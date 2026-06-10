CREATE TABLE "route_day_stats" (
	"route_id" text NOT NULL,
	"service_date" date NOT NULL,
	"daypart" text NOT NULL,
	"observations" integer NOT NULL,
	"on_time_pct" real NOT NULL,
	"avg_delay_sec" real NOT NULL,
	"p90_delay_sec" real NOT NULL,
	CONSTRAINT "route_day_stats_route_id_service_date_daypart_pk" PRIMARY KEY("route_id","service_date","daypart")
);
--> statement-breakpoint
CREATE TABLE "stop_events" (
	"service_date" date NOT NULL,
	"trip_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"route_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"delay_sec" integer NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	CONSTRAINT "stop_events_service_date_trip_id_stop_sequence_pk" PRIMARY KEY("service_date","trip_id","stop_sequence")
);
--> statement-breakpoint
CREATE INDEX "stop_events_route_date_idx" ON "stop_events" USING btree ("route_id","service_date");--> statement-breakpoint
CREATE INDEX "stop_events_stop_date_idx" ON "stop_events" USING btree ("stop_id","service_date");