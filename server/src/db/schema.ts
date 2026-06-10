import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Static GTFS (loaded by scripts/load-gtfs.ts, replaced wholesale on each load)

export const routes = pgTable("routes", {
  routeId: text("route_id").primaryKey(),
  shortName: text("short_name").notNull(),
  longName: text("long_name").notNull().default(""),
  type: integer("type").notNull().default(3),
  color: text("color"),
  textColor: text("text_color"),
  sortOrder: integer("sort_order"),
});

export const stops = pgTable("stops", {
  stopId: text("stop_id").primaryKey(),
  code: text("code"),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
});

export const trips = pgTable(
  "trips",
  {
    tripId: text("trip_id").primaryKey(),
    routeId: text("route_id").notNull(),
    serviceId: text("service_id").notNull(),
    headsign: text("headsign"),
    directionId: integer("direction_id"),
    shapeId: text("shape_id"),
    blockId: text("block_id"),
  },
  (t) => [index("trips_route_idx").on(t.routeId)],
);

// arrival/departure are seconds since "noon minus 12h" (GTFS time, can exceed 24:00:00)
export const stopTimes = pgTable(
  "stop_times",
  {
    tripId: text("trip_id").notNull(),
    stopSequence: integer("stop_sequence").notNull(),
    stopId: text("stop_id").notNull(),
    arrivalSec: integer("arrival_sec"),
    departureSec: integer("departure_sec"),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.stopSequence] }),
    index("stop_times_stop_idx").on(t.stopId),
  ],
);

// One row per shape, coordinates as [lon, lat] pairs ready for GeoJSON
export const shapes = pgTable("shapes", {
  shapeId: text("shape_id").primaryKey(),
  coordinates: jsonb("coordinates").$type<[number, number][]>().notNull(),
});

export const calendar = pgTable("calendar", {
  serviceId: text("service_id").primaryKey(),
  monday: boolean("monday").notNull(),
  tuesday: boolean("tuesday").notNull(),
  wednesday: boolean("wednesday").notNull(),
  thursday: boolean("thursday").notNull(),
  friday: boolean("friday").notNull(),
  saturday: boolean("saturday").notNull(),
  sunday: boolean("sunday").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
});

export const calendarDates = pgTable(
  "calendar_dates",
  {
    serviceId: text("service_id").notNull(),
    date: date("date").notNull(),
    exceptionType: integer("exception_type").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.date] })],
);

// Realtime: raw vehicle pings, pruned after 48h (see ingest/retention)
export const vehiclePositions = pgTable(
  "vehicle_positions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vehicleId: text("vehicle_id").notNull(),
    tripId: text("trip_id"),
    routeId: text("route_id"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    bearing: real("bearing"),
    speed: real("speed"),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vehicle_positions_ts_idx").on(t.ts),
    index("vehicle_positions_route_ts_idx").on(t.routeId, t.ts),
  ],
);

// One row per (service day, trip, stop). TripUpdates keeps rewriting the row
// until the bus passes the stop; the final value is the last prediction
// before arrival, which is as close to "actual" as the feed gets.
export const stopEvents = pgTable(
  "stop_events",
  {
    serviceDate: date("service_date").notNull(),
    tripId: text("trip_id").notNull(),
    stopSequence: integer("stop_sequence").notNull(),
    routeId: text("route_id").notNull(),
    stopId: text("stop_id").notNull(),
    delaySec: integer("delay_sec").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceDate, t.tripId, t.stopSequence] }),
    index("stop_events_route_date_idx").on(t.routeId, t.serviceDate),
    index("stop_events_stop_date_idx").on(t.stopId, t.serviceDate),
  ],
);

// Nightly rollup of stop_events; daypart 'all' covers the whole service day
export const routeDayStats = pgTable(
  "route_day_stats",
  {
    routeId: text("route_id").notNull(),
    serviceDate: date("service_date").notNull(),
    daypart: text("daypart").notNull(),
    observations: integer("observations").notNull(),
    onTimePct: real("on_time_pct").notNull(),
    avgDelaySec: real("avg_delay_sec").notNull(),
    p90DelaySec: real("p90_delay_sec").notNull(),
  },
  (t) => [primaryKey({ columns: [t.routeId, t.serviceDate, t.daypart] })],
);

export const gtfsMeta = pgTable("gtfs_meta", {
  id: integer("id").primaryKey().default(1),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
});
