import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const KEY = 'order-key-0001';
const CUSTOMER = '01711000001';
const SECOND_CUSTOMER = '01711000099';

describe('placing an order', () => {
  const t = withTestApp();

  const orderBody = (overrides: Record<string, unknown> = {}) => ({
    restaurantId: t.demo().restaurantId,
    items: [
      { menuItemId: t.demo().menuItemIds.beefCheeseBurger, quantity: 2, price: 1 },
      { menuItemId: t.demo().menuItemIds.coldCoffee, quantity: 1, price: 1 },
    ],
    delivery: {
      lat: 24.5965,
      lng: 88.2775,
      addressLine: 'Court Road',
      landmark: 'Behind the college gate',
      phone: '01711000001',
    },
    ...overrides,
  });

  const place = async (token: string, body: unknown, key: string | null = KEY) =>
    t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(token), ...(key === null ? {} : { 'idempotency-key': key }) },
      payload: body as object,
    });

  const count = async (table: string): Promise<number> => {
    const rows = await t.db.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
    return rows[0]?.n ?? -1;
  };

  it('places an order priced from the menu, not the request', async () => {
    const token = await t.signIn(CUSTOMER);
    const res = await place(token, orderBody());
    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order).toMatchObject({
      status: 'placed',
      subtotal: 94000,
      deliveryFee: 2000,
      total: 96000,
      paymentMethod: 'cash',
      customerPhone: '+8801711000001',
    });
    expect(order.items.map((i: { unitPrice: number }) => i.unitPrice).sort()).toEqual([18000, 38000]);
    const events = await t.db.execute<{ event: string; actor_type: string }>(
      sql`SELECT event, actor_type FROM order_events`,
    );
    expect(events).toEqual([{ event: 'placed', actor_type: 'customer' }]);
    const outbox = await t.db.execute<{ topic: string; published_at: string | null }>(
      sql`SELECT topic, published_at FROM outbox`,
    );
    expect(outbox).toEqual([{ topic: 'order.changed', published_at: null }]);
  });

  it('a retried request returns the same order', async () => {
    const token = await t.signIn(CUSTOMER);
    const first = await place(token, orderBody());
    const second = await place(token, orderBody());
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json()).toEqual(first.json());
    expect(await count('orders')).toBe(1);
    expect(await count('outbox')).toBe(1);
  });

  it('two simultaneous requests with one key create one order', async () => {
    const token = await t.signIn(CUSTOMER);
    const [a, b] = await Promise.all([place(token, orderBody()), place(token, orderBody())]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().id).toBe(b.json().id);
    expect(await count('orders')).toBe(1);
  });

  it('a different body under the same key is refused', async () => {
    const token = await t.signIn(CUSTOMER);
    expect((await place(token, orderBody())).statusCode).toBe(201);
    const other = await place(token, orderBody({ note: 'No onions' }));
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('idempotency_key_reused');
    expect(await count('orders')).toBe(1);
  });

  it('a missing or malformed key is refused', async () => {
    const token = await t.signIn(CUSTOMER);
    for (const key of [null, 'short', 'has spaces in it', 'x'.repeat(65)]) {
      const res = await place(token, orderBody(), key);
      expect(res.statusCode, String(key)).toBe(400);
      expect(res.json().error.code).toBe('idempotency_key_required');
    }
    expect(await count('orders')).toBe(0);
  });

  it('the same key from two customers makes two orders', async () => {
    const first = await place(await t.signIn(CUSTOMER), orderBody());
    const second = await place(await t.signIn(SECOND_CUSTOMER), orderBody());
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
    expect(await count('orders')).toBe(2);
  });

  it("refuses a sold-out item, another restaurant's item, a closed restaurant, and a Dhaka delivery point", async () => {
    const token = await t.signIn(CUSTOMER);
    const { restaurantId, menuItemIds, zoneId } = t.demo();

    await t.db.execute(sql`UPDATE menu_items SET is_available = false WHERE id = ${menuItemIds.coldCoffee}`);
    let res = await place(token, orderBody(), 'key-sold-out');
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'item_unavailable']);
    await t.db.execute(sql`UPDATE menu_items SET is_available = true WHERE id = ${menuItemIds.coldCoffee}`);

    const other = await t.db.execute<{ id: string }>(sql`
      INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location)
      VALUES (${zoneId}, 'other-place', 'Other', 'অন্য', 'Cafe', 'ক্যাফে', 'Main Road',
        ST_SetSRID(ST_MakePoint(88.28, 24.6), 4326)::geography)
      RETURNING id`);
    const category = await t.db.execute<{ id: string }>(sql`
      INSERT INTO menu_categories (restaurant_id, name_en, name_bn, position)
      VALUES (${other[0]?.id}, 'Mains', 'প্রধান', 1) RETURNING id`);
    const foreign = await t.db.execute<{ id: string }>(sql`
      INSERT INTO menu_items (restaurant_id, category_id, name_en, name_bn, price_poisha, position)
      VALUES (${other[0]?.id}, ${category[0]?.id}, 'Tea', 'চা', 5000, 1) RETURNING id`);
    res = await place(token, orderBody({ items: [{ menuItemId: foreign[0]?.id, quantity: 1 }] }), 'key-foreign');
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'item_not_in_restaurant']);

    res = await place(
      token,
      orderBody({ delivery: { ...orderBody().delivery, lat: 23.8103, lng: 90.4125 } }),
      'key-dhaka',
    );
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'outside_zone']);

    await t.db.execute(sql`UPDATE restaurants SET is_open = false WHERE id = ${restaurantId}`);
    res = await place(token, orderBody(), 'key-closed');
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'restaurant_closed']);

    expect(await count('orders')).toBe(0);
    expect(await count('outbox')).toBe(0);
  });

  it('refuses a zero quantity and an empty order', async () => {
    const token = await t.signIn(CUSTOMER);
    const { menuItemIds } = t.demo();
    for (const items of [[], [{ menuItemId: menuItemIds.coldCoffee, quantity: 0 }]]) {
      const res = await place(token, orderBody({ items }), `key-${items.length}-invalid`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    }
    expect(await count('orders')).toBe(0);
  });

  it('refuses an invalid delivery phone', async () => {
    const token = await t.signIn(CUSTOMER);
    const res = await place(token, orderBody({ delivery: { ...orderBody().delivery, phone: '12345' } }));
    expect([res.statusCode, res.json().error.code]).toEqual([400, 'invalid_phone']);
    expect(await count('orders')).toBe(0);
  });

  it('only the customer, the restaurant, a holding rider and admin can read an order', async () => {
    const token = await t.signIn(CUSTOMER);
    const placed = (await place(token, orderBody())).json();
    const get = (tok: string) => t.app().inject({ method: 'GET', url: `/v1/orders/${placed.id}`, headers: t.as(tok) });

    expect((await get(token)).statusCode).toBe(200);
    expect((await get(await t.signIn('01711000002'))).statusCode).toBe(200);
    expect((await get(await t.signIn('01711000004'))).statusCode).toBe(200);

    const stranger = await t.signIn(SECOND_CUSTOMER);
    expect((await get(stranger)).statusCode).toBe(404);
    const riderToken = await t.signIn('01711000003');
    expect((await get(riderToken)).statusCode).toBe(404);

    await t.db.execute(sql`UPDATE orders SET rider_id = ${t.demo().riderId}, status = 'ready' WHERE id = ${placed.id}`);
    const asRider = await get(riderToken);
    expect(asRider.statusCode).toBe(200);
    expect(asRider.json().customerPhone).toBe('+8801711000001');
    await t.db.execute(sql`UPDATE orders SET status = 'delivered' WHERE id = ${placed.id}`);
    expect((await get(riderToken)).json().customerPhone).toBeNull();

    const notAnId = await t.app().inject({ method: 'GET', url: '/v1/orders/nope', headers: t.as(token) });
    expect(notAnId.statusCode).toBe(404);
  });

  it('lists only my own orders, newest first', async () => {
    const token = await t.signIn(CUSTOMER);
    const first = (await place(token, orderBody(), 'list-key-0001')).json();
    const second = (await place(token, orderBody(), 'list-key-0002')).json();
    await place(await t.signIn(SECOND_CUSTOMER), orderBody(), 'list-key-0003');
    const res = await t.app().inject({ method: 'GET', url: '/v1/orders', headers: t.as(token) });
    expect(res.json().orders.map((o: { id: string }) => o.id)).toEqual([second.id, first.id]);
  });

  it('a customer can cancel until the restaurant accepts', async () => {
    const token = await t.signIn(CUSTOMER);
    const placed = (await place(token, orderBody())).json();
    const cancel = () =>
      t.app().inject({ method: 'POST', url: `/v1/orders/${placed.id}/cancel`, headers: t.as(token) });

    const first = await cancel();
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('cancelled');
    const again = await cancel();
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('cancelled');
    expect(again.json().timeline.filter((e: { event: string }) => e.event === 'cancelled')).toHaveLength(1);

    const stranger = await t.signIn(SECOND_CUSTOMER);
    const other = await t
      .app()
      .inject({ method: 'POST', url: `/v1/orders/${placed.id}/cancel`, headers: t.as(stranger) });
    expect(other.statusCode).toBe(404);
  });

  it('cannot be cancelled once the restaurant has accepted', async () => {
    const token = await t.signIn(CUSTOMER);
    const placed = (await place(token, orderBody())).json();
    await t.db.execute(sql`UPDATE orders SET status = 'preparing' WHERE id = ${placed.id}`);
    const res = await t.app().inject({ method: 'POST', url: `/v1/orders/${placed.id}/cancel`, headers: t.as(token) });
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'actor_not_allowed']);
  });
});
