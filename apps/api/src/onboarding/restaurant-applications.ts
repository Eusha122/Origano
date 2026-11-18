import { randomUUID } from 'node:crypto';
import type { RestaurantApplicationBody, RestaurantApplicationView } from '@oregano/contracts';
import { type AccountStatus, accountTransition, normalizeBdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';
import { type DocumentKind, type DocumentSubject, listDocuments, type VaultDeps } from '../media/vault';
import { sealString } from '../security/crypto';

/** The document kinds a restaurant owner uploads. */
export const RESTAURANT_DOCUMENT_KINDS = ['owner_nid_front', 'owner_nid_back', 'trade_licence'] as const;
export type RestaurantDocumentKind = (typeof RESTAURANT_DOCUMENT_KINDS)[number];

/** An application nobody touched for this long, and that was never approved, counts as abandoned. */
export const ABANDONED_AFTER_DAYS = 30;

type Row = {
  id: string;
  status: AccountStatus;
  restaurant_name: string;
  cuisine: string;
  address_line: string;
  restaurant_phone: string | null;
  owner_name: string;
  payout_method: 'bkash' | 'nagad' | 'bank';
  payout_account_sealed: string | null;
  payout_account_last4: string;
  no_trade_licence: boolean;
  rejection_reason: string | null;
  restaurant_id: string | null;
};

const COLUMNS = sql`id, status, restaurant_name, cuisine, address_line, restaurant_phone, owner_name, payout_method,
  payout_account_sealed, payout_account_last4, no_trade_licence, rejection_reason, restaurant_id`;

export const applicationSubject = (id: string): DocumentSubject => ({ type: 'restaurant_application', id });

const notFound = () => new AppError('not_found', 404, 'Not found.');
const notEditable = () =>
  new AppError('application_not_editable', 409, 'This application is with the Oregano team and cannot be changed.');

/** Kinds still needed before the application can be sent. */
export function missingKinds(stored: readonly DocumentKind[], noTradeLicence: boolean): RestaurantDocumentKind[] {
  const needed = RESTAURANT_DOCUMENT_KINDS.filter((kind) => kind !== 'trade_licence' || !noTradeLicence);
  return needed.filter((kind) => !stored.includes(kind));
}

async function present(db: Executor, row: Row): Promise<RestaurantApplicationView> {
  const stored = (await listDocuments(db, applicationSubject(row.id))).filter((d) => d.status === 'stored');
  return {
    id: row.id,
    status: row.status,
    details: {
      restaurantName: row.restaurant_name,
      cuisine: row.cuisine,
      addressLine: row.address_line,
      restaurantPhone: row.restaurant_phone,
      ownerName: row.owner_name,
      payoutMethod: row.payout_method,
      payoutAccountLast4: row.payout_account_last4,
    },
    documents: stored.map((d) => ({ id: d.id, kind: d.kind, uploadedAt: d.uploadedAt, outcome: d.outcome })),
    missing: missingKinds(
      stored.map((d) => d.kind),
      row.no_trade_licence,
    ),
    rejectionReason: row.rejection_reason,
    noTradeLicence: row.no_trade_licence,
    restaurantId: row.restaurant_id,
  };
}

/** The user's open application, or else their latest one. Each applicant only ever sees their own. */
async function findMine(db: Executor, userId: string, lock = false): Promise<Row | null> {
  const rows = await db.execute<Row>(sql`
    SELECT ${COLUMNS} FROM restaurant_applications WHERE applicant_user_id = ${userId}
    ORDER BY (status <> 'approved') DESC, created_at DESC LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`);
  return rows[0] ?? null;
}

export async function getMyApplication(db: Db, userId: string): Promise<RestaurantApplicationView | null> {
  const row = await findMine(db, userId);
  return row ? present(db, row) : null;
}

/** An open application the applicant may still change: applied or rejected. Throws 404 or 409 otherwise. */
export async function editableApplicationId(db: Executor, userId: string): Promise<string> {
  const row = await findMine(db, userId);
  if (!row || row.status === 'approved') throw notFound();
  if (row.status !== 'applied' && row.status !== 'rejected') throw notEditable();
  return row.id;
}

export async function touchApplication(db: Executor, applicationId: string): Promise<void> {
  await db.execute(sql`UPDATE restaurant_applications SET last_activity_at = now() WHERE id = ${applicationId}`);
}

const lockApplicant = (tx: Executor, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`restaurant-application:${userId}`}))`);

/** Creates the application, or updates it while it is applied or rejected. */
export async function saveMyApplication(
  deps: Pick<VaultDeps, 'db' | 'keys'>,
  userId: string,
  body: RestaurantApplicationBody,
): Promise<RestaurantApplicationView> {
  const phone = body.restaurantPhone === null ? null : normalizeBdPhone(body.restaurantPhone);
  const last4 = body.payoutAccount.replace(/[^0-9]/g, '').slice(-4);
  return deps.db.transaction(async (tx) => {
    await lockApplicant(tx, userId);
    const existing = await findMine(tx, userId, true);
    if (existing && existing.status !== 'approved') {
      if (existing.status !== 'applied' && existing.status !== 'rejected') throw notEditable();
      await tx.execute(sql`
        UPDATE restaurant_applications SET restaurant_name = ${body.restaurantName}, cuisine = ${body.cuisine},
          address_line = ${body.addressLine}, restaurant_phone = ${phone}, owner_name = ${body.ownerName},
          payout_method = ${body.payoutMethod},
          payout_account_sealed = ${sealString(deps.keys, body.payoutAccount, existing.id)},
          payout_account_last4 = ${last4}, last_activity_at = now()
        WHERE id = ${existing.id}`);
      return present(tx, (await findMine(tx, userId)) as Row);
    }
    const id = randomUUID();
    await tx.execute(sql`
      INSERT INTO restaurant_applications (id, applicant_user_id, restaurant_name, cuisine, address_line,
        restaurant_phone, owner_name, payout_method, payout_account_sealed, payout_account_last4)
      VALUES (${id}, ${userId}, ${body.restaurantName}, ${body.cuisine}, ${body.addressLine}, ${phone},
        ${body.ownerName}, ${body.payoutMethod}, ${sealString(deps.keys, body.payoutAccount, id)}, ${last4})`);
    await writeAudit(tx, {
      actor: { type: 'user', id: userId },
      action: 'application.created',
      targetType: 'restaurant_application',
      targetId: id,
    });
    return present(tx, (await findMine(tx, userId)) as Row);
  });
}

/** Sends the application for review. Sending one that is already under review changes nothing. */
export async function submitMyApplication(
  db: Db,
  userId: string,
  noTradeLicence: boolean,
): Promise<RestaurantApplicationView> {
  return db.transaction(async (tx) => {
    await lockApplicant(tx, userId);
    const row = await findMine(tx, userId, true);
    if (!row || row.status === 'approved') throw notFound();
    if (row.status === 'under_review') return present(tx, row);
    const next = accountTransition(row.status, row.status === 'rejected' ? 'resubmit' : 'submit');
    if (next === null) throw new AppError('invalid_transition', 409, 'That is not possible right now.');
    const view = await present(tx, { ...row, no_trade_licence: noTradeLicence });
    if (view.missing.length > 0 || row.payout_account_sealed === null) {
      throw new AppError('application_incomplete', 422, 'Some details or documents are missing.');
    }
    await tx.execute(sql`
      UPDATE restaurant_applications SET status = ${next}, no_trade_licence = ${noTradeLicence},
        rejection_reason = NULL, submitted_at = now(), last_activity_at = now()
      WHERE id = ${row.id}`);
    await writeAudit(tx, {
      actor: { type: 'user', id: userId },
      action: 'application.submitted',
      targetType: 'restaurant_application',
      targetId: row.id,
      data: { noTradeLicence },
    });
    return { ...view, status: next, rejectionReason: null, noTradeLicence };
  });
}

/** True when the application was never approved and has been idle for 30 days. The vault asks this before keeping files. */
export async function restaurantApplicationAbandoned(db: Executor, id: string, now = new Date()): Promise<boolean> {
  const rows = await db.execute<{ abandoned: boolean }>(sql`
    SELECT (status <> 'approved'
      AND last_activity_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${ABANDONED_AFTER_DAYS})) AS abandoned
    FROM restaurant_applications WHERE id = ${id}`);
  // An application that no longer exists has nobody to keep its files for.
  return rows[0]?.abandoned ?? true;
}

/** Clears the sealed payout number of rejected or abandoned applications 30 days after the last activity. */
export async function pruneRestaurantApplicationDetails(db: Db, now: Date): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE restaurant_applications SET payout_account_sealed = NULL, payout_account_last4 = ''
    WHERE status <> 'approved' AND payout_account_sealed IS NOT NULL
      AND last_activity_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${ABANDONED_AFTER_DAYS})
    RETURNING id`);
  return rows.length;
}
