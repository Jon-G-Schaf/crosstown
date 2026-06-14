import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { FastifyBaseLogger } from "fastify";
import { lt } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { stopEvents } from "../db/schema.js";

const TRIP_FEED_URL =
  process.env.TRIP_FEED_URL ??
  "https://gtfs-rt.cota.vontascloud.com/TMGTFSRealTimeWebService/TripUpdate/TripUpdates.pb";

// The feed regenerates on a 30s cycle (measured June 11); polling faster
// than that just re-downloads identical bytes.
export const TRIP_POLL_INTERVAL_MS = 30_000;
// Raw stop_events are only read for "today" (live stats) and by the hourly
// rollup that finalizes each service day into route_day_stats; nothing reads
// raw rows older than that. route_day_stats holds the permanent history, so a
// short raw-retention window has no product impact and keeps the 500MB volume
// from filling (90 days would reach ~600MB on its own). 7 days leaves a wide
// buffer for rollup re-runs and audits.
const RETENTION_DAYS = 7;
const TZ = "America/New_York";

// The feed honors If-Modified-Since with a 304, so an unchanged file costs
// nothing: no download, no decode, no upsert. Skipping the upsert also means
// last_seen freezes while the feed is stalled, which is what the observed-
// event window in lib/reliability.ts wants (stale predictions should age
// into ghosts, not stay perpetually "fresh").
let feedLastModified: string | null = null;

const { ScheduleRelationship } =
  GtfsRealtimeBindings.transit_realtime.TripUpdate.StopTimeUpdate;

function toEpochSec(ts: number | { toNumber(): number } | null | undefined): number | null {
  if (ts == null) return null;
  const n = typeof ts === "number" ? ts : ts.toNumber();
  return n > 0 ? n : null;
}

// "20260610" -> "2026-06-10"
function parseServiceDate(d: string | null | undefined): string | null {
  if (!d || !/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export type Candidate = {
  serviceDate: string;
  tripId: string;
  stopSequence: number;
  routeId: string;
  stopId: string;
  eventEpoch: number;
  // true when the feed gave a departure time only; the delay is then
  // computed against the scheduled departure rather than arrival
  isDeparture: boolean;
};

// COTA's TripUpdates carry predicted arrival times but no delay field, so
// delay is computed here against the static schedule: the service day starts
// at "local noon minus 12h" (GTFS convention, DST-safe) and stop_times holds
// seconds from that origin. Candidates go through a temp table so the
// schedule join and delay math happen set-based in SQL, without holding
// 360k stop_times in process memory. Exported for the integration test.
export async function upsertCandidates(rows: Candidate[]) {
  const records = rows.map((r) => ({
    service_date: r.serviceDate,
    trip_id: r.tripId,
    stop_sequence: r.stopSequence,
    route_id: r.routeId,
    stop_id: r.stopId,
    event_epoch: r.eventEpoch,
    is_departure: r.isDeparture,
  }));

  await sql.begin(async (tx) => {
    await tx`
      create temp table tmp_stop_updates (
        service_date date,
        trip_id text,
        stop_sequence int,
        route_id text,
        stop_id text,
        event_epoch bigint,
        is_departure boolean
      ) on commit drop
    `;
    const chunkSize = 2000;
    for (let i = 0; i < records.length; i += chunkSize) {
      await tx`insert into tmp_stop_updates ${tx(records.slice(i, i + chunkSize))}`;
    }
    await tx`
      insert into stop_events
        (service_date, trip_id, stop_sequence, route_id, stop_id, delay_sec, event_time, last_seen)
      select
        u.service_date,
        u.trip_id,
        u.stop_sequence,
        u.route_id,
        u.stop_id,
        (u.event_epoch
          - (extract(epoch from ((u.service_date::timestamp + interval '12 hours') at time zone ${TZ}))::bigint - 43200)
          - case when u.is_departure
              then coalesce(st.departure_sec, st.arrival_sec)
              else coalesce(st.arrival_sec, st.departure_sec) end
        )::int as delay_sec,
        to_timestamp(u.event_epoch),
        now()
      from tmp_stop_updates u
      join stop_times st
        on st.trip_id = u.trip_id and st.stop_sequence = u.stop_sequence
      where coalesce(st.arrival_sec, st.departure_sec) is not null
      on conflict (service_date, trip_id, stop_sequence) do update set
        delay_sec = excluded.delay_sec,
        event_time = excluded.event_time,
        last_seen = excluded.last_seen
    `;
  });
}

export async function pollTripUpdatesOnce(log: FastifyBaseLogger) {
  const res = await fetch(TRIP_FEED_URL, {
    headers: feedLastModified ? { "if-modified-since": feedLastModified } : undefined,
  });
  if (res.status === 304) {
    log.info("trip updates poll: feed unchanged");
    return;
  }
  if (!res.ok) throw new Error(`trip feed responded ${res.status}`);
  feedLastModified = res.headers.get("last-modified");
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(await res.arrayBuffer()),
  );

  const byKey = new Map<string, Candidate>();
  let skipped = 0;

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    const routeId = tu?.trip?.routeId;
    const serviceDate = parseServiceDate(tu?.trip?.startDate);
    if (!tu || !tripId || !routeId || !serviceDate) {
      skipped++;
      continue;
    }

    for (const stu of tu.stopTimeUpdate ?? []) {
      if (
        stu.scheduleRelationship === ScheduleRelationship.SKIPPED ||
        stu.scheduleRelationship === ScheduleRelationship.NO_DATA
      ) {
        continue;
      }
      const arrivalEpoch = toEpochSec(stu.arrival?.time);
      const eventEpoch = arrivalEpoch ?? toEpochSec(stu.departure?.time);
      if (eventEpoch == null || stu.stopSequence == null || !stu.stopId) {
        skipped++;
        continue;
      }
      byKey.set(`${serviceDate}|${tripId}|${stu.stopSequence}`, {
        serviceDate,
        tripId,
        stopSequence: stu.stopSequence,
        routeId,
        stopId: stu.stopId,
        eventEpoch,
        isDeparture: arrivalEpoch == null,
      });
    }
  }

  const rows = [...byKey.values()];
  if (rows.length > 0) {
    await upsertCandidates(rows);
  }

  log.info({ candidates: rows.length, skipped }, "trip updates poll");
}

export async function pruneStopEvents(log: FastifyBaseLogger) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  await db.delete(stopEvents).where(lt(stopEvents.serviceDate, cutoff));
  log.info({ cutoff }, "pruned stop events");
}

export function startTripUpdateIngest(log: FastifyBaseLogger) {
  const tick = () =>
    pollTripUpdatesOnce(log).catch((err) => log.warn({ err }, "trip updates poll failed"));
  const prune = () =>
    pruneStopEvents(log).catch((err) => log.warn({ err }, "stop events prune failed"));

  tick();
  prune();
  const pollTimer = setInterval(tick, TRIP_POLL_INTERVAL_MS);
  const pruneTimer = setInterval(prune, 24 * 3600 * 1000);
  return () => {
    clearInterval(pollTimer);
    clearInterval(pruneTimer);
  };
}
