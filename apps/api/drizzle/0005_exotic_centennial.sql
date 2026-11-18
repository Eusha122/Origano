CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"phone" text NOT NULL,
	"body_sealed" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"purge_after_send" boolean NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sms_messages_purpose_valid" CHECK ("sms_messages"."purpose" IN ('otp')),
	CONSTRAINT "sms_messages_status_valid" CHECK ("sms_messages"."status" IN ('queued', 'sent', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE INDEX "sms_messages_due_idx" ON "sms_messages" USING btree ("next_attempt_at") WHERE "sms_messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "sms_messages_phone_idx" ON "sms_messages" USING btree ("phone","created_at" DESC NULLS LAST);