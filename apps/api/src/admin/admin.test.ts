import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const CUSTOMER = '01711000001';
const OWNER = '01711000002';
const RIDER = '01711000003';
const ADMIN = '01711000004';
let keyCounter = 0;

describe('admin: live order list', () => {
  const t = withTestApp();

  const place = async (): Promise<{ id: string; number: number }> => {
    keyCounter += 1;
    const res = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(await t.signIn(CUSTOMER)), 'idempotency-key': `admin-key-${keyCounter}-00001` },
      payload: {
        restaurantId: t.demo().restaurantId,
        items: [{ menuItemId: t.demo().menuItemIds.beefCheeseBurger, quantity: 1 }],
        delivery: {
          lat: 24.5965,
          lng: 88.2775,
          addressLine: 'Court Road, house 7',
          landmark: 'Behind the college gate',
          phone: '01711000001',
        },
      },
    });
    return res.json();
  };

  const list = async (phone: string) =>
    t.app().inject({ method: 'GET', url: '/v1/admin/orders', headers: t.as(await t.signIn(phone)) });

  it('the admin sees every recent order with customer and rider details', async () => {
    const first = await place();
    const second = await place();
    await t.app().inject({
      method: 'POST',
      url: `/v1/restaurant/orders/${second.id}/accept`,
      headers: t.as(await t.signIn(OWNER)),
      payload: { readyInMinutes: 20 },
    });
    await t.app().inject({
      method: 'POST',
      url: '/v1/rider/online',
      headers: t.as(await t.signIn(RIDER)),
      payload: { online: true },
    });
    await t.app().inject({
      method: 'POST',
      url: `/v1/rider/orders/${second.id}/claim`,
      headers: t.as(await t.signIn(RIDER)),
    });

    const res = await list(ADMIN);
    expect(res.statusCode).toBe(200);
    const { orders } = res.json();
    expect(orders.map((o: { id: string }) => o.id)).toEqual([second.id, first.id]);
    expect(orders[0]).toMatchObject({
      number: second.number,
      status: 'preparing',
      customerPhone: '+8801711000001',
      riderPhone: '+8801711000003',
    });
    expect(typeof orders[0].riderName).toBe('string');
    expect(typeof orders[0].restaurantNameEn).toBe('string');
    expect(Number.isInteger(orders[0].total)).toBe(true);
    expect(orders[0].createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(orders[1]).toMatchObject({ status: 'placed', riderName: null, riderPhone: null });
  });

  it('orders older than 24 hours are left out', async () => {
    const old = await place();
    const fresh = await place();
    await t.db.execute(sql`UPDATE orders SET created_at = now() - interval '25 hours' WHERE id = ${old.id}`);
    const res = await list(ADMIN);
    expect(res.json().orders.map((o: { id: string }) => o.id)).toEqual([fresh.id]);
  });

  it('a customer, a restaurant owner and a rider all get 403', async () => {
    for (const phone of [CUSTOMER, OWNER, RIDER]) {
      const res = await list(phone);
      expect([res.statusCode, res.json().error.code]).toEqual([403, 'forbidden']);
    }
  });
});
