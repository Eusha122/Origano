import type { AddressInfo } from 'node:net';
import type { RiderInvite, StaffMember } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { relayOnce } from '../events/relay';
import { withTestApp } from '../testing/app';

const OWNER = '01711000002';
const CUSTOMER = '01711000001';
const STAFF = '01811000101';
const NEW_RIDER = '01911000101';

describe('restaurant staff and rider invites', () => {
  const t = withTestApp({ realtime: true, limits: { staffPerRestaurant: 3 } });
  let publisher: Redis;
  beforeAll(() => {
    publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });
  afterAll(async () => {
    await publisher.quit();
  });

  const base = () => `/v1/restaurant/${t.demo().restaurantId}`;
  const call = async (method: 'GET' | 'POST' | 'DELETE', phone: string, url: string, payload?: object) =>
    t.app().inject({ method, url, headers: t.as(await t.signIn(phone)), ...(payload ? { payload } : {}) });
  const audits = async (action: string): Promise<{ n: number; actor: string | null }> =>
    (
      await t.db.execute<{ n: number; actor: string | null }>(
        sql`SELECT count(*)::int AS n, max(actor_id::text) AS actor FROM audit_log WHERE action = ${action}`,
      )
    )[0] ?? { n: -1, actor: null };

  it('lets the owner add a staff phone, who then works for that restaurant', async () => {
    const res = await call('POST', OWNER, `${base()}/staff`, { phone: STAFF });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ phone: '+8801811000101', role: 'staff' });
    const me = (await call('GET', STAFF, '/v1/me')).json();
    expect(me.restaurantIds).toEqual([t.demo().restaurantId]);
    const members = ((await call('GET', OWNER, `${base()}/staff`)).json() as { members: StaffMember[] }).members;
    expect(members.map((m) => m.role)).toEqual(['owner', 'staff']);
    expect(await audits('staff.added')).toEqual({ n: 1, actor: t.demo().ownerId });
    // Adding the same phone again is a repeat: 200, no duplicate, no second audit row.
    const again = await call('POST', OWNER, `${base()}/staff`, { phone: STAFF });
    expect(again.statusCode).toBe(200);
    expect((await audits('staff.added')).n).toBe(1);
    expect(((await call('GET', OWNER, `${base()}/staff`)).json() as { members: unknown[] }).members).toHaveLength(2);
  });

  it('removes staff: their next request shows no restaurant, and their open socket closes with 4401', async () => {
    await call('POST', OWNER, `${base()}/staff`, { phone: STAFF });
    const token = await t.signIn(STAFF);
    const url = `ws://127.0.0.1:${(t.app().server.address() as AddressInfo).port}/v1/realtime`;
    const ws = new WebSocket(url);
    const closed = new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
    const got: string[] = [];
    ws.on('message', (d) => got.push(String(d)));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await expect.poll(() => got.length).toBe(1);

    const staffId = (await t.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE phone = '+8801811000101'`))[0]
      ?.id;
    const res = await call('DELETE', OWNER, `${base()}/staff/${staffId}`);
    expect(res.statusCode).toBe(204);
    await relayOnce(t.db, (channel, message) => publisher.publish(channel, message));
    expect(await closed).toBe(4401);
    expect(((await call('GET', STAFF, '/v1/me')).json() as { restaurantIds: string[] }).restaurantIds).toEqual([]);
    expect(await audits('staff.removed')).toEqual({ n: 1, actor: t.demo().ownerId });
    // Removing someone who is no longer a member is a repeat.
    expect((await call('DELETE', OWNER, `${base()}/staff/${staffId}`)).statusCode).toBe(204);
    expect((await audits('staff.removed')).n).toBe(1);
  });

  it('keeps every staff and invite route owner-only', async () => {
    await call('POST', OWNER, `${base()}/staff`, { phone: STAFF });
    const calls: ['GET' | 'POST' | 'DELETE', string, object?][] = [
      ['GET', `${base()}/staff`],
      ['POST', `${base()}/staff`, { phone: '01811000102' }],
      ['DELETE', `${base()}/staff/${t.demo().ownerId}`],
      ['GET', `${base()}/rider-invites`],
      ['POST', `${base()}/rider-invites`, { phone: NEW_RIDER }],
      ['DELETE', `${base()}/rider-invites/${NEW_RIDER}`],
    ];
    for (const who of [STAFF, CUSTOMER]) {
      for (const [method, url, payload] of calls) {
        expect((await call(method, who, url, payload)).statusCode, `${who} ${method} ${url}`).toBe(403);
      }
    }
    // Staff could not remove the owner.
    expect(((await call('GET', OWNER, `${base()}/staff`)).json() as { members: unknown[] }).members).toHaveLength(2);
  });

  it('keeps an owner of one restaurant out of another restaurant', async () => {
    const other = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, status)
        VALUES (${t.demo().zoneId}, 'rice-house', 'Rice House', 'Rice House', 'Rice', 'Rice', 'Main Road',
          ST_SetSRID(ST_MakePoint(88.28, 24.6), 4326)::geography, 'approved') RETURNING id`)
    )[0]?.id;
    for (const [method, path] of [
      ['GET', 'staff'],
      ['POST', 'staff'],
      ['GET', 'rider-invites'],
    ] as const) {
      const res = await call(
        method,
        OWNER,
        `/v1/restaurant/${other}/${path}`,
        method === 'POST' ? { phone: STAFF } : undefined,
      );
      expect(res.statusCode, `${method} ${path}`).toBe(403);
    }
    expect((await call('GET', OWNER, '/v1/restaurant/not-an-id/staff')).statusCode).toBe(404);
  });

  it('refuses the member over the limit, but not a repeat of someone already in', async () => {
    // The limit is 3 in this test: the owner and two staff.
    expect((await call('POST', OWNER, `${base()}/staff`, { phone: '01811000111' })).statusCode).toBe(201);
    expect((await call('POST', OWNER, `${base()}/staff`, { phone: '01811000112' })).statusCode).toBe(201);
    const over = await call('POST', OWNER, `${base()}/staff`, { phone: '01811000113' });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: { code: 'staff_limit_reached' } });
    expect((await call('POST', OWNER, `${base()}/staff`, { phone: '01811000112' })).statusCode).toBe(200);
  });

  it('will not remove the only owner', async () => {
    const res = await call('DELETE', OWNER, `${base()}/staff/${t.demo().ownerId}`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'cannot_remove_last_owner' } });
    expect(((await call('GET', OWNER, `${base()}/staff`)).json() as { members: unknown[] }).members).toHaveLength(1);
  });

  it('refuses a bad phone number', async () => {
    expect((await call('POST', OWNER, `${base()}/staff`, { phone: '123' })).statusCode).toBe(400);
    expect((await call('POST', OWNER, `${base()}/rider-invites`, { phone: '123' })).statusCode).toBe(400);
  });

  it('invites a rider, shows where their application stands, and withdrawing the invite leaves a bound rider alone', async () => {
    const created = await call('POST', OWNER, `${base()}/rider-invites`, { phone: NEW_RIDER });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ phone: '+8801911000101', riderStatus: null });
    expect((await call('POST', OWNER, `${base()}/rider-invites`, { phone: NEW_RIDER })).statusCode).toBe(200);
    expect((await audits('rider_invite.created')).n).toBe(1);

    // The invited person applies as the restaurant's own rider.
    const token = await t.signIn(NEW_RIDER);
    const applied = await t.app().inject({
      method: 'PUT',
      url: '/v1/onboarding/rider',
      headers: t.as(token),
      payload: {
        type: 'restaurant_staff',
        zoneId: t.demo().zoneId,
        name: 'Rafiq Mia',
        vehicleType: 'bicycle',
        vehicleRegistration: null,
        guarantor: { name: 'Karim Mia', phone: '01911000999', relation: 'Father' },
      },
    });
    expect(applied.statusCode).toBe(200);
    const listed = ((await call('GET', OWNER, `${base()}/rider-invites`)).json() as { invites: RiderInvite[] }).invites;
    expect(listed).toMatchObject([{ phone: '+8801911000101', riderStatus: 'applied' }]);

    expect((await call('DELETE', OWNER, `${base()}/rider-invites/${NEW_RIDER}`)).statusCode).toBe(204);
    expect((await audits('rider_invite.deleted')).n).toBe(1);
    expect((await call('DELETE', OWNER, `${base()}/rider-invites/${NEW_RIDER}`)).statusCode).toBe(204);
    expect((await audits('rider_invite.deleted')).n).toBe(1);
    const bound = await t.db.execute<{ restaurant_id: string | null }>(
      sql`SELECT restaurant_id FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = '+8801911000101'`,
    );
    expect(bound[0]?.restaurant_id).toBe(t.demo().restaurantId);
  });
});
