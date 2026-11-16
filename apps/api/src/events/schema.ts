import { sql } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orders } from '../ordering/schema';

export const orderEvents = pgTable('order_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  event: text('event').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  data: jsonb('data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outbox = pgTable(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('outbox_unpublished_idx').on(table.id).where(sql`${table.publishedAt} IS NULL`)],
);
