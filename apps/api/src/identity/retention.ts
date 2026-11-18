import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

const at = (now: Date) => sql`${now.toISOString()}::timestamptz`;

/** OTP events are kept 48 hours (the longest window the limits look at is 24), spent challenges a day past expiry. */
export async function pruneOtp(db: Db, now: Date): Promise<number> {
  const events = await db.execute(
    sql`DELETE FROM otp_events WHERE created_at < ${at(now)} - interval '48 hours' RETURNING id`,
  );
  const challenges = await db.execute(
    sql`DELETE FROM otp_challenges WHERE expires_at < ${at(now)} - interval '24 hours' RETURNING phone`,
  );
  return events.length + challenges.length;
}

/**
 * Tokens are kept 7 days after they expire, and sessions 30 days after they were revoked or ran out. A session
 * that is still live is never touched, and deleting a session takes its tokens with it.
 */
export async function pruneSessions(db: Db, now: Date): Promise<number> {
  const tokens = await db.execute(
    sql`DELETE FROM auth_tokens WHERE expires_at < ${at(now)} - interval '7 days' RETURNING id`,
  );
  const sessions = await db.execute(sql`
    DELETE FROM auth_sessions
    WHERE revoked_at < ${at(now)} - interval '30 days'
       OR (revoked_at IS NULL AND absolute_expires_at < ${at(now)} - interval '30 days')
    RETURNING id`);
  return tokens.length + sessions.length;
}
