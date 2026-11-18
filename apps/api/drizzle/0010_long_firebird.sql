CREATE TABLE "restaurant_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"status" text DEFAULT 'applied' NOT NULL,
	"restaurant_name" text NOT NULL,
	"cuisine" text NOT NULL,
	"address_line" text NOT NULL,
	"restaurant_phone" text,
	"owner_name" text NOT NULL,
	"payout_method" text NOT NULL,
	"payout_account_sealed" text,
	"payout_account_last4" text NOT NULL,
	"no_trade_licence" boolean DEFAULT false NOT NULL,
	"licence_waived" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"restaurant_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_applications_status_valid" CHECK ("restaurant_applications"."status" IN ('applied', 'under_review', 'approved', 'rejected')),
	CONSTRAINT "restaurant_applications_payout_method_valid" CHECK ("restaurant_applications"."payout_method" IN ('bkash', 'nagad', 'bank'))
);
--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "status" text;--> statement-breakpoint
UPDATE "restaurants" SET "status" = 'approved';--> statement-breakpoint
ALTER TABLE "restaurants" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_applications" ADD CONSTRAINT "restaurant_applications_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_applications_one_open_idx" ON "restaurant_applications" USING btree ("applicant_user_id") WHERE "restaurant_applications"."status" IN ('applied', 'under_review', 'rejected');--> statement-breakpoint
CREATE INDEX "restaurant_applications_queue_idx" ON "restaurant_applications" USING btree ("status","submitted_at");--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_status_valid" CHECK ("restaurants"."status" IN ('approved', 'suspended'));