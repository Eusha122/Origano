import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Append-only: a trigger refuses UPDATE and DELETE. No foreign keys, so removing a user never touches history. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    data: jsonb('data').notNull().default({}),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_target_idx').on(table.targetType, table.targetId, table.id),
    check('audit_log_actor_valid', sql`${table.actorType} IN ('user', 'operator', 'system')`),
  ],
);
