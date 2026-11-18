import { randomInt } from 'node:crypto';
import type { AccountSummary, AdminRestaurantRow, AdminRiderRow, Agency, CreateAgencyBody } from '@oregano/contracts';
import { accountTransition, normalizeBdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { type AuditAction, writeAudit } from '../admin/audit';
import type { Db, Executor, Tx } from '../db/client';
import { releaseRiderOrders } from '../dispatch/repo';
import { AppError } from '../errors';
import { writeOutbox } from '../events/outbox';

const notFound = () => new AppError('not_found', 404, 'Not found.');
const badMove = () => new AppError('invalid_transition', 409, 'That is not possible right now.');
const accessChanged = (tx: Executor, userId: string) => writeOutbox(tx, 'user.access_changed', { userId });

type Kind = 'suspend' | 'reinstate';
const STATUS_AFTER = { suspend: 'suspended', reinstate: 'approved' } as const;

/** Whether the account is already where the action leads (a repeat: answered, nothing written), or may move. */
function decide(current: string, kind: Kind): 'repeat' | 'move' {
  if (current === STATUS_AFTER[kind]) return 'repeat';
  const from = current as Parameters<typeof accountTransition>[0];
  if (accountTransition(from, kind) === null) throw badMove();
  return 'move';
}

// ---------- riders ----------

/** Stops a rider working: offline, un-picked orders back to the pool, and their app told to reload who they are. */
async function stopRider(tx: Tx, riderId: string): Promise<number> {
  await tx.execute(sql`UPDATE riders SET is_online = false WHERE user_id = ${riderId}`);
  const released = await releaseRiderOrders(tx, riderId);
  await accessChanged(tx, riderId);
  return released.length;
}

export async function suspendRider(db: Db, adminId: string, userId: string, reason: string): Promise<AccountSummary> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ status: string }>(
      sql`SELECT status FROM riders WHERE user_id = ${userId} FOR UPDATE`,
    );
    const current = rows[0]?.status;
    if (!current) throw notFound();
    if (decide(current, 'suspend') === 'move') {
      await tx.execute(
        sql`UPDATE riders SET status = 'suspended', suspended_reason = ${reason} WHERE user_id = ${userId}`,
      );
      const released = await stopRider(tx, userId);
      await audit(tx, adminId, 'rider.suspended', 'rider', userId, { released, reason });
    }
    return { id: userId, status: 'suspended' };
  });
}

export async function reinstateRider(db: Db, adminId: string, userId: string): Promise<AccountSummary> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ status: string }>(
      sql`SELECT status FROM riders WHERE user_id = ${userId} FOR UPDATE`,
    );
    const current = rows[0]?.status;
    if (!current) throw notFound();
    if (decide(current, 'reinstate') === 'move') {
      await tx.execute(sql`UPDATE riders SET status = 'approved', suspended_reason = NULL WHERE user_id = ${userId}`);
      await accessChanged(tx, userId);
      await audit(tx, adminId, 'rider.reinstated', 'rider', userId);
    }
    return { id: userId, status: 'approved' };
  });
}

// ---------- restaurants ----------

async function setRestaurant(
  db: Db,
  adminId: string,
  id: string,
  kind: Kind,
  reason?: string,
): Promise<AccountSummary> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ status: string }>(sql`SELECT status FROM restaurants WHERE id = ${id} FOR UPDATE`);
    const current = rows[0]?.status;
    if (!current) throw notFound();
    if (decide(current, kind) === 'move') {
      await tx.execute(sql`UPDATE restaurants SET status = ${STATUS_AFTER[kind]} WHERE id = ${id}`);
      // Staff reload what they may see; orders already placed carry on.
      const staff = await tx.execute<{ user_id: string }>(
        sql`SELECT user_id FROM restaurant_staff WHERE restaurant_id = ${id}`,
      );
      for (const member of staff) await accessChanged(tx, member.user_id);
      await audit(
        tx,
        adminId,
        kind === 'suspend' ? 'restaurant.suspended' : 'restaurant.reinstated',
        'restaurant',
        id,
        reason ? { reason } : {},
      );
    }
    return { id, status: STATUS_AFTER[kind] };
  });
}

export const suspendRestaurant = (db: Db, adminId: string, id: string, reason: string) =>
  setRestaurant(db, adminId, id, 'suspend', reason);
export const reinstateRestaurant = (db: Db, adminId: string, id: string) => setRestaurant(db, adminId, id, 'reinstate');

// ---------- agencies ----------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = (): string => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export async function listAgencies(db: Db): Promise<Agency[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    code: string;
    status: 'approved' | 'suspended';
    rider_count: number;
  }>(sql`
    SELECT a.id, a.name, a.code, a.status, count(r.user_id)::int AS rider_count
    FROM agencies a LEFT JOIN riders r ON r.agency_id = a.id
    GROUP BY a.id ORDER BY a.created_at, a.id`);
  return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, status: r.status, riderCount: r.rider_count }));
}

/** Creates an agency with a random code, retrying when the code is taken. */
export async function createAgency(db: Db, adminId: string, body: CreateAgencyBody): Promise<Agency> {
  const phone = normalizeBdPhone(body.contactPhone);
  if (phone === null) throw new AppError('invalid_phone', 400, 'That is not a valid phone number.');
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await tx.execute<{ id: string; code: string }>(sql`
        INSERT INTO agencies (name, contact_phone, code) VALUES (${body.name}, ${phone}, ${newCode()})
        ON CONFLICT (code) DO NOTHING RETURNING id, code`);
      const row = rows[0];
      if (!row) continue;
      await audit(tx, adminId, 'agency.created', 'agency', row.id);
      return { id: row.id, name: body.name, code: row.code, status: 'approved' as const, riderCount: 0 };
    }
    throw new Error('No free agency code');
  });
}

export async function suspendAgency(db: Db, adminId: string, id: string, reason: string): Promise<AccountSummary> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ status: string }>(sql`SELECT status FROM agencies WHERE id = ${id} FOR UPDATE`);
    const current = rows[0]?.status;
    if (!current) throw notFound();
    if (decide(current, 'suspend') === 'move') {
      await tx.execute(sql`UPDATE agencies SET status = 'suspended' WHERE id = ${id}`);
      const riders = await tx.execute<{ user_id: string }>(
        sql`SELECT user_id FROM riders WHERE agency_id = ${id} ORDER BY user_id FOR UPDATE`,
      );
      let released = 0;
      for (const rider of riders) released += await stopRider(tx, rider.user_id);
      await audit(tx, adminId, 'agency.suspended', 'agency', id, { riders: riders.length, released, reason });
    }
    return { id, status: 'suspended' };
  });
}

export async function reinstateAgency(db: Db, adminId: string, id: string): Promise<AccountSummary> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ status: string }>(sql`SELECT status FROM agencies WHERE id = ${id} FOR UPDATE`);
    const current = rows[0]?.status;
    if (!current) throw notFound();
    if (decide(current, 'reinstate') === 'move') {
      await tx.execute(sql`UPDATE agencies SET status = 'approved' WHERE id = ${id}`);
      const riders = await tx.execute<{ user_id: string }>(sql`SELECT user_id FROM riders WHERE agency_id = ${id}`);
      for (const rider of riders) await accessChanged(tx, rider.user_id);
      await audit(tx, adminId, 'agency.reinstated', 'agency', id);
    }
    return { id, status: 'approved' };
  });
}

function audit(
  tx: Executor,
  adminId: string,
  action: AuditAction,
  targetType: string,
  targetId: string,
  data: Record<string, number | string> = {},
): Promise<void> {
  return writeAudit(tx, { actor: { type: 'user', id: adminId }, action, targetType, targetId, data });
}

/** Riders who have been approved at some point (approved or suspended), for the accounts tab. Names only. */
export async function listRiderAccounts(db: Db): Promise<AdminRiderRow[]> {
  const rows = await db.execute<{
    user_id: string;
    name: string | null;
    type: AdminRiderRow['type'];
    status: AdminRiderRow['status'];
    agency_name: string | null;
  }>(sql`
    SELECT r.user_id, u.name, r.type, r.status, a.name AS agency_name
    FROM riders r JOIN users u ON u.id = r.user_id LEFT JOIN agencies a ON a.id = r.agency_id
    WHERE r.status IN ('approved', 'suspended') ORDER BY u.name, r.user_id`);
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name ?? '',
    type: r.type,
    status: r.status,
    agencyName: r.agency_name,
  }));
}

export async function listRestaurantAccounts(db: Db): Promise<AdminRestaurantRow[]> {
  const rows = await db.execute<{ id: string; name_en: string; status: 'approved' | 'suspended'; is_open: boolean }>(
    sql`SELECT id, name_en, status, is_open FROM restaurants ORDER BY name_en, id`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name_en, status: r.status, isOpen: r.is_open }));
}
