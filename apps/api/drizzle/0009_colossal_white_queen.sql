CREATE TABLE "identity_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"storage_key" text,
	"sealed_key" jsonb,
	"byte_size" integer,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_outcome" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	CONSTRAINT "identity_documents_subject_type_valid" CHECK ("identity_documents"."subject_type" IN ('rider', 'restaurant_application')),
	CONSTRAINT "identity_documents_kind_valid" CHECK ("identity_documents"."kind" IN ('nid_front', 'nid_back', 'photo', 'trade_licence', 'owner_nid_front', 'owner_nid_back')),
	CONSTRAINT "identity_documents_status_valid" CHECK ("identity_documents"."status" IN ('pending', 'stored', 'deleted')),
	CONSTRAINT "identity_documents_outcome_valid" CHECK ("identity_documents"."review_outcome" IS NULL OR "identity_documents"."review_outcome" IN ('accepted', 'rejected')),
	CONSTRAINT "identity_documents_deleted_reason_valid" CHECK ("identity_documents"."deleted_reason" IS NULL OR "identity_documents"."deleted_reason" IN ('decision_retention', 'abandoned', 'replaced', 'upload_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_documents_one_stored_idx" ON "identity_documents" USING btree ("subject_type","subject_id","kind") WHERE "identity_documents"."status" = 'stored';--> statement-breakpoint
CREATE INDEX "identity_documents_subject_idx" ON "identity_documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "identity_documents_delete_after_idx" ON "identity_documents" USING btree ("delete_after") WHERE "identity_documents"."status" <> 'deleted';