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
import { restaurants } from '../catalog/schema';
import { agencies } from '../onboarding/schema';
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

/** One sign-in on one device. Revoking it signs that device out; its tokens hang off it. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    client: text('client').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId),
    check('auth_sessions_client_valid', sql`${table.client} IN ('web', 'native')`),
    check(
      'auth_sessions_reason_valid',
      sql`${table.revokeReason} IS NULL OR ${table.revokeReason} IN ('logout', 'reuse_detected', 'team_change', 'operator')`,
    ),
  ],
);

/** Access and refresh tokens, stored only as SHA-256. A refresh token's children are what replaced it. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    parentId: uuid('parent_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_tokens_session_idx').on(table.sessionId),
    index('auth_tokens_parent_idx').on(table.parentId),
    check('auth_tokens_kind_valid', sql`${table.kind} IN ('access', 'refresh')`),
  ],
);

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
    vehicleType: text('vehicle_type'),
    vehicleRegistration: text('vehicle_registration'),
    guarantorName: text('guarantor_name'),
    guarantorPhone: text('guarantor_phone'),
    guarantorRelation: text('guarantor_relation'),
    /** Set exactly when type is agency. */
    agencyId: uuid('agency_id').references(() => agencies.id),
    /** Set exactly when type is restaurant_staff. */
    restaurantId: uuid('restaurant_id').references(() => restaurants.id),
    rejectionReason: text('rejection_reason'),
    suspendedReason: text('suspended_reason'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('riders_agency_matches_type', sql`(${table.type} = 'agency') = (${table.agencyId} IS NOT NULL)`),
    check(
      'riders_restaurant_matches_type',
      sql`(${table.type} = 'restaurant_staff') = (${table.restaurantId} IS NOT NULL)`,
    ),
    check(
      'riders_vehicle_type_valid',
      sql`${table.vehicleType} IS NULL OR ${table.vehicleType} IN ('bicycle', 'motorcycle', 'electric_bike', 'on_foot')`,
    ),
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
