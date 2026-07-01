import type { FastifyInstance } from "fastify";
import { sql as dsql } from "drizzle-orm";
import { db } from "../db/index.js";

// Downsample cadence: one position per vehicle per bucket. 120s keeps the
// payload to a few hundred KB over 24h while staying smooth once the client
// interpolates between samples.
const BUCKET_SEC = 120;
const DEFAULT_HOURS = 24;
const MAX_HOURS = 48;
const CACHE_MS = 60_000;

export type ReplayTrack = {
  vehicleId: string;
  routeId: string | null;
  // [t, lon, lat, bearing] with t = seconds from window start, bearing null
  // when the feed omitted it. Sorted ascending by t.
  samples: [number, number, number, number | null][];
};

type ReplayBody = {
  start: string;
  end: string;
  bucketSec: number;
  tracks: ReplayTrack[];
};

const cache = new Map<number, { at: number; body: ReplayBody }>();

function parseHours(raw: unknown): number {
  const n = Math.round(Number(raw ?? DEFAULT_HOURS));
  if (!Number.isFinite(n)) return DEFAULT_HOURS;
  return Math.min(MAX_HOURS, Math.max(1, n));
}

// Downsample vehicle_positions in [start, end) to one ping per vehicle per
// BUCKET_SEC bucket (latest ping in the bucket wins), grouped into per-vehicle
// tracks. Exported for the integration test.
export async function loadReplayTracks(start: Date, end: Date): Promise<ReplayTrack[]> {
  // Pass timestamps as ISO strings cast to timestamptz (the driver serializes
  // text trivially; raw Date / interval bind params are flaky through this
  // path). The bucket size is a trusted constant, inlined as a literal.
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const bucketLiteral = dsql.raw(`interval '${BUCKET_SEC} seconds'`);

  const rows = await db.execute<{
    vehicle_id: string;
    route_id: string | null;
    t: number;
    lon: number;
    lat: number;
    bearing: number | null;
  }>(dsql`
    select
      vehicle_id,
      route_id,
      extract(epoch from (bucket - ${startIso}::timestamptz))::int as t,
      lon,
      lat,
      bearing
    from (
      -- one row per (vehicle, bucket), the latest ping in the bucket. Bucket is
      -- computed once in the inner query so DISTINCT ON and ORDER BY reference
      -- the same plain column.
      select distinct on (vehicle_id, bucket)
        vehicle_id,
        route_id,
        bucket,
        lon,
        lat,
        bearing
      from (
        select
          vehicle_id,
          route_id,
          date_bin(${bucketLiteral}, ts, ${startIso}::timestamptz) as bucket,
          round(lon::numeric, 5)::float8 as lon,
          round(lat::numeric, 5)::float8 as lat,
          bearing,
          ts
        from vehicle_positions
        where ts >= ${startIso}::timestamptz and ts < ${endIso}::timestamptz
      ) binned
      order by vehicle_id, bucket, ts desc
    ) s
    order by vehicle_id, bucket
  `);

  // A physical bus can serve several routes during a 24-hour window. Keep
  // route-contiguous segments separate so the replay never colors a later run
  // with the vehicle's first route or interpolates across a route change.
  const tracks: ReplayTrack[] = [];
  let current: ReplayTrack | null = null;
  const finishCurrent = () => {
    if (current && current.samples.length >= 2) tracks.push(current);
  };
  for (const r of rows) {
    if (
      !current ||
      current.vehicleId !== r.vehicle_id ||
      current.routeId !== r.route_id
    ) {
      finishCurrent();
      current = { vehicleId: r.vehicle_id, routeId: r.route_id, samples: [] };
    }
    current.samples.push([r.t, r.lon, r.lat, r.bearing]);
  }
  finishCurrent();

  // A single ping can't be interpolated into movement; drop those tracks.
  return tracks;
}

export async function replayPlugin(app: FastifyInstance) {
  // Historical vehicle_positions for the last N hours, downsampled to one ping
  // per vehicle per BUCKET_SEC bucket (the latest ping in the bucket wins via
  // DISTINCT ON). Grouped into per-vehicle tracks the client plays back and
  // scrubs. Read-only; rolling window, so a short cache keeps the full-window
  // scan off the hot path.
  app.get<{ Querystring: { hours?: string } }>("/api/replay", async (req) => {
    const hours = parseHours(req.query.hours);
    const cached = cache.get(hours);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;

    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const tracks = await loadReplayTracks(start, end);

    const body: ReplayBody = {
      start: start.toISOString(),
      end: end.toISOString(),
      bucketSec: BUCKET_SEC,
      tracks,
    };
    cache.set(hours, { at: Date.now(), body });
    return body;
  });
}
