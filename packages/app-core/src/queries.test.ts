import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleOrderHint, queryKeys, webTokenStorage } from './index';

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
