import type { StaffMember } from '@oregano/contracts';
import { normalizeBdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';
import { writeOutbox } from '../events/outbox';

/** Makes a user an owner of a restaurant. Owners come only from an approved application. */
export async function addRestaurantOwner(tx: Executor, restaurantId: string, userId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO restaurant_staff (restaurant_id, user_id, role) VALUES (${restaurantId}, ${userId}, 'owner')
    ON CONFLICT (restaurant_id, user_id) DO UPDATE SET role = 'owner'`);
}

type StaffRow = { user_id: string; phone: string; name: string | null; role: 'owner' | 'staff'; created_at: string };

const toMember = (r: StaffRow): StaffMember => ({
  userId: r.user_id,
  phone: r.phone,
  // A staff member's name is private to them; only owners (approved by the team) show theirs.
  name: r.role === 'owner' ? r.name : null,
  role: r.role,
  addedAt: new Date(r.created_at).toISOString(),
});

export async function listStaff(db: Executor, restaurantId: string): Promise<StaffMember[]> {
  const rows = await db.execute<StaffRow>(sql`
    SELECT rs.user_id, u.phone, u.name, rs.role, rs.created_at FROM restaurant_staff rs
    JOIN users u ON u.id = rs.user_id WHERE rs.restaurant_id = ${restaurantId}
    ORDER BY (rs.role = 'owner') DESC, rs.created_at, rs.user_id`);
  return rows.map(toMember);
}

/** Adds a phone as staff (never owner). Already a member: the existing entry and `created: false`, nothing written. */
export async function addStaff(
  db: Db,
  ownerId: string,
  restaurantId: string,
  phoneInput: string,
  limit: number,
): Promise<{ member: StaffMember; created: boolean }> {
  const phone = normalizeBdPhone(phoneInput);
  if (phone === null) throw new AppError('invalid_phone', 400, 'That is not a valid phone number.');
  return db.transaction(async (tx) => {
    // The restaurant row is the lock that makes the count below exact.
    await tx.execute(sql`SELECT id FROM restaurants WHERE id = ${restaurantId} FOR UPDATE`);
    const users = await tx.execute<{ id: string }>(sql`
      INSERT INTO users (phone) VALUES (${phone}) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`);
    const userId = users[0]?.id as string;
    const current = await listStaff(tx, restaurantId);
    const existing = current.find((m) => m.userId === userId);
    if (existing) return { member: existing, created: false };
    if (current.length >= limit) {
      throw new AppError('staff_limit_reached', 409, 'This restaurant already has the most staff it can have.');
    }
    await tx.execute(
      sql`INSERT INTO restaurant_staff (restaurant_id, user_id, role) VALUES (${restaurantId}, ${userId}, 'staff')`,
    );
    await writeOutbox(tx, 'user.access_changed', { userId });
    await writeAudit(tx, {
      actor: { type: 'user', id: ownerId },
      action: 'staff.added',
      targetType: 'restaurant',
      targetId: restaurantId,
      data: { userId },
    });
    const member = (await listStaff(tx, restaurantId)).find((m) => m.userId === userId) as StaffMember;
    return { member, created: true };
  });
}

/** Removes a member. Not a member already: nothing happens. The last owner cannot be removed. */
export async function removeStaff(db: Db, ownerId: string, restaurantId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM restaurants WHERE id = ${restaurantId} FOR UPDATE`);
    const members = await listStaff(tx, restaurantId);
    const target = members.find((m) => m.userId === userId);
    if (!target) return;
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) {
      throw new AppError('cannot_remove_last_owner', 409, 'The last owner cannot be removed.');
    }
    await tx.execute(sql`DELETE FROM restaurant_staff WHERE restaurant_id = ${restaurantId} AND user_id = ${userId}`);
    await writeOutbox(tx, 'user.access_changed', { userId });
    await writeAudit(tx, {
      actor: { type: 'user', id: ownerId },
      action: 'staff.removed',
      targetType: 'restaurant',
      targetId: restaurantId,
      data: { userId },
    });
  });
}

/** 403 unless the signed-in user is an owner (not just staff) of this restaurant. */
export async function requireOwner(
  db: Executor,
  user: { id: string; restaurantIds: string[] },
  restaurantId: string,
): Promise<void> {
  const forbidden = () => new AppError('forbidden', 403, 'You cannot do that.');
  if (!user.restaurantIds.includes(restaurantId)) throw forbidden();
  const rows = await db.execute<{ role: string }>(
    sql`SELECT role FROM restaurant_staff WHERE restaurant_id = ${restaurantId} AND user_id = ${user.id}`,
  );
  if (rows[0]?.role !== 'owner') throw forbidden();
}
