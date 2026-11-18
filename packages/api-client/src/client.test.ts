import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, createMemorySessionStore, type SessionStore } from './index';

const fakeFetch =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A store that already holds an access token (and, in body mode, a refresh token). */
function storeWith(accessToken: string | null, mode: SessionStore['mode'] = 'body', refreshToken = 'refresh-1') {
  const store = createMemorySessionStore(mode);
  if (accessToken) store.save({ accessToken, refreshToken: mode === 'body' ? refreshToken : null });
  return store;
}

describe('api client without a server', () => {
  it('rejects a response that breaks the contract', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      session: storeWith('t'),
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
    const client = createApiClient({ baseUrl: 'http://api.test', session: storeWith(null), fetch: failing });
    const error = await client.restaurants().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'internal' });
  });

  it('turns an error body into ApiError with code and requestId', async () => {
    const body = { error: { code: 'otp_invalid', message: 'That code is not right.', requestId: 'req-7' } };
    const client = createApiClient({
      baseUrl: 'http://api.test',
      session: storeWith(null),
      fetch: fakeFetch(401, body),
    });
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
    const client = createApiClient({ baseUrl: 'http://api.test/', session: storeWith('tok'), fetch: capture });
    expect(await client.myOrders()).toEqual([]);
    expect(url).toBe('http://api.test/v1/orders');
    expect(seen?.get('authorization')).toBe('Bearer tok');
  });

  it('gives up on a request that hangs and reports it as a network failure', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const client = createApiClient({
      baseUrl: 'http://api.test',
      session: storeWith(null),
      fetch: hanging,
      timeoutMs: 50,
    });
    const started = Date.now();
    const error = await client.restaurants().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'internal' });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  phone: '+8801711000001',
  name: null,
  roles: ['customer'],
  teamRoles: [],
  restaurantIds: [],
  rider: null,
};
const refreshed = (n: number) => ({
  accessToken: `access-${n}`,
  accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshToken: `refresh-${n}`,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const expired = () => json(401, { error: { code: 'unauthenticated', message: 'Please sign in.', requestId: 'r' } });

type Call = { path: string; headers: Headers; credentials: RequestCredentials | undefined; body: string | undefined };

/** A server whose access token `access-1` has expired; a refresh hands out access-2, and only that works. */
function expiringServer(refreshStatus = 200) {
  const calls: Call[] = [];
  const handler: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({ path, headers, credentials: init?.credentials, body: init?.body as string | undefined });
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (path === '/v1/auth/refresh') {
      return refreshStatus === 200
        ? json(200, refreshed(2))
        : json(refreshStatus, {
            error: { code: 'unauthenticated', message: 'Please sign in.', requestId: 'r' },
          });
    }
    if (headers.get('authorization') !== 'Bearer access-2') return expired();
    return path === '/v1/me' ? json(200, ME) : json(200, { orders: [] });
  };
  return { handler, calls };
}

describe('silent refresh', () => {
  it('two requests that both hit an expired token share one refresh, then each is retried once', async () => {
    const { handler, calls } = expiringServer();
    const store = storeWith('access-1');
    const client = createApiClient({ baseUrl: 'http://api.test', session: store, fetch: handler });
    const [me, orders] = await Promise.all([client.me(), client.myOrders()]);
    expect(me.id).toBe(ME.id);
    expect(orders).toEqual([]);
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/v1/me')).toHaveLength(2);
    expect(store.getAccessToken()).toBe('access-2');
    expect(store.getRefreshToken()).toBe('refresh-2');
  });

  it('puts the refresh token in the body in body mode', async () => {
    const { handler, calls } = expiringServer();
    const client = createApiClient({ baseUrl: 'http://api.test', session: storeWith('access-1'), fetch: handler });
    await client.me();
    const refresh = calls.find((c) => c.path === '/v1/auth/refresh');
    expect(JSON.parse(refresh?.body ?? '{}')).toEqual({ refreshToken: 'refresh-1' });
  });

  it('retries a place-order with the very same idempotency key', async () => {
    const calls: Call[] = [];
    const order = {
      id: '22222222-2222-4222-8222-222222222222',
    };
    const handler: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const headers = new Headers(init?.headers);
      calls.push({ path, headers, credentials: init?.credentials, body: init?.body as string | undefined });
      if (path === '/v1/auth/refresh') return json(200, refreshed(2));
      return headers.get('authorization') === 'Bearer access-2' ? json(200, order) : expired();
    };
    const client = createApiClient({ baseUrl: 'http://api.test', session: storeWith('access-1'), fetch: handler });
    await client.placeOrder({} as never, 'key-123456789').catch(() => {});
    const placed = calls.filter((c) => c.path === '/v1/orders');
    expect(placed).toHaveLength(2);
    expect(placed.map((c) => c.headers.get('idempotency-key'))).toEqual(['key-123456789', 'key-123456789']);
  });

  it('signs out once, clearing the session, when the refresh is refused', async () => {
    const { handler } = expiringServer(401);
    const store = storeWith('access-1');
    let signedOut = 0;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      session: store,
      fetch: handler,
      onSignedOut: () => signedOut++,
    });
    const results = await Promise.all([
      client.me().catch((e: unknown) => e),
      client.myOrders().catch((e: unknown) => e),
    ]);
    for (const r of results) expect(r).toMatchObject({ status: 401 });
    expect(signedOut).toBe(1);
    expect(store.getAccessToken()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
  });

  it('stays signed in when the refresh cannot reach the server', async () => {
    let signedOut = 0;
    const handler: typeof fetch = async (input) => {
      if (new URL(String(input)).pathname === '/v1/auth/refresh') throw new TypeError('offline');
      return expired();
    };
    const store = storeWith('access-1');
    const client = createApiClient({
      baseUrl: 'http://api.test',
      session: store,
      fetch: handler,
      onSignedOut: () => signedOut++,
    });
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0 });
    expect(signedOut).toBe(0);
    expect(store.getRefreshToken()).toBe('refresh-1');
  });

  it('does not try to refresh a guest', async () => {
    const { handler, calls } = expiringServer();
    const client = createApiClient({ baseUrl: 'http://api.test', session: storeWith(null), fetch: handler });
    await client.me().catch(() => {});
    expect(calls.some((c) => c.path === '/v1/auth/refresh')).toBe(false);
  });

  it('in browser mode sends credentials and the client header on auth routes only, and no body', async () => {
    const { handler, calls } = expiringServer();
    const store = createMemorySessionStore('cookie');
    store.save({ accessToken: 'access-1', refreshToken: null });
    const client = createApiClient({ baseUrl: 'http://api.test', session: store, fetch: handler });
    await client.me();
    const refresh = calls.find((c) => c.path === '/v1/auth/refresh');
    expect(refresh?.credentials).toBe('include');
    expect(refresh?.headers.get('x-oregano-client')).toBe('web');
    expect(refresh?.body).toBeUndefined();
    const me = calls.find((c) => c.path === '/v1/me');
    expect(me?.credentials).not.toBe('include');
    expect(me?.headers.get('x-oregano-client')).toBeNull();
    expect(store.getAccessToken()).toBe('access-2');
    expect(store.getRefreshToken()).toBeNull();
  });

  it('saves the tokens a sign-in returns', async () => {
    const body = { ...refreshed(1), user: ME };
    const store = storeWith(null);
    const client = createApiClient({ baseUrl: 'http://api.test', session: store, fetch: fakeFetch(200, body) });
    await client.verifyOtp('01711000001', '123456');
    expect(store.getAccessToken()).toBe('access-1');
    expect(store.getRefreshToken()).toBe('refresh-1');
  });

  it('logging out clears the session even when the server cannot be reached', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const store = storeWith('access-1');
    const client = createApiClient({ baseUrl: 'http://api.test', session: store, fetch: failing });
    await client.logout().catch(() => {});
    expect(store.getAccessToken()).toBeNull();
  });

  it('saveRiderApplication sends a JSON PUT with the bearer token, and zones() is read without a body', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const view = {
      status: 'applied',
      type: 'independent',
      zoneId: '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a',
      agencyName: null,
      restaurantName: null,
      details: {
        type: 'independent',
        zoneId: '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a',
        name: 'Jamal Hossain',
        vehicleType: 'bicycle',
        vehicleRegistration: null,
        guarantor: { name: 'Kabir Hossain', phone: '+8801911000555', relation: 'Brother' },
      },
      documents: [],
      missing: ['nid_front', 'nid_back', 'photo'],
      rejectionReason: null,
      suspendedReason: null,
    };
    const recording: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} });
      const url = String(input);
      const body = url.endsWith('/zones') ? { zones: [{ id: view.zoneId, name: 'Chapainawabganj' }] } : view;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = createApiClient({ baseUrl: 'http://api.test', session: storeWith('tok'), fetch: recording });
    const body = {
      type: 'independent' as const,
      zoneId: view.zoneId,
      name: 'Jamal Hossain',
      vehicleType: 'bicycle' as const,
      vehicleRegistration: null,
      guarantor: { name: 'Kabir Hossain', phone: '01911000555', relation: 'Brother' },
    };
    const saved = await client.saveRiderApplication(body);
    expect(saved.status).toBe('applied');
    const put = seen[0];
    expect(put?.url).toBe('http://api.test/v1/onboarding/rider');
    expect(put?.init.method).toBe('PUT');
    expect(JSON.parse(String(put?.init.body))).toEqual(body);
    const headers = put?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['content-type']).toBe('application/json');

    const zones = await client.zones();
    expect(zones).toEqual([{ id: view.zoneId, name: 'Chapainawabganj' }]);
    expect(seen[1]?.init.body).toBeUndefined();
    const getHeaders = (seen[1]?.init.headers ?? {}) as Record<string, string>;
    expect(getHeaders['content-type']).toBeUndefined();
  });

  it('riderApplication() turns a 404 into null', async () => {
    const body = { error: { code: 'not_found', message: 'Not found.', requestId: 'req-1' } };
    const client = createApiClient({
      baseUrl: 'http://api.test',
      session: storeWith('tok'),
      fetch: fakeFetch(404, body),
    });
    expect(await client.riderApplication()).toBeNull();
  });
});
