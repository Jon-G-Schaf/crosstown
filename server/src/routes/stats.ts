import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, lt, sql as dsqlRaw } from "drizzle-orm";
import { db } from "../db/index.js";
import { routeDayStats, routes } from "../db/schema.js";
import { localServiceDate, pulseSelectSql, statsSelectSql } from "../jobs/rollup.js";
import { mergeStats, type StatRow } from "../lib/reliability.js";

const RANGES = new Set([7, 30, 90]);
const LIVE_CACHE_MS = 60_000;

type AggRow = StatRow & { routeId: string; daypart: string; serviceDate?: string };

let liveCache: { at: number; rows: AggRow[] } | null = null;

type PulseBody = {
  serviceDate: string;
  hours: { hour: number; observations: number; onTimePct: number }[];
};
let pulseCache: { at: number; body: PulseBody } | null = null;

// Today's stop_events aggregated on the fly; rollups only cover finished days.
async function liveTodayStats(): Promise<{ rows: AggRow[] }> {
  if (liveCache && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache;
  const today = localServiceDate(0);
  const raw = await db.execute<{
    route_id: string;
    daypart: string;
    observations: number;
    on_time_pct: number;
    avg_delay_sec: number;
    p90_delay_sec: number;
  }>(statsSelectSql(today));
  const rows = raw.map((r) => ({
    routeId: r.route_id,
    daypart: r.daypart,
    observations: r.observations,
    onTimePct: r.on_time_pct,
    avgDelaySec: r.avg_delay_sec,
    p90DelaySec: r.p90_delay_sec,
  }));
  liveCache = { at: Date.now(), rows };
  return liveCache;
}

function parseRange(raw: unknown): number {
  const n = Number(String(raw ?? "30").replace(/d$/, ""));
  return RANGES.has(n) ? n : 30;
}

export async function statsPlugin(app: FastifyInstance) {
  // Headline numbers for the map panel and rankings hero.
  app.get("/api/stats/system", async () => {
    const { rows: live } = await liveTodayStats();
    const alls = live.filter((l) => l.daypart === "all");
    const arrivalsToday = alls.reduce((sum, l) => sum + l.observations, 0);
    const todayOnTimePct =
      arrivalsToday > 0
        ? alls.reduce((sum, l) => sum + l.onTimePct * l.observations, 0) / arrivalsToday
        : null;
    // Lifetime arrivals measured. stop_events keeps only 3 days, so its row
    // count plateaus; route_day_stats is the durable archive (one 'all' row
    // per route per finished day, never pruned), so summing it and adding
    // today's live count gives a total that climbs for the life of the
    // project. Observed-only already, since the rollup drops ghosts/forecasts.
    const [lifetime] = await db.execute<{ total: string }>(dsqlRaw`
      select coalesce(sum(observations), 0)::bigint::text as total
      from route_day_stats
      where daypart = 'all'
    `);
    return {
      todayOnTimePct,
      arrivalsToday,
      arrivalsOnRecord: Number(lifetime?.total ?? 0) + arrivalsToday,
    };
  });

  // Today's system-wide on-time % by hour, for the pulse chart.
  app.get("/api/stats/pulse", async () => {
    if (pulseCache && Date.now() - pulseCache.at < LIVE_CACHE_MS) return pulseCache.body;
    const today = localServiceDate(0);
    const rows = await db.execute<{
      hour: number;
      observations: number;
      on_time_pct: number;
    }>(pulseSelectSql(today));
    const body = {
      serviceDate: today,
      hours: rows.map((r) => ({
        hour: r.hour,
        observations: r.observations,
        onTimePct: r.on_time_pct,
      })),
    };
    pulseCache = { at: Date.now(), body };
    return body;
  });

  app.get<{ Querystring: { range?: string } }>("/api/stats/routes", async (req) => {
    const range = parseRange(req.query.range);
    // The window includes today, so 7d means today plus the previous six
    // service dates rather than eight dates from today-7 through today.
    const since = localServiceDate(1 - range);
    const today = localServiceDate(0);

    const [history, { rows: live }, routeRows] = await Promise.all([
      db
        .select()
        .from(routeDayStats)
        .where(
          and(gte(routeDayStats.serviceDate, since), lt(routeDayStats.serviceDate, today)),
        ),
      liveTodayStats(),
      db.select().from(routes),
    ]);

    // 'all' rows drive the ranking; the daypart rows ride along so the list
    // can show each route's time-of-day profile without a second request.
    const byRoute = new Map<string, StatRow | null>();
    const byRouteDaypart = new Map<string, Map<string, StatRow | null>>();
    const fold = (routeId: string, daypart: string, s: StatRow) => {
      if (daypart === "all") {
        byRoute.set(routeId, mergeStats(byRoute.get(routeId) ?? null, s));
        return;
      }
      let parts = byRouteDaypart.get(routeId);
      if (!parts) {
        parts = new Map();
        byRouteDaypart.set(routeId, parts);
      }
      parts.set(daypart, mergeStats(parts.get(daypart) ?? null, s));
    };
    for (const h of history) fold(h.routeId, h.daypart, h);
    for (const l of live) fold(l.routeId, l.daypart, l);

    const result = routeRows
      .map((r) => {
        const s = byRoute.get(r.routeId);
        return s
          ? {
              routeId: r.routeId,
              shortName: r.shortName,
              longName: r.longName,
              color: r.color,
              ...s,
              dayparts: [...(byRouteDaypart.get(r.routeId)?.entries() ?? [])]
                .filter((e): e is [string, StatRow] => e[1] != null)
                .map(([daypart, d]) => ({
                  daypart,
                  observations: d.observations,
                  onTimePct: d.onTimePct,
                  avgDelaySec: d.avgDelaySec,
                })),
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.onTimePct - a.onTimePct);

    return { range, routes: result };
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/api/stats/routes/:id",
    async (req, reply) => {
      const range = parseRange(req.query.range);
      const since = localServiceDate(1 - range);
      const today = localServiceDate(0);

      const [route] = await db.select().from(routes).where(eq(routes.routeId, req.params.id));
      if (!route) return reply.code(404).send({ error: "route not found" });

      const [historyRows, { rows: live }] = await Promise.all([
        db
          .select()
          .from(routeDayStats)
          .where(
            and(
              eq(routeDayStats.routeId, req.params.id),
              gte(routeDayStats.serviceDate, since),
            ),
          )
          .orderBy(asc(routeDayStats.serviceDate)),
        liveTodayStats(),
      ]);

      const liveForRoute = live.filter((l) => l.routeId === req.params.id);

      const series = [
        ...historyRows
          .filter((h) => h.daypart === "all" && h.serviceDate < today)
          .map((h) => ({
            serviceDate: h.serviceDate,
            observations: h.observations,
            onTimePct: h.onTimePct,
            avgDelaySec: h.avgDelaySec,
          })),
        ...liveForRoute
          .filter((l) => l.daypart === "all")
          .map((l) => ({
            serviceDate: today,
            observations: l.observations,
            onTimePct: l.onTimePct,
            avgDelaySec: l.avgDelaySec,
            partial: true,
          })),
      ];

      const dayparts = new Map<string, StatRow | null>();
      for (const h of historyRows) {
        if (h.daypart === "all" || h.serviceDate >= today) continue;
        dayparts.set(h.daypart, mergeStats(dayparts.get(h.daypart) ?? null, h));
      }
      for (const l of liveForRoute) {
        if (l.daypart === "all") continue;
        dayparts.set(l.daypart, mergeStats(dayparts.get(l.daypart) ?? null, l));
      }

      return {
        route,
        range,
        series,
        dayparts: [...dayparts.entries()].map(([daypart, s]) => ({ daypart, ...s })),
      };
    },
  );
}
