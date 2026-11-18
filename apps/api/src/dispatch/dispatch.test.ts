import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const CUSTOMER = '01711000001';
const OWNER = '01711000002';
const RIDER_A = '01711000003';
const RIDER_B = '01711000005';
let keyCounter = 0;

describe('riders: offers, claiming and delivering', () => {
  const t = withTestApp();

  const place = async (): Promise<{ id: string }> => {
    keyCounter += 1;
    const res = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(await t.signIn(CUSTOMER)), 'idempotency-key': `dispatch-key-${keyCounter}-0001` },
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

  const owner = async (id: string, action: string, payload?: object) =>
    t.app().inject({
      method: 'POST',
      url: `/v1/restaurant/orders/${id}/${action}`,
      headers: t.as(await t.signIn(OWNER)),
      payload,
    });

  const accepted = async (): Promise<{ id: string }> => {
    const placed = await place();
    await owner(placed.id, 'accept', { readyInMinutes: 20 });
    return placed;
  };

  const online = async (phone: string, value = true) =>
    t.app().inject({
      method: 'POST',
      url: '/v1/rider/online',
      headers: t.as(await t.signIn(phone)),
      payload: { online: value },
    });

  const claim = async (phone: string, id: string) =>
    t.app().inject({ method: 'POST', url: `/v1/rider/orders/${id}/claim`, headers: t.as(await t.signIn(phone)) });

  const step = async (phone: string, id: string, action: 'pick-up' | 'deliver') =>
    t.app().inject({ method: 'POST', url: `/v1/rider/orders/${id}/${action}`, headers: t.as(await t.signIn(phone)) });

  const offers = async (phone: string) =>
    t.app().inject({ method: 'GET', url: '/v1/rider/offers', headers: t.as(await t.signIn(phone)) });

  it('going online returns the updated Me', async () => {
    const res = await online(RIDER_A);
    expect(res.statusCode).toBe(200);
    expect(res.json().rider.isOnline).toBe(true);
    expect((await online(RIDER_A, false)).json().rider.isOnline).toBe(false);
  });

  it("an online rider sees an accepted order as an offer, without the customer's phone or address line", async () => {
    const placed = await accepted();
    await online(RIDER_A);
    const res = await offers(RIDER_A);
    expect(res.statusCode).toBe(200);
    const list = res.json().offers;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      orderId: placed.id,
      status: 'preparing',
      landmark: 'Behind the college gate',
    });
    expect(typeof list[0].distanceKm).toBe('number');
    expect(list[0].deliveryFee).toBeGreaterThan(0);
    const text = JSON.stringify(list[0]);
    expect(text).not.toContain('01711000001');
    expect(text).not.toContain('Court Road, house 7');
    expect(list[0]).not.toHaveProperty('customerPhone');
  });

  it('a placed (not yet accepted) order is not offered', async () => {
    await place();
    await online(RIDER_A);
    expect((await offers(RIDER_A)).json().offers).toEqual([]);
  });

  it('an offline rider sees no offers and cannot claim', async () => {
    const placed = await accepted();
    expect((await offers(RIDER_A)).json().offers).toEqual([]);
    const res = await claim(RIDER_A, placed.id);
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'rider_offline']);
  });

  it('claiming gives the rider the order', async () => {
    const placed = await accepted();
    await online(RIDER_A);
    const res = await claim(RIDER_A, placed.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().rider.id).toBeTruthy();
    const mine = await t
      .app()
      .inject({ method: 'GET', url: '/v1/rider/orders', headers: t.as(await t.signIn(RIDER_A)) });
    expect(mine.json().orders.map((o: { id: string }) => o.id)).toEqual([placed.id]);
    expect((await offers(RIDER_A)).json().offers).toEqual([]);
  });

  it('claiming an unknown or malformed order is 404', async () => {
    await online(RIDER_A);
    expect((await claim(RIDER_A, 'not-a-uuid')).statusCode).toBe(404);
    expect((await claim(RIDER_A, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const placed = await place();
    expect((await claim(RIDER_A, placed.id)).statusCode).toBe(404);
  });

  it('two riders claiming at the same moment: exactly one wins', async () => {
    await online(RIDER_A);
    await online(RIDER_B);
    const tokenA = await t.signIn(RIDER_A);
    const tokenB = await t.signIn(RIDER_B);
    for (let i = 0; i < 20; i += 1) {
      const placed = await accepted();
      const [a, b] = await Promise.all([
        t.app().inject({ method: 'POST', url: `/v1/rider/orders/${placed.id}/claim`, headers: t.as(tokenA) }),
        t.app().inject({ method: 'POST', url: `/v1/rider/orders/${placed.id}/claim`, headers: t.as(tokenB) }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const loser = a.statusCode === 409 ? a : b;
      expect(loser.json().error.code).toBe('already_claimed');
      const winner = a.statusCode === 200 ? a : b;
      const rows = await t.db.execute<{ rider_id: string }>(sql`SELECT rider_id FROM orders WHERE id = ${placed.id}`);
      expect(rows[0]?.rider_id).toBe(winner.json().rider.id);
    }
    // Twenty rounds of place, accept and a double claim: slow where the database is across a network.
  }, 60_000);

  it('claiming twice is harmless', async () => {
    const placed = await accepted();
    await online(RIDER_A);
    expect((await claim(RIDER_A, placed.id)).statusCode).toBe(200);
    const again = await claim(RIDER_A, placed.id);
    expect(again.statusCode).toBe(200);
    const events = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM order_events WHERE order_id = ${placed.id} AND event = 'rider_assigned'`,
    );
    expect(events[0]?.n).toBe(1);
  });

  it("the customer's phone appears for the holding rider only once the order is ready", async () => {
    const placed = await accepted();
    await online(RIDER_A);
    const claimed = await claim(RIDER_A, placed.id);
    expect(claimed.json().customerPhone).toBeNull();
    await owner(placed.id, 'ready');
    const getOrder = async () =>
      (await t.app().inject({ method: 'GET', url: '/v1/rider/orders', headers: t.as(await t.signIn(RIDER_A)) })).json()
        .orders[0];
    expect((await getOrder()).customerPhone).toBe('+8801711000001');
    const picked = await step(RIDER_A, placed.id, 'pick-up');
    expect(picked.statusCode).toBe(200);
    expect(picked.json()).toMatchObject({ status: 'on_the_way', customerPhone: '+8801711000001' });
    const delivered = await step(RIDER_A, placed.id, 'deliver');
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json()).toMatchObject({ status: 'delivered', customerPhone: null });
    expect((await step(RIDER_A, placed.id, 'deliver')).statusCode).toBe(200);
  });

  it('pick up needs ready, deliver needs on the way', async () => {
    const placed = await accepted();
    await online(RIDER_A);
    await claim(RIDER_A, placed.id);
    const early = await step(RIDER_A, placed.id, 'pick-up');
    expect([early.statusCode, early.json().error.code]).toEqual([409, 'invalid_transition']);
    await owner(placed.id, 'ready');
    const tooSoon = await step(RIDER_A, placed.id, 'deliver');
    expect([tooSoon.statusCode, tooSoon.json().error.code]).toEqual([409, 'invalid_transition']);
  });

  it('another rider cannot pick up or deliver', async () => {
    const placed = await accepted();
    await online(RIDER_A);
    await claim(RIDER_A, placed.id);
    await owner(placed.id, 'ready');
    for (const action of ['pick-up', 'deliver'] as const) {
      const res = await step(RIDER_B, placed.id, action);
      expect([res.statusCode, res.json().error.code]).toEqual([404, 'not_found']);
    }
    expect((await step(RIDER_A, 'not-a-uuid', 'pick-up')).statusCode).toBe(404);
  });

  it("the customer sees the rider's name and phone once assigned", async () => {
    const placed = await accepted();
    expect(
      (
        await t.app().inject({ method: 'GET', url: `/v1/orders/${placed.id}`, headers: t.as(await t.signIn(CUSTOMER)) })
      ).json().rider,
    ).toBeNull();
    await online(RIDER_A);
    await claim(RIDER_A, placed.id);
    const res = await t
      .app()
      .inject({ method: 'GET', url: `/v1/orders/${placed.id}`, headers: t.as(await t.signIn(CUSTOMER)) });
    expect(res.json().rider).toMatchObject({ phone: '+8801711000003' });
    expect(res.json().rider.id).toBeTruthy();
  });

  it('a claim writes one outbox row with the rider set', async () => {
    const placed = await accepted();
    await online(RIDER_A);
    const before = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM outbox`);
    await claim(RIDER_A, placed.id);
    const after = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM outbox`);
    expect((after[0]?.n ?? 0) - (before[0]?.n ?? 0)).toBe(1);
  });

  it('a customer cannot use rider routes, and a suspended rider is forbidden', async () => {
    const customer = await t
      .app()
      .inject({ method: 'GET', url: '/v1/rider/offers', headers: t.as(await t.signIn(CUSTOMER)) });
    expect([customer.statusCode, customer.json().error.code]).toEqual([403, 'forbidden']);
    await t.signIn(RIDER_A);
    await t.db.execute(sql`
      UPDATE riders SET status = 'suspended' WHERE user_id = (SELECT id FROM users WHERE phone = '+8801711000003')`);
    const res = await offers(RIDER_A);
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'forbidden']);
  });
});
