// One-off read-only audit queries against whatever DATABASE_URL points at.
// Usage: DATABASE_URL=... npx tsx scripts/audit-snapshot.ts
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

async function main() {
  const [counts] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where event_time > now())::int as future,
      count(*) filter (where event_time <= now())::int as past,
      count(*) filter (where event_time <= now()
        and event_time > last_seen + interval '5 minutes')::int as ghost_suspect,
      count(distinct stop_id)::int as distinct_stops,
      count(distinct trip_id)::int as distinct_trips
    from stop_events
    where service_date = (now() at time zone 'America/New_York')::date
  `;
  console.log("today stop_events:", counts);

  const [otp] = await sql`
    select
      (100.0 * avg(case when delay_sec between -60 and 300 then 1.0 else 0.0 end))::numeric(5,2) as otp_all_rows,
      (100.0 * avg(case when delay_sec between -60 and 300 then 1.0 else 0.0 end)
        filter (where event_time <= now()))::numeric(5,2) as otp_past_only,
      (avg(delay_sec))::numeric(8,1) as avg_delay_all,
      (avg(delay_sec) filter (where event_time <= now()))::numeric(8,1) as avg_delay_past
    from stop_events
    where service_date = (now() at time zone 'America/New_York')::date
  `;
  console.log("on-time % contamination:", otp);

  const hours = await sql`
    select extract(hour from event_time at time zone 'America/New_York')::int as local_hour,
           count(*)::int as rows
    from stop_events
    where service_date = (now() at time zone 'America/New_York')::date
    group by 1 order by 1
  `;
  console.log("rows by local hour of event_time:");
  for (const h of hours) console.log(`  ${String(h.local_hour).padStart(2, "0")}:00  ${h.rows}`);

  const [sanity] = await sql`
    select min(event_time) as first_event, max(event_time) as last_event, now() as db_now
    from stop_events
    where service_date = (now() at time zone 'America/New_York')::date
  `;
  console.log("range:", sanity);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
