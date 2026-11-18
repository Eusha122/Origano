import type { PlaceOrderBody } from '@oregano/contracts';
import {
  addMoney,
  bestDiscount,
  checkSelections,
  deliveryFee,
  normalizeBdPhone,
  type OrderActor,
  type OrderEvent,
  type OrderStatus,
  orderTotals,
  priceLine,
  type ReadyMinutes,
  type RejectReason,
  TERMINAL_STATUSES,
  transition,
} from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { getPricingContext } from '../catalog/pricing-context';
import { distanceMeters, getRestaurantForOrder } from '../catalog/repo';
import type { Db, Tx } from '../db/client';
import { AppError } from '../errors';
import { writeOrderChanged } from '../events/outbox';
import type { AuthUser } from '../identity/auth';
import { findZoneForPoint } from '../zones/repo';

/** Timeline names for each domain event. A rider claim writes `rider_assigned` itself. */
const EVENT_NAMES: Record<OrderEvent, string> = {
  accept: 'accepted',
  reject: 'rejected',
  cancel: 'cancelled',
  expire: 'expired',
  mark_ready: 'ready',
  pick_up: 'picked_up',
  deliver: 'delivered',
  collect: 'delivered',
  report_undeliverable: 'undeliverable',
};

function selectionError(
  reason: 'unknown_option' | 'option_unavailable' | 'required_choice_missing' | 'too_many_choices' | 'duplicate_option',
): AppError {
  if (reason === 'option_unavailable') {
    return new AppError('option_unavailable', 422, 'One of the choices is not available right now.');
  }
  if (reason === 'required_choice_missing') {
    return new AppError('required_choice_missing', 400, 'Pick a choice for each required option.');
  }
  return new AppError('invalid_option', 400, 'Something you picked is not offered.');
}

/** Places an order inside the caller's transaction (see `withIdempotency`). Prices come only from the database. */
/**
 * Most orders in progress one customer may have. Taken under a lock per customer, so several orders placed
 * at the same moment cannot all see the old count. A replayed request never reaches this: it is answered
 * from the stored response before any work is done.
 */
async function assertUnderOpenOrderLimit(tx: Tx, customerId: string, limit: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`orders:${customerId}`}))`);
  const rows = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM orders
    WHERE customer_id = ${customerId}
      AND status NOT IN (${sql.join(
        TERMINAL_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      )})`);
  if ((rows[0]?.n ?? 0) >= limit) {
    throw new AppError('too_many_open_orders', 409, 'You have too many orders in progress.');
  }
}

export async function placeOrderIn(
  tx: Tx,
  customer: AuthUser,
  body: PlaceOrderBody,
  openOrderLimit: number,
  now: Date = new Date(),
): Promise<{ orderId: string }> {
  await assertUnderOpenOrderLimit(tx, customer.id, openOrderLimit);
  const restaurant = await getRestaurantForOrder(tx, body.restaurantId, now);
  if (!restaurant) throw new AppError('not_found', 404, 'Not found.');
  if (!restaurant.approved || !restaurant.isOpen)
    throw new AppError('restaurant_closed', 422, 'This restaurant is closed right now.');

  const found = new Map(
    (
      await getPricingContext(
        tx,
        restaurant.id,
        body.items.map((i) => i.menuItemId),
        now,
      )
    ).map((m) => [m.id, m]),
  );
  const lines = body.items.map((line) => {
    const item = found.get(line.menuItemId);
    if (!item) {
      throw new AppError('item_not_in_restaurant', 422, "This item is not on this restaurant's menu.");
    }
    return { item, line };
  });
  if (lines.some((l) => !l.item.isAvailable)) {
    throw new AppError('item_unavailable', 422, 'Some items are no longer available.');
  }
  // Every price comes from the database: base price, chosen options, then the best live discount.
  const priced = lines.map(({ item, line }) => {
    const optionIds = line.optionIds ?? [];
    const selection = checkSelections(item.groups, optionIds);
    if (!selection.ok) throw selectionError(selection.reason);
    const { off } = bestDiscount(addMoney(item.price, selection.delta), item.discounts);
    const allOptions = item.groups.flatMap((g) => g.options);
    return {
      item,
      quantity: line.quantity,
      note: line.note ?? null,
      unitPrice: priceLine(item.price, selection.delta, off),
      discount: off,
      options: optionIds.map((id) => {
        const o = allOptions.find((x) => x.id === id);
        return { nameEn: o?.nameEn ?? '', nameBn: o?.nameBn ?? '', priceDelta: o?.priceDelta ?? 0 };
      }),
    };
  });

  const point = { lat: body.delivery.lat, lng: body.delivery.lng };
  const zone = await findZoneForPoint(tx, point);
  if (!zone || zone.id !== restaurant.zoneId) {
    throw new AppError('outside_zone', 422, "We don't deliver here yet.");
  }
  const phone = normalizeBdPhone(body.delivery.phone);
  if (!phone) throw new AppError('invalid_phone', 400, 'That phone number is not valid.');

  const fee = deliveryFee(await distanceMeters(tx, restaurant.location, point), zone);
  const totals = orderTotals(
    priced.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
    fee,
  );

  const created = await tx.execute<{ id: string }>(sql`
    INSERT INTO orders (customer_id, restaurant_id, zone_id, type, status, subtotal_poisha, delivery_fee_poisha,
      total_poisha, payment_method, address_line, landmark, delivery_phone, delivery_location, note)
    VALUES (${customer.id}, ${restaurant.id}, ${zone.id}, 'delivery', 'placed', ${totals.subtotal},
      ${totals.deliveryFee}, ${totals.total}, 'cash', ${body.delivery.addressLine}, ${body.delivery.landmark},
      ${phone}, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography, ${body.note ?? null})
    RETURNING id`);
  const orderId = created[0]?.id;
  if (!orderId) throw new Error('Order insert returned no row');

  for (const l of priced) {
    await tx.execute(sql`
      INSERT INTO order_items (order_id, menu_item_id, name_en, name_bn, unit_price_poisha, quantity, line_total_poisha,
        options, note, discount_poisha)
      VALUES (${orderId}, ${l.item.id}, ${l.item.nameEn}, ${l.item.nameBn}, ${l.unitPrice}, ${l.quantity},
        ${l.unitPrice * l.quantity}, ${JSON.stringify(l.options)}::jsonb, ${l.note}, ${l.discount})`);
  }
  await tx.execute(sql`
    INSERT INTO order_events (order_id, event, from_status, to_status, actor_type, actor_id)
    VALUES (${orderId}, 'placed', NULL, 'placed', 'customer', ${customer.id})`);
  await writeOrderChanged(tx, {
    orderId,
    customerId: customer.id,
    restaurantId: restaurant.id,
    riderId: null,
    zoneId: zone.id,
    status: 'placed',
  });
  return { orderId };
}

type LockedOrder = {
  id: string;
  customer_id: string;
  restaurant_id: string;
  rider_id: string | null;
  zone_id: string;
  type: 'delivery';
  status: OrderStatus;
};

/** Applies one state-machine event under a row lock; every change writes an event row and an outbox row. */
export function applyTransition(
  db: Db,
  input: {
    orderId: string;
    event: OrderEvent;
    actor: OrderActor;
    actorId: string;
    data?: { readyInMinutes?: ReadyMinutes; reason?: RejectReason };
  },
): Promise<{ orderId: string; changed: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<LockedOrder>(sql`
      SELECT id, customer_id, restaurant_id, rider_id, zone_id, type, status
      FROM orders WHERE id = ${input.orderId} FOR UPDATE`);
    const order = rows[0];
    if (!order) throw new AppError('not_found', 404, 'Not found.');

    const result = transition({ status: order.status, type: order.type }, input.event, input.actor);
    if (!result.ok) {
      if (result.reason === 'already_applied') return { orderId: order.id, changed: false };
      if (result.reason === 'actor_not_allowed') {
        throw new AppError('actor_not_allowed', 403, 'You cannot do that to this order.');
      }
      throw new AppError('invalid_transition', 409, 'This order cannot change that way right now.');
    }

    const readyInMinutes = input.data?.readyInMinutes ?? null;
    const reason = input.data?.reason ?? null;
    await tx.execute(sql`
      UPDATE orders SET status = ${result.status},
        ready_in_minutes = COALESCE(${readyInMinutes}::integer, ready_in_minutes),
        reject_reason = COALESCE(${reason}::text, reject_reason),
        updated_at = now()
      WHERE id = ${order.id}`);
    await tx.execute(sql`
      INSERT INTO order_events (order_id, event, from_status, to_status, actor_type, actor_id, data)
      VALUES (${order.id}, ${EVENT_NAMES[input.event]}, ${order.status}, ${result.status}, ${input.actor},
        ${input.actorId}, ${JSON.stringify(input.data ?? {})}::jsonb)`);
    await writeOrderChanged(tx, {
      orderId: order.id,
      customerId: order.customer_id,
      restaurantId: order.restaurant_id,
      riderId: order.rider_id,
      zoneId: order.zone_id,
      status: result.status,
    });
    return { orderId: order.id, changed: true };
  });
}
