import { afterAll, describe, expect, it } from "vitest";
import postgresDriver from "postgres";

// Integration test: needs a reachable Postgres. Runs against the dev/CI
// database server using a dedicated crosstown_test database; skips (with a
// warning) when no server is up.
const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/crosstown_test";

async function ensureTestDb(): Promise<boolean> {
  const adminUrl = TEST_URL.replace(/\/[^/]+$/, "/postgres");
  const dbName = TEST_URL.split("/").pop()!;
  const admin = postgresDriver(adminUrl, { onnotice: () => {}, connect_timeout: 3 });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await admin.unsafe(`create database "${dbName}"`);
    return true;
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 1 });
  }
}

const available = await ensureTestDb();
if (!available) {
  console.warn(`trip-updates integration test skipped: no postgres at ${TEST_URL}`);
}

process.env.DATABASE_URL = TEST_URL;
const { db, sql, runMigrations } = available ? await import("../db/index.js") : ({} as never);
const { upsertCandidates } = available ? await import("./trip-updates.js") : ({} as never);
const { stopEvents, stopTimes } = await import("../db/schema.js");

afterAll(async () => {
  if (available) await sql.end({ timeout: 1 });
});

// The GTFS service-day origin is "local noon minus 12h". These are the
// known-correct origins (as UTC instants) the SQL must reproduce.
const ORIGINS = {
  edt: { date: "2026-06-09", epoch: Date.parse("2026-06-09T04:00:00Z") / 1000 },
  est: { date: "2026-01-15", epoch: Date.parse("2026-01-15T05:00:00Z") / 1000 },
  // Spring forward: the service day is 23h long and its origin is 11pm
  // EST the previous calendar day (noon EDT minus 12h).
  dst: { date: "2026-03-08", epoch: Date.parse("2026-03-08T04:00:00Z") / 1000 },
};

const candidate = (over: Partial<Parameters<typeof upsertCandidates>[0][number]>) => ({
  serviceDate: ORIGINS.edt.date,
  tripId: "trip-a",
  stopSequence: 1,
  routeId: "R1",
  stopId: "S1",
  eventEpoch: 0,
  isDeparture: false,
  ...over,
});

describe.runIf(available)("upsertCandidates delay math", () => {
  it("computes delay against the schedule across timezones and DST", async () => {
    await runMigrations();
    await db.delete(stopEvents);
    await db.delete(stopTimes);

    await db.insert(stopTimes).values([
      // 08:30:00 scheduled arrival, 08:35:00 departure
      { tripId: "trip-a", stopSequence: 1, stopId: "S1", arrivalSec: 30600, departureSec: 30900 },
      // past-midnight stop: 25:30:00 (1:30am next calendar day)
      { tripId: "trip-a", stopSequence: 2, stopId: "S2", arrivalSec: 91800, departureSec: 91800 },
      // "02:30:00" on the spring-forward day
      { tripId: "trip-b", stopSequence: 1, stopId: "S3", arrivalSec: 9000, departureSec: 9000 },
    ]);

    await upsertCandidates([
      // EDT: 90s late at an 08:30 stop
      candidate({ eventEpoch: ORIGINS.edt.epoch + 30600 + 90 }),
      // EDT past-midnight: 120s late at the 25:30 stop
      candidate({ stopSequence: 2, stopId: "S2", eventEpoch: ORIGINS.edt.epoch + 91800 + 120 }),
      // spring-forward day: exactly on time
      candidate({
        serviceDate: ORIGINS.dst.date,
        tripId: "trip-b",
        stopId: "S3",
        eventEpoch: ORIGINS.dst.epoch + 9000,
      }),
      // EST (winter): 45s early at the 08:30 stop
      candidate({ serviceDate: ORIGINS.est.date, eventEpoch: ORIGINS.est.epoch + 30600 - 45 }),
    ]);

    const rows = await db.select().from(stopEvents);
    const get = (serviceDate: string, tripId: string, seq: number) =>
      rows.find(
        (r) => r.serviceDate === serviceDate && r.tripId === tripId && r.stopSequence === seq,
      )!;

    expect(get(ORIGINS.edt.date, "trip-a", 1).delaySec).toBe(90);
    expect(get(ORIGINS.edt.date, "trip-a", 2).delaySec).toBe(120);
    expect(get(ORIGINS.dst.date, "trip-b", 1).delaySec).toBe(0);
    expect(get(ORIGINS.est.date, "trip-a", 1).delaySec).toBe(-45);
  });

  it("compares departure-only events to the scheduled departure", async () => {
    await upsertCandidates([
      // 60s after scheduled departure (30900); against arrival it would be 360
      candidate({ eventEpoch: ORIGINS.edt.epoch + 30900 + 60, isDeparture: true }),
    ]);
    const rows = await db.select().from(stopEvents);
    const updated = rows.find(
      (r) => r.serviceDate === ORIGINS.edt.date && r.tripId === "trip-a" && r.stopSequence === 1,
    )!;
    expect(updated.delaySec).toBe(60);
  });

  it("rewrites the same row on conflict", async () => {
    await upsertCandidates([candidate({ eventEpoch: ORIGINS.edt.epoch + 30600 + 300 })]);
    const rows = await db.select().from(stopEvents);
    const matching = rows.filter(
      (r) => r.serviceDate === ORIGINS.edt.date && r.tripId === "trip-a" && r.stopSequence === 1,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.delaySec).toBe(300);
  });
});
