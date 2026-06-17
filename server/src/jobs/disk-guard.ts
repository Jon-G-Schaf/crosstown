import type { FastifyBaseLogger } from "fastify";
import { sql } from "../db/index.js";

// The Postgres volume is a fixed 500MB and has filled twice (June 14 and 17,
// 2026), each time crash-looping the database with no headroom to recover.
// Retention, ping downsampling and a 64MB WAL ceiling keep steady state near
// 200MB, but this is the backstop: it watches total volume use (database heap
// plus WAL) and, if it ever climbs past the high-water mark, force-prunes the
// churn tables so the disk cannot fill. Plain VACUUM does not shrink files, but
// it returns freed space for reuse in place, which halts further growth.

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
// The volume is ~434MB usable; act with a wide margin to spare.
const HIGH_WATER_MB = 340;

async function usageMb(): Promise<{ dbMb: number; walMb: number; totalMb: number }> {
  const rows = await sql<{ db: string; wal: string }[]>`
    select
      pg_database_size(current_database())::bigint as db,
      coalesce((select sum(size) from pg_ls_waldir()), 0)::bigint as wal
  `;
  const row = rows[0];
  if (!row) return { dbMb: 0, walMb: 0, totalMb: 0 };
  const dbMb = Number(row.db) / 1048576;
  const walMb = Number(row.wal) / 1048576;
  return { dbMb, walMb, totalMb: dbMb + walMb };
}

async function emergencyPrune(log: FastifyBaseLogger) {
  // Tighter than the normal retention windows. vehicle_positions is raw pings
  // that regenerate; stop_events keeps two days so the rollup can still run.
  await sql`delete from vehicle_positions where ts < now() - interval '24 hours'`;
  await sql`delete from stop_events where service_date < current_date - 2`;
  await sql`vacuum (analyze) vehicle_positions`;
  await sql`vacuum (analyze) stop_events`;
  await sql`checkpoint`;
  log.warn("disk guard: emergency prune complete");
}

export function startDiskGuard(log: FastifyBaseLogger) {
  const run = async () => {
    try {
      const u = await usageMb();
      const line = {
        dbMb: Math.round(u.dbMb),
        walMb: Math.round(u.walMb),
        totalMb: Math.round(u.totalMb),
        highWaterMb: HIGH_WATER_MB,
      };
      if (u.totalMb >= HIGH_WATER_MB) {
        log.error(line, "disk guard: over high water, pruning");
        await emergencyPrune(log);
      } else {
        log.info(line, "disk guard");
      }
    } catch (err) {
      log.warn({ err }, "disk guard check failed");
    }
  };

  run();
  const timer = setInterval(run, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}
