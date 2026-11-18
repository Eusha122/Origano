export const ORDER_STATUSES = [
  'placed',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'rejected',
  'cancelled',
  'expired',
  'undeliverable',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderType = 'delivery' | 'pickup';
export type OrderActor = 'customer' | 'restaurant' | 'rider' | 'system' | 'admin';
export type OrderEvent =
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'expire'
  | 'mark_ready'
  | 'pick_up'
  | 'deliver'
  | 'collect'
  | 'report_undeliverable';

export const REJECT_REASONS = ['item_out_of_stock', 'too_busy', 'closing_soon'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type TransitionResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; reason: 'invalid_transition' | 'actor_not_allowed' | 'already_applied' };

type Row = {
  from: OrderStatus;
  event: OrderEvent;
  actor: OrderActor;
  to: OrderStatus;
  types: readonly OrderType[];
};

const BOTH: readonly OrderType[] = ['delivery', 'pickup'];
const DELIVERY: readonly OrderType[] = ['delivery'];
const PICKUP: readonly OrderType[] = ['pickup'];

/** The single definition of every allowed order transition. Anything absent is invalid. */
const TRANSITIONS: readonly Row[] = [
  { from: 'placed', event: 'accept', actor: 'restaurant', to: 'preparing', types: BOTH },
  { from: 'placed', event: 'reject', actor: 'restaurant', to: 'rejected', types: BOTH },
  { from: 'placed', event: 'cancel', actor: 'customer', to: 'cancelled', types: BOTH },
  { from: 'placed', event: 'expire', actor: 'system', to: 'expired', types: BOTH },
  { from: 'preparing', event: 'mark_ready', actor: 'restaurant', to: 'ready', types: BOTH },
  { from: 'ready', event: 'pick_up', actor: 'rider', to: 'on_the_way', types: DELIVERY },
  { from: 'ready', event: 'collect', actor: 'restaurant', to: 'delivered', types: PICKUP },
  { from: 'on_the_way', event: 'deliver', actor: 'rider', to: 'delivered', types: DELIVERY },
  { from: 'on_the_way', event: 'report_undeliverable', actor: 'rider', to: 'undeliverable', types: DELIVERY },
  { from: 'placed', event: 'cancel', actor: 'admin', to: 'cancelled', types: BOTH },
  { from: 'preparing', event: 'cancel', actor: 'admin', to: 'cancelled', types: BOTH },
  { from: 'ready', event: 'cancel', actor: 'admin', to: 'cancelled', types: BOTH },
  { from: 'on_the_way', event: 'cancel', actor: 'admin', to: 'cancelled', types: BOTH },
];

/** Statuses an order never leaves. */
export const TERMINAL_STATUSES = ['delivered', 'rejected', 'cancelled', 'expired', 'undeliverable'] as const;

const TERMINAL: ReadonlySet<OrderStatus> = new Set(TERMINAL_STATUSES);

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.has(status);
}

export function transition(
  order: { status: OrderStatus; type: OrderType },
  event: OrderEvent,
  actor: OrderActor,
): TransitionResult {
  const candidates = TRANSITIONS.filter(
    (row) => row.from === order.status && row.event === event && row.types.includes(order.type),
  );
  const allowed = candidates.find((row) => row.actor === actor);
  if (allowed) return { ok: true, status: allowed.to };
  if (candidates.length > 0) return { ok: false, reason: 'actor_not_allowed' };

  const repeated = TRANSITIONS.some((row) => row.event === event && row.actor === actor && row.to === order.status);
  if (repeated) return { ok: false, reason: 'already_applied' };

  return { ok: false, reason: 'invalid_transition' };
}
