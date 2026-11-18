import type { AddressInfo } from 'node:net';
import type { BdPhone, OrderStatus } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AuthUser } from '../identity/sessions';
import { withTestApp } from '../testing/app';
import type { OrderChangedPayload } from './outbox';
import { audienceIncludes } from './realtime';
import { EVENTS_CHANNEL } from './relay';

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  phone: '+8801711000001' as BdPhone,
  name: null,
  teamRoles: [],
  restaurantIds: [],
  rider: null,
  ...over,
});
const event = (over: Partial<OrderChangedPayload> = {}): OrderChangedPayload => ({
  orderId: 'o1',
  customerId: 'c1',
  restaurantId: 'r1',
  riderId: null,
  zoneId: 'z1',
  status: 'placed' as OrderStatus,
  ...over,
});
const rider = (id: string, zoneId: string, status = 'approved'): AuthUser =>
  user({ id, rider: { zoneId, status, isOnline: true } });

describe('audienceIncludes', () => {
  const cases: [string, AuthUser, OrderChangedPayload, boolean][] = [
    ['a superadmin', user({ teamRoles: ['superadmin'] }), event(), true],
    ['a support member', user({ teamRoles: ['support'] }), event(), true],
    ['the order customer', user({ id: 'c1' }), event(), true],
    ['another customer', user({ id: 'c2' }), event(), false],
    ['staff of the restaurant', user({ restaurantIds: ['r1'] }), event(), true],
    ['staff of another restaurant', user({ restaurantIds: ['r2'] }), event(), false],
    ['the holding rider', rider('d1', 'z1'), event({ riderId: 'd1', status: 'on_the_way' }), true],
    ['another rider once a rider holds the order', rider('d2', 'z1'), event({ riderId: 'd1', status: 'ready' }), false],
    ['zone rider, preparing, no rider', rider('d2', 'z1'), event({ status: 'preparing' }), true],
    ['zone rider, ready, no rider', rider('d2', 'z1'), event({ status: 'ready' }), true],
    ['zone rider, placed, no rider', rider('d2', 'z1'), event({ status: 'placed' }), false],
    ['rider in another zone', rider('d2', 'z2'), event({ status: 'ready' }), false],
    ['unapproved rider in the zone', rider('d2', 'z1', 'applied'), event({ status: 'ready' }), false],
  ];
  it.each(cases)('%s', (_name, who, ev, expected) => {
    expect(audienceIncludes(who, ev)).toBe(expected);
  });
});

describe('realtime websocket', () => {
  const t = withTestApp({ realtime: true });
  let publisher: Redis;
  beforeAll(() => {
    publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });
  afterAll(async () => {
    await publisher.quit();
  });

  const url = (): string => `ws://127.0.0.1:${(t.app().server.address() as AddressInfo).port}/v1/realtime`;
  const closeCode = (ws: WebSocket): Promise<number> => new Promise((resolve) => ws.once('close', (c) => resolve(c)));
  const opened = (ws: WebSocket): Promise<void> => new Promise((resolve) => ws.once('open', () => resolve()));
  const userId = async (phone: string): Promise<string> => {
    const rows = await t.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE phone = ${phone}`);
    const row = rows[0];
    if (!row) throw new Error(`no user ${phone}`);
    return row.id;
  };

  it('a WebSocket that authenticates receives hints for its own orders only', async () => {
    const tokenA = await t.signIn('01711000001');
    await t.signIn('01711000099');
    const customerA = await userId('+8801711000001');
    const customerB = await userId('+8801711000099');
    const ws = new WebSocket(url());
    const got: string[] = [];
    ws.on('message', (data) => got.push(String(data)));
    await opened(ws);
    ws.send(JSON.stringify({ type: 'auth', token: tokenA }));
    await expect.poll(() => got.length).toBe(1);
    const mine = '7f0c6d3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f';
    const theirs = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
    const base = { restaurantId: 'r-x', riderId: null, zoneId: 'z-x', status: 'placed' };
    await publisher.publish(EVENTS_CHANNEL, JSON.stringify({ ...base, orderId: theirs, customerId: customerB }));
    await publisher.publish(EVENTS_CHANNEL, JSON.stringify({ ...base, orderId: mine, customerId: customerA }));
    await expect.poll(() => got.length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(got).toEqual([JSON.stringify({ type: 'ready' }), JSON.stringify({ type: 'order.changed', orderId: mine })]);
    const closed = closeCode(ws);
    ws.close();
    await closed;
  });

  it('a WebSocket that never authenticates receives nothing and is closed with 4401', async () => {
    // An admin socket hears every hint, so its message proves the hint went out while the other socket waited.
    const admin = new WebSocket(url());
    const adminGot: string[] = [];
    admin.on('message', (d) => adminGot.push(String(d)));
    await opened(admin);
    admin.send(JSON.stringify({ type: 'auth', token: await t.signIn('01711000004') }));
    await expect.poll(() => adminGot.length).toBe(1);

    const ws = new WebSocket(url());
    const got: string[] = [];
    ws.on('message', (d) => got.push(String(d)));
    const closed = closeCode(ws);
    await opened(ws);
    const orderId = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
    const hint = { orderId, customerId: 'c-x', restaurantId: 'r-x', riderId: null, zoneId: 'z-x', status: 'placed' };
    await publisher.publish(EVENTS_CHANNEL, JSON.stringify(hint));
    await expect.poll(() => adminGot.length).toBe(2);

    expect(await closed).toBe(4401);
    expect(got).toEqual([]);
    const adminClosed = closeCode(admin);
    admin.close();
    await adminClosed;
  }, 10_000);

  it('closes with 4400 on a malformed message and 4401 on a bad token', async () => {
    const bad = new WebSocket(url());
    await opened(bad);
    bad.send('{"nope":1}');
    expect(await closeCode(bad)).toBe(4400);
    const wrong = new WebSocket(url());
    await opened(wrong);
    wrong.send(JSON.stringify({ type: 'auth', token: 'not-a-token' }));
    expect(await closeCode(wrong)).toBe(4401);
  });

  it('closes an unauthenticated socket that sends an oversized frame', async () => {
    const ws = new WebSocket(url());
    await opened(ws);
    ws.send('x'.repeat(10_000));
    expect(await closeCode(ws)).toBe(1009);
  });
});
