import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { withTestDb } from '../testing/db';
import { relayOnce } from './relay';

async function addRows(db: Db, count: number): Promise<void> {
  for (let i = 1; i <= count; i += 1) {
    await db.execute(
      sql`INSERT INTO outbox (topic, payload) VALUES ('order.changed', ${JSON.stringify({ n: i })}::jsonb)`,
    );
  }
}

const unpublished = async (db: Db): Promise<number> => {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`);
  return rows[0]?.n ?? -1;
};

describe('relayOnce', () => {
  const { db } = withTestDb();

  it('publishes unpublished rows once, in order', async () => {
    await addRows(db, 3);
    const sent: string[] = [];
    const publish = async (_channel: string, message: string) => sent.push(message);
    expect(await relayOnce(db, publish)).toBe(3);
    expect(await relayOnce(db, publish)).toBe(0);
    expect(sent.map((m) => (JSON.parse(m) as { n: number }).n)).toEqual([1, 2, 3]);
    expect(await unpublished(db)).toBe(0);
  });

  it('two relays running together never publish a row twice', async () => {
    await addRows(db, 10);
    const sent: string[] = [];
    const publish = async (_channel: string, message: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      sent.push(message);
    };
    await Promise.all([relayOnce(db, publish, 6), relayOnce(db, publish, 6)]);
    await relayOnce(db, publish, 6);
    expect(sent).toHaveLength(10);
    expect(new Set(sent).size).toBe(10);
  });

  it('leaves rows unpublished when publishing fails', async () => {
    await addRows(db, 2);
    await expect(
      relayOnce(db, async () => {
        throw new Error('redis down');
      }),
    ).rejects.toThrow('redis down');
    expect(await unpublished(db)).toBe(2);
  });
});
