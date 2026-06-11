# Crosstown

Live map and reliability stats for COTA buses in Columbus, Ohio.

**[crosstown.jongschaf.com](https://crosstown.jongschaf.com)**

The schedule says when the bus should come. Crosstown records when it actually
does: a worker watches COTA's realtime feeds around the clock, keeps the
history in Postgres, and turns it into route-by-route on-time numbers you can
actually act on. Route 21 late every weekday evening? Now there's a chart.

## How it works

- `server/` polls COTA's GTFS-realtime vehicle positions every 15s and trip
  updates every 30s (the feed itself regenerates every 30s; conditional
  requests make unchanged polls free). COTA publishes predicted arrival times
  but no delay field, so delays are computed against the static schedule in
  SQL at ingest.
- The last prediction before a bus reaches a stop is recorded as the observed
  arrival. Nightly jobs roll those up into per-route, per-daypart stats
  (on time = between 1 min early and 5 min late).
- Raw positions are kept 48 hours, arrival records 90 days, rollups forever.
- The live map gets positions pushed over SSE and interpolates bus motion
  client-side between feed updates.

## Stack

- **server/** - Fastify + TypeScript, Drizzle for schema and migrations,
  hand-written SQL for the aggregations, Postgres. Runs on Railway.
- **web/** - Next.js, Tailwind, MapLibre GL (Carto dark basemap), Recharts.
  Runs on Vercel.

## Local dev

```
npm install
npm run db:dev -w server     # embedded Postgres (or: docker compose up -d)
npm run load-gtfs -w server  # pull COTA's schedule into the DB
npm run dev                  # server on :4000, web on :3000
```

Copy `.env.example` to `.env` first. Tests: `npm test -w server`.

## Data

Vehicle positions, trip updates, and the static schedule come from
[COTA's open data](https://www.cota.com/data/). This project is not
affiliated with COTA.
