import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { relayOnce } from '../events/relay';
import { withTestApp } from '../testing/app';

const CUSTOMER = '01711000001';
const OWNER = '01711000002';
const RIDER_A = '01711000003';
const RIDER_B = '01711000005';
const ONBOARDING = '01711000006';
const SUPPORT = '01711000007';
const REASON = { reason: 'Repeated complaints from customers.' };
let keys = 0;

describe('suspending and reinstating accounts', () => {
  const t = withTestApp({ realtime: true });
  let publisher: Redis;
  beforeAll(() => {
    publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });
  afterAll(async () => {
    await publisher.quit();
  });

  const as = async (phone: string) => t.as(await t.signIn(phone));
  const post = async (phone: string, url: string, payload?: object) =>
    t.app().inject({ method: 'POST', url, headers: await as(phone), ...(payload ? { payload } : {}) });
  const get = async (phone: string, url: string) => t.app().inject({ method: 'GET', url, headers: await as(phone) });

  const place = async (): Promise<string> => {
    keys += 1;
    const res = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...(await as(CUSTOMER)), 'idempotency-key': `accounts-key-${keys}-00001` },
      payload: {
        restaurantId: t.demo().restaurantId,
        items: [{ menuItemId: t.demo().menuItemIds.beefCheeseBurger, quantity: 1 }],
        delivery: { lat: 24.5965, lng: 88.2775, addressLine: 'Court Road', landmark: 'Gate', phone: CUSTOMER },
      },
    });
    return (res.json() as { id: string }).id;
  };
  const owner = async (id: string, action: string, payload?: object) =>
    post(OWNER, `/v1/restaurant/orders/${id}/${action}`, payload);
  const goOnline = (phone: string, online = true) => post(phone, '/v1/rider/online', { online });

  /** An order that is accepted and ready, claimed by RIDER_A. */
  const heldReady = async (): Promise<string> => {
    const id = await place();
    await owner(id, 'accept', { readyInMinutes: 20 });
    await owner(id, 'ready');
    expect((await post(RIDER_A, `/v1/rider/orders/${id}/claim`)).statusCode).toBe(200);
    return id;
  };
  const riderId = async (phone: string): Promise<string> =>
    (await t.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE phone = ${`+88${phone}`}`))[0]?.id as string;
  const audits = async (action: string): Promise<{ n: number; actor: string | null }> => {
    const rows = await t.db.execute<{ n: number; actor: string | null }>(
      sql`SELECT count(*)::int AS n, max(actor_id::text) AS actor FROM audit_log WHERE action = ${action}`,
    );
    return rows[0] ?? { n: -1, actor: null };
  };
  const adminId = async (): Promise<string> => riderId(ONBOARDING);

  describe('riders', () => {
    it('releases orders not yet picked up, lets the rider finish the one on the road, and stops them taking more', async () => {
      await goOnline(RIDER_A);
      const a = await heldReady();
      const b = await heldReady();
      expect((await post(RIDER_A, `/v1/rider/orders/${b}/pick-up`)).statusCode).toBe(200);
      const id = await riderId(RIDER_A);

      const res = await post(ONBOARDING, `/v1/admin/riders/${id}/suspend`, REASON);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'suspended' });

      const holders = await t.db.execute<{ id: string; rider_id: string | null; status: string }>(
        sql`SELECT id, rider_id, status FROM orders WHERE id IN (${a}, ${b})`,
      );
      expect(holders.find((o) => o.id === a)?.rider_id).toBeNull();
      expect(holders.find((o) => o.id === b)).toMatchObject({ rider_id: id, status: 'on_the_way' });
      const events = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM order_events WHERE event = 'rider_released' AND order_id = ${a}`,
      );
      expect(events[0]?.n).toBe(1);

      // Order A is on offer to another rider again.
      await goOnline(RIDER_B);
      const offers = (await get(RIDER_B, '/v1/rider/offers')).json() as { offers: { orderId: string }[] };
      expect(offers.offers.map((o) => o.orderId)).toContain(a);

      // The suspended rider can still deliver what they carry, but cannot work.
      expect((await post(RIDER_A, `/v1/rider/orders/${b}/deliver`)).statusCode).toBe(200);
      expect((await get(RIDER_A, '/v1/rider/orders')).statusCode).toBe(200);
      expect((await goOnline(RIDER_A)).statusCode).toBe(403);
      expect((await post(RIDER_A, `/v1/rider/orders/${a}/claim`)).statusCode).toBe(403);
      expect((await get(RIDER_A, '/v1/rider/offers')).statusCode).toBe(403);
      const me = (await get(RIDER_A, '/v1/me')).json();
      expect(me.rider).toMatchObject({ status: 'suspended', isOnline: false });
      expect(me.roles).not.toContain('rider');
    });

    it('closes the rider’s open socket with 4401', async () => {
      const token = await t.signIn(RIDER_A);
      const url = `ws://127.0.0.1:${(t.app().server.address() as AddressInfo).port}/v1/realtime`;
      const ws = new WebSocket(url);
      const closed = new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
      const got: string[] = [];
      ws.on('message', (d) => got.push(String(d)));
      await new Promise<void>((resolve) => ws.once('open', () => resolve()));
      ws.send(JSON.stringify({ type: 'auth', token }));
      await expect.poll(() => got.length).toBe(1);

      await post(ONBOARDING, `/v1/admin/riders/${await riderId(RIDER_A)}/suspend`, REASON);
      await relayOnce(t.db, (channel, message) => publisher.publish(channel, message));
      expect(await closed).toBe(4401);
    });

    it('reinstating lets them go online again; repeating either action changes nothing', async () => {
      const id = await riderId(RIDER_A);
      await post(ONBOARDING, `/v1/admin/riders/${id}/suspend`, REASON);
      const again = await post(ONBOARDING, `/v1/admin/riders/${id}/suspend`, REASON);
      expect(again.statusCode).toBe(200);
      expect((await audits('rider.suspended')).n).toBe(1);

      expect((await post(ONBOARDING, `/v1/admin/riders/${id}/reinstate`)).statusCode).toBe(200);
      expect((await post(ONBOARDING, `/v1/admin/riders/${id}/reinstate`)).statusCode).toBe(200);
      expect((await audits('rider.reinstated')).n).toBe(1);
      expect((await goOnline(RIDER_A)).statusCode).toBe(200);
      const [row] = await t.db.execute<{ suspended_reason: string | null }>(
        sql`SELECT suspended_reason FROM riders WHERE user_id = ${id}`,
      );
      expect(row?.suspended_reason).toBeNull();
    });

    it('refuses to suspend a rider who is not approved', async () => {
      await t.db.execute(sql`UPDATE riders SET status = 'under_review' WHERE user_id = ${await riderId(RIDER_A)}`);
      const res = await post(ONBOARDING, `/v1/admin/riders/${await riderId(RIDER_A)}/suspend`, REASON);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'invalid_transition' } });
    });

    it('audits once with the acting admin, and needs accounts.manage and a reason', async () => {
      const id = await riderId(RIDER_A);
      expect((await post(SUPPORT, `/v1/admin/riders/${id}/suspend`, REASON)).statusCode).toBe(403);
      expect((await post(CUSTOMER, `/v1/admin/riders/${id}/suspend`, REASON)).statusCode).toBe(403);
      expect((await post(ONBOARDING, `/v1/admin/riders/${id}/suspend`, { reason: 'x' })).statusCode).toBe(400);
      await post(ONBOARDING, `/v1/admin/riders/${id}/suspend`, REASON);
      expect(await audits('rider.suspended')).toEqual({ n: 1, actor: await adminId() });
      const outbox = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM outbox WHERE topic = 'user.access_changed'`,
      );
      expect(outbox[0]?.n).toBeGreaterThan(0);
    });
  });

  describe('restaurants', () => {
    it('hides a suspended restaurant, keeps its existing orders, and brings it back on reinstating', async () => {
      const orderId = await place();
      const list = async () =>
        (
          (await t.app().inject({ method: 'GET', url: '/v1/restaurants' })).json() as {
            restaurants: { slug: string }[];
          }
        ).restaurants.map((r) => r.slug);
      expect(await list()).toContain('burger-lane');

      const url = `/v1/admin/restaurants/${t.demo().restaurantId}`;
      expect((await post(ONBOARDING, `${url}/suspend`, REASON)).statusCode).toBe(200);
      expect(await list()).not.toContain('burger-lane');
      expect((await post(ONBOARDING, `${url}/suspend`, REASON)).statusCode).toBe(200);
      expect((await audits('restaurant.suspended')).n).toBe(1);

      // The restaurant's staff still work the orders already placed.
      expect((await owner(orderId, 'accept', { readyInMinutes: 20 })).statusCode).toBe(200);
      expect(((await get(OWNER, '/v1/restaurant/orders')).json() as { orders: unknown[] }).orders).toHaveLength(1);

      expect((await post(ONBOARDING, `${url}/reinstate`)).statusCode).toBe(200);
      expect(await list()).toContain('burger-lane');
      expect((await audits('restaurant.reinstated')).n).toBe(1);
      const outbox = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM outbox WHERE topic = 'user.access_changed'`,
      );
      expect(outbox[0]?.n).toBe(2);
    });

    it('needs the permission, and an unknown restaurant is 404', async () => {
      expect((await post(SUPPORT, `/v1/admin/restaurants/${t.demo().restaurantId}/suspend`, REASON)).statusCode).toBe(
        403,
      );
      expect(
        (await post(ONBOARDING, '/v1/admin/restaurants/00000000-0000-4000-8000-000000000000/suspend', REASON))
          .statusCode,
      ).toBe(404);
    });
  });

  describe('agencies', () => {
    const agency = async (): Promise<{ id: string; code: string }> => {
      const res = await post(ONBOARDING, '/v1/admin/agencies', { name: 'Swift Riders', contactPhone: '01911999999' });
      expect(res.statusCode).toBe(201);
      return res.json();
    };
    const joinAgency = async (phone: string, agencyId: string): Promise<void> => {
      await t.db.execute(
        sql`UPDATE riders SET type = 'agency', agency_id = ${agencyId} WHERE user_id = ${await riderId(phone)}`,
      );
    };

    it('generates a code from the allowed alphabet and lists agencies with their rider counts', async () => {
      const created = await agency();
      expect(created.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      await joinAgency(RIDER_A, created.id);
      const list = (await get(ONBOARDING, '/v1/admin/agencies')).json() as {
        agencies: { id: string; code: string; status: string; riderCount: number }[];
      };
      expect(list.agencies).toEqual([
        { id: created.id, name: 'Swift Riders', code: created.code, status: 'approved', riderCount: 1 },
      ]);
      expect((await audits('agency.created')).n).toBe(1);
      expect((await get(SUPPORT, '/v1/admin/agencies')).statusCode).toBe(403);
      expect(
        (await post(ONBOARDING, '/v1/admin/agencies', { name: 'Bad Phone', contactPhone: '123' })).statusCode,
      ).toBe(400);
    });

    it('suspending an agency stops its riders and releases their unpicked orders; reinstating lets them work', async () => {
      const created = await agency();
      await joinAgency(RIDER_A, created.id);
      await goOnline(RIDER_A);
      const orderId = await heldReady();

      expect((await post(ONBOARDING, `/v1/admin/agencies/${created.id}/suspend`, REASON)).statusCode).toBe(200);
      expect((await goOnline(RIDER_A)).statusCode).toBe(403);
      const [order] = await t.db.execute<{ rider_id: string | null }>(
        sql`SELECT rider_id FROM orders WHERE id = ${orderId}`,
      );
      expect(order?.rider_id).toBeNull();
      const [rider] = await t.db.execute<{ is_online: boolean }>(
        sql`SELECT is_online FROM riders WHERE user_id = ${await riderId(RIDER_A)}`,
      );
      expect(rider?.is_online).toBe(false);
      expect((await audits('agency.suspended')).n).toBe(1);
      expect((await post(ONBOARDING, `/v1/admin/agencies/${created.id}/suspend`, REASON)).statusCode).toBe(200);
      expect((await audits('agency.suspended')).n).toBe(1);

      expect((await post(ONBOARDING, `/v1/admin/agencies/${created.id}/reinstate`)).statusCode).toBe(200);
      expect((await goOnline(RIDER_A)).statusCode).toBe(200);
      expect((await audits('agency.reinstated')).n).toBe(1);
    });
  });
});
