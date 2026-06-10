import type { FastifyBaseLogger } from "fastify";
import { sql as dsql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  DAYPART_CASE_SQL,
  ON_TIME_EARLY_SEC,
  ON_TIME_LATE_SEC,
} from "../lib/reliability.js";

const TZ = "America/New_York";

// Per-route, per-daypart aggregate of one service date of stop_events,
// with a coalesced 'all' bucket via grouping sets. Shared between the
// nightly rollup (insert) and the live "today so far" stats endpoint.
export function statsSelectSql(serviceDate: string) {
  return dsql`
    select
      route_id,
      service_date,
      coalesce(daypart, 'all') as daypart,
      count(*)::int as observations,
      (100.0 * avg(
        case when delay_sec >= ${ON_TIME_EARLY_SEC} and delay_sec <= ${ON_TIME_LATE_SEC}
        then 1.0 else 0.0 end
      ))::real as on_time_pct,
      avg(delay_sec)::real as avg_delay_sec,
      (percentile_cont(0.9) within group (order by delay_sec))::real as p90_delay_sec
    from (
      select
        route_id,
        service_date,
        delay_sec,
        ${dsql.raw(DAYPART_CASE_SQL)} as daypart
      from (
        select
          route_id,
          service_date,
          delay_sec,
          extract(hour from event_time at time zone ${TZ})::int as h
        from stop_events
        where service_date = ${serviceDate}
      ) hours
    ) bucketed
    group by grouping sets ((route_id, service_date, daypart), (route_id, service_date))
  `;
}

// Aggregates one service date of stop_events into route_day_stats.
// Idempotent: safe to re-run for the same date.
export async function rollupServiceDate(serviceDate: string) {
  await db.execute(dsql`
    insert into route_day_stats
      (route_id, service_date, daypart, observations, on_time_pct, avg_delay_sec, p90_delay_sec)
    ${statsSelectSql(serviceDate)}
    on conflict (route_id, service_date, daypart) do update set
      observations = excluded.observations,
      on_time_pct = excluded.on_time_pct,
      avg_delay_sec = excluded.avg_delay_sec,
      p90_delay_sec = excluded.p90_delay_sec
  `);
}

export function localServiceDate(offsetDays: number): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  local.setDate(local.getDate() + offsetDays);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startRollupJob(log: FastifyBaseLogger) {
  const run = async (label: string) => {
    const yesterday = localServiceDate(-1);
    try {
      await rollupServiceDate(yesterday);
      log.info({ serviceDate: yesterday, label }, "rollup complete");
    } catch (err) {
      log.warn({ err, serviceDate: yesterday }, "rollup failed");
    }
  };

  // Catch up on boot (covers restarts and deploy gaps), then hourly.
  // Hourly re-runs are cheap and make the 3:30am "nightly" timing a
  // non-event: whichever run happens after midnight finalizes the day.
  run("boot");
  const timer = setInterval(() => run("scheduled"), 3600 * 1000);
  return () => clearInterval(timer);
}
