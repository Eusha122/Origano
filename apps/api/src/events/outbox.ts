import type { OrderStatus } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';

export type OrderChangedPayload = {
  orderId: string;
  customerId: string;
  restaurantId: string;
  riderId: string | null;
  zoneId: string;
  status: OrderStatus;
};

/** Written in the same transaction as the change it announces, so a message exists exactly when the change committed. */
export async function writeOutbox(tx: Executor, topic: string, payload: object): Promise<void> {
  await tx.execute(sql`INSERT INTO outbox (topic, payload) VALUES (${topic}, ${JSON.stringify(payload)}::jsonb)`);
}

/** Written in the same transaction as the order change, so a hint exists exactly when the change committed. */
export async function writeOrderChanged(tx: Tx, payload: OrderChangedPayload): Promise<void> {
  await tx.execute(
    sql`INSERT INTO outbox (topic, payload) VALUES ('order.changed', ${JSON.stringify(payload)}::jsonb)`,
  );
}
