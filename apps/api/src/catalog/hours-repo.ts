import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

/** 11:00 to 22:00 every day: the starting hours of a new restaurant, until its owner edits them. */
export async function insertDefaultHours(tx: Executor, restaurantId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
    SELECT ${restaurantId}, d, 660, 1320 FROM generate_series(0, 6) AS d
    ON CONFLICT DO NOTHING`);
}
