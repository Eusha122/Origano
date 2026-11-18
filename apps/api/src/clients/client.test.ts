import type { AddressInfo } from 'node:net';
import { ApiError, createApiClient, createMemorySessionStore, newIdempotencyKey } from '@oregano/api-client';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const CUSTOMER = '01711000001';

describe('typed API client against the real API', () => {
  const t = withTestApp();
  let baseUrl = '';
  beforeAll(async () => {
    await t.app().listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(t.app().server.address() as AddressInfo).port}`;
  });

  /** A client that holds its session in memory, as a native app does. Pass a token to start signed in. */
  const clientWith = (accessToken?: string) => {
    const session = createMemorySessionStore();
    if (accessToken) session.save({ accessToken, refreshToken: null });
    return { client: createApiClient({ baseUrl, session }), session };
  };

  it('signs in and reads me', async () => {
    const { client } = clientWith();
    const requested = await client.requestOtp(CUSTOMER);
    expect(requested.expiresInSeconds).toBeGreaterThan(0);
    const code = await t.otp.last('+8801711000001');
    if (!code) throw new Error('no OTP was sent');
    const session = await client.verifyOtp(CUSTOMER, code);
    const me = await client.me();
    expect(me).toEqual(session.user);
    expect(me.phone).toBe('+8801711000001');
    await client.logout();
    await expect(client.me()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });

  it('keeps a user signed in past an expired access token by refreshing silently', async () => {
    const { client, session } = clientWith();
    await client.requestOtp(CUSTOMER);
    await client.verifyOtp(CUSTOMER, (await t.otp.last('+8801711000001')) as string);
    const before = session.getAccessToken();
    await t.db.execute(sql`UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE kind = 'access'`);
    const me = await client.me();
    expect(me.phone).toBe('+8801711000001');
    expect(session.getAccessToken()).not.toBe(before);
  });

  it('signs the client out when the refresh token is no longer good', async () => {
    let signedOut = 0;
    const store = createMemorySessionStore();
    const client = createApiClient({ baseUrl, session: store, onSignedOut: () => signedOut++ });
    await client.requestOtp(CUSTOMER);
    await client.verifyOtp(CUSTOMER, (await t.otp.last('+8801711000001')) as string);
    await t.db.execute(sql`UPDATE auth_sessions SET revoked_at = now()`);
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toBe(1);
    expect(store.getAccessToken()).toBeNull();
  });

  it('turns an error body into ApiError with code and requestId', async () => {
    const { client } = clientWith();
    await client.requestOtp(CUSTOMER);
    const error = await client.verifyOtp(CUSTOMER, '000000').catch((e: unknown) => e);
    // A captured code is random, so 000000 is wrong except by a one-in-a-million chance.
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'otp_invalid' });
    expect((error as ApiError).requestId).not.toBe('');
  });

  it('placeOrder sends the Idempotency-Key header', async () => {
    const token = await t.signIn(CUSTOMER);
    const { client } = clientWith(token);
    const body = {
      restaurantId: t.demo().restaurantId,
      items: [{ menuItemId: t.demo().menuItemIds.beefCheeseBurger, quantity: 1 }],
      delivery: {
        lat: 24.5965,
        lng: 88.2775,
        addressLine: 'Court Road',
        landmark: 'Behind the college gate',
        phone: CUSTOMER,
      },
    };
    const key = newIdempotencyKey();
    const first = await client.placeOrder(body, key);
    const retry = await client.placeOrder(body, key);
    expect(retry.id).toBe(first.id);
    const other = await client.placeOrder(body, newIdempotencyKey());
    expect(other.id).not.toBe(first.id);
    expect((await client.myOrders()).map((o) => o.id).sort()).toEqual([first.id, other.id].sort());
  });
});
