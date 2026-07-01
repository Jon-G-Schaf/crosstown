import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema.js";

export const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/crosstown";

export const sql = postgres(databaseUrl, { onnotice: () => {} });
export const db = drizzle(sql, { schema });

// Migrations folder sits at server/drizzle, one level above src/ and dist/
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

// vehicle_positions (a ping every 15s) and stop_events (upserts every 30s) are
// pruned by DELETE, which leaves dead tuples that autovacuum has to reclaim or
// the heap bloats and the 500MB volume fills (it did, June 14 2026:
// vehicle_positions had bloated to ~2x its live size). Stock autovacuum lagged
// the churn, so make it aggressive and unthrottled on just these two tables:
// vacuum at 2% dead rows and run at full speed, so freed space is reused in
// place instead of the files growing. Idempotent, safe to run every boot.
export async function tuneTables() {
  for (const table of ["vehicle_positions", "stop_events"]) {
    await sql`
      alter table ${sql(table)} set (
        autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_vacuum_insert_scale_factor = 0.02,
        autovacuum_analyze_scale_factor = 0.05,
        autovacuum_vacuum_cost_delay = 0
      )
    `;
  }

  // Keep WAL inside the 500MB volume. The stock max_wal_size (1GB) let pg_wal
  // grow past 100MB and fill the disk (June 14 and 17 2026); 64MB is ample for
  // this low write rate. ALTER SYSTEM persists it in postgresql.auto.conf and is
  // reloadable, so this re-applies the ceiling if the managed config is ever
  // reset. (A single utility statement runs fine through postgres-js here: PG
  // treats one extended-protocol command as top-level, not a transaction block.)
  // The catch covers the non-superuser case (local dev).
  try {
    await sql`alter system set max_wal_size = '64MB'`;
    await sql`alter system set min_wal_size = '32MB'`;
    await sql`select pg_reload_conf()`;
  } catch {
    // not a superuser; leave WAL at the server default
  }

  // Railway's Postgres image preloads pg_stat_statements. Install its SQL
  // interface when available so the disk guard can reset the append-only query
  // text file before it consumes the small volume. This is operational
  // metadata only; application behavior does not depend on the extension.
  try {
    await sql`create extension if not exists pg_stat_statements`;
  } catch {
    // The extension may be unavailable in lightweight local Postgres images.
  }
}
