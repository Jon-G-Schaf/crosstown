// Downloads COTA's static GTFS zip and replaces the static tables wholesale.
// Usage: npm run load-gtfs -w server
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
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

async function insertChunked<T>(table: Parameters<typeof db.insert>[0], rows: T[], label: string) {
  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(table).values(rows.slice(i, i + chunkSize) as never);
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
  await db.transaction(async (tx) => {
    await tx.delete(stopTimes);
    await tx.delete(trips);
    await tx.delete(shapes);
    await tx.delete(calendarDates);
    await tx.delete(calendar);
    await tx.delete(stops);
    await tx.delete(routes);
    await tx.delete(gtfsMeta);
  });

  await insertChunked(routes, routeRows, "routes");
  await insertChunked(stops, stopRows, "stops");
  await insertChunked(trips, tripRows, "trips");
  await insertChunked(stopTimes, stopTimeRows, "stop_times");
  await insertChunked(shapes, shapeRows, "shapes");
  await insertChunked(calendar, calendarRows, "calendar");
  await insertChunked(calendarDates, calendarDateRows, "calendar_dates");
  await db.insert(gtfsMeta).values({ id: 1, loadedAt: new Date(), source: GTFS_URL });

  console.log("Done");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
