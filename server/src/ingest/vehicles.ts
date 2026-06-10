import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { FastifyBaseLogger } from "fastify";
import { lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { vehiclePositions } from "../db/schema.js";

const VEHICLE_FEED_URL =
  process.env.VEHICLE_FEED_URL ??
  "https://gtfs-rt.cota.vontascloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb";

export const POLL_INTERVAL_MS = 15_000;
const RETENTION_HOURS = 48;

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

export async function pollVehiclesOnce(log: FastifyBaseLogger) {
  const res = await fetch(VEHICLE_FEED_URL);
  if (!res.ok) throw new Error(`vehicle feed responded ${res.status}`);
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(await res.arrayBuffer()),
  );

  const next: VehicleSnapshot[] = [];
  const fresh: (typeof vehiclePositions.$inferInsert)[] = [];

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
      bearing: pos.bearing ?? null,
      speed: pos.speed ?? null,
      ts: new Date(tsMs).toISOString(),
    };
    next.push(row);

    // Feed repeats unchanged pings between polls; only store movement.
    if (lastSeenTs.get(vehicleId) !== tsMs) {
      lastSeenTs.set(vehicleId, tsMs);
      fresh.push({ ...row, ts: new Date(tsMs) });
    }
  }

  snapshot = next;
  snapshotAt = new Date().toISOString();
  const payload = getSnapshot();
  for (const fn of listeners) fn(payload);

  if (fresh.length > 0) {
    await db.insert(vehiclePositions).values(fresh);
  }
  log.info({ vehicles: next.length, stored: fresh.length }, "vehicle poll");
}

export async function pruneVehiclePositions(log: FastifyBaseLogger) {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600 * 1000);
  await db.delete(vehiclePositions).where(lt(vehiclePositions.ts, cutoff));
  log.info({ cutoff: cutoff.toISOString() }, "pruned vehicle positions");
}

export function startVehicleIngest(log: FastifyBaseLogger) {
  const tick = () =>
    pollVehiclesOnce(log).catch((err) => log.warn({ err }, "vehicle poll failed"));
  const prune = () =>
    pruneVehiclePositions(log).catch((err) => log.warn({ err }, "prune failed"));

  tick();
  prune();
  const pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  const pruneTimer = setInterval(prune, 3600 * 1000);
  return () => {
    clearInterval(pollTimer);
    clearInterval(pruneTimer);
  };
}
