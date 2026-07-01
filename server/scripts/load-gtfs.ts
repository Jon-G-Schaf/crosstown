// Downloads COTA's static GTFS zip and replaces the static tables wholesale.
// Usage: npm run load-gtfs -w server
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { sql as dsql } from "drizzle-orm";
import {
  calendar,
  calendarDates,
  gtfsMeta,
  routes,
  shapes,
  stops,
  stopTimes,
  trips,
} from "../src/db/schema.js";
import { db, runMigrations, sql } from "../src/db/index.js";
import { gtfsTimeToSeconds } from "../src/lib/gtfs-time.js";

try {
  process.loadEnvFile("../.env");
} catch {
  // no .env file; rely on real env vars
}

const GTFS_URL = process.env.GTFS_URL ?? "https://www.cota.com/data/cota.gtfs.zip";

type Row = Record<string, string>;

function readCsv(zip: AdmZip, name: string): Row[] {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} missing from GTFS zip`);
  return parse(entry.getData().toString("utf-8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
}

async function insertChunked<T>(
  rows: T[],
  label: string,
  insert: (chunk: T[]) => PromiseLike<unknown>,
) {
  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insert(rows.slice(i, i + chunkSize));
  }
  console.log(`  ${label}: ${rows.length} rows`);
}

// GTFS dates are YYYYMMDD
function gtfsDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

async function main() {
  console.log(`Downloading ${GTFS_URL}`);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));

  await runMigrations();

  const routeRows = readCsv(zip, "routes.txt").map((r) => ({
    routeId: r.route_id!,
    shortName: r.route_short_name ?? "",
    longName: r.route_long_name ?? "",
    type: Number(r.route_type ?? 3),
    color: r.route_color || null,
    textColor: r.route_text_color || null,
    sortOrder: r.route_sort_order ? Number(r.route_sort_order) : null,
  }));

  const stopRows = readCsv(zip, "stops.txt").map((r) => ({
    stopId: r.stop_id!,
    code: r.stop_code || null,
    name: r.stop_name ?? "",
    lat: Number(r.stop_lat),
    lon: Number(r.stop_lon),
  }));

  const tripRows = readCsv(zip, "trips.txt").map((r) => ({
    tripId: r.trip_id!,
    routeId: r.route_id!,
    serviceId: r.service_id!,
    headsign: r.trip_headsign || null,
    directionId: r.direction_id === "" || r.direction_id == null ? null : Number(r.direction_id),
    shapeId: r.shape_id || null,
    blockId: r.block_id || null,
  }));

  const stopTimeRows = readCsv(zip, "stop_times.txt").map((r) => ({
    tripId: r.trip_id!,
    stopSequence: Number(r.stop_sequence),
    stopId: r.stop_id!,
    arrivalSec: gtfsTimeToSeconds(r.arrival_time ?? ""),
    departureSec: gtfsTimeToSeconds(r.departure_time ?? ""),
  }));

  const shapePoints = new Map<string, { seq: number; coord: [number, number] }[]>();
  for (const r of readCsv(zip, "shapes.txt")) {
    const id = r.shape_id!;
    if (!shapePoints.has(id)) shapePoints.set(id, []);
    shapePoints.get(id)!.push({
      seq: Number(r.shape_pt_sequence),
      coord: [Number(r.shape_pt_lon), Number(r.shape_pt_lat)],
    });
  }
  const shapeRows = [...shapePoints.entries()].map(([shapeId, pts]) => ({
    shapeId,
    coordinates: pts.sort((a, b) => a.seq - b.seq).map((p) => p.coord),
  }));

  const calendarRows = readCsv(zip, "calendar.txt").map((r) => ({
    serviceId: r.service_id!,
    monday: r.monday === "1",
    tuesday: r.tuesday === "1",
    wednesday: r.wednesday === "1",
    thursday: r.thursday === "1",
    friday: r.friday === "1",
    saturday: r.saturday === "1",
    sunday: r.sunday === "1",
    startDate: gtfsDate(r.start_date!),
    endDate: gtfsDate(r.end_date!),
  }));

  const calendarDateRows = zip.getEntry("calendar_dates.txt")
    ? readCsv(zip, "calendar_dates.txt").map((r) => ({
        serviceId: r.service_id!,
        date: gtfsDate(r.date!),
        exceptionType: Number(r.exception_type),
      }))
    : [];

  console.log("Replacing static tables");
  // TRUNCATE, not DELETE: a full reload runs on every deploy, and DELETE leaves
  // the old rows as dead tuples that bloat the files until autovacuum catches
  // up (stop_times reached ~2x its live size and helped fill the 500MB volume).
  // TRUNCATE frees the space at once so each load writes a fresh, compact table.
  // Keep TRUNCATE and every replacement insert in one transaction. PostgreSQL
  // preserves the old relfiles until commit, so a failed parse/insert rolls
  // back to the complete previous schedule; a successful commit still frees
  // the old table storage immediately without DELETE bloat.
  await db.transaction(async (tx) => {
    await tx.execute(
      dsql.raw(
        "truncate table stop_times, trips, shapes, calendar_dates, calendar, stops, routes, gtfs_meta",
      ),
    );

    await insertChunked(routeRows, "routes", (chunk) => tx.insert(routes).values(chunk));
    await insertChunked(stopRows, "stops", (chunk) => tx.insert(stops).values(chunk));
    await insertChunked(tripRows, "trips", (chunk) => tx.insert(trips).values(chunk));
    await insertChunked(stopTimeRows, "stop_times", (chunk) =>
      tx.insert(stopTimes).values(chunk),
    );
    await insertChunked(shapeRows, "shapes", (chunk) => tx.insert(shapes).values(chunk));
    await insertChunked(calendarRows, "calendar", (chunk) =>
      tx.insert(calendar).values(chunk),
    );
    await insertChunked(calendarDateRows, "calendar_dates", (chunk) =>
      tx.insert(calendarDates).values(chunk),
    );
    await tx.insert(gtfsMeta).values({ id: 1, loadedAt: new Date(), source: GTFS_URL });
  });

  console.log("Done");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
