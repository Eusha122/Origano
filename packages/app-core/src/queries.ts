import type { QueryClient } from '@tanstack/react-query';

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
  await client.invalidateQueries({ queryKey: queryKeys.me, exact: true });
}
