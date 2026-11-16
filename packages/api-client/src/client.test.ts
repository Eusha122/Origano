import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from './index';

const fakeFetch =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client without a server', () => {
  it('rejects a response that breaks the contract', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
      fetch: fakeFetch(200, { id: 1 }),
    });
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'internal' });
  });

  it('a network failure becomes ApiError with status 0', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetch: failing });
    const error = await client.restaurants().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'internal' });
  });

  it('turns an error body into ApiError with code and requestId', async () => {
    const body = { error: { code: 'otp_invalid', message: 'That code is not right.', requestId: 'req-7' } };
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetch: fakeFetch(401, body) });
    const error = await client.verifyOtp('01711000001', '000000').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: 'otp_invalid',
      message: 'That code is not right.',
      requestId: 'req-7',
    });
  });

  it('sends the bearer token and unwraps list envelopes', async () => {
    let seen: Headers | undefined;
    let url = '';
    const capture: typeof fetch = async (input, init) => {
      url = String(input);
      seen = new Headers(init?.headers);
      return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    };
    const client = createApiClient({ baseUrl: 'http://api.test/', getToken: () => 'tok', fetch: capture });
    expect(await client.myOrders()).toEqual([]);
    expect(url).toBe('http://api.test/v1/orders');
    expect(seen?.get('authorization')).toBe('Bearer tok');
  });
});
