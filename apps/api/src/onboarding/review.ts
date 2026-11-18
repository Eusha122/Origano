import type {
  AdminCreateRestaurantApplicationBody,
  ApplicationQueueItem,
  ApproveRestaurantBody,
  RestaurantApplicationView,
  RiderApplicationDetail,
} from '@oregano/contracts';
import { type AccountStatus, accountTransition, normalizeBdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import { createApprovedRestaurant } from '../catalog/repo';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';
import { writeOutbox } from '../events/outbox';
import { addRestaurantOwner } from '../identity/staff';
import { recordDecision, type VaultDeps } from '../media/vault';
import { findZoneForPoint } from '../zones/repo';
import {
  applicationSubject,
  findApplicationById,
  insertApplication,
  presentApplication,
} from './restaurant-applications';
import { findRiderRow, presentRider, riderSubject } from './rider-applications';

/** Files of a decided application are deleted this long after the decision. */
const RETENTION_DAYS = 7;
const retentionEnd = (now: Date): Date => new Date(now.getTime() + RETENTION_DAYS * 86_400_000);

const notFound = () => new AppError('not_found', 404, 'Not found.');
const badMove = () => new AppError('invalid_transition', 409, 'That is not possible right now.');
const incomplete = () => new AppError('application_incomplete', 422, 'Some details or documents are missing.');

const accessChanged = (tx: Executor, userId: string) => writeOutbox(tx, 'user.access_changed', { userId });

export type QueueFilter = { kind?: 'restaurant' | 'rider'; status: AccountStatus };

/** Submitted applications, oldest first. Drafts (`applied`) only when asked for. Names only. */
export async function listApplicationQueue(db: Db, filter: QueueFilter): Promise<ApplicationQueueItem[]> {
  const rows = await db.execute<{
    kind: 'restaurant' | 'rider';
    id: string;
    name: string;
    submitted_at: string;
    status: AccountStatus;
    rider_type: ApplicationQueueItem['riderType'];
  }>(sql`
    SELECT * FROM (
      SELECT 'restaurant' AS kind, a.id, a.restaurant_name AS name, a.status,
        to_char(COALESCE(a.submitted_at, a.last_activity_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS submitted_at,
        COALESCE(a.submitted_at, a.last_activity_at) AS sort_at, NULL AS rider_type
      FROM restaurant_applications a
      UNION ALL
      SELECT 'rider', r.user_id, COALESCE(u.name, ''), r.status,
        to_char(COALESCE(r.submitted_at, r.last_activity_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        COALESCE(r.submitted_at, r.last_activity_at), r.type
      FROM riders r JOIN users u ON u.id = r.user_id
    ) q
    WHERE q.status = ${filter.status} ${filter.kind ? sql`AND q.kind = ${filter.kind}` : sql``}
    ORDER BY q.sort_at ASC, q.id ASC
    LIMIT 100`);
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    name: r.name,
    submittedAt: r.submitted_at,
    status: r.status,
    riderType: r.rider_type,
  }));
}

export async function getRestaurantApplicationDetail(db: Db, id: string): Promise<RestaurantApplicationView> {
  const row = await findApplicationById(db, id);
  if (!row) throw notFound();
  return presentApplication(db, row);
}

export async function getRiderApplicationDetail(db: Db, userId: string): Promise<RiderApplicationDetail> {
  const row = await findRiderRow(db, userId);
  if (!row) throw notFound();
  return { ...(await presentRider(db, row)), userId };
}

/** Approves a restaurant: creates it (closed), makes the applicant its owner, and starts the file deletion clock. */
export async function approveRestaurantApplication(
  db: Db,
  reviewerId: string,
  id: string,
  body: ApproveRestaurantBody,
  now = new Date(),
): Promise<RestaurantApplicationView> {
  return db.transaction(async (tx) => {
    const row = await findApplicationById(tx, id, true);
    if (!row?.applicant_user_id) throw notFound();
    if (row.status === 'approved') return presentApplication(tx, row);
    if (accountTransition(row.status, 'approve') === null) throw badMove();

    // The licence must be on file, or the reviewer waives it on the record. The two ID photos are always needed.
    const view = await presentApplication(tx, { ...row, no_trade_licence: false });
    const missing = view.missing.filter((kind) => !(kind === 'trade_licence' && body.waiveLicence));
    if (missing.length > 0 || row.payout_account_sealed === null) throw incomplete();

    const zone = await findZoneForPoint(tx, { lat: body.lat, lng: body.lng });
    if (!zone) throw new AppError('outside_zone', 422, 'That point is outside every delivery zone.');

    const restaurant = await createApprovedRestaurant(tx, {
      zoneId: zone.id,
      name: row.restaurant_name,
      cuisine: row.cuisine,
      addressLine: row.address_line,
      phone: row.restaurant_phone,
      location: { lat: body.lat, lng: body.lng },
    });
    await addRestaurantOwner(tx, restaurant.id, row.applicant_user_id);
    await recordDecision(tx, applicationSubject(id), 'accepted', reviewerId, retentionEnd(now));
    await tx.execute(sql`
      UPDATE restaurant_applications SET status = 'approved', restaurant_id = ${restaurant.id},
        licence_waived = ${body.waiveLicence && view.missing.includes('trade_licence')}, rejection_reason = NULL,
        reviewed_by = ${reviewerId}, reviewed_at = ${now.toISOString()}, last_activity_at = ${now.toISOString()}
      WHERE id = ${id}`);
    const waived = body.waiveLicence && view.missing.includes('trade_licence');
    if (waived) {
      await writeAudit(tx, {
        actor: { type: 'user', id: reviewerId },
        action: 'application.licence_waived',
        targetType: 'restaurant_application',
        targetId: id,
      });
    }
    await writeAudit(tx, {
      actor: { type: 'user', id: reviewerId },
      action: 'application.approved',
      targetType: 'restaurant_application',
      targetId: id,
      data: { restaurantId: restaurant.id },
    });
    await accessChanged(tx, row.applicant_user_id);
    return presentApplication(tx, (await findApplicationById(tx, id)) as NonNullable<typeof row>);
  });
}

export async function rejectRestaurantApplication(
  db: Db,
  reviewerId: string,
  id: string,
  reason: string,
  now = new Date(),
): Promise<RestaurantApplicationView> {
  return db.transaction(async (tx) => {
    const row = await findApplicationById(tx, id, true);
    if (!row?.applicant_user_id) throw notFound();
    if (row.status === 'rejected') return presentApplication(tx, row);
    if (accountTransition(row.status, 'reject') === null) throw badMove();
    await recordDecision(tx, applicationSubject(id), 'rejected', reviewerId, retentionEnd(now));
    await tx.execute(sql`
      UPDATE restaurant_applications SET status = 'rejected', rejection_reason = ${reason}, reviewed_by = ${reviewerId},
        reviewed_at = ${now.toISOString()}, last_activity_at = ${now.toISOString()}
      WHERE id = ${id}`);
    await writeAudit(tx, {
      actor: { type: 'user', id: reviewerId },
      action: 'application.rejected',
      targetType: 'restaurant_application',
      targetId: id,
    });
    await accessChanged(tx, row.applicant_user_id);
    return presentApplication(tx, (await findApplicationById(tx, id)) as NonNullable<typeof row>);
  });
}

export async function approveRiderApplication(
  db: Db,
  reviewerId: string,
  userId: string,
  now = new Date(),
): Promise<RiderApplicationDetail> {
  return db.transaction(async (tx) => {
    const row = await findRiderRow(tx, userId, true);
    if (!row) throw notFound();
    if (row.status === 'approved') return { ...(await presentRider(tx, row)), userId };
    if (accountTransition(row.status, 'approve') === null) throw badMove();
    if ((await presentRider(tx, row)).missing.length > 0) throw incomplete();
    await recordDecision(tx, riderSubject(userId), 'accepted', reviewerId, retentionEnd(now));
    await tx.execute(sql`
      UPDATE riders SET status = 'approved', rejection_reason = NULL, suspended_reason = NULL, reviewed_by = ${reviewerId},
        reviewed_at = ${now.toISOString()}, last_activity_at = ${now.toISOString()}
      WHERE user_id = ${userId}`);
    await writeAudit(tx, {
      actor: { type: 'user', id: reviewerId },
      action: 'application.approved',
      targetType: 'rider_application',
      targetId: userId,
    });
    await accessChanged(tx, userId);
    return { ...(await presentRider(tx, (await findRiderRow(tx, userId)) as NonNullable<typeof row>)), userId };
  });
}

export async function rejectRiderApplication(
  db: Db,
  reviewerId: string,
  userId: string,
  reason: string,
  now = new Date(),
): Promise<RiderApplicationDetail> {
  return db.transaction(async (tx) => {
    const row = await findRiderRow(tx, userId, true);
    if (!row) throw notFound();
    if (row.status === 'rejected') return { ...(await presentRider(tx, row)), userId };
    if (accountTransition(row.status, 'reject') === null) throw badMove();
    await recordDecision(tx, riderSubject(userId), 'rejected', reviewerId, retentionEnd(now));
    await tx.execute(sql`
      UPDATE riders SET status = 'rejected', rejection_reason = ${reason}, reviewed_by = ${reviewerId},
        reviewed_at = ${now.toISOString()}, last_activity_at = ${now.toISOString()}
      WHERE user_id = ${userId}`);
    await writeAudit(tx, {
      actor: { type: 'user', id: reviewerId },
      action: 'application.rejected',
      targetType: 'rider_application',
      targetId: userId,
    });
    await accessChanged(tx, userId);
    return { ...(await presentRider(tx, (await findRiderRow(tx, userId)) as NonNullable<typeof row>)), userId };
  });
}

/** Door 1: the team applies for an owner who cannot. The owner finds the application when they sign in. */
export async function createApplicationForOwner(
  deps: Pick<VaultDeps, 'db' | 'keys'>,
  teamMemberId: string,
  body: AdminCreateRestaurantApplicationBody,
): Promise<RestaurantApplicationView> {
  const phone = normalizeBdPhone(body.ownerPhone);
  if (phone === null) throw new AppError('invalid_phone', 400, 'That is not a valid phone number.');
  return deps.db.transaction(async (tx) => {
    const users = await tx.execute<{ id: string }>(sql`
      INSERT INTO users (phone) VALUES (${phone})
      ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`);
    const ownerId = users[0]?.id;
    if (!ownerId) throw new Error('User could not be created');
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`restaurant-application:${ownerId}`}))`);
    const open = await tx.execute<{ id: string }>(sql`
      SELECT id FROM restaurant_applications
      WHERE applicant_user_id = ${ownerId} AND status IN ('applied', 'under_review', 'rejected')`);
    if (open[0]) throw new AppError('application_exists', 409, 'This person already has an application in progress.');
    const { ownerPhone: _ownerPhone, ...details } = body;
    const id = await insertApplication(tx, deps.keys, { applicantUserId: ownerId, teamMemberId }, details);
    return presentApplication(
      tx,
      (await findApplicationById(tx, id)) as NonNullable<Awaited<ReturnType<typeof findApplicationById>>>,
    );
  });
}
