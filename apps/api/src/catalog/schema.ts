import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../db/geography';
import { users } from '../identity/schema';
import { zones } from '../zones/schema';

export const restaurants = pgTable(
  'restaurants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zones.id),
    slug: text('slug').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    cuisineEn: text('cuisine_en').notNull(),
    cuisineBn: text('cuisine_bn').notNull(),
    addressLine: text('address_line').notNull(),
    phone: text('phone'),
    location: geographyPoint('location').notNull(),
    /** approved or suspended; no default, so every insert says which. Only approved restaurants are listed or orderable. */
    status: text('status').notNull(),
    isOpen: boolean('is_open').notNull().default(true),
    prepMinutes: integer('prep_minutes').notNull().default(20),
    /** Extra minutes added to the prep time while the kitchen is busy: 0, 10 or 20. */
    busyExtraMinutes: integer('busy_extra_minutes').notNull().default(0),
    coverImageKey: text('cover_image_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('restaurants_prep_minutes_range', sql`${table.prepMinutes} BETWEEN 5 AND 120`),
    check('restaurants_busy_valid', sql`${table.busyExtraMinutes} IN (0, 10, 20)`),
    check('restaurants_status_valid', sql`${table.status} IN ('approved', 'suspended')`),
  ],
);

export const restaurantStaff = pgTable(
  'restaurant_staff',
  {
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.restaurantId, table.userId] }),
    check('restaurant_staff_role_valid', sql`${table.role} IN ('owner', 'staff')`),
  ],
);

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('menu_categories_restaurant_name_unique').on(table.restaurantId, table.nameEn)],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => menuCategories.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    descriptionEn: text('description_en'),
    descriptionBn: text('description_bn'),
    pricePoisha: integer('price_poisha').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
    /** Hidden from the menu but kept because past orders point at it. */
    isArchived: boolean('is_archived').notNull().default(false),
    imageKey: text('image_key'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('menu_items_restaurant_name_unique').on(table.restaurantId, table.nameEn),
    check('menu_items_price_positive', sql`${table.pricePoisha} > 0`),
  ],
);

/** Weekly opening intervals in the zone's local time. `closeMinute` above 1440 means after midnight (up to 04:00). */
export const restaurantHours = pgTable(
  'restaurant_hours',
  {
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /** 0 = Sunday. */
    dayOfWeek: integer('day_of_week').notNull(),
    openMinute: integer('open_minute').notNull(),
    closeMinute: integer('close_minute').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.restaurantId, table.dayOfWeek, table.openMinute] }),
    check('restaurant_hours_day_range', sql`${table.dayOfWeek} BETWEEN 0 AND 6`),
    check('restaurant_hours_open_range', sql`${table.openMinute} BETWEEN 0 AND 1439`),
    check(
      'restaurant_hours_close_range',
      sql`${table.closeMinute} > ${table.openMinute} AND ${table.closeMinute} <= 1680`,
    ),
  ],
);

export const optionGroups = pgTable(
  'option_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    minSelect: integer('min_select').notNull(),
    maxSelect: integer('max_select').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    index('option_groups_item_idx').on(table.menuItemId),
    check(
      'option_groups_select_range',
      sql`${table.minSelect} >= 0 AND ${table.maxSelect} >= ${table.minSelect} AND ${table.maxSelect} >= 1`,
    ),
  ],
);

export const options = pgTable(
  'options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    priceDeltaPoisha: integer('price_delta_poisha').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
    position: integer('position').notNull(),
  },
  (table) => [
    index('options_group_idx').on(table.groupId),
    check('options_price_delta_non_negative', sql`${table.priceDeltaPoisha} >= 0`),
  ],
);

export const restaurantDiscounts = pgTable(
  'restaurant_discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    value: integer('value').notNull(),
    scope: text('scope').notNull(),
    menuItemId: uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => menuCategories.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('restaurant_discounts_restaurant_idx').on(table.restaurantId),
    check('restaurant_discounts_kind_valid', sql`${table.kind} IN ('percent', 'amount')`),
    check(
      'restaurant_discounts_value_valid',
      sql`(${table.kind} = 'percent' AND ${table.value} BETWEEN 1 AND 90) OR (${table.kind} = 'amount' AND ${table.value} > 0)`,
    ),
    check(
      'restaurant_discounts_scope_target',
      sql`(${table.scope} = 'item' AND ${table.menuItemId} IS NOT NULL AND ${table.categoryId} IS NULL)
        OR (${table.scope} = 'category' AND ${table.categoryId} IS NOT NULL AND ${table.menuItemId} IS NULL)
        OR (${table.scope} = 'menu' AND ${table.menuItemId} IS NULL AND ${table.categoryId} IS NULL)`,
    ),
    check('restaurant_discounts_window', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);
