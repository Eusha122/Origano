import { teamCan } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { AppError } from '../errors';
import type { AuthUser } from '../identity/auth';
import { isUuid } from '../ordering/repo';

export type CatalogActor = { kind: 'staff' | 'owner' | 'admin' };

const notFound = () => new AppError('not_found', 404, 'Not found.');
const forbidden = () => new AppError('forbidden', 403, 'You cannot do that.');

/**
 * Who may change a restaurant's catalog. A team member who manages accounts may act on any restaurant (the Oregano team
 * enters menus). Staff of the restaurant may do `staff` level things; `owner` level needs an owner. Anyone else, and an
 * unknown restaurant, looks like a missing restaurant.
 */
export async function requireCatalogActor(
  db: Executor,
  user: AuthUser,
  restaurantId: string,
  level: 'staff' | 'owner',
): Promise<CatalogActor> {
  if (!isUuid(restaurantId)) throw notFound();
  if (teamCan(user.teamRoles, 'accounts.manage')) {
    const exists = await db.execute<{ id: string }>(sql`SELECT id FROM restaurants WHERE id = ${restaurantId}`);
    if (exists.length === 0) throw notFound();
    return { kind: 'admin' };
  }
  if (!user.restaurantIds.includes(restaurantId)) throw notFound();
  const rows = await db.execute<{ role: 'owner' | 'staff' }>(
    sql`SELECT role FROM restaurant_staff WHERE restaurant_id = ${restaurantId} AND user_id = ${user.id}`,
  );
  const role = rows[0]?.role;
  if (!role) throw notFound();
  if (level === 'owner' && role !== 'owner') throw forbidden();
  return { kind: role };
}
