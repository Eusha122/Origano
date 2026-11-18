import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('restaurants_prep_minutes_range', sql`${table.prepMinutes} BETWEEN 5 AND 120`),
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
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('menu_items_restaurant_name_unique').on(table.restaurantId, table.nameEn),
    check('menu_items_price_positive', sql`${table.pricePoisha} > 0`),
  ],
);
