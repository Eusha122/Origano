import { ApiError } from '@oregano/api-client';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSession, handleAuthFailed, handleOrderHint, queryKeys, webTokenStorage } from './index';

describe('query keys and hints', () => {
  it('a hint invalidates the order and every list', async () => {
    const client = new QueryClient();
    const lists = [
      queryKeys.myOrders,
      queryKeys.restaurantOrders,
      queryKeys.offers,
      queryKeys.riderOrders,
      queryKeys.adminOrders,
    ];
    const untouched = [
      queryKeys.me,
      queryKeys.order('other'),
      queryKeys.restaurants,
      queryKeys.restaurant('burger-lane'),
    ];
    for (const key of [queryKeys.order('o1'), ...lists, ...untouched]) client.setQueryData(key, { seeded: true });

    await handleOrderHint(client, 'o1');

    for (const key of [queryKeys.order('o1'), ...lists]) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
    for (const key of untouched) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
    }
  });
});

describe('realtime auth failure', () => {
  it('marks me stale so the session check runs again', async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.me, { seeded: true });
    client.setQueryData(queryKeys.myOrders, { seeded: true });
    await handleAuthFailed(client);
    expect(client.getQueryState(queryKeys.me)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.myOrders)?.isInvalidated).toBe(false);
  });
});

describe('deriveSession', () => {
  const me = {
    id: '7f0c6d3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f',
    phone: '+8801711000001',
    name: null,
    roles: ['customer' as const],
    restaurantIds: [],
    rider: null,
  };

  it('is signed out with no token', () => {
    expect(deriveSession({ token: null, data: undefined, error: null, isPending: true })).toEqual({
      me: null,
      isLoading: false,
      isSignedIn: false,
      error: null,
      expired: false,
    });
  });

  it('stays signed in while me cannot load offline', () => {
    const offline = new ApiError(0, 'internal', 'fetch failed', '');
    expect(deriveSession({ token: 't', data: undefined, error: offline, isPending: false })).toEqual({
      me: null,
      isLoading: false,
      isSignedIn: true,
      error: offline,
      expired: false,
    });
  });

  it('treats a 401 from me as an expired session', () => {
    const refused = new ApiError(401, 'unauthenticated', 'Sign in again.', 'r1');
    expect(deriveSession({ token: 't', data: undefined, error: refused, isPending: false }).expired).toBe(true);
  });

  it('is loading, then signed in with me', () => {
    expect(deriveSession({ token: 't', data: undefined, error: null, isPending: true }).isLoading).toBe(true);
    expect(deriveSession({ token: 't', data: me, error: null, isPending: false })).toMatchObject({
      me,
      isSignedIn: true,
      isLoading: false,
    });
  });
});

describe('webTokenStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the token in localStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    webTokenStorage.set('abc');
    expect(webTokenStorage.get()).toBe('abc');
    webTokenStorage.clear();
    expect(webTokenStorage.get()).toBeNull();
  });

  it('never throws when localStorage throws or is missing', () => {
    const throwing = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: throwing, setItem: throwing, removeItem: throwing });
    expect(webTokenStorage.get()).toBeNull();
    expect(() => webTokenStorage.set('abc')).not.toThrow();
    expect(() => webTokenStorage.clear()).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(webTokenStorage.get()).toBeNull();
  });
});
