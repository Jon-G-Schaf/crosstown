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
  console.warn(`rollup integration test skipped: no postgres at ${TEST_URL}`);
}

process.env.DATABASE_URL = TEST_URL;
const { db, sql, runMigrations } = available ? await import("../db/index.js") : ({} as never);
const { rollupServiceDate } = available ? await import("./rollup.js") : ({} as never);
const { stopEvents, routeDayStats } = await import("../db/schema.js");

afterAll(async () => {
  if (available) await sql.end({ timeout: 1 });
});

// June dates are EDT (UTC-4): local hour H = UTC hour H+4.
const DATE = "2026-06-09";
const at = (utcHourMinute: string) => new Date(`${DATE}T${utcHourMinute}:00Z`);

describe.runIf(available)("rollupServiceDate", () => {
  it("aggregates a day into per-daypart and all buckets", async () => {
    await runMigrations();
    await db.delete(stopEvents);
    await db.delete(routeDayStats);

    const seed = (
      tripId: string,
      stopSequence: number,
      routeId: string,
      delaySec: number,
      eventTime: Date,
    ) => ({
      serviceDate: DATE,
      tripId,
      stopSequence,
      routeId,
      stopId: "S1",
      delaySec,
      eventTime,
      lastSeen: new Date(),
    });

    await db.insert(stopEvents).values([
      // route A, am_peak (local 08:00 = 12:00Z): on-time, on-time, late
      seed("t1", 1, "A", 0, at("12:00")),
      seed("t1", 2, "A", 100, at("12:10")),
      seed("t1", 3, "A", 400, at("12:20")),
      // route A, pm_peak (local 16:00 = 20:00Z): too early
      seed("t2", 1, "A", -120, at("20:00")),
      // route B, midday (local 12:00 = 16:00Z): both on time
      seed("t3", 1, "B", 0, at("16:00")),
      seed("t3", 2, "B", 60, at("16:05")),
    ]);

    await rollupServiceDate(DATE);

    const rows = await db.select().from(routeDayStats);
    const get = (routeId: string, daypart: string) =>
      rows.find((r) => r.routeId === routeId && r.daypart === daypart);

    const aAm = get("A", "am_peak")!;
    expect(aAm.observations).toBe(3);
    expect(aAm.onTimePct).toBeCloseTo(66.67, 1);
    expect(aAm.avgDelaySec).toBeCloseTo(166.67, 1);
    expect(aAm.p90DelaySec).toBeCloseTo(340, 0); // percentile_cont over [0,100,400]

    const aPm = get("A", "pm_peak")!;
    expect(aPm.observations).toBe(1);
    expect(aPm.onTimePct).toBe(0); // -120s is earlier than the -60s window

    const aAll = get("A", "all")!;
    expect(aAll.observations).toBe(4);
    expect(aAll.onTimePct).toBeCloseTo(50, 1);

    const bAll = get("B", "all")!;
    expect(bAll.observations).toBe(2);
    expect(bAll.onTimePct).toBe(100);

    expect(get("B", "am_peak")).toBeUndefined();
  });

  it("is idempotent on re-run", async () => {
    await rollupServiceDate(DATE);
    const rows = await db.select().from(routeDayStats);
    expect(rows.filter((r) => r.routeId === "A")).toHaveLength(3); // am_peak, pm_peak, all
  });
});
