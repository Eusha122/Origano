import type { AddressInfo } from 'node:net';
import { ApiError, createApiClient, newIdempotencyKey } from '@oregano/api-client';
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

  const clientWith = (token: () => string | null) => createApiClient({ baseUrl, getToken: token });

  it('signs in and reads me', async () => {
    let token: string | null = null;
    const client = clientWith(() => token);
    const requested = await client.requestOtp(CUSTOMER);
    expect(requested.expiresInSeconds).toBeGreaterThan(0);
    const code = await t.otp.last('+8801711000001');
    if (!code) throw new Error('no OTP was sent');
    const session = await client.verifyOtp(CUSTOMER, code);
    token = session.token;
    const me = await client.me();
    expect(me).toEqual(session.user);
    expect(me.phone).toBe('+8801711000001');
    await client.logout();
    await expect(client.me()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });

  it('turns an error body into ApiError with code and requestId', async () => {
    const client = clientWith(() => null);
    await client.requestOtp(CUSTOMER);
    const error = await client.verifyOtp(CUSTOMER, '000000').catch((e: unknown) => e);
    // A captured code is random, so 000000 is wrong except by a one-in-a-million chance.
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'otp_invalid' });
    expect((error as ApiError).requestId).not.toBe('');
  });

  it('placeOrder sends the Idempotency-Key header', async () => {
    const token = await t.signIn(CUSTOMER);
    const client = clientWith(() => token);
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
