import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { restaurants } from '../catalog/schema';
import { users } from '../identity/schema';

/**
 * A restaurant's application to join. Payout details are sealed; the file copies live in the media vault,
 * keyed by this id. `restaurant_id` is set when the application is approved.
 */
export const restaurantApplications = pgTable(
  'restaurant_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantUserId: uuid('applicant_user_id')
      .notNull()
      .references(() => users.id),
    /** A team member, when the team applied for the owner (door 1). */
    createdByUserId: uuid('created_by_user_id'),
    status: text('status').notNull().default('applied'),
    restaurantName: text('restaurant_name').notNull(),
    cuisine: text('cuisine').notNull(),
    addressLine: text('address_line').notNull(),
    restaurantPhone: text('restaurant_phone'),
    ownerName: text('owner_name').notNull(),
    payoutMethod: text('payout_method').notNull(),
    /** AES-256-GCM, bound to this row's id. Null once cleared after a rejection or abandonment. */
    payoutAccountSealed: text('payout_account_sealed'),
    payoutAccountLast4: text('payout_account_last4').notNull(),
    noTradeLicence: boolean('no_trade_licence').notNull().default(false),
    licenceWaived: boolean('licence_waived').notNull().default(false),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    restaurantId: uuid('restaurant_id'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One open application per user; a rejected one stays open so it can be resubmitted.
    uniqueIndex('restaurant_applications_one_open_idx')
      .on(table.applicantUserId)
      .where(sql`${table.status} IN ('applied', 'under_review', 'rejected')`),
    index('restaurant_applications_queue_idx').on(table.status, table.submittedAt),
    check(
      'restaurant_applications_status_valid',
      sql`${table.status} IN ('applied', 'under_review', 'approved', 'rejected')`,
    ),
    check('restaurant_applications_payout_method_valid', sql`${table.payoutMethod} IN ('bkash', 'nagad', 'bank')`),
  ],
);

/** A delivery agency whose riders join with its code. */
export const agencies = pgTable(
  'agencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    /** 8 characters, random, unique. */
    code: text('code').notNull().unique(),
    status: text('status').notNull().default('approved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('agencies_status_valid', sql`${table.status} IN ('approved', 'suspended')`)],
);

/** A restaurant owner's invitation for a phone to join as that restaurant's own rider. */
export const riderInvites = pgTable(
  'rider_invites',
  {
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    invitedBy: uuid('invited_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.restaurantId, table.phone] })],
);
