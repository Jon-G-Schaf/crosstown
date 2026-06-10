import type { FastifyInstance } from "fastify";
import { asc, eq, inArray, sql as dsql } from "drizzle-orm";
import { db } from "../db/index.js";
import { routes, shapes, stops, stopTimes, trips } from "../db/schema.js";

export async function routesPlugin(app: FastifyInstance) {
  app.get("/api/routes", async () => {
    const all = await db
      .select()
      .from(routes)
      .orderBy(asc(routes.sortOrder), asc(routes.shortName));
    return { routes: all };
  });

  app.get<{ Params: { id: string } }>("/api/routes/:id", async (req, reply) => {
    const [route] = await db.select().from(routes).where(eq(routes.routeId, req.params.id));
    if (!route) return reply.code(404).send({ error: "route not found" });

    // Most common shape per direction stands in for "the" route geometry;
    // its trip provides the canonical stop list.
    const reps = await db.execute<{
      direction_id: number | null;
      shape_id: string | null;
      trip_id: string;
      headsign: string | null;
    }>(dsql`
      select distinct on (direction_id)
        direction_id, shape_id, trip_id, headsign
      from (
        select direction_id, shape_id, min(trip_id) as trip_id,
               min(headsign) as headsign, count(*) as n
        from trips
        where route_id = ${req.params.id}
        group by direction_id, shape_id
      ) counted
      order by direction_id, n desc
    `);

    const shapeIds = reps.map((r) => r.shape_id).filter((s): s is string => s != null);
    const shapeRows = shapeIds.length
      ? await db.select().from(shapes).where(inArray(shapes.shapeId, shapeIds))
      : [];
    const shapeById = new Map(shapeRows.map((s) => [s.shapeId, s.coordinates]));

    const directions = [];
    for (const rep of reps) {
      const stopList = await db
        .select({
          stopId: stops.stopId,
          name: stops.name,
          lat: stops.lat,
          lon: stops.lon,
          sequence: stopTimes.stopSequence,
        })
        .from(stopTimes)
        .innerJoin(stops, eq(stops.stopId, stopTimes.stopId))
        .where(eq(stopTimes.tripId, rep.trip_id))
        .orderBy(asc(stopTimes.stopSequence));

      directions.push({
        directionId: rep.direction_id,
        headsign: rep.headsign,
        coordinates: rep.shape_id ? (shapeById.get(rep.shape_id) ?? []) : [],
        stops: stopList,
      });
    }

    return { route, directions };
  });
}
