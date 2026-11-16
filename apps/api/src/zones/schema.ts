import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { geographyPolygon } from '../db/geography';

export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    boundary: geographyPolygon('boundary').notNull(),
    feePerKmPoisha: integer('fee_per_km_poisha').notNull(),
    minFeePoisha: integer('min_fee_poisha').notNull(),
    roadFactor: numeric('road_factor', { precision: 3, scale: 2 }).notNull().default('1.30'),
    timezone: text('timezone').notNull().default('Asia/Dhaka'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('zones_boundary_idx').using('gist', table.boundary),
    check('zones_fee_per_km_non_negative', sql`${table.feePerKmPoisha} >= 0`),
    check('zones_min_fee_non_negative', sql`${table.minFeePoisha} >= 0`),
    check('zones_road_factor_at_least_one', sql`${table.roadFactor} >= 1`),
  ],
);
