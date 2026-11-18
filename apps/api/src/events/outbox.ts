import type { OrderStatus } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client';

export type OrderChangedPayload = {
  orderId: string;
  customerId: string;
  restaurantId: string;
  riderId: string | null;
  zoneId: string;
  status: OrderStatus;
};

/** Written in the same transaction as the order change, so a hint exists exactly when the change committed. */
export async function writeOrderChanged(tx: Tx, payload: OrderChangedPayload): Promise<void> {
  await tx.execute(
    sql`INSERT INTO outbox (topic, payload) VALUES ('order.changed', ${JSON.stringify(payload)}::jsonb)`,
  );
}
