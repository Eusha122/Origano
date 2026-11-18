import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const CUSTOMER = '01711000001';
const OWNER = '01711000002';
const OTHER_OWNER = '01711000077';

describe('the restaurant side of an order', () => {
  const t = withTestApp();

  const place = async (key = 'restaurant-key-0001'): Promise<{ id: string }> => {
    const res = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(await t.signIn(CUSTOMER)), 'idempotency-key': key },
      payload: {
        restaurantId: t.demo().restaurantId,
        items: [{ menuItemId: t.demo().menuItemIds.beefCheeseBurger, quantity: 1 }],
        delivery: {
          lat: 24.5965,
          lng: 88.2775,
          addressLine: 'Court Road',
          landmark: 'Behind the college gate',
          phone: '01711000001',
        },
      },
    });
    return res.json();
  };

  const act = async (token: string, id: string, action: string, payload?: object) =>
    t.app().inject({ method: 'POST', url: `/v1/restaurant/orders/${id}/${action}`, headers: t.as(token), payload });

  const outboxCount = async (): Promise<number> => {
    const rows = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM outbox`);
    return rows[0]?.n ?? -1;
  };

  it("lists new orders for the owner's restaurant", async () => {
    const placed = await place();
    const res = await t
      .app()
      .inject({ method: 'GET', url: '/v1/restaurant/orders', headers: t.as(await t.signIn(OWNER)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().orders.map((o: { id: string }) => o.id)).toEqual([placed.id]);
  });

  it('accepts with a ready time and records the accepted event', async () => {
    const placed = await place();
    const res = await act(await t.signIn(OWNER), placed.id, 'accept', { readyInMinutes: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'preparing', readyInMinutes: 20 });
    expect(res.json().timeline.map((e: { event: string }) => e.event)).toContain('accepted');
  });

  it('a second accept tap returns the same order, not an error', async () => {
    const placed = await place();
    const token = await t.signIn(OWNER);
    await act(token, placed.id, 'accept', { readyInMinutes: 20 });
    const again = await act(token, placed.id, 'accept', { readyInMinutes: 20 });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('preparing');
    expect(again.json().timeline.filter((e: { event: string }) => e.event === 'accepted')).toHaveLength(1);
  });

  it('rejects with a reason', async () => {
    const placed = await place();
    const res = await act(await t.signIn(OWNER), placed.id, 'reject', { reason: 'too_busy' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'rejected', rejectReason: 'too_busy' });
  });

  it('refuses a bad body', async () => {
    const placed = await place();
    const token = await t.signIn(OWNER);
    for (const [action, body] of [
      ['accept', { readyInMinutes: 15 }],
      ['reject', { reason: 'bored' }],
    ] as const) {
      const res = await act(token, placed.id, action, body);
      expect([res.statusCode, res.json().error.code]).toEqual([400, 'validation_failed']);
    }
  });

  it('marks an accepted order ready', async () => {
    const placed = await place();
    const token = await t.signIn(OWNER);
    await act(token, placed.id, 'accept', { readyInMinutes: 10 });
    const res = await act(token, placed.id, 'ready');
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ready');
    const again = await act(token, placed.id, 'ready');
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('ready');
  });

  it('cannot mark a placed order ready', async () => {
    const placed = await place();
    const res = await act(await t.signIn(OWNER), placed.id, 'ready');
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'invalid_transition']);
  });

  it('staff of another restaurant get 404', async () => {
    const placed = await place();
    await t.signIn(OTHER_OWNER);
    const other = await t.db.execute<{ id: string }>(sql`
      INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, status)
      VALUES (${t.demo().zoneId}, 'other-place', 'Other', 'অন্য', 'Cafe', 'ক্যাফে', 'Main Road',
        ST_SetSRID(ST_MakePoint(88.28, 24.6), 4326)::geography, 'approved')
      RETURNING id`);
    await t.db.execute(sql`
      INSERT INTO restaurant_staff (restaurant_id, user_id, role)
      SELECT ${other[0]?.id}, id, 'owner' FROM users WHERE phone = '+8801711000077'`);
    const token = await t.signIn(OTHER_OWNER);
    for (const [action, body] of [
      ['accept', { readyInMinutes: 20 }],
      ['reject', { reason: 'too_busy' }],
      ['ready', undefined],
    ] as const) {
      const res = await act(token, placed.id, action, body);
      expect([res.statusCode, res.json().error.code], action).toEqual([404, 'not_found']);
    }
    expect((await act(token, 'not-a-uuid', 'ready')).statusCode).toBe(404);
    const list = await t.app().inject({ method: 'GET', url: '/v1/restaurant/orders', headers: t.as(token) });
    expect(list.json().orders).toEqual([]);
  });

  it('a customer cannot use restaurant routes', async () => {
    const token = await t.signIn(CUSTOMER);
    const res = await t.app().inject({ method: 'GET', url: '/v1/restaurant/orders', headers: t.as(token) });
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'forbidden']);
    const placed = await place();
    const post = await act(token, placed.id, 'ready');
    expect([post.statusCode, post.json().error.code]).toEqual([403, 'forbidden']);
  });

  it('every change writes one outbox row', async () => {
    const placed = await place();
    const token = await t.signIn(OWNER);
    expect(await outboxCount()).toBe(1);
    await act(token, placed.id, 'accept', { readyInMinutes: 30 });
    await act(token, placed.id, 'accept', { readyInMinutes: 30 });
    expect(await outboxCount()).toBe(2);
    await act(token, placed.id, 'ready');
    await act(token, placed.id, 'ready');
    expect(await outboxCount()).toBe(3);
  });
});
