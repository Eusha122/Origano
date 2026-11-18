import type { RiderApplicationBody, RiderApplicationView } from '@oregano/contracts';
import {
  type AccountStatus,
  accountTransition,
  normalizeBdPhone,
  type RiderType,
  type VehicleType,
  vehicleNeedsRegistration,
} from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';
import { clearDecision, type DocumentKind, type DocumentSubject, listDocuments } from '../media/vault';
import { ABANDONED_AFTER_DAYS } from './restaurant-applications';

/** The document kinds a rider uploads. */
export const RIDER_DOCUMENT_KINDS = ['nid_front', 'nid_back', 'photo'] as const;
export type RiderDocumentKind = (typeof RIDER_DOCUMENT_KINDS)[number];

/** A rider's documents are filed under the rider's user id. */
export const riderSubject = (userId: string): DocumentSubject => ({ type: 'rider', id: userId });

type Row = {
  user_id: string;
  name: string | null;
  zone_id: string;
  type: RiderType;
  status: AccountStatus;
  vehicle_type: VehicleType | null;
  vehicle_registration: string | null;
  guarantor_name: string | null;
  guarantor_phone: string | null;
  guarantor_relation: string | null;
  agency_id: string | null;
  agency_name: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  rejection_reason: string | null;
  suspended_reason: string | null;
};

const notFound = () => new AppError('not_found', 404, 'Not found.');
const notEditable = () =>
  new AppError('application_not_editable', 409, 'This application is with the Oregano team and cannot be changed.');
const invalid = (message = 'Some details are missing or wrong.') => new AppError('validation_failed', 400, message);

const lockApplicant = (tx: Executor, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`rider-application:${userId}`}))`);

export async function findRiderRow(db: Executor, userId: string, lock = false): Promise<Row | null> {
  return findRow(db, userId, lock);
}

async function findRow(db: Executor, userId: string, lock = false): Promise<Row | null> {
  const rows = await db.execute<Row>(sql`
    SELECT r.user_id, u.name, r.zone_id, r.type, r.status, r.vehicle_type, r.vehicle_registration,
      r.guarantor_name, r.guarantor_phone, r.guarantor_relation, r.agency_id, a.name AS agency_name,
      r.restaurant_id, rs.name_en AS restaurant_name, r.rejection_reason, r.suspended_reason
    FROM riders r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN agencies a ON a.id = r.agency_id
    LEFT JOIN restaurants rs ON rs.id = r.restaurant_id
    WHERE r.user_id = ${userId} ${lock ? sql`FOR UPDATE OF r` : sql``}`);
  return rows[0] ?? null;
}

export function missingRiderKinds(stored: readonly DocumentKind[]): RiderDocumentKind[] {
  return RIDER_DOCUMENT_KINDS.filter((kind) => !stored.includes(kind));
}

export async function presentRider(db: Executor, row: Row): Promise<RiderApplicationView> {
  return present(db, row);
}

async function present(db: Executor, row: Row): Promise<RiderApplicationView> {
  const stored = (await listDocuments(db, riderSubject(row.user_id))).filter((d) => d.status === 'stored');
  return {
    status: row.status,
    type: row.type,
    zoneId: row.zone_id,
    agencyName: row.agency_name,
    restaurantName: row.restaurant_name,
    details: {
      type: row.type,
      zoneId: row.zone_id,
      name: row.name ?? '',
      vehicleType: row.vehicle_type ?? 'motorcycle',
      vehicleRegistration: row.vehicle_registration,
      guarantor: {
        name: row.guarantor_name ?? '',
        phone: row.guarantor_phone ?? '',
        relation: row.guarantor_relation ?? '',
      },
    },
    documents: stored.map((d) => ({ id: d.id, kind: d.kind, uploadedAt: d.uploadedAt, outcome: d.outcome })),
    missing: missingRiderKinds(stored.map((d) => d.kind)),
    rejectionReason: row.rejection_reason,
    suspendedReason: row.suspended_reason,
  };
}

export async function getMyRiderApplication(db: Db, userId: string): Promise<RiderApplicationView | null> {
  const row = await findRow(db, userId);
  return row ? present(db, row) : null;
}

/** The rider row's id when the applicant may still change it (applied or rejected). Throws 404 or 409 otherwise. */
export async function editableRiderId(db: Executor, userId: string): Promise<string> {
  const row = await findRow(db, userId);
  if (!row) throw notFound();
  if (row.status !== 'applied' && row.status !== 'rejected') throw notEditable();
  return row.user_id;
}

/** The rider's version of requireApplicationOpen. */
export async function requireRiderOpen(tx: Executor, userId: string): Promise<void> {
  const rows = await tx.execute<{ status: AccountStatus }>(
    sql`SELECT status FROM riders WHERE user_id = ${userId} FOR UPDATE`,
  );
  const status = rows[0]?.status;
  if (!status) throw notFound();
  if (status !== 'applied' && status !== 'rejected') throw notEditable();
}

export async function touchRider(db: Executor, userId: string): Promise<void> {
  await db.execute(sql`UPDATE riders SET last_activity_at = now() WHERE user_id = ${userId}`);
}

/** Creates the rider (as applied) on the first call, then updates it while it is applied or rejected. */
export async function saveMyRiderApplication(
  db: Db,
  userId: string,
  userPhone: string,
  body: RiderApplicationBody,
): Promise<RiderApplicationView> {
  const guarantorPhone = normalizeBdPhone(body.guarantor.phone);
  if (guarantorPhone === null || guarantorPhone === userPhone) {
    throw invalid('The guarantor needs their own phone number.');
  }
  const registration = vehicleNeedsRegistration(body.vehicleType) ? (body.vehicleRegistration?.trim() ?? '') : null;
  if (registration === '') throw invalid('This vehicle needs a registration number.');

  return db.transaction(async (tx) => {
    await lockApplicant(tx, userId);
    const existing = await findRow(tx, userId, true);
    if (existing && existing.status !== 'applied' && existing.status !== 'rejected') throw notEditable();

    const zone = await tx.execute<{ id: string }>(sql`SELECT id FROM zones WHERE id = ${body.zoneId} AND is_active`);
    if (!zone[0]) throw invalid('That zone is not open yet.');

    let agencyId: string | null = null;
    let restaurantId: string | null = null;
    if (body.type === 'agency') {
      if (body.agencyCode === undefined && existing?.agency_id) {
        agencyId = existing.agency_id;
      } else {
        const found = await tx.execute<{ id: string }>(
          sql`SELECT id FROM agencies WHERE code = ${body.agencyCode ?? ''} AND status = 'approved'`,
        );
        agencyId = found[0]?.id ?? null;
        if (agencyId === null) throw new AppError('agency_code_invalid', 422, 'That agency code was not found.');
      }
    } else if (body.type === 'restaurant_staff') {
      const invite = await tx.execute<{ restaurant_id: string }>(
        sql`SELECT restaurant_id FROM rider_invites WHERE phone = ${userPhone} ORDER BY created_at DESC LIMIT 1`,
      );
      restaurantId = invite[0]?.restaurant_id ?? null;
      if (restaurantId === null) {
        throw new AppError('rider_invite_missing', 422, 'No restaurant has invited this phone number.');
      }
    }

    await tx.execute(sql`UPDATE users SET name = ${body.name} WHERE id = ${userId}`);
    if (!existing) {
      await tx.execute(sql`
        INSERT INTO riders (user_id, zone_id, type, status, vehicle_type, vehicle_registration, guarantor_name,
          guarantor_phone, guarantor_relation, agency_id, restaurant_id)
        VALUES (${userId}, ${body.zoneId}, ${body.type}, 'applied', ${body.vehicleType}, ${registration},
          ${body.guarantor.name}, ${guarantorPhone}, ${body.guarantor.relation}, ${agencyId}, ${restaurantId})`);
      await writeAudit(tx, {
        actor: { type: 'user', id: userId },
        action: 'application.created',
        targetType: 'rider_application',
        targetId: userId,
        data: { type: body.type },
      });
    } else {
      await tx.execute(sql`
        UPDATE riders SET zone_id = ${body.zoneId}, type = ${body.type}, vehicle_type = ${body.vehicleType},
          vehicle_registration = ${registration}, guarantor_name = ${body.guarantor.name},
          guarantor_phone = ${guarantorPhone}, guarantor_relation = ${body.guarantor.relation},
          agency_id = ${agencyId}, restaurant_id = ${restaurantId}, last_activity_at = now()
        WHERE user_id = ${userId}`);
    }
    return present(tx, (await findRow(tx, userId)) as Row);
  });
}

/** Sends the application for review. Sending one that is already under review changes nothing. */
export async function submitMyRiderApplication(db: Db, userId: string): Promise<RiderApplicationView> {
  return db.transaction(async (tx) => {
    await lockApplicant(tx, userId);
    const row = await findRow(tx, userId, true);
    if (!row) throw notFound();
    if (row.status === 'under_review') return present(tx, row);
    const action = row.status === 'rejected' ? 'resubmit' : 'submit';
    const next = accountTransition(row.status, action);
    if (next === null) throw new AppError('invalid_transition', 409, 'That is not possible right now.');
    const view = await present(tx, row);
    if (view.missing.length > 0 || row.guarantor_name === null || row.guarantor_phone === null) {
      throw new AppError('application_incomplete', 422, 'Some details or documents are missing.');
    }
    if (row.status === 'rejected') await clearDecision(tx, riderSubject(userId));
    await tx.execute(sql`
      UPDATE riders SET status = ${next}, rejection_reason = NULL, submitted_at = now(), last_activity_at = now()
      WHERE user_id = ${userId}`);
    await writeAudit(tx, {
      actor: { type: 'user', id: userId },
      action: 'application.submitted',
      targetType: 'rider_application',
      targetId: userId,
    });
    return { ...view, status: next, rejectionReason: null };
  });
}

/** Waiting on the applicant. An application under review is waiting on the team and never expires. */
const OPEN_STATUSES = sql`status IN ('applied', 'rejected')`;

/** True when the application is still open (never approved) and has been idle for 30 days. */
export async function riderApplicationAbandoned(db: Executor, userId: string, now = new Date()): Promise<boolean> {
  const rows = await db.execute<{ abandoned: boolean }>(sql`
    SELECT (${OPEN_STATUSES}
      AND last_activity_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${ABANDONED_AFTER_DAYS})) AS abandoned
    FROM riders WHERE user_id = ${userId}`);
  return rows[0]?.abandoned ?? true;
}

/** Clears the guarantor and the registration number of rejected or abandoned applications 30 days after the last activity. */
export async function pruneRiderApplicationDetails(db: Db, now: Date): Promise<number> {
  const rows = await db.execute<{ user_id: string }>(sql`
    UPDATE riders SET guarantor_name = NULL, guarantor_phone = NULL, guarantor_relation = NULL,
      vehicle_registration = NULL
    WHERE ${OPEN_STATUSES}
      AND (guarantor_name IS NOT NULL OR guarantor_phone IS NOT NULL OR guarantor_relation IS NOT NULL
        OR vehicle_registration IS NOT NULL)
      AND last_activity_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${ABANDONED_AFTER_DAYS})
    RETURNING user_id`);
  return rows.length;
}
