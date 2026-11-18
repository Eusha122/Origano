import type { Order } from '@oregano/contracts';
import type { OrderStatus } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { AppError } from '../errors';

export type Viewer = { kind: 'customer' | 'restaurant' | 'rider' | 'admin'; userId: string };

const iso = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

type OrderRow = {
  id: string;
  number: number;
  status: OrderStatus;
  type: 'delivery';
  restaurant_id: string;
  restaurant_name_en: string;
  restaurant_name_bn: string;
  restaurant_phone: string | null;
  subtotal_poisha: number;
  delivery_fee_poisha: number;
  total_poisha: number;
  address_line: string;
  landmark: string;
  lat: number;
  lng: number;
  delivery_phone: string;
  note: string | null;
  ready_in_minutes: number | null;
  reject_reason: Order['rejectReason'];
  created_at: string;
  rider_id: string | null;
  rider_name: string | null;
  rider_phone: string | null;
};

const PHONE_VISIBLE_TO_RIDER: readonly OrderStatus[] = ['ready', 'on_the_way'];

/** Admin, the restaurant and the customer (their own number) always; a rider only while holding a ready or on-the-way order. */
function customerPhoneFor(row: OrderRow, viewer: Viewer): string | null {
  if (viewer.kind !== 'rider') return row.delivery_phone;
  return row.rider_id === viewer.userId && PHONE_VISIBLE_TO_RIDER.includes(row.status) ? row.delivery_phone : null;
}

/** The orders as this viewer sees them, in the order of `ids`. Three queries however many ids. */
export async function loadOrders(db: Executor, ids: string[], viewer: Viewer): Promise<Order[]> {
  if (ids.length === 0) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<OrderRow>(sql`
    SELECT o.id, o.number, o.status, o.type, o.restaurant_id,
      r.name_en AS restaurant_name_en, r.name_bn AS restaurant_name_bn, r.phone AS restaurant_phone,
      o.subtotal_poisha, o.delivery_fee_poisha, o.total_poisha, o.address_line, o.landmark,
      ST_Y(o.delivery_location::geometry) AS lat, ST_X(o.delivery_location::geometry) AS lng,
      o.delivery_phone, o.note, o.ready_in_minutes, o.reject_reason, ${iso('o.created_at')} AS created_at,
      o.rider_id, u.name AS rider_name, u.phone AS rider_phone
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN users u ON u.id = o.rider_id
    WHERE o.id IN (${list})`);
  const items = await db.execute<{
    order_id: string;
    menu_item_id: string;
    name_en: string;
    name_bn: string;
    unit_price_poisha: number;
    quantity: number;
    line_total_poisha: number;
  }>(sql`
    SELECT order_id, menu_item_id, name_en, name_bn, unit_price_poisha, quantity, line_total_poisha
    FROM order_items WHERE order_id IN (${list}) ORDER BY created_at, id`);
  const events = await db.execute<{ order_id: string; event: string; at: string }>(sql`
    SELECT order_id, event, ${iso('created_at')} AS at
    FROM order_events WHERE order_id IN (${list}) ORDER BY id`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const showRiderPhone = viewer.kind !== 'rider';
  const result: Order[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new AppError('not_found', 404, 'Not found.');
    result.push({
      id: row.id,
      number: row.number,
      status: row.status,
      type: row.type,
      restaurant: {
        id: row.restaurant_id,
        nameEn: row.restaurant_name_en,
        nameBn: row.restaurant_name_bn,
        phone: row.restaurant_phone,
      },
      items: items
        .filter((i) => i.order_id === id)
        .map((i) => ({
          menuItemId: i.menu_item_id,
          nameEn: i.name_en,
          nameBn: i.name_bn,
          unitPrice: i.unit_price_poisha,
          quantity: i.quantity,
          lineTotal: i.line_total_poisha,
        })),
      subtotal: row.subtotal_poisha,
      deliveryFee: row.delivery_fee_poisha,
      total: row.total_poisha,
      paymentMethod: 'cash',
      delivery: { addressLine: row.address_line, landmark: row.landmark, lat: Number(row.lat), lng: Number(row.lng) },
      customerPhone: customerPhoneFor(row, viewer),
      rider: row.rider_id
        ? { id: row.rider_id, name: row.rider_name, phone: showRiderPhone ? row.rider_phone : null }
        : null,
      note: row.note,
      readyInMinutes: row.ready_in_minutes,
      rejectReason: row.reject_reason,
      timeline: events.filter((e) => e.order_id === id).map((e) => ({ event: e.event, at: e.at })),
      createdAt: row.created_at,
    });
  }
  return result;
}

export async function loadOrder(db: Executor, orderId: string, viewer: Viewer): Promise<Order> {
  const [order] = await loadOrders(db, [orderId], viewer);
  if (!order) throw new AppError('not_found', 404, 'Not found.');
  return order;
}
