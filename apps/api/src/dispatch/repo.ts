import type { RiderOffer } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { writeOrderChanged } from '../events/outbox';

export type ClaimResult = 'claimed' | 'already_mine' | 'taken' | 'not_claimable';

/**
 * One UPDATE decides the winner, so two riders can never both claim an order.
 * A win also writes the `rider_assigned` event and the outbox row in the same transaction.
 */
export function claimOrder(db: Db, riderId: string, orderId: string): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const won = await tx.execute<{
      id: string;
      customer_id: string;
      restaurant_id: string;
      zone_id: string;
      status: string;
    }>(sql`
      UPDATE orders SET rider_id = ${riderId}, updated_at = now()
      WHERE id = ${orderId} AND rider_id IS NULL AND status IN ('preparing', 'ready')
        AND zone_id = (SELECT zone_id FROM riders WHERE user_id = ${riderId})
      RETURNING id, customer_id, restaurant_id, zone_id, status`);
    const row = won[0];
    if (row) {
      await tx.execute(sql`
        INSERT INTO order_events (order_id, event, from_status, to_status, actor_type, actor_id)
        VALUES (${row.id}, 'rider_assigned', ${row.status}, ${row.status}, 'rider', ${riderId})`);
      await writeOrderChanged(tx, {
        orderId: row.id,
        customerId: row.customer_id,
        restaurantId: row.restaurant_id,
        riderId,
        zoneId: row.zone_id,
        status: row.status as 'preparing' | 'ready',
      });
      return 'claimed';
    }
    const current = await tx.execute<{ rider_id: string | null }>(
      sql`SELECT rider_id FROM orders WHERE id = ${orderId}`,
    );
    const holder = current[0]?.rider_id;
    if (holder === riderId) return 'already_mine';
    if (holder) return 'taken';
    return 'not_claimable';
  });
}

/** Unclaimed preparing/ready orders in the rider's zone, newest first. No customer phone or address line. */
export async function listOffers(db: Db, zoneId: string): Promise<RiderOffer[]> {
  const rows = await db.execute<{
    id: string;
    number: number;
    status: 'preparing' | 'ready';
    name_en: string;
    name_bn: string;
    address_line: string;
    landmark: string;
    distance_m: number;
    delivery_fee_poisha: number;
  }>(sql`
    SELECT o.id, o.number, o.status, r.name_en, r.name_bn, r.address_line, o.landmark,
      ST_Distance(r.location, o.delivery_location) AS distance_m, o.delivery_fee_poisha
    FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
    WHERE o.zone_id = ${zoneId} AND o.rider_id IS NULL AND o.status IN ('preparing', 'ready')
    ORDER BY o.created_at DESC, o.number DESC`);
  return rows.map((r) => ({
    orderId: r.id,
    number: r.number,
    status: r.status,
    restaurant: { nameEn: r.name_en, nameBn: r.name_bn, addressLine: r.address_line },
    landmark: r.landmark,
    distanceKm: Math.round(Number(r.distance_m) / 100) / 10,
    deliveryFee: r.delivery_fee_poisha,
  }));
}

/**
 * Puts every order this rider holds but has not picked up (preparing or ready) back in the offer pool.
 * Orders already on the road stay with the rider, who can still deliver them. Returns the released order ids.
 */
export async function releaseRiderOrders(tx: Tx, riderId: string): Promise<string[]> {
  const released = await tx.execute<{
    id: string;
    customer_id: string;
    restaurant_id: string;
    zone_id: string;
    status: 'preparing' | 'ready';
  }>(sql`
    UPDATE orders SET rider_id = NULL, updated_at = now()
    WHERE rider_id = ${riderId} AND status IN ('preparing', 'ready')
    RETURNING id, customer_id, restaurant_id, zone_id, status`);
  for (const row of released) {
    await tx.execute(sql`
      INSERT INTO order_events (order_id, event, from_status, to_status, actor_type, actor_id)
      VALUES (${row.id}, 'rider_released', ${row.status}, ${row.status}, 'system', ${riderId})`);
    await writeOrderChanged(tx, {
      orderId: row.id,
      customerId: row.customer_id,
      restaurantId: row.restaurant_id,
      riderId: null,
      zoneId: row.zone_id,
      status: row.status,
    });
  }
  return released.map((r) => r.id);
}
