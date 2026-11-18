import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

/** The items of one restaurant ordered most in the last 30 days, best first. Orders that never went ahead do not count. */
export async function popularItemIds(db: Executor, restaurantId: string, limit: number): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT oi.menu_item_id AS id
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.restaurant_id = ${restaurantId}
      AND o.created_at > now() - interval '30 days'
      AND o.status NOT IN ('rejected', 'cancelled', 'expired', 'undeliverable')
    GROUP BY oi.menu_item_id
    ORDER BY SUM(oi.quantity) DESC, oi.menu_item_id
    LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

/** Dish names ordered most in the last 14 days in a zone (or everywhere), best first. */
export async function popularDishNames(db: Executor, zoneId: string | null, limit: number): Promise<string[]> {
  const zone = zoneId ? sql`AND o.zone_id = ${zoneId}` : sql``;
  const rows = await db.execute<{ name: string }>(sql`
    SELECT oi.name_en AS name
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at > now() - interval '14 days'
      AND o.status NOT IN ('rejected', 'cancelled', 'expired', 'undeliverable') ${zone}
    GROUP BY oi.name_en
    ORDER BY SUM(oi.quantity) DESC, oi.name_en
    LIMIT ${limit}`);
  return rows.map((r) => r.name);
}
