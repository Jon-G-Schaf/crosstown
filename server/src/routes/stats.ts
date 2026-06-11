import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, lt, sql as dsqlRaw } from "drizzle-orm";
import { db } from "../db/index.js";
import { routeDayStats, routes } from "../db/schema.js";
import { localServiceDate, statsSelectSql } from "../jobs/rollup.js";
import { mergeStats, OBSERVED_EVENT_SQL, type StatRow } from "../lib/reliability.js";

const RANGES = new Set([7, 30, 90]);
const LIVE_CACHE_MS = 60_000;

type AggRow = StatRow & { routeId: string; daypart: string; serviceDate?: string };

let liveCache: { at: number; rows: AggRow[]; pendingToday: number } | null = null;

// Today's stop_events aggregated on the fly; rollups only cover finished
// days. pendingToday counts today's rows that are still forecasts (or
// ghosts), so the on-record counter can exclude them.
async function liveTodayStats(): Promise<{ rows: AggRow[]; pendingToday: number }> {
  if (liveCache && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache;
  const today = localServiceDate(0);
  const [raw, [pending]] = await Promise.all([
    db.execute<{
      route_id: string;
      daypart: string;
      observations: number;
      on_time_pct: number;
      avg_delay_sec: number;
      p90_delay_sec: number;
    }>(statsSelectSql(today)),
    db.execute<{ pending: number }>(dsqlRaw`
      select count(*)::int as pending
      from stop_events
      where service_date = ${today}
        and not (${dsqlRaw.raw(OBSERVED_EVENT_SQL)})
    `),
  ]);
  const rows = raw.map((r) => ({
    routeId: r.route_id,
    daypart: r.daypart,
    observations: r.observations,
    onTimePct: r.on_time_pct,
    avgDelaySec: r.avg_delay_sec,
    p90DelaySec: r.p90_delay_sec,
  }));
  liveCache = { at: Date.now(), rows, pendingToday: pending?.pending ?? 0 };
  return liveCache;
}

function parseRange(raw: unknown): number {
  const n = Number(String(raw ?? "30").replace(/d$/, ""));
  return RANGES.has(n) ? n : 30;
}

export async function statsPlugin(app: FastifyInstance) {
  // Headline numbers for the map panel and rankings hero. The on-record
  // count is Postgres' row estimate; close enough for a counter and free.
  app.get("/api/stats/system", async () => {
    const { rows: live, pendingToday } = await liveTodayStats();
    const alls = live.filter((l) => l.daypart === "all");
    const arrivalsToday = alls.reduce((sum, l) => sum + l.observations, 0);
    const todayOnTimePct =
      arrivalsToday > 0
        ? alls.reduce((sum, l) => sum + l.onTimePct * l.observations, 0) / arrivalsToday
        : null;
    const [estimate] = await db.execute<{ estimate: string }>(
      dsqlRaw`select greatest(reltuples, 0)::bigint::text as estimate
              from pg_class where relname = 'stop_events'`,
    );
    return {
      todayOnTimePct,
      arrivalsToday,
      arrivalsOnRecord: Math.max(Number(estimate?.estimate ?? 0) - pendingToday, arrivalsToday),
    };
  });

  app.get<{ Querystring: { range?: string } }>("/api/stats/routes", async (req) => {
    const range = parseRange(req.query.range);
    const since = localServiceDate(-range);
    const today = localServiceDate(0);

    const [history, { rows: live }, routeRows] = await Promise.all([
      db
        .select()
        .from(routeDayStats)
        .where(
          and(
            eq(routeDayStats.daypart, "all"),
            gte(routeDayStats.serviceDate, since),
            lt(routeDayStats.serviceDate, today),
          ),
        ),
      liveTodayStats(),
      db.select().from(routes),
    ]);

    const byRoute = new Map<string, StatRow | null>();
    for (const h of history) {
      byRoute.set(h.routeId, mergeStats(byRoute.get(h.routeId) ?? null, h));
    }
    for (const l of live) {
      if (l.daypart !== "all") continue;
      byRoute.set(l.routeId, mergeStats(byRoute.get(l.routeId) ?? null, l));
    }

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
      const since = localServiceDate(-range);
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
