ALTER TABLE "route_day_stats" ADD COLUMN "median_delay_sec" real;--> statement-breakpoint
-- Raw stop_events for these historical days is already pruned (3-day
-- retention), so a true median can't be recomputed; avg_delay_sec is the
-- closest available proxy for the backfill. All rows from here on get a
-- real percentile_cont(0.5) from the rollup.
UPDATE "route_day_stats" SET "median_delay_sec" = "avg_delay_sec" WHERE "median_delay_sec" IS NULL;--> statement-breakpoint
ALTER TABLE "route_day_stats" ALTER COLUMN "median_delay_sec" SET NOT NULL;
