import type { RestaurantControls } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { loadIntervals } from './hours-repo';
import { restaurantState } from './state';

/** The owner's switch, busy mode and what customers currently see. Null for an unknown restaurant. */
export async function getControls(db: Executor, restaurantId: string, now: Date): Promise<RestaurantControls | null> {
  const rows = await db.execute<{
    is_open: boolean;
    prep_minutes: number;
    busy_extra_minutes: number;
    timezone: string;
  }>(sql`
    SELECT r.is_open, r.prep_minutes, r.busy_extra_minutes, z.timezone
    FROM restaurants r JOIN zones z ON z.id = r.zone_id WHERE r.id = ${restaurantId}`);
  const r = rows[0];
  if (!r) return null;
  const intervals = (await loadIntervals(db, [restaurantId])).get(restaurantId) ?? [];
  const state = restaurantState(
    {
      switchOn: r.is_open,
      timezone: r.timezone,
      intervals,
      prepMinutes: r.prep_minutes,
      busyExtraMinutes: r.busy_extra_minutes,
    },
    now,
  );
  return {
    switchOn: r.is_open,
    isOpen: state.isOpen,
    opensAt: state.opensAt,
    busyExtraMinutes: r.busy_extra_minutes,
    prepMinutes: state.prepMinutes,
  };
}

/** Sets the open switch. True when the value changed. */
export async function setOpenSwitch(tx: Executor, restaurantId: string, isOpen: boolean): Promise<boolean> {
  const rows = await tx.execute(
    sql`UPDATE restaurants SET is_open = ${isOpen} WHERE id = ${restaurantId} AND is_open <> ${isOpen} RETURNING id`,
  );
  return rows.length > 0;
}

/** Sets busy mode. True when the value changed. */
export async function setBusyMinutes(tx: Executor, restaurantId: string, minutes: number): Promise<boolean> {
  const rows = await tx.execute(
    sql`UPDATE restaurants SET busy_extra_minutes = ${minutes}
        WHERE id = ${restaurantId} AND busy_extra_minutes <> ${minutes} RETURNING id`,
  );
  return rows.length > 0;
}

/** Sets an item's availability; null when the item is not on this restaurant's menu, else whether it changed. */
export async function setItemAvailability(
  tx: Executor,
  restaurantId: string,
  itemId: string,
  isAvailable: boolean,
): Promise<{ changed: boolean } | null> {
  const found = await tx.execute<{ is_available: boolean }>(
    sql`SELECT is_available FROM menu_items WHERE id = ${itemId} AND restaurant_id = ${restaurantId} FOR UPDATE`,
  );
  const row = found[0];
  if (!row) return null;
  if (row.is_available === isAvailable) return { changed: false };
  await tx.execute(sql`UPDATE menu_items SET is_available = ${isAvailable} WHERE id = ${itemId}`);
  return { changed: true };
}
