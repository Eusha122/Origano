CREATE TABLE "otp_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"phone" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_events_kind_valid" CHECK ("otp_events"."kind" IN ('send', 'failure', 'probe'))
);
--> statement-breakpoint
-- Codes live five minutes, so clearing them loses nothing, and old rows may hold several per phone.
DELETE FROM "otp_challenges";--> statement-breakpoint
DROP INDEX "otp_challenges_phone_created_idx";--> statement-breakpoint
ALTER TABLE "otp_challenges" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD PRIMARY KEY ("phone");--> statement-breakpoint
CREATE INDEX "otp_events_phone_idx" ON "otp_events" USING btree ("phone","kind","created_at");--> statement-breakpoint
CREATE INDEX "otp_events_ip_idx" ON "otp_events" USING btree ("ip_hash","kind","created_at");--> statement-breakpoint
CREATE INDEX "otp_events_kind_idx" ON "otp_events" USING btree ("kind","created_at");
