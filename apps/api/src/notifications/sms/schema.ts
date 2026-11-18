import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const smsMessages = pgTable(
  'sms_messages',
  {
    id: uuid('id').primaryKey(),
    purpose: text('purpose').notNull(),
    phone: text('phone').notNull(),
    /** The text, sealed with AES-256-GCM (the row id is the AAD). Null once sent or expired. */
    bodySealed: text('body_sealed'),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    purgeAfterSend: boolean('purge_after_send').notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('sms_messages_due_idx').on(table.nextAttemptAt).where(sql`${table.status} = 'queued'`),
    index('sms_messages_phone_idx').on(table.phone, table.createdAt.desc()),
    check('sms_messages_purpose_valid', sql`${table.purpose} IN ('otp')`),
    check('sms_messages_status_valid', sql`${table.status} IN ('queued', 'sent', 'failed', 'expired')`),
  ],
);
