import type { FastifyBaseLogger } from "fastify";
import { sql } from "../db/index.js";
import { pruneVehiclePositions } from "../ingest/vehicles.js";
import { pruneStopEvents } from "../ingest/trip-updates.js";

// Backstop for the fixed 500MB volume, which filled and crash-looped Postgres
// twice (June 14 and 17 2026). The structural fixes (short retention, ping
// downsampling, a 64MB WAL ceiling) keep steady state near 200MB; this watches
// database + WAL size and, if it crosses the high-water mark, recycles WAL and
// re-enforces retention. It deliberately does NOT VACUUM FULL: that needs free
// space and an exclusive lock the near-full case can't afford (the offline
// TRUNCATE/COPY reclaim handles a true fill). So it caps growth and alerts; it
// cannot shrink files, so a genuinely over-full heap stays reported until the
// offline reclaim runs.

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000; // let boot and any crash recovery settle first
const HIGH_WATER_MB = 340; // volume is ~434MB usable
const QUERY_STATS_HIGH_WATER_MB = 32;

type DiskUsage = { dbMb: number; walMb: number; statsMb: number; totalMb: number };

// Account for the whole Postgres cluster, not just the application database.
// pg_database_size(current_database()) previously missed the template/system
// databases and, more importantly, pg_stat_statements' append-only query-text
// file (88MB during the July 1 incident). Filesystem metadata is still outside
// SQL's view, so HIGH_WATER_MB deliberately leaves substantial headroom.
export async function usageMb(): Promise<DiskUsage> {
  const db = await sql<{ bytes: string }[]>`
    select coalesce(sum(pg_database_size(datname)), 0)::bigint as bytes
    from pg_database
  `;
  const dbMb = Number(db[0]?.bytes ?? 0) / 1048576;
  let walMb = 0;
  try {
    // pg_ls_waldir() needs superuser/pg_monitor; WAL is capped by max_wal_size
    // anyway, so fall back to the database size alone when not privileged.
    const wal = await sql<{ bytes: string }[]>`
      select coalesce(sum(size), 0)::bigint as bytes from pg_ls_waldir()
    `;
    walMb = Number(wal[0]?.bytes ?? 0) / 1048576;
  } catch {
    // not privileged for pg_ls_waldir(); skip the WAL component
  }
  let statsMb = 0;
  try {
    const stats = await sql<{ bytes: string }[]>`
      select coalesce(
        (pg_stat_file('pg_stat_tmp/pgss_query_texts.stat', true)).size,
        0
      )::bigint as bytes
    `;
    statsMb = Number(stats[0]?.bytes ?? 0) / 1048576;
  } catch {
    // pg_stat_file needs elevated privileges and the file is optional.
  }
  return { dbMb, walMb, statsMb, totalMb: dbMb + walMb + statsMb };
}

async function resetQueryStats(log: FastifyBaseLogger) {
  try {
    await sql`select pg_stat_statements_reset()`;
    log.warn("disk guard: reset oversized pg_stat_statements query text");
    return true;
  } catch (err) {
    log.warn({ err }, "disk guard: query statistics reset failed");
    return false;
  }
}

export function startDiskGuard(log: FastifyBaseLogger) {
  let busy = false;
  const run = async () => {
    if (busy) return; // a slow prune must not overlap the next tick
    busy = true;
    try {
      let u = await usageMb();
      if (u.statsMb >= QUERY_STATS_HIGH_WATER_MB && (await resetQueryStats(log))) {
        u = await usageMb();
      }
      const line = {
        dbMb: Math.round(u.dbMb),
        walMb: Math.round(u.walMb),
        statsMb: Math.round(u.statsMb),
        totalMb: Math.round(u.totalMb),
        highWaterMb: HIGH_WATER_MB,
      };
      if (u.totalMb < HIGH_WATER_MB) {
        log.info(line, "disk guard");
        return;
      }
      log.error(line, "disk guard: over high water");
      // Recycle WAL first: it's cheap and is the entire fix when WAL is what
      // grew, so no data is deleted in that case.
      await sql`checkpoint`;
      const after = await usageMb();
      if (after.totalMb >= HIGH_WATER_MB) {
        // Still over after the checkpoint, so the heap is the driver: re-enforce
        // the normal retention windows via the same helpers the ingest jobs use,
        // in case their periodic prunes fell behind.
        await pruneVehiclePositions(log);
        await pruneStopEvents(log);
        log.warn(
          { ...line, afterCheckpointMb: Math.round(after.totalMb) },
          "disk guard: re-enforced retention",
        );
      }
    } catch (err) {
      log.warn({ err }, "disk guard check failed");
    } finally {
      busy = false;
    }
  };

  const first = setTimeout(run, FIRST_CHECK_MS);
  const timer = setInterval(run, CHECK_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
