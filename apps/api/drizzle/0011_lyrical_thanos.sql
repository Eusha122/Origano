CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_code_unique" UNIQUE("code"),
	CONSTRAINT "agencies_status_valid" CHECK ("agencies"."status" IN ('approved', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "rider_invites" (
	"restaurant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_invites_restaurant_id_phone_pk" PRIMARY KEY("restaurant_id","phone")
);
--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "vehicle_type" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "vehicle_registration" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "guarantor_name" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "guarantor_phone" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "guarantor_relation" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "restaurant_id" uuid;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rider_invites" ADD CONSTRAINT "rider_invites_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_agency_matches_type" CHECK (("riders"."type" = 'agency') = ("riders"."agency_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_restaurant_matches_type" CHECK (("riders"."type" = 'restaurant_staff') = ("riders"."restaurant_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_vehicle_type_valid" CHECK ("riders"."vehicle_type" IS NULL OR "riders"."vehicle_type" IN ('bicycle', 'motorcycle', 'electric_bike', 'on_foot'));
--> statement-breakpoint
UPDATE "riders" SET "vehicle_type" = 'motorcycle' WHERE "vehicle_type" IS NULL;