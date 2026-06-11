import type { FastifyInstance } from "fastify";
import { sql as dsqlRaw } from "drizzle-orm";
import { db } from "../db/index.js";
import { localServiceDate } from "../jobs/rollup.js";
import { OBSERVED_EVENT_SQL } from "../lib/reliability.js";

const CACHE_MS = 30_000;

type Arrival = {
  routeId: string;
  shortName: string;
  stopName: string;
  delaySec: number;
  eventEpoch: number;
};

let cache: { at: number; body: { arrivals: Arrival[] } } | null = null;

// The newest observed arrivals, for the live ticker on the map page. The
// service_date equality keeps the scan on the primary-key index; the
// observed predicate is the same one every stat uses, so the ticker can
// never show a forecast or a ghost.
export async function arrivalsPlugin(app: FastifyInstance) {
  app.get("/api/arrivals/recent", async () => {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.body;
    const rows = await db.execute<{
      route_id: string;
      short_name: string;
      stop_name: string;
      delay_sec: number;
      event_epoch: number;
    }>(dsqlRaw`
      select se.route_id, r.short_name, s.name as stop_name, se.delay_sec,
             extract(epoch from se.event_time)::int as event_epoch
      from stop_events se
      join routes r on r.route_id = se.route_id
      join stops s on s.stop_id = se.stop_id
      where se.service_date = ${localServiceDate(0)}
        and se.event_time > now() - interval '10 minutes'
        and ${dsqlRaw.raw(OBSERVED_EVENT_SQL)}
      order by se.event_time desc
      limit 30
    `);
    const body = {
      arrivals: rows.map((r) => ({
        routeId: r.route_id,
        shortName: r.short_name,
        stopName: r.stop_name,
        delaySec: r.delay_sec,
        eventEpoch: r.event_epoch,
      })),
    };
    cache = { at: Date.now(), body };
    return body;
  });
}
