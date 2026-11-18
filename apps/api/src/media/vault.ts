import { randomUUID } from 'node:crypto';
import { DOCUMENT_KINDS, type DocumentKind } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { Config } from '../config';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';
import { decryptBytes, encryptBytes, newDataKey, type SealedKey, unwrapDataKey } from '../security/crypto';
import { normaliseDocumentImage } from './image';
import type { ObjectStore } from './store';

export { DOCUMENT_KINDS, type DocumentKind };
export type DocumentSubject = { type: 'rider' | 'restaurant_application'; id: string };
export type DeletedReason = 'decision_retention' | 'abandoned' | 'replaced' | 'upload_failed';
export type VaultDeps = { db: Db; store: ObjectStore; keys: Config['dataKeys'] };

/** What the rest of the system may know about a document. Never a storage key. */
export type DocumentSummary = {
  id: string;
  kind: DocumentKind;
  status: 'pending' | 'stored' | 'deleted';
  uploadedAt: string;
  outcome: 'accepted' | 'rejected' | null;
};

type Row = {
  id: string;
  kind: DocumentKind;
  status: 'pending' | 'stored' | 'deleted';
  uploaded_at: Date | string;
  review_outcome: 'accepted' | 'rejected' | null;
};

const summarise = (r: Row): DocumentSummary => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  uploadedAt: new Date(r.uploaded_at).toISOString(),
  outcome: r.review_outcome,
});

const REFUSALS = {
  unsupported_document: new AppError('unsupported_document', 400, 'That file is not a usable JPEG, PNG or WebP image'),
  document_too_large: new AppError('document_too_large', 413, 'That file is too large'),
} as const;

/**
 * Marks a document deleted (once) and audits it. The object and the key stay on the row until `purgeObject`
 * has removed the object, so a crash in between leaves something `pruneDocuments` can still find.
 */
async function markDeleted(tx: Executor, id: string, reason: DeletedReason): Promise<boolean> {
  const done = await tx.execute<{ kind: string }>(sql`
    UPDATE identity_documents SET status = 'deleted', deleted_at = now(), deleted_reason = ${reason}
    WHERE id = ${id} AND status <> 'deleted' RETURNING kind`);
  const kind = done[0]?.kind;
  if (kind === undefined) return false;
  await writeAudit(tx, {
    actor: { type: 'system' },
    action: 'document.deleted',
    targetType: 'document',
    targetId: id,
    data: { kind, reason },
  });
  return true;
}

/** Removes the object of a deleted document, then forgets where it was and how it was sealed. */
async function purgeObject(deps: VaultDeps, id: string): Promise<void> {
  const rows = await deps.db.execute<{ storage_key: string | null }>(
    sql`SELECT storage_key FROM identity_documents WHERE id = ${id} AND status = 'deleted'`,
  );
  const key = rows[0]?.storage_key;
  if (!key) return;
  await deps.store.delete(key);
  await deps.db.execute(
    sql`UPDATE identity_documents SET storage_key = NULL, sealed_key = NULL WHERE id = ${id} AND status = 'deleted'`,
  );
}

/**
 * Normalises, encrypts and stores one document. The order leaves no object that no row points to:
 * reject bad files first, commit a pending row with the key, write the object, then flip the row.
 */
export async function storeDocument(
  deps: VaultDeps,
  subject: DocumentSubject,
  kind: DocumentKind,
  upload: Buffer,
  uploadedBy: string,
): Promise<DocumentSummary> {
  const checked = await normaliseDocumentImage(upload);
  if (!checked.ok) throw REFUSALS[checked.code];

  const id = randomUUID();
  const storageKey = `docs/${randomUUID()}`;
  await deps.db.execute(sql`
    INSERT INTO identity_documents (id, subject_type, subject_id, kind, status, storage_key, uploaded_by)
    VALUES (${id}, ${subject.type}, ${subject.id}, ${kind}, 'pending', ${storageKey}, ${uploadedBy})`);

  const { key, sealed } = newDataKey(deps.keys, id);
  const body = encryptBytes(key, checked.jpeg, id);
  try {
    await deps.store.put(storageKey, body);
  } catch (error) {
    // The object may exist even though the call failed, so the key stays until the purge has run.
    await deps.db.transaction((tx) => markDeleted(tx, id, 'upload_failed'));
    await purgeObject(deps, id).catch(() => {});
    throw error;
  }

  const replaced: string[] = [];
  const summary = await deps.db.transaction(async (tx) => {
    // Two uploads of one kind at once take turns; the older document goes first: only one stored row per kind may exist.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`doc:${subject.type}:${subject.id}:${kind}`}))`);
    const old = await tx.execute<{ id: string }>(sql`
      SELECT id FROM identity_documents
      WHERE subject_type = ${subject.type} AND subject_id = ${subject.id} AND kind = ${kind}
        AND status = 'stored' AND id <> ${id} FOR UPDATE`);
    for (const row of old) {
      await markDeleted(tx, row.id, 'replaced');
      replaced.push(row.id);
    }
    const rows = await tx.execute<Row>(sql`
      UPDATE identity_documents SET status = 'stored', sealed_key = ${JSON.stringify(sealed)}::jsonb,
        byte_size = ${body.length}
      WHERE id = ${id} AND status = 'pending' RETURNING id, kind, status, uploaded_at, review_outcome`);
    // A sweep may have given up on a very slow upload. Its object is purged later through the deleted row.
    if (!rows[0]) throw new AppError('bad_request', 409, 'The upload took too long. Try again.');
    await writeAudit(tx, {
      actor: { type: 'user', id: uploadedBy },
      action: 'document.uploaded',
      targetType: 'document',
      targetId: id,
      data: { kind, subjectType: subject.type },
    });
    return summarise(rows[0]);
  });

  for (const oldId of replaced) await purgeObject(deps, oldId);
  return summary;
}

/** The decrypted JPEG, `'deleted'` once the content is gone, or null for an unknown or unfinished document. */
export async function readDocument(deps: VaultDeps, documentId: string): Promise<Buffer | 'deleted' | null> {
  if (!/^[0-9a-f-]{36}$/.test(documentId)) return null;
  const rows = await deps.db.execute<{ status: string; storage_key: string | null; sealed_key: SealedKey | null }>(
    sql`SELECT status, storage_key, sealed_key FROM identity_documents WHERE id = ${documentId}`,
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status === 'deleted') return 'deleted';
  if (row.status !== 'stored' || !row.storage_key || !row.sealed_key) return null;
  const key = unwrapDataKey(deps.keys, row.sealed_key, documentId);
  let sealed: Buffer;
  try {
    sealed = await deps.store.get(row.storage_key);
  } catch (error) {
    // A delete may have won the race since the row was read.
    const again = await deps.db.execute<{ status: string }>(
      sql`SELECT status FROM identity_documents WHERE id = ${documentId}`,
    );
    if (again[0]?.status === 'deleted') return 'deleted';
    throw error;
  }
  return decryptBytes(key, sealed, documentId);
}

/** Every document of a subject, newest first. Never keys. */
export async function listDocuments(db: Executor, subject: DocumentSubject): Promise<DocumentSummary[]> {
  const rows = await db.execute<Row>(sql`
    SELECT id, kind, status, uploaded_at, review_outcome FROM identity_documents
    WHERE subject_type = ${subject.type} AND subject_id = ${subject.id} AND status <> 'pending'
    ORDER BY uploaded_at DESC, id`);
  return rows.map(summarise);
}

/** Records who decided, and when the files must go. Call in the transaction that decides the application. */
export async function recordDecision(
  tx: Executor,
  subject: DocumentSubject,
  outcome: 'accepted' | 'rejected',
  reviewerId: string,
  deleteAfter: Date,
): Promise<void> {
  await tx.execute(sql`
    UPDATE identity_documents SET review_outcome = ${outcome}, reviewed_by = ${reviewerId}, reviewed_at = now(),
      delete_after = ${deleteAfter.toISOString()}
    WHERE subject_type = ${subject.type} AND subject_id = ${subject.id} AND status IN ('pending', 'stored')`);
}

/** Deletes the file and its key; the kind, reviewer, time and outcome stay. Safe to repeat. */
export async function deleteDocumentContent(deps: VaultDeps, documentId: string, reason: DeletedReason): Promise<void> {
  await deps.db.transaction((tx) => markDeleted(tx, documentId, reason));
  await purgeObject(deps, documentId);
}

/**
 * Deletes content that is due, uploads that never finished (an hour old) and files of abandoned applications,
 * and finishes any purge a crash interrupted. Returns how many documents it touched.
 */
export async function pruneDocuments(
  deps: VaultDeps,
  now: Date,
  isAbandoned: (subject: DocumentSubject) => Promise<boolean>,
): Promise<number> {
  const at = now.toISOString();
  const work = new Map<string, DeletedReason | null>();

  const due = await deps.db.execute<{ id: string }>(
    sql`SELECT id FROM identity_documents WHERE status <> 'deleted' AND delete_after <= ${at}`,
  );
  for (const r of due) work.set(r.id, 'decision_retention');

  const stuck = await deps.db.execute<{ id: string }>(
    sql`SELECT id FROM identity_documents WHERE status = 'pending' AND uploaded_at <= ${at}::timestamptz - interval '1 hour'`,
  );
  for (const r of stuck) if (!work.has(r.id)) work.set(r.id, 'upload_failed');

  const subjects = await deps.db.execute<{ subject_type: DocumentSubject['type']; subject_id: string }>(
    sql`SELECT DISTINCT subject_type, subject_id FROM identity_documents WHERE status = 'stored'`,
  );
  for (const s of subjects) {
    if (!(await isAbandoned({ type: s.subject_type, id: s.subject_id }))) continue;
    const docs = await deps.db.execute<{ id: string }>(sql`
      SELECT id FROM identity_documents
      WHERE subject_type = ${s.subject_type} AND subject_id = ${s.subject_id} AND status = 'stored'`);
    for (const r of docs) if (!work.has(r.id)) work.set(r.id, 'abandoned');
  }

  const leftovers = await deps.db.execute<{ id: string }>(
    sql`SELECT id FROM identity_documents WHERE status = 'deleted' AND storage_key IS NOT NULL`,
  );
  for (const r of leftovers) if (!work.has(r.id)) work.set(r.id, null);

  let done = 0;
  for (const [id, reason] of work) {
    try {
      if (reason) await deleteDocumentContent(deps, id, reason);
      else await purgeObject(deps, id);
      done += 1;
    } catch (error) {
      // Left for the next pass; the others must not wait behind it.
      console.error(`document sweep: could not delete ${id}`, error instanceof Error ? error.message : error);
    }
  }
  return done;
}
