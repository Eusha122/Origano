import type { RiderInvite } from '@oregano/contracts';
import { type AccountStatus, normalizeBdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';

type Row = { phone: string; created_at: string; rider_status: AccountStatus | null };

const toInvite = (r: Row): RiderInvite => ({
  phone: r.phone,
  createdAt: new Date(r.created_at).toISOString(),
  riderStatus: r.rider_status,
});

const validPhone = (input: string): string => {
  const phone = normalizeBdPhone(input);
  if (phone === null) throw new AppError('invalid_phone', 400, 'That is not a valid phone number.');
  return phone;
};

export async function listRiderInvites(db: Executor, restaurantId: string): Promise<RiderInvite[]> {
  const rows = await db.execute<Row>(sql`
    SELECT i.phone, i.created_at, r.status AS rider_status
    FROM rider_invites i
    LEFT JOIN users u ON u.phone = i.phone
    LEFT JOIN riders r ON r.user_id = u.id AND r.restaurant_id = i.restaurant_id
    WHERE i.restaurant_id = ${restaurantId} ORDER BY i.created_at, i.phone`);
  return rows.map(toInvite);
}

/** Lets a phone join as this restaurant's own rider. Inviting twice is a repeat: nothing is written. */
export async function createRiderInvite(
  db: Db,
  ownerId: string,
  restaurantId: string,
  phoneInput: string,
): Promise<{ invite: RiderInvite; created: boolean }> {
  const phone = validPhone(phoneInput);
  return db.transaction(async (tx) => {
    const inserted = await tx.execute(sql`
      INSERT INTO rider_invites (restaurant_id, phone, invited_by) VALUES (${restaurantId}, ${phone}, ${ownerId})
      ON CONFLICT DO NOTHING RETURNING phone`);
    if (inserted.length > 0) {
      await writeAudit(tx, {
        actor: { type: 'user', id: ownerId },
        action: 'rider_invite.created',
        targetType: 'restaurant',
        targetId: restaurantId,
      });
    }
    const invite = (await listRiderInvites(tx, restaurantId)).find((i) => i.phone === phone) as RiderInvite;
    return { invite, created: inserted.length > 0 };
  });
}

/** Withdraws an invite. A rider already bound to the restaurant stays bound. */
export async function deleteRiderInvite(
  db: Db,
  ownerId: string,
  restaurantId: string,
  phoneInput: string,
): Promise<void> {
  const phone = validPhone(phoneInput);
  await db.transaction(async (tx) => {
    const removed = await tx.execute(
      sql`DELETE FROM rider_invites WHERE restaurant_id = ${restaurantId} AND phone = ${phone} RETURNING phone`,
    );
    if (removed.length === 0) return;
    await writeAudit(tx, {
      actor: { type: 'user', id: ownerId },
      action: 'rider_invite.deleted',
      targetType: 'restaurant',
      targetId: restaurantId,
    });
  });
}
