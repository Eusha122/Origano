import { teamCan } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import type { AuthUser } from '../identity/auth';
import type { Viewer } from './present';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** How this user relates to an order: admin, then its customer, its restaurant's staff, its rider; otherwise null. */
export async function resolveViewer(db: Executor, user: AuthUser, orderId: string): Promise<Viewer | null> {
  if (!isUuid(orderId)) return null;
  const rows = await db.execute<{ customer_id: string; restaurant_id: string; rider_id: string | null }>(sql`
    SELECT customer_id, restaurant_id, rider_id FROM orders WHERE id = ${orderId}`);
  const order = rows[0];
  if (!order) return null;
  if (teamCan(user.teamRoles, 'orders.read')) return { kind: 'admin', userId: user.id };
  if (order.customer_id === user.id) return { kind: 'customer', userId: user.id };
  if (user.restaurantIds.includes(order.restaurant_id)) return { kind: 'restaurant', userId: user.id };
  if (order.rider_id === user.id) return { kind: 'rider', userId: user.id };
  return null;
}

/** The customer's own orders, newest first. */
export async function listCustomerOrderIds(db: Executor, customerId: string, limit: number): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM orders WHERE customer_id = ${customerId} ORDER BY created_at DESC, number DESC LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

export async function findOrderCustomerId(db: Executor, orderId: string): Promise<string | null> {
  if (!isUuid(orderId)) return null;
  const rows = await db.execute<{ customer_id: string }>(sql`SELECT customer_id FROM orders WHERE id = ${orderId}`);
  return rows[0]?.customer_id ?? null;
}
