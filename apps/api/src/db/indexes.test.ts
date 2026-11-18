import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';

describe('indexes', () => {
  const { db } = withTestDb();

  // Each one backs a hot lookup: an order's lines, an order's history in order, and a rider's orders.
  it.each([
    ['order_items', 'order_items_order_idx', '(order_id)'],
    ['order_events', 'order_events_order_idx', '(order_id, id)'],
    ['orders', 'orders_rider_idx', '(rider_id)'],
  ])('%s has %s on %s', async (table, name, columns) => {
    const rows = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${table} AND indexname = ${name}`,
    );
    expect(rows[0]?.indexdef ?? '').toContain(columns);
  });
});
