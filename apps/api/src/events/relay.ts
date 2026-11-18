import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Db } from '../db/client';

export const EVENTS_CHANNEL = 'oregano:events';

/**
 * Publishes the next batch of unpublished outbox rows, in id order, and marks them published.
 * One transaction: if publishing throws, nothing is marked and the rows are retried next time.
 * SKIP LOCKED lets several relays run side by side without publishing a row twice.
 */
export function relayOnce(
  db: Db,
  publish: (channel: string, message: string) => Promise<unknown>,
  batchSize = 100,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; topic: string; payload: unknown }>(
      sql`SELECT id, topic, payload FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) return 0;
    for (const row of rows) await publish(EVENTS_CHANNEL, JSON.stringify({ topic: row.topic, payload: row.payload }));
    const ids = rows.map((row) => row.id);
    await tx.execute(sql`UPDATE outbox SET published_at = now() WHERE id IN (${sql.join(ids, sql`, `)})`);
    return rows.length;
  });
}

/** Polls the outbox and relays to Redis until stopped. Errors are logged and retried on the next tick. */
export function startRelay(
  db: Db,
  redisUrl: string,
  opts: { intervalMs?: number } = {},
): { stop: () => Promise<void> } {
  const intervalMs = opts.intervalMs ?? 250;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, commandTimeout: 5000 });
  redis.on('error', (error) => console.error('relay redis error', error.message));
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    try {
      let count: number;
      do {
        count = await relayOnce(db, (channel, message) => redis.publish(channel, message));
        if (count > 0) console.log(`relayed ${count} event${count === 1 ? '' : 's'}`);
      } while (count > 0 && !stopped);
    } catch (error) {
      console.error('relay failed, will retry', error instanceof Error ? error.message : error);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        current = tick();
      }, intervalMs);
    }
  };
  current = tick();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
      redis.disconnect();
    },
  };
}
