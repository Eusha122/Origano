import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

/** Makes a user an owner of a restaurant. Staff management routes arrive in Task 16. */
export async function addRestaurantOwner(tx: Executor, restaurantId: string, userId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO restaurant_staff (restaurant_id, user_id, role) VALUES (${restaurantId}, ${userId}, 'owner')
    ON CONFLICT (restaurant_id, user_id) DO UPDATE SET role = 'owner'`);
}
