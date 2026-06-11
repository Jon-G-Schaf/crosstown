import type { FastifyInstance } from "fastify";
import { sql as dsql } from "drizzle-orm";
import { db } from "../db/index.js";

const CACHE_MS = 60 * 60 * 1000;

type ShapeFeature = {
  type: "Feature";
  properties: { routeId: string; color: string | null };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

let cache: { at: number; body: { type: "FeatureCollection"; features: ShapeFeature[] } } | null =
  null;

// One representative shape per route and direction (the most-used one),
// as GeoJSON for the map's network layer. Static data; cached an hour.
async function loadShapes() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body;

  const rows = await db.execute<{
      route_id: string;
      color: string | null;
      coordinates: [number, number][];
    }>(dsql`
      select reps.route_id, r.color, s.coordinates
      from (
        select distinct on (route_id, direction_id) route_id, shape_id
        from (
          select route_id, direction_id, shape_id, count(*) as n
          from trips
          where shape_id is not null
          group by route_id, direction_id, shape_id
        ) counted
        order by route_id, direction_id, n desc
      ) reps
      join shapes s on s.shape_id = reps.shape_id
      join routes r on r.route_id = reps.route_id
    `);

  const body = {
    type: "FeatureCollection" as const,
    features: rows.map((row) => ({
      type: "Feature" as const,
      properties: { routeId: row.route_id, color: row.color },
      geometry: {
        type: "LineString" as const,
        coordinates: row.coordinates.map(
          ([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))] as [number, number],
        ),
      },
    })),
  };
  cache = { at: Date.now(), body };
  return body;
}

export async function shapesPlugin(app: FastifyInstance) {
  app.get("/api/shapes", async () => loadShapes());

  // Prewarm so the first visitor after a deploy gets strands immediately.
  app.addHook("onReady", async () => {
    loadShapes().catch((err) => app.log.warn({ err }, "shapes prewarm failed"));
  });
}
