import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';
import { seedDemo } from './seed-demo';

describe('demo seed', () => {
  const { db } = withTestDb();

  it('creates Burger Lane with its menu, staff, riders and admin', async () => {
    const ids = await seedDemo(db);
    const items = await db.execute<{ name_en: string; price_poisha: number }>(
      sql`SELECT name_en, price_poisha FROM menu_items WHERE restaurant_id = ${ids.restaurantId} ORDER BY name_en`,
    );
    expect(items.map((i) => [i.name_en, i.price_poisha])).toEqual([
      ['Beef Cheese Burger', 38000],
      ['Chicken Pizza, 8 inch', 35000],
      ['Cold Coffee', 18000],
      ['Crispy Chicken Burger', 22000],
    ]);
    const roles = await db.execute<{ phone: string; is_admin: boolean }>(
      sql`SELECT phone, is_admin FROM users ORDER BY phone`,
    );
    expect(roles.map((r) => r.phone)).toEqual([
      '+8801711000001',
      '+8801711000002',
      '+8801711000003',
      '+8801711000004',
      '+8801711000005',
    ]);
  });

  it('is safe to run twice', async () => {
    const first = await seedDemo(db);
    const second = await seedDemo(db);
    expect(second).toEqual(first);
    const count = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM menu_items`);
    expect(count[0]?.n).toBe(4);
  });

  it('refuses an order whose total does not add up', async () => {
    const ids = await seedDemo(db);
    await expect(
      db.execute(sql`
        INSERT INTO orders (number, customer_id, restaurant_id, zone_id, type, status, subtotal_poisha, delivery_fee_poisha,
          total_poisha, payment_method, address_line, landmark, delivery_phone, delivery_location)
        VALUES (nextval('order_number_seq'), ${ids.customerId}, ${ids.restaurantId}, ${ids.zoneId}, 'delivery', 'placed',
          38000, 2000, 1, 'cash', 'x', 'y', '+8801711000001', ST_GeogFromText('SRID=4326;POINT(88.2775 24.5965)'))
      `),
    ).rejects.toThrow();
  });
});
