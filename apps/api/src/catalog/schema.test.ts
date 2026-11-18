import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';
import { seedZones } from '../zones/seed';
import { createApprovedRestaurant } from './repo';

describe('catalog schema', () => {
  const { db } = withTestDb();

  async function restaurantWithItem() {
    await seedZones(db);
    const zone = (await db.execute<{ id: string }>(sql`SELECT id FROM zones LIMIT 1`))[0];
    if (!zone) throw new Error('no zone');
    const r = await createApprovedRestaurant(db, {
      zoneId: zone.id,
      name: 'Schema Cafe',
      cuisine: 'Cafe',
      addressLine: 'Main road',
      phone: null,
      location: { lat: 24.5965, lng: 88.2775 },
    });
    const cat = (
      await db.execute<{ id: string }>(
        sql`INSERT INTO menu_categories (restaurant_id, name_en, name_bn, position) VALUES (${r.id}, 'Mains', 'Mains', 1) RETURNING id`,
      )
    )[0];
    const item = (
      await db.execute<{ id: string }>(
        sql`INSERT INTO menu_items (restaurant_id, category_id, name_en, name_bn, price_poisha, position)
            VALUES (${r.id}, ${cat?.id}, 'Burger', 'Burger', 28000, 1) RETURNING id`,
      )
    )[0];
    return { restaurantId: r.id, categoryId: cat?.id as string, itemId: item?.id as string };
  }

  const discount = (
    restaurantId: string,
    f: { kind: string; value: number; scope: string; item?: string | null; cat?: string | null; hours?: number },
  ) =>
    db.execute(sql`
      INSERT INTO restaurant_discounts (restaurant_id, kind, value, scope, menu_item_id, category_id, starts_at, ends_at)
      VALUES (${restaurantId}, ${f.kind}, ${f.value}, ${f.scope}, ${f.item ?? null}, ${f.cat ?? null}, now(), now() + (${f.hours ?? 24} * interval '1 hour'))`);

  it('refuses a percent discount above 90', async () => {
    const { restaurantId } = await restaurantWithItem();
    await expect(discount(restaurantId, { kind: 'percent', value: 95, scope: 'menu' })).rejects.toThrow();
  });

  it('refuses an item-scope discount with no item, and a menu-scope one with a target', async () => {
    const { restaurantId, itemId } = await restaurantWithItem();
    await expect(discount(restaurantId, { kind: 'percent', value: 10, scope: 'item' })).rejects.toThrow();
    await expect(discount(restaurantId, { kind: 'percent', value: 10, scope: 'menu', item: itemId })).rejects.toThrow();
    await expect(
      discount(restaurantId, { kind: 'percent', value: 10, scope: 'item', item: itemId }),
    ).resolves.toBeDefined();
  });

  it('refuses a discount that ends before it starts', async () => {
    const { restaurantId } = await restaurantWithItem();
    await expect(discount(restaurantId, { kind: 'amount', value: 5000, scope: 'menu', hours: -1 })).rejects.toThrow();
  });

  it('refuses hours that close before they open, or run past 04:00 the next day', async () => {
    const { restaurantId } = await restaurantWithItem();
    const hours = (day: number, open: number, close: number) =>
      db.execute(sql`INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
        VALUES (${restaurantId}, ${day}, ${open}, ${close})`);
    await expect(hours(1, 600, 600)).rejects.toThrow();
    await expect(hours(1, 600, 1681)).rejects.toThrow();
    await expect(hours(7, 600, 700)).rejects.toThrow();
    await hours(1, 1080, 1560);
    await expect(hours(1, 1080, 1500)).rejects.toThrow();
  });

  it('refuses a negative option price and a busy value that is not 0, 10 or 20', async () => {
    const { restaurantId, itemId } = await restaurantWithItem();
    const group = (
      await db.execute<{ id: string }>(
        sql`INSERT INTO option_groups (menu_item_id, name_en, name_bn, min_select, max_select, position)
            VALUES (${itemId}, 'Size', 'Size', 1, 1, 1) RETURNING id`,
      )
    )[0];
    await expect(
      db.execute(sql`INSERT INTO options (group_id, name_en, name_bn, price_delta_poisha, position)
        VALUES (${group?.id}, 'Large', 'Large', -1, 1)`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE restaurants SET busy_extra_minutes = 15 WHERE id = ${restaurantId}`),
    ).rejects.toThrow();
  });

  it('gives a newly created restaurant the default hours, 11:00 to 22:00 every day', async () => {
    const { restaurantId } = await restaurantWithItem();
    const rows = await db.execute<{ day_of_week: number; open_minute: number; close_minute: number }>(
      sql`SELECT day_of_week, open_minute, close_minute FROM restaurant_hours WHERE restaurant_id = ${restaurantId} ORDER BY day_of_week`,
    );
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.open_minute === 660 && r.close_minute === 1320)).toBe(true);
  });
});
