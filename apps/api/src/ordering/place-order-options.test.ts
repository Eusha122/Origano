import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const CUSTOMER = '01711000001';
let now = new Date('2026-11-19T06:00:00Z'); // 12:00 in Dhaka

describe('placing an order with options, notes and discounts', () => {
  const t = withTestApp({ clock: () => now });
  const burger = () => t.demo().menuItemIds.beefCheeseBurger; // Tk 380
  const coffee = () => t.demo().menuItemIds.coldCoffee; // Tk 180

  const delivery = {
    lat: 24.5965,
    lng: 88.2775,
    addressLine: 'Court Road',
    landmark: 'Behind the college gate',
    phone: '01711000001',
  };
  let n = 0;
  const place = async (items: unknown[], extra: Record<string, unknown> = {}) =>
    t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(await t.signIn(CUSTOMER)), 'idempotency-key': `options-key-${++n}-0001` },
      payload: { restaurantId: t.demo().restaurantId, items, delivery, ...extra },
    });

  async function addGroup(itemId: string, name: string, min: number, max: number, opts: [string, number, boolean?][]) {
    const g = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO option_groups (menu_item_id, name_en, name_bn, min_select, max_select, position)
        VALUES (${itemId}, ${name}, ${name}, ${min}, ${max}, 1) RETURNING id`)
    )[0]?.id as string;
    const ids: string[] = [];
    for (const [i, [label, delta, available]] of opts.entries()) {
      const row = (
        await t.db.execute<{ id: string }>(sql`
          INSERT INTO options (group_id, name_en, name_bn, price_delta_poisha, is_available, position)
          VALUES (${g}, ${label}, ${label}, ${delta}, ${available ?? true}, ${i + 1}) RETURNING id`)
      )[0]?.id as string;
      ids.push(row);
    }
    return ids;
  }

  it('prices a size and an add-on on the server: Tk 380 + Tk 30 + Tk 20 = Tk 430', async () => {
    const [, large] = await addGroup(burger(), 'Size', 1, 1, [
      ['Regular', 0],
      ['Large', 3000],
    ]);
    const [cheese] = await addGroup(burger(), 'Extras', 0, 2, [
      ['Cheese', 2000],
      ['Egg', 1500],
    ]);
    const res = await place([{ menuItemId: burger(), quantity: 2, optionIds: [large, cheese], note: 'Less spicy' }]);
    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order.items[0]).toMatchObject({
      unitPrice: 43000,
      quantity: 2,
      lineTotal: 86000,
      discount: 0,
      note: 'Less spicy',
    });
    expect(order.items[0].options.map((o: { nameEn: string; priceDelta: number }) => [o.nameEn, o.priceDelta])).toEqual(
      [
        ['Large', 3000],
        ['Cheese', 2000],
      ],
    );
    expect(order.subtotal).toBe(86000);
  });

  it('refuses a missing required choice', async () => {
    await addGroup(burger(), 'Size', 1, 1, [
      ['Regular', 0],
      ['Large', 3000],
    ]);
    const res = await place([{ menuItemId: burger(), quantity: 1 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('required_choice_missing');
  });

  it('refuses a sold-out option', async () => {
    const [, gone] = await addGroup(burger(), 'Size', 1, 1, [
      ['Regular', 0],
      ['XL', 6000, false],
    ]);
    const res = await place([{ menuItemId: burger(), quantity: 1, optionIds: [gone] }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('option_unavailable');
  });

  it('refuses an option that belongs to another item', async () => {
    const [other] = await addGroup(coffee(), 'Size', 0, 1, [['Big', 1000]]);
    const res = await place([{ menuItemId: burger(), quantity: 1, optionIds: [other] }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_option');
  });

  it('takes a live discount off the unit price and keeps it on the order line', async () => {
    await t.db.execute(sql`
      INSERT INTO restaurant_discounts (restaurant_id, kind, value, scope, menu_item_id, starts_at, ends_at)
      VALUES (${t.demo().restaurantId}, 'percent', 10, 'item', ${burger()}, '2026-11-19T00:00:00Z', '2026-11-20T00:00:00Z')`);
    const res = await place([{ menuItemId: burger(), quantity: 1 }]);
    expect(res.json().items[0]).toMatchObject({ unitPrice: 34200, discount: 3800, lineTotal: 34200 });
    expect(res.json().subtotal).toBe(34200);
  });

  it('ignores a discount that ended before now, using the server clock', async () => {
    await t.db.execute(sql`
      INSERT INTO restaurant_discounts (restaurant_id, kind, value, scope, menu_item_id, starts_at, ends_at)
      VALUES (${t.demo().restaurantId}, 'percent', 10, 'item', ${burger()}, '2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z')`);
    const res = await place([{ menuItemId: burger(), quantity: 1 }]);
    expect(res.json().items[0]).toMatchObject({ unitPrice: 38000, discount: 0 });
  });

  it('refuses an order after closing time even though the switch is on', async () => {
    await t.db.execute(sql`DELETE FROM restaurant_hours`);
    await t.db.execute(sql`
      INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
      SELECT ${t.demo().restaurantId}, d, 660, 1320 FROM generate_series(0, 6) d`);
    now = new Date('2026-11-19T17:00:00Z'); // 23:00
    const res = await place([{ menuItemId: burger(), quantity: 1 }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('restaurant_closed');
    now = new Date('2026-11-19T06:00:00Z');
    expect((await place([{ menuItemId: burger(), quantity: 1 }])).statusCode).toBe(201);
  });

  it('keeps the same item with different options as separate lines, and refuses an exact repeat', async () => {
    const [regular, large] = await addGroup(burger(), 'Size', 1, 1, [
      ['Regular', 0],
      ['Large', 3000],
    ]);
    const ok = await place([
      { menuItemId: burger(), quantity: 1, optionIds: [regular] },
      { menuItemId: burger(), quantity: 1, optionIds: [large] },
    ]);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().items).toHaveLength(2);
    const repeat = await place([
      { menuItemId: burger(), quantity: 1, optionIds: [regular] },
      { menuItemId: burger(), quantity: 2, optionIds: [regular] },
    ]);
    expect(repeat.statusCode).toBe(400);
  });

  it('still takes a request with no options or notes', async () => {
    const res = await place([{ menuItemId: coffee(), quantity: 1 }]);
    expect(res.statusCode).toBe(201);
    expect(res.json().items[0]).toMatchObject({ unitPrice: 18000, options: [], note: null, discount: 0 });
  });
});
