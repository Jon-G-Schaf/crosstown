import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { FastifyBaseLogger } from "fastify";
import { lt } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { vehiclePositions } from "../db/schema.js";
import { startSingleFlight } from "../lib/single-flight.js";

const VEHICLE_FEED_URL =
  process.env.VEHICLE_FEED_URL ??
  "https://gtfs-rt.cota.vontascloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb";

// The feed regenerates on a 30s cycle (measured June 11); 15s polling halves
// the pickup latency, and If-Modified-Since makes the unchanged poll free.
export const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;
const RETENTION_HOURS = 48;
// Store at most one ping per vehicle per minute. The live map reads the
// in-memory snapshot (full resolution), and the replay query buckets at 120s,
// so storing the raw ~30s feed cadence just doubled vehicle_positions and
// helped fill the 500MB volume (June 17 2026). 60s halves the table with no
// visible loss.
const STORE_BUCKET_MS = 60_000;

export type VehicleSnapshot = {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
  speed: number | null;
  ts: string;
};

// Latest snapshot kept in memory; /api/vehicles never has to hit the DB.
let snapshot: VehicleSnapshot[] = [];
let snapshotAt: string | null = null;
const lastSeenTs = new Map<string, number>();
const lastStoredBucket = new Map<string, number>();

export type SnapshotPayload = { vehicles: VehicleSnapshot[]; updatedAt: string | null };

const listeners = new Set<(snap: SnapshotPayload) => void>();

export function getSnapshot(): SnapshotPayload {
  return { vehicles: snapshot, updatedAt: snapshotAt };
}

export function subscribeToSnapshots(fn: (snap: SnapshotPayload) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function toMillis(ts: number | { toNumber(): number } | null | undefined): number | null {
  if (ts == null) return null;
  const n = typeof ts === "number" ? ts : ts.toNumber();
  return n > 0 ? n * 1000 : null;
}

// protobufjs puts field defaults on the prototype, so an absent bearing
// reads as 0 ("due north") through plain property access. Only own
// properties were actually on the wire; everything else is unknown.
function wireNumber(obj: object, key: string): number | null {
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj as Record<string, number>)[key]!
    : null;
}

let feedLastModified: string | null = null;

export async function pollVehiclesOnce(log: FastifyBaseLogger) {
  const res = await fetch(VEHICLE_FEED_URL, {
    headers: feedLastModified ? { "if-modified-since": feedLastModified } : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 304) {
    log.info("vehicle poll: feed unchanged");
    return;
  }
  if (!res.ok) throw new Error(`vehicle feed responded ${res.status}`);
  const nextLastModified = res.headers.get("last-modified");
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(await res.arrayBuffer()),
  );

  const next: VehicleSnapshot[] = [];
  const fresh: (typeof vehiclePositions.$inferInsert)[] = [];
  const stateUpdates: { vehicleId: string; tsMs: number; bucket: number }[] = [];

  for (const entity of feed.entity) {
    const v = entity.vehicle;
    const pos = v?.position;
    const vehicleId = v?.vehicle?.id;
    if (!v || !pos || !vehicleId) continue;

    const tsMs = toMillis(v.timestamp) ?? Date.now();
    const row: VehicleSnapshot = {
      vehicleId,
      tripId: v.trip?.tripId ?? null,
      routeId: v.trip?.routeId ?? null,
      lat: pos.latitude,
      lon: pos.longitude,
      bearing: wireNumber(pos, "bearing"),
      speed: wireNumber(pos, "speed"),
      ts: new Date(tsMs).toISOString(),
    };
    next.push(row);

    // Feed repeats unchanged pings between polls; only store movement, and at
    // most one row per vehicle per STORE_BUCKET_MS so the table stays small.
    if (lastSeenTs.get(vehicleId) !== tsMs) {
      const bucket = Math.floor(tsMs / STORE_BUCKET_MS);
      if (lastStoredBucket.get(vehicleId) !== bucket) {
        fresh.push({ ...row, ts: new Date(tsMs) });
      }
      stateUpdates.push({ vehicleId, tsMs, bucket });
    }
  }

  snapshot = next;
  snapshotAt = new Date().toISOString();
  const payload = getSnapshot();
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      log.warn({ err }, "vehicle snapshot listener failed");
    }
  }

  if (fresh.length > 0) {
    await db.insert(vehiclePositions).values(fresh);
  }
  for (const update of stateUpdates) {
    lastSeenTs.set(update.vehicleId, update.tsMs);
    lastStoredBucket.set(update.vehicleId, update.bucket);
  }
  // Only advance the validator after decoding and persistence succeed. If
  // either fails, the same feed revision must be retried rather than skipped
  // by a 304 on the next poll.
  feedLastModified = nextLastModified;
  log.info({ vehicles: next.length, stored: fresh.length }, "vehicle poll");
}

export async function pruneVehiclePositions(log: FastifyBaseLogger) {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600 * 1000);
  await db.delete(vehiclePositions).where(lt(vehiclePositions.ts, cutoff));
  log.info({ cutoff: cutoff.toISOString() }, "pruned vehicle positions");
}

// lastSeenTs and lastStoredBucket are in-memory, so a restart would re-insert
// each vehicle's current ping as a duplicate row. Seed both from the latest
// stored pings.
async function seedLastSeen() {
  const rows = await sql<{ vehicle_id: string; ts: Date }[]>`
    select vehicle_id, max(ts) as ts
    from vehicle_positions
    where ts > now() - interval '2 hours'
    group by vehicle_id
  `;
  for (const r of rows) {
    const ms = new Date(r.ts).getTime();
    lastSeenTs.set(r.vehicle_id, ms);
    lastStoredBucket.set(r.vehicle_id, Math.floor(ms / STORE_BUCKET_MS));
  }
}

export function startVehicleIngest(log: FastifyBaseLogger) {
  const prune = () =>
    pruneVehiclePositions(log).catch((err) => log.warn({ err }, "prune failed"));

  let stopped = false;
  let stopPoll: (() => void) | null = null;
  seedLastSeen().catch((err) => log.warn({ err }, "last-seen seed failed")).finally(() => {
    if (stopped) return;
    stopPoll = startSingleFlight({
      intervalMs: POLL_INTERVAL_MS,
      run: () => pollVehiclesOnce(log),
      onError: (err) => log.warn({ err }, "vehicle poll failed"),
    });
  });
  prune();
  const pruneTimer = setInterval(prune, 3600 * 1000);
  return () => {
    stopped = true;
    stopPoll?.();
    clearInterval(pruneTimer);
  };
}
