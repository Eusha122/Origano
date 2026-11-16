import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { AppError } from '../errors';

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export function assertIdempotencyKey(key: string | undefined): string {
  if (key === undefined || !KEY.test(key)) {
    throw new AppError('idempotency_key_required', 400, 'An Idempotency-Key header of 8 to 64 characters is required.');
  }
  return key;
}

/** JSON with object keys sorted at every depth, so equal bodies hash equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Runs `run` at most once per (user, key). The key row and the work share one transaction: a concurrent
 * duplicate blocks on the key insert until the first commits, then gets the stored response.
 */
export async function withIdempotency<T>(
  db: Db,
  input: { userId: string; key: string | undefined; requestBody: unknown },
  run: (tx: Tx) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const key = assertIdempotencyKey(input.key);
  const hash = createHash('sha256').update(canonicalJson(input.requestBody)).digest('hex');
  return db.transaction(async (tx) => {
    const inserted = await tx.execute<{ key: string }>(sql`
      INSERT INTO idempotency_keys (user_id, key, request_hash)
      VALUES (${input.userId}, ${key}, ${hash})
      ON CONFLICT DO NOTHING
      RETURNING key`);
    if (inserted.length > 0) {
      const result = await run(tx);
      await tx.execute(sql`
        UPDATE idempotency_keys
        SET response_status = ${result.status}, response_body = ${JSON.stringify(result.body)}::jsonb
        WHERE user_id = ${input.userId} AND key = ${key}`);
      return result;
    }
    const rows = await tx.execute<{ request_hash: string; response_status: number | null; response_body: T }>(sql`
      SELECT request_hash, response_status, response_body
      FROM idempotency_keys WHERE user_id = ${input.userId} AND key = ${key}`);
    const stored = rows[0];
    if (!stored || stored.response_status === null) throw new Error('Idempotency key has no stored response');
    if (stored.request_hash !== hash) {
      throw new AppError('idempotency_key_reused', 422, 'This key was already used for a different order.');
    }
    return { status: stored.response_status, body: stored.response_body };
  });
}
