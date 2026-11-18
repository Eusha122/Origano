import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Config, loadConfig } from '../config';
import { AppError } from '../errors';
import { unwrapDataKey } from '../security/crypto';
import { withTestDb } from '../testing/db';
import { TEST_DATA_KEYS } from '../testing/keys';
import { createS3Store } from './store';
import {
  type DocumentSubject,
  deleteDocumentContent,
  listDocuments,
  pruneDocuments,
  readDocument,
  recordDecision,
  storeDocument,
  type VaultDeps,
} from './vault';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Buffer => readFileSync(join(here, 'fixtures', name));

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost/x',
  REDIS_URL: 'redis://localhost:6379',
  OTP_SECRET: 'test-only-otp-secret-0123456789abcdef',
  DATA_KEYS: TEST_DATA_KEYS,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: 'oregano-test',
});

const storeOf = createS3Store(config.s3);
const SUBJECT: DocumentSubject = { type: 'rider', id: randomUUID() };
const UPLOADER = randomUUID();

describe('document vault', () => {
  const { db } = withTestDb();
  const deps = (): VaultDeps => ({ db, store: storeOf, keys: config.dataKeys });

  beforeAll(async () => {
    await storeOf.ensureBucket();
  });

  const rows = () =>
    db.execute<{
      id: string;
      status: string;
      storage_key: string | null;
      sealed_key: unknown;
      deleted_reason: string | null;
      kind: string;
      review_outcome: string | null;
      reviewed_by: string | null;
    }>(sql`SELECT * FROM identity_documents ORDER BY uploaded_at`);

  it('stores a phone photo encrypted, with no metadata, and reads it back as a small JPEG', async () => {
    const summary = await storeDocument(deps(), SUBJECT, 'nid_front', fixture('ok.jpg'), UPLOADER);
    expect(summary).toMatchObject({ kind: 'nid_front', status: 'stored' });

    const [row] = await rows();
    expect(row?.storage_key).toMatch(/^docs\/[0-9a-f-]{36}$/);
    const raw = await storeOf.get(row?.storage_key ?? '');
    expect(raw.subarray(0, 3).toString('hex')).not.toBe('ffd8ff');
    expect(raw.includes(Buffer.from('FixturePhone'))).toBe(false);

    const read = await readDocument(deps(), summary.id);
    if (!Buffer.isBuffer(read)) throw new Error('expected bytes');
    expect(read.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const meta = await sharp(read).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2000);
    expect(meta.format).toBe('jpeg');
  });

  it('accepts PNG and WebP', async () => {
    await storeDocument(deps(), SUBJECT, 'nid_front', fixture('ok.png'), UPLOADER);
    await storeDocument(deps(), SUBJECT, 'nid_back', fixture('ok.webp'), UPLOADER);
    expect((await listDocuments(db, SUBJECT)).filter((d) => d.status === 'stored')).toHaveLength(2);
  });

  it('refuses a PDF renamed to .jpg and writes nothing', async () => {
    await expect(storeDocument(deps(), SUBJECT, 'nid_front', fixture('fake.jpg'), UPLOADER)).rejects.toMatchObject({
      code: 'unsupported_document',
    });
    expect(await rows()).toHaveLength(0);
  });

  it('never keeps HTML hidden behind JPEG magic bytes', async () => {
    try {
      const summary = await storeDocument(deps(), SUBJECT, 'nid_front', fixture('polyglot.jpg'), UPLOADER);
      const read = await readDocument(deps(), summary.id);
      expect(Buffer.isBuffer(read) && read.includes(Buffer.from('<html'))).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('unsupported_document');
    }
  });

  it('refuses a pixel bomb', async () => {
    await expect(storeDocument(deps(), SUBJECT, 'nid_front', fixture('bomb.png'), UPLOADER)).rejects.toMatchObject({
      code: 'unsupported_document',
    });
    expect(await rows()).toHaveLength(0);
  });

  it('refuses a body over 8 MB', async () => {
    const big = Buffer.concat([fixture('ok.jpg').subarray(0, 4), Buffer.alloc(8 * 1024 * 1024 + 1)]);
    await expect(storeDocument(deps(), SUBJECT, 'nid_front', big, UPLOADER)).rejects.toMatchObject({
      code: 'document_too_large',
    });
  });

  it('keeps exactly one stored document per kind: a second upload replaces the first and deletes its object', async () => {
    const first = await storeDocument(deps(), SUBJECT, 'photo', fixture('ok.jpg'), UPLOADER);
    const [before] = await rows();
    const second = await storeDocument(deps(), SUBJECT, 'photo', fixture('ok.png'), UPLOADER);
    const all = await rows();
    expect(all.filter((r) => r.status === 'stored')).toHaveLength(1);
    const old = all.find((r) => r.id === first.id);
    expect(old).toMatchObject({ status: 'deleted', deleted_reason: 'replaced', storage_key: null, sealed_key: null });
    await expect(storeOf.get(before?.storage_key ?? '')).rejects.toThrow();
    expect(all.find((r) => r.id === second.id)?.status).toBe('stored');
  });

  it('deleteDocumentContent removes the object, keeps the review facts, and is safe to repeat', async () => {
    const summary = await storeDocument(deps(), SUBJECT, 'nid_front', fixture('ok.jpg'), UPLOADER);
    const reviewer = randomUUID();
    await recordDecision(db, SUBJECT, 'accepted', reviewer, new Date(Date.now() + 7 * 86_400_000));
    const [stored] = await rows();
    await deleteDocumentContent(deps(), summary.id, 'decision_retention');
    await deleteDocumentContent(deps(), summary.id, 'decision_retention');
    const [after] = await rows();
    expect(after).toMatchObject({
      status: 'deleted',
      storage_key: null,
      sealed_key: null,
      kind: 'nid_front',
      reviewed_by: reviewer,
      review_outcome: 'accepted',
      deleted_reason: 'decision_retention',
    });
    await expect(storeOf.get(stored?.storage_key ?? '')).rejects.toThrow();
    expect(await readDocument(deps(), summary.id)).toBe('deleted');
    const audits = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'document.deleted'`,
    );
    expect(audits[0]?.n).toBe(1);
  });

  it('readDocument gives null for an id it does not know', async () => {
    expect(await readDocument(deps(), randomUUID())).toBeNull();
  });

  it('pruneDocuments deletes what is due, what never finished uploading, and what is abandoned; it keeps the rest', async () => {
    const due = await storeDocument(deps(), SUBJECT, 'nid_front', fixture('ok.jpg'), UPLOADER);
    const fresh = await storeDocument(deps(), SUBJECT, 'nid_back', fixture('ok.jpg'), UPLOADER);
    const abandonedSubject: DocumentSubject = { type: 'restaurant_application', id: randomUUID() };
    const abandoned = await storeDocument(deps(), abandonedSubject, 'trade_licence', fixture('ok.jpg'), UPLOADER);
    const stuckId = randomUUID();
    await db.execute(sql`INSERT INTO identity_documents (id, subject_type, subject_id, kind, status, storage_key, uploaded_by, uploaded_at)
      VALUES (${stuckId}, 'rider', ${SUBJECT.id}, 'photo', 'pending', ${`docs/${stuckId}`}, ${UPLOADER}, now() - interval '2 hours')`);
    const freshPending = randomUUID();
    await db.execute(sql`INSERT INTO identity_documents (id, subject_type, subject_id, kind, status, storage_key, uploaded_by)
      VALUES (${freshPending}, 'rider', ${SUBJECT.id}, 'owner_nid_back', 'pending', ${`docs/${freshPending}`}, ${UPLOADER})`);
    await db.execute(
      sql`UPDATE identity_documents SET delete_after = now() - interval '1 minute' WHERE id = ${due.id}`,
    );

    const count = await pruneDocuments(deps(), new Date(), async (s) => s.id === abandonedSubject.id);
    expect(count).toBe(3);

    const status = Object.fromEntries((await rows()).map((r) => [r.id, [r.status, r.deleted_reason]]));
    expect(status[due.id]).toEqual(['deleted', 'decision_retention']);
    expect(status[stuckId]).toEqual(['deleted', 'upload_failed']);
    expect(status[abandoned.id]).toEqual(['deleted', 'abandoned']);
    expect(status[fresh.id]?.[0]).toBe('stored');
    expect(status[freshPending]?.[0]).toBe('pending');
  });

  it('cannot unwrap a stored key with a different master key', async () => {
    await storeDocument(deps(), SUBJECT, 'nid_front', fixture('ok.jpg'), UPLOADER);
    const [row] = await rows();
    const other = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@localhost/x',
      REDIS_URL: 'redis://localhost:6379',
      OTP_SECRET: 'test-only-otp-secret-0123456789abcdef',
      DATA_KEYS: `test1:${Buffer.alloc(32, 9).toString('base64')}`,
    }) satisfies Config;
    const sealed = row?.sealed_key as { kid: string; wrappedKey: string };
    expect(() => unwrapDataKey(other.dataKeys, sealed, row?.id ?? '')).toThrow();
    expect(unwrapDataKey(config.dataKeys, sealed, row?.id ?? '')).toHaveLength(32);
  });
});
