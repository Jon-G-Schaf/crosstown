CREATE TABLE "vehicle_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_id" text,
	"route_id" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"bearing" real,
	"speed" real,
	"ts" timestamp with time zone NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vehicle_positions_ts_idx" ON "vehicle_positions" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "vehicle_positions_route_ts_idx" ON "vehicle_positions" USING btree ("route_id","ts");