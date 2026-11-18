import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { menuItems, restaurants } from '../catalog/schema';
import { geographyPoint } from '../db/geography';
import { users } from '../identity/schema';
import { zones } from '../zones/schema';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull().unique().default(sql`nextval('order_number_seq')`),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zones.id),
    riderId: uuid('rider_id').references(() => users.id),
    type: text('type').notNull(),
    status: text('status').notNull(),
    subtotalPoisha: integer('subtotal_poisha').notNull(),
    deliveryFeePoisha: integer('delivery_fee_poisha').notNull(),
    totalPoisha: integer('total_poisha').notNull(),
    paymentMethod: text('payment_method').notNull(),
    addressLine: text('address_line').notNull(),
    landmark: text('landmark').notNull(),
    deliveryPhone: text('delivery_phone').notNull(),
    deliveryLocation: geographyPoint('delivery_location').notNull(),
    note: text('note'),
    readyInMinutes: integer('ready_in_minutes'),
    rejectReason: text('reject_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('orders_restaurant_status_idx').on(table.restaurantId, table.status),
    index('orders_customer_created_idx').on(table.customerId, table.createdAt.desc()),
    index('orders_zone_unassigned_idx').on(table.zoneId, table.status).where(sql`${table.riderId} IS NULL`),
    index('orders_rider_idx').on(table.riderId),
    check('orders_type_valid', sql`${table.type} IN ('delivery')`),
    check(
      'orders_status_valid',
      sql`${table.status} IN ('placed', 'preparing', 'ready', 'on_the_way', 'delivered', 'rejected', 'cancelled', 'expired', 'undeliverable')`,
    ),
    check('orders_subtotal_non_negative', sql`${table.subtotalPoisha} >= 0`),
    check('orders_fee_non_negative', sql`${table.deliveryFeePoisha} >= 0`),
    check('orders_total_non_negative', sql`${table.totalPoisha} >= 0`),
    check('orders_total_adds_up', sql`${table.totalPoisha} = ${table.subtotalPoisha} + ${table.deliveryFeePoisha}`),
    check('orders_payment_method_valid', sql`${table.paymentMethod} IN ('cash')`),
    check('orders_ready_in_minutes_valid', sql`${table.readyInMinutes} IN (10, 20, 30)`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    unitPricePoisha: integer('unit_price_poisha').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalPoisha: integer('line_total_poisha').notNull(),
    /** Chosen options as priced at the time of the order: [{ nameEn, nameBn, priceDelta }]. */
    options: jsonb('options').notNull().default(sql`'[]'::jsonb`),
    note: text('note'),
    /** Per-unit discount in poisha already taken off unit_price_poisha. */
    discountPoisha: integer('discount_poisha').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    check('order_items_unit_price_positive', sql`${table.unitPricePoisha} > 0`),
    check('order_items_quantity_range', sql`${table.quantity} BETWEEN 1 AND 20`),
    check('order_items_line_total', sql`${table.lineTotalPoisha} = ${table.unitPricePoisha} * ${table.quantity}`),
  ],
);
