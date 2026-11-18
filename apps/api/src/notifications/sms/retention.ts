import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';

const at = (now: Date) => sql`${now.toISOString()}::timestamptz`;

/** A sealed text is useless once its code has expired, so it goes; the row (no text) is deleted after 30 days. */
export async function pruneSms(db: Db, now: Date): Promise<number> {
  const dropped = await db.execute(sql`
    UPDATE sms_messages SET body_sealed = NULL
    WHERE body_sealed IS NOT NULL AND expires_at <= ${at(now)} RETURNING id`);
  const deleted = await db.execute(
    sql`DELETE FROM sms_messages WHERE created_at < ${at(now)} - interval '30 days' RETURNING id`,
  );
  return dropped.length + deleted.length;
}
