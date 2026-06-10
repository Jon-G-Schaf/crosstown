# Crosstown

Live map and reliability stats for COTA buses in Columbus, Ohio. Watches the
real-time feed around the clock, keeps the history in Postgres, and answers the
question the schedule can't: how late is this route, actually?

Work in progress.

## Stack

- `server/` - Fastify API + ingestion worker (TypeScript, Drizzle, Postgres)
- `web/` - Next.js frontend (MapLibre, Tailwind)

## Local dev

```
npm install
npm run db:dev -w server   # embedded Postgres (or: docker compose up -d)
npm run dev                # server on :4000, web on :3000
```

Copy `.env.example` to `.env` first.

Data comes from COTA's public GTFS and GTFS-realtime feeds.
