CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_bn" text NOT NULL,
	"boundary" geography(Polygon, 4326) NOT NULL,
	"fee_per_km_poisha" integer NOT NULL,
	"min_fee_poisha" integer NOT NULL,
	"road_factor" numeric(3, 2) DEFAULT '1.30' NOT NULL,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_slug_unique" UNIQUE("slug"),
	CONSTRAINT "zones_fee_per_km_non_negative" CHECK ("zones"."fee_per_km_poisha" >= 0),
	CONSTRAINT "zones_min_fee_non_negative" CHECK ("zones"."min_fee_poisha" >= 0),
	CONSTRAINT "zones_road_factor_at_least_one" CHECK ("zones"."road_factor" >= 1)
);
--> statement-breakpoint
CREATE INDEX "zones_boundary_idx" ON "zones" USING gist ("boundary");