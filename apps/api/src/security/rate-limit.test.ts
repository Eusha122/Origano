import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createS3Store } from '../media/store';
import { withTestApp } from '../testing/app';
import { withTestDb } from '../testing/db';
import { TEST_DATA_KEYS } from '../testing/keys';

const get = (t: ReturnType<typeof withTestApp>, url: string, ip: string, headers: Record<string, string> = {}) =>
  t.app().inject({ method: 'GET', url, remoteAddress: ip, headers });

describe('per-IP limits', () => {
  const t = withTestApp({ limits: { routePerIpMinute: 6, restaurantListPerIpMinute: 3 } });

  it('limits the restaurant list to a few a minute per address, with Retry-After, and leaves other addresses alone', async () => {
    for (let i = 0; i < 3; i++) expect((await get(t, '/v1/restaurants', '192.0.2.10')).statusCode).toBe(200);
    const over = await get(t, '/v1/restaurants', '192.0.2.10');
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('rate_limited');
    const wait = Number(over.headers['retry-after']);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    expect((await get(t, '/v1/restaurants', '192.0.2.11')).statusCode).toBe(200);
  });

  it('limits every route per address, and counts an IPv6 /64 as one address', async () => {
    for (let i = 0; i < 6; i++) await get(t, '/v1/me', `2001:db8:5:1::${i + 1}`);
    const over = await get(t, '/v1/me', '2001:db8:5:1:ffff::1');
    expect(over.statusCode).toBe(429);
    expect((await get(t, '/v1/me', '2001:db8:5:2::1')).statusCode).toBe(401);
  });

  it('never limits the health checks', async () => {
    for (let i = 0; i < 20; i++) expect((await get(t, '/healthz', '192.0.2.20')).statusCode).toBe(200);
  });

  it('lets a browser read how long to wait', async () => {
    const res = await get(t, '/v1/restaurants', '192.0.2.30', { origin: 'http://localhost:8081' });
    expect(res.headers['access-control-expose-headers']).toContain('retry-after');
  });
});

describe('per-user limits', () => {
  const t = withTestApp({ limits: { writesPerUserMinute: 3, ordersPerUserTenMinutes: 3 } });

  const cancel = (token: string, ip = '192.0.2.40') =>
    t.app().inject({
      method: 'POST',
      url: '/v1/orders/3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a/cancel',
      headers: t.as(token),
      remoteAddress: ip,
    });

  it('limits writes per signed-in user, not per address: two users on one address have a budget each', async () => {
    const a = await t.signIn('01711000001');
    const b = await t.signIn('01711000099');
    for (let i = 0; i < 3; i++) expect((await cancel(a)).statusCode).toBe(404);
    const over = await cancel(a);
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('rate_limited');
    expect((await cancel(b)).statusCode).toBe(404);
  });

  it('limits order placement per user across different idempotency keys', async () => {
    const token = await t.signIn('01711000001');
    const place = (key: string) =>
      t.app().inject({
        method: 'POST',
        url: '/v1/orders',
        headers: { ...t.as(token), 'idempotency-key': key },
        payload: {
          restaurantId: t.demo().restaurantId,
          items: [{ menuItemId: t.demo().menuItemIds.coldCoffee, quantity: 1 }],
          delivery: { lat: 24.5965, lng: 88.2775, addressLine: 'Court Road', landmark: 'Gate', phone: '01711000001' },
        },
        remoteAddress: '192.0.2.50',
      });
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await place(`rate-key-000${i}`)).statusCode);
    expect(results).toEqual([201, 201, 201, 429]);
  });
});

describe('when Redis is down', () => {
  const { db } = withTestDb();
  const redis = new Redis('redis://127.0.0.1:1', {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  redis.on('error', () => {});
  afterAll(() => redis.disconnect());

  it('ordering keeps working: limits fail open, quickly', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@localhost/x',
      REDIS_URL: 'redis://localhost',
      OTP_SECRET: 'x'.repeat(40),
      DATA_KEYS: TEST_DATA_KEYS,
    });
    const app = await buildApp({
      config,
      checks: [],
      services: {
        db,
        sms: { keys: config.dataKeys, retainUntilExpiry: false },
        redis,
        store: createS3Store(config.s3),
      },
    });
    try {
      const started = Date.now();
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({ method: 'GET', url: '/v1/restaurants' });
        expect(res.statusCode).toBe(200);
      }
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await app.close();
    }
  });
});
