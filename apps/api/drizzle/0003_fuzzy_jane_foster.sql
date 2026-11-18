CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_valid" CHECK ("audit_log"."actor_type" IN ('user', 'operator', 'system'))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_label" text NOT NULL,
	CONSTRAINT "team_members_role_valid" CHECK ("team_members"."role" IN ('superadmin', 'onboarding', 'support'))
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id","id");--> statement-breakpoint
INSERT INTO "team_members" ("user_id", "role", "granted_by_label")
SELECT "id", 'superadmin', 'migration from is_admin' FROM "users" WHERE "is_admin";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_admin";