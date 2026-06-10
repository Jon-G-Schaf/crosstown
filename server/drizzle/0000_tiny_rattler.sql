CREATE TABLE "calendar" (
	"service_id" text PRIMARY KEY NOT NULL,
	"monday" boolean NOT NULL,
	"tuesday" boolean NOT NULL,
	"wednesday" boolean NOT NULL,
	"thursday" boolean NOT NULL,
	"friday" boolean NOT NULL,
	"saturday" boolean NOT NULL,
	"sunday" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_dates" (
	"service_id" text NOT NULL,
	"date" date NOT NULL,
	"exception_type" integer NOT NULL,
	CONSTRAINT "calendar_dates_service_id_date_pk" PRIMARY KEY("service_id","date")
);
--> statement-breakpoint
CREATE TABLE "gtfs_meta" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"loaded_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"route_id" text PRIMARY KEY NOT NULL,
	"short_name" text NOT NULL,
	"long_name" text DEFAULT '' NOT NULL,
	"type" integer DEFAULT 3 NOT NULL,
	"color" text,
	"text_color" text,
	"sort_order" integer
);
--> statement-breakpoint
CREATE TABLE "shapes" (
	"shape_id" text PRIMARY KEY NOT NULL,
	"coordinates" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stop_times" (
	"trip_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"stop_id" text NOT NULL,
	"arrival_sec" integer,
	"departure_sec" integer,
	CONSTRAINT "stop_times_trip_id_stop_sequence_pk" PRIMARY KEY("trip_id","stop_sequence")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"stop_id" text PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"trip_id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"service_id" text NOT NULL,
	"headsign" text,
	"direction_id" integer,
	"shape_id" text,
	"block_id" text
);
--> statement-breakpoint
CREATE INDEX "stop_times_stop_idx" ON "stop_times" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "trips_route_idx" ON "trips" USING btree ("route_id");