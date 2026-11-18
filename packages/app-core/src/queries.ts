import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** Every query key the apps use, in one place, so a hint can find what to refresh. */
export const queryKeys = {
  me: ['me'],
  order: (id: string) => ['order', id] as ['order', string],
  myOrders: ['orders', 'mine'],
  restaurantOrders: ['orders', 'restaurant'],
  offers: ['offers'],
  riderOrders: ['orders', 'rider'],
  adminOrders: ['orders', 'admin'],
  restaurants: ['restaurants'],
  restaurantApplication: ['restaurant-application'],
  riderApplication: ['rider-application'],
  zones: ['zones'],
  staff: (restaurantId: string) => ['staff', restaurantId] as ['staff', string],
  riderInvites: (restaurantId: string) => ['rider-invites', restaurantId] as ['rider-invites', string],
  restaurant: (slug: string) => ['restaurant', slug] as ['restaurant', string],
  controls: (restaurantId: string) => ['controls', restaurantId] as ['controls', string],
  ownerMenu: (restaurantId: string) => ['owner-menu', restaurantId] as ['owner-menu', string],
  hours: (restaurantId: string) => ['hours', restaurantId] as ['hours', string],
  discounts: (restaurantId: string) => ['discounts', restaurantId] as ['discounts', string],
} as const satisfies Record<string, readonly string[] | ((arg: string) => readonly string[])>;

/** Realtime is only a hint, so every screen that shows an open order also refetches on this interval. */
export const OPEN_ORDER_REFETCH_MS = 15_000;

/** What a realtime hint does: mark the order and every order or offer list stale (active ones refetch). */
export async function handleOrderHint(client: QueryClient, orderId: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.order(orderId) }),
    // ['orders'] matches every list: mine, restaurant, rider and admin.
    client.invalidateQueries({ queryKey: ['orders'] }),
    client.invalidateQueries({ queryKey: queryKeys.offers }),
  ]);
}

/**
 * What a realtime 4401 does: check the session again. If the token was revoked, me answers 401 and
 * useSession signs out, which also closes the socket; if authentication was only slow, nothing changes.
 */
export async function handleAuthFailed(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.me, exact: true }),
    // An approval, a rejection or a suspension changes the application the person is looking at, too.
    client.invalidateQueries({ queryKey: queryKeys.restaurantApplication, exact: true }),
    client.invalidateQueries({ queryKey: queryKeys.riderApplication, exact: true }),
  ]);
}

/**
 * Shows a change at once and returns a function that puts the old value back, for when the server refuses it.
 * With nothing cached there is nothing to show or restore.
 */
export function optimisticUpdate<T>(client: QueryClient, key: QueryKey, update: (old: T) => T): () => void {
  const previous = client.getQueryData<T>(key);
  if (previous === undefined) return () => undefined;
  client.setQueryData<T>(key, update(previous));
  return () => client.setQueryData<T>(key, previous);
}
