import { ApiError } from '@oregano/api-client';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebSessionStore,
  deriveSession,
  handleAuthFailed,
  handleOrderHint,
  optimisticUpdate,
  queryKeys,
} from './index';

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
    teamRoles: [],
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

describe('createWebSessionStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubStorage = () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    return store;
  };

  it('keeps the access token in memory and only a non-secret flag in localStorage', () => {
    const store = stubStorage();
    const session = createWebSessionStore();
    expect(session.mode).toBe('cookie');
    expect(session.hasSession?.()).toBe(false);
    session.save({ accessToken: 'secret-access', refreshToken: null });
    expect(session.getAccessToken()).toBe('secret-access');
    expect(session.getRefreshToken()).toBeNull();
    expect(session.hasSession?.()).toBe(true);
    expect([...store.values()]).toEqual(['1']);
    session.clear();
    expect(session.getAccessToken()).toBeNull();
    expect(session.hasSession?.()).toBe(false);
    expect(store.size).toBe(0);
  });

  it('a new page load remembers there was a session, but not the token', () => {
    stubStorage();
    createWebSessionStore().save({ accessToken: 'secret-access', refreshToken: null });
    const reloaded = createWebSessionStore();
    expect(reloaded.getAccessToken()).toBeNull();
    expect(reloaded.hasSession?.()).toBe(true);
  });

  it('removes the old long-lived token that earlier versions kept in localStorage', () => {
    const store = stubStorage();
    store.set('oregano.session', 'old-token');
    createWebSessionStore();
    expect(store.has('oregano.session')).toBe(false);
  });

  it('never throws when localStorage throws or is missing', () => {
    const throwing = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: throwing, setItem: throwing, removeItem: throwing });
    const session = createWebSessionStore();
    expect(session.hasSession?.()).toBe(false);
    expect(() => session.save({ accessToken: 'a', refreshToken: null })).not.toThrow();
    expect(session.getAccessToken()).toBe('a');
    expect(() => session.clear()).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(createWebSessionStore().hasSession?.()).toBe(false);
  });
});

describe('deriveSession while a stored session is being restored', () => {
  it('counts as signed in and loading, never as signed out', () => {
    expect(
      deriveSession({ token: null, data: undefined, error: null, isPending: true, restoring: true }),
    ).toMatchObject({
      me: null,
      isSignedIn: true,
      isLoading: true,
      expired: false,
    });
    expect(deriveSession({ token: null, data: undefined, error: null, isPending: true })).toMatchObject({
      isSignedIn: false,
      isLoading: false,
    });
  });
});

describe('optimistic updates', () => {
  it('shows the change at once and puts the old value back on rollback', () => {
    const client = new QueryClient();
    const key = queryKeys.controls('r1');
    client.setQueryData(key, { switchOn: true, busyExtraMinutes: 0 });
    const rollback = optimisticUpdate<{ switchOn: boolean; busyExtraMinutes: number }>(client, key, (old) => ({
      ...old,
      switchOn: false,
    }));
    expect(client.getQueryData(key)).toEqual({ switchOn: false, busyExtraMinutes: 0 });
    rollback();
    expect(client.getQueryData(key)).toEqual({ switchOn: true, busyExtraMinutes: 0 });
  });

  it('leaves an empty cache empty, and its rollback does nothing', () => {
    const client = new QueryClient();
    const key = queryKeys.controls('r1');
    const rollback = optimisticUpdate<number>(client, key, (old) => old + 1);
    expect(client.getQueryData(key)).toBeUndefined();
    rollback();
    expect(client.getQueryData(key)).toBeUndefined();
  });

  it('keys each restaurant separately', () => {
    expect(queryKeys.controls('a')).not.toEqual(queryKeys.controls('b'));
    expect(queryKeys.ownerMenu('a')).toEqual(['owner-menu', 'a']);
  });
});
