import { TERMINAL_STATUSES } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

/** How many orders in a zone are still in progress. */
export async function countOpenOrdersInZone(db: Executor, zoneId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM orders
    WHERE zone_id = ${zoneId} AND status NOT IN (${sql.join(
      TERMINAL_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )})`);
  return rows[0]?.n ?? 0;
}
