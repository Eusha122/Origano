import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a document link works. */
export const DOCUMENT_TICKET_SECONDS = 300;

const sign = (key: Buffer, payload: string): Buffer => createHmac('sha256', key).update(payload).digest();

/** `base64url(payload).base64url(hmac)`: binds one document to one admin until `expiresAt`. */
export function issueDocumentTicket(key: Buffer, t: { documentId: string; adminId: string; expiresAt: Date }): string {
  const payload = Buffer.from(JSON.stringify({ d: t.documentId, a: t.adminId, e: t.expiresAt.getTime() })).toString(
    'base64url',
  );
  return `${payload}.${sign(key, payload).toString('base64url')}`;
}

/** True only for an untampered ticket made for this document and this admin that has not expired. */
export function checkDocumentTicket(
  key: Buffer,
  ticket: string,
  documentId: string,
  adminId: string,
  now: Date,
): boolean {
  const [payload, mac, extra] = ticket.split('.');
  if (!payload || !mac || extra !== undefined) return false;
  const given = Buffer.from(mac, 'base64url');
  const expected = sign(key, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      d?: unknown;
      a?: unknown;
      e?: unknown;
    };
    return claims.d === documentId && claims.a === adminId && typeof claims.e === 'number' && claims.e > now.getTime();
  } catch {
    return false;
  }
}
