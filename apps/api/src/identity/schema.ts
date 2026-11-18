import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { zones } from '../zones/schema';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedByLabel: text('granted_by_label').notNull(),
  },
  (table) => [check('team_members_role_valid', sql`${table.role} IN ('superadmin', 'onboarding', 'support')`)],
);

/** One live challenge per phone: a new code replaces the old one. Wrong-code counts live in otp_events. */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    phone: text('phone').primaryKey(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('otp_challenges_attempts_range', sql`${table.attempts} BETWEEN 0 AND 5`)],
);

/**
 * What the limits remember: every code sent, every wrong guess, and every guess for a phone with no code
 * (a probe, which counts against the IP but never locks the phone). Only a keyed hash of the IP is kept.
 */
export const otpEvents = pgTable(
  'otp_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    phone: text('phone').notNull(),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('otp_events_phone_idx').on(table.phone, table.kind, table.createdAt),
    index('otp_events_ip_idx').on(table.ipHash, table.kind, table.createdAt),
    index('otp_events_kind_idx').on(table.kind, table.createdAt),
    check('otp_events_kind_valid', sql`${table.kind} IN ('send', 'failure', 'probe')`),
  ],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riders = pgTable(
  'riders',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zones.id),
    type: text('type').notNull(),
    status: text('status').notNull(),
    isOnline: boolean('is_online').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('riders_type_valid', sql`${table.type} IN ('agency', 'independent', 'restaurant_staff')`),
    check(
      'riders_status_valid',
      sql`${table.status} IN ('applied', 'under_review', 'approved', 'rejected', 'suspended')`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);
