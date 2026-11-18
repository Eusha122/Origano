import type { OrderStatus } from '@oregano/domain';
import type { MessageKey } from './en';

const CUSTOMER: Record<OrderStatus, MessageKey> = {
  placed: 'order.placed',
  preparing: 'order.preparing',
  ready: 'order.ready',
  on_the_way: 'order.onTheWay',
  delivered: 'order.delivered',
  rejected: 'order.rejected',
  cancelled: 'order.cancelled',
  // Plan 02 never produces these two; until they get their own words they read as the nearest outcome.
  expired: 'order.rejected',
  undeliverable: 'order.cancelled',
};

const RIDER: Record<OrderStatus, MessageKey> = {
  placed: 'riderStatus.placed',
  preparing: 'riderStatus.preparing',
  ready: 'riderStatus.ready',
  on_the_way: 'riderStatus.onTheWay',
  delivered: 'riderStatus.delivered',
  rejected: 'riderStatus.rejected',
  cancelled: 'riderStatus.cancelled',
  expired: 'riderStatus.expired',
  undeliverable: 'riderStatus.undeliverable',
};

/** The words for an order's status, in the voice of whoever reads them. A ready order has no rider to wait for once one holds it. */
export function orderStatusKey(status: OrderStatus, audience: 'customer' | 'rider', hasRider: boolean): MessageKey {
  if (audience === 'rider') return RIDER[status];
  return status === 'ready' && !hasRider ? 'order.readyWaiting' : CUSTOMER[status];
}
