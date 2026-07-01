import { afterAll, describe, expect, it } from "vitest";
import postgresDriver from "postgres";

// Integration test: needs a reachable Postgres. Runs against the dev/CI
// database server using a dedicated crosstown_test database; skips (with a
// warning) when no server is up. Same bootstrap as rollup.test.ts.
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
  console.warn(`replay integration test skipped: no postgres at ${TEST_URL}`);
}

process.env.DATABASE_URL = TEST_URL;
const { db, sql, runMigrations } = available ? await import("../db/index.js") : ({} as never);
const { loadReplayTracks } = available ? await import("./replay.js") : ({} as never);
const { vehiclePositions } = await import("../db/schema.js");

afterAll(async () => {
  if (available) await sql.end({ timeout: 1 });
});

// Window aligned to a round timestamp so the 120s buckets are predictable:
// bucket 0 = [start, start+120s), bucket 1 = [start+120s, start+240s), ...
const START = new Date("2026-06-09T00:00:00Z");
const END = new Date("2026-06-09T01:00:00Z");
const at = (offsetSec: number) => new Date(START.getTime() + offsetSec * 1000);

describe.runIf(available)("loadReplayTracks", () => {
  it("buckets positions per vehicle, keeps the latest ping per bucket, drops single-ping tracks", async () => {
    await runMigrations();
    await db.delete(vehiclePositions);

    await db.insert(vehiclePositions).values([
      // vehicle A, bucket 0: two pings; the later ping (t-wise) should win
      { vehicleId: "A", tripId: null, routeId: "2", lat: 39.95, lon: -82.99, bearing: 90, speed: null, ts: at(30) },
      { vehicleId: "A", tripId: null, routeId: "2", lat: 39.96, lon: -82.98, bearing: 100, speed: null, ts: at(60) },
      // vehicle A, bucket 1
      { vehicleId: "A", tripId: null, routeId: "2", lat: 39.97, lon: -82.97, bearing: null, speed: null, ts: at(150) },
      // vehicle B: a single ping -> not enough to interpolate -> dropped
      { vehicleId: "B", tripId: null, routeId: "5", lat: 39.90, lon: -83.00, bearing: 0, speed: null, ts: at(30) },
    ]);

    const tracks = await loadReplayTracks(START, END);

    // B is dropped (single ping); only A survives.
    expect(tracks.map((t) => t.vehicleId).sort()).toEqual(["A"]);

    const a = tracks.find((t) => t.vehicleId === "A")!;
    expect(a.routeId).toBe("2");
    // bucket 0 (t=0) and bucket 1 (t=120), ascending.
    expect(a.samples.map((s) => s[0])).toEqual([0, 120]);
    // bucket 0 kept the later ping (lon -82.98), not the earlier (-82.99).
    const [t0, lon0, lat0, bearing0] = a.samples[0]!;
    expect(t0).toBe(0);
    expect(lon0).toBeCloseTo(-82.98, 5);
    expect(lat0).toBeCloseTo(39.96, 5);
    expect(bearing0).toBe(100);
    // bucket 1 had a null bearing; it round-trips as null.
    expect(a.samples[1]![3]).toBeNull();
  });

  it("excludes positions outside the window", async () => {
    await runMigrations();
    await db.delete(vehiclePositions);

    await db.insert(vehiclePositions).values([
      { vehicleId: "A", tripId: null, routeId: "2", lat: 39.95, lon: -82.99, bearing: null, speed: null, ts: at(-600) },
      { vehicleId: "A", tripId: null, routeId: "2", lat: 39.96, lon: -82.98, bearing: null, speed: null, ts: at(30) },
      { vehicleId: "A", tripId: null, routeId: "2", lat: 39.97, lon: -82.97, bearing: null, speed: null, ts: at(150) },
    ]);

    const tracks = await loadReplayTracks(START, END);
    const a = tracks.find((t) => t.vehicleId === "A")!;
    // the pre-window ping at t=-600s is excluded; two in-window buckets remain.
    expect(a.samples.map((s) => s[0])).toEqual([0, 120]);
  });

  it("splits a vehicle track when the assigned route changes", async () => {
    await runMigrations();
    await db.delete(vehiclePositions);

    await db.insert(vehiclePositions).values([
      {
        vehicleId: "A",
        tripId: null,
        routeId: "2",
        lat: 39.95,
        lon: -82.99,
        bearing: null,
        speed: null,
        ts: at(30),
      },
      {
        vehicleId: "A",
        tripId: null,
        routeId: "2",
        lat: 39.96,
        lon: -82.98,
        bearing: null,
        speed: null,
        ts: at(150),
      },
      {
        vehicleId: "A",
        tripId: null,
        routeId: "5",
        lat: 39.97,
        lon: -82.97,
        bearing: null,
        speed: null,
        ts: at(270),
      },
      {
        vehicleId: "A",
        tripId: null,
        routeId: "5",
        lat: 39.98,
        lon: -82.96,
        bearing: null,
        speed: null,
        ts: at(390),
      },
    ]);

    const tracks = await loadReplayTracks(START, END);

    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.routeId)).toEqual(["2", "5"]);
    expect(tracks.map((t) => t.samples.map((s) => s[0]))).toEqual([
      [0, 120],
      [240, 360],
    ]);
  });
});
