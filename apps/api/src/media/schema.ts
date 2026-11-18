import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Kinds a document may have; the CHECK below repeats vault.ts DOCUMENT_KINDS. */
const KINDS = "'nid_front', 'nid_back', 'photo', 'trade_licence', 'owner_nid_front', 'owner_nid_back'";

/**
 * One identity document. The file itself lives encrypted in object storage; after deletion this row keeps only
 * the kind, who reviewed it and the outcome. No foreign keys: the subject is a rider or a restaurant application,
 * and the vault never reads another module's tables.
 */
export const identityDocuments = pgTable(
  'identity_documents',
  {
    id: uuid('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    storageKey: text('storage_key'),
    /** The per-file data key, wrapped by a master key from DATA_KEYS. */
    sealedKey: jsonb('sealed_key').$type<{ kid: string; wrappedKey: string }>(),
    byteSize: integer('byte_size'),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    reviewOutcome: text('review_outcome'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    deleteAfter: timestamp('delete_after', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedReason: text('deleted_reason'),
  },
  (table) => [
    uniqueIndex('identity_documents_one_stored_idx')
      .on(table.subjectType, table.subjectId, table.kind)
      .where(sql`${table.status} = 'stored'`),
    index('identity_documents_subject_idx').on(table.subjectType, table.subjectId),
    index('identity_documents_delete_after_idx').on(table.deleteAfter).where(sql`${table.status} <> 'deleted'`),
    check('identity_documents_subject_type_valid', sql`${table.subjectType} IN ('rider', 'restaurant_application')`),
    check('identity_documents_kind_valid', sql`${table.kind} IN (${sql.raw(KINDS)})`),
    check('identity_documents_status_valid', sql`${table.status} IN ('pending', 'stored', 'deleted')`),
    check(
      'identity_documents_outcome_valid',
      sql`${table.reviewOutcome} IS NULL OR ${table.reviewOutcome} IN ('accepted', 'rejected')`,
    ),
    check(
      'identity_documents_deleted_reason_valid',
      sql`${table.deletedReason} IS NULL OR ${table.deletedReason} IN ('decision_retention', 'abandoned', 'replaced', 'upload_failed')`,
    ),
  ],
);
