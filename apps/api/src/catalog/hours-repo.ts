import type { OpeningInterval } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

/** 11:00 to 22:00 every day: the starting hours of a new restaurant, until its owner edits them. */
export async function insertDefaultHours(tx: Executor, restaurantId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
    SELECT ${restaurantId}, d, 660, 1320 FROM generate_series(0, 6) AS d
    ON CONFLICT DO NOTHING`);
}

/** The weekly intervals of each restaurant (a restaurant with none is missing from the map). */
export async function loadIntervals(db: Executor, restaurantIds: string[]): Promise<Map<string, OpeningInterval[]>> {
  const map = new Map<string, OpeningInterval[]>();
  if (restaurantIds.length === 0) return map;
  const rows = await db.execute<{
    restaurant_id: string;
    day_of_week: number;
    open_minute: number;
    close_minute: number;
  }>(sql`
    SELECT restaurant_id, day_of_week, open_minute, close_minute FROM restaurant_hours
    WHERE restaurant_id IN (${sql.join(
      restaurantIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY day_of_week, open_minute`);
  for (const r of rows) {
    const list = map.get(r.restaurant_id) ?? [];
    list.push({ day: r.day_of_week, openMinute: r.open_minute, closeMinute: r.close_minute });
    map.set(r.restaurant_id, list);
  }
  return map;
}
