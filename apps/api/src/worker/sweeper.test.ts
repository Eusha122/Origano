import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { pruneOtp, pruneSessions } from '../identity/retention';
import { pruneSms } from '../notifications/sms/retention';
import { withTestDb } from '../testing/db';
import { defaultSweepJobs, runSweepOnce, type SweepJob } from './sweeper';

const NOW = new Date('2026-12-01T12:00:00Z');
const ago = (interval: string) => sql.raw(`'${NOW.toISOString()}'::timestamptz - interval '${interval}'`);

describe('retention sweeper', () => {
  const { db } = withTestDb();

  const count = async (table: string, where = 'true'): Promise<number> => {
    const rows = await db.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`));
    return rows[0]?.n ?? -1;
  };

  it('forgets OTP events after 48 hours and spent challenges 24 hours after they expired', async () => {
    await db.execute(sql`
      INSERT INTO otp_events (kind, phone, ip_hash, created_at) VALUES
        ('send', '+8801711000001', 'h', ${ago('47 hours')}), ('send', '+8801711000001', 'h', ${ago('49 hours')})`);
    await db.execute(sql`
      INSERT INTO otp_challenges (phone, code_hash, expires_at) VALUES
        ('+8801711000001', 'x', ${ago('23 hours')}), ('+8801711000002', 'x', ${ago('25 hours')})`);
    expect(await pruneOtp(db, NOW)).toBe(2);
    expect(await count('otp_events')).toBe(1);
    expect(await count('otp_challenges')).toBe(1);
    expect(await pruneOtp(db, NOW)).toBe(0);
  });

  it('forgets tokens 7 days after they expired, and sessions 30 days after they ended', async () => {
    const user = (
      await db.execute<{ id: string }>(sql`INSERT INTO users (phone) VALUES ('+8801711000001') RETURNING id`)
    )[0]?.id as string;
    const session = async (revoked: string | null, absolute: string) =>
      (
        await db.execute<{ id: string }>(sql`
          INSERT INTO auth_sessions (user_id, client, absolute_expires_at, revoked_at)
          VALUES (${user}, 'native', ${sql.raw(`'${NOW.toISOString()}'::timestamptz + interval '${absolute}'`)},
            ${revoked === null ? null : ago(revoked)})
          RETURNING id`)
      )[0]?.id as string;
    const live = await session(null, '10 days');
    await session('29 days', '10 days'); // revoked recently: kept
    await session('31 days', '10 days'); // revoked long ago: deleted
    await session(null, '-31 days'); // expired long ago, never revoked: deleted
    let n = 0;
    const token = (kind: string, expires: string) =>
      db.execute(sql`
        INSERT INTO auth_tokens (session_id, kind, token_hash, expires_at)
        VALUES (${live}, ${kind}, ${`hash-${++n}`}, ${ago(expires)})`);
    await token('access', '6 days');
    await token('access', '8 days');
    await token('refresh', '9 days');
    expect(await pruneSessions(db, NOW)).toBeGreaterThanOrEqual(4);
    expect(await count('auth_sessions')).toBe(2);
    expect(await count('auth_tokens', `session_id = '${live}'`)).toBe(1);
    expect(await pruneSessions(db, NOW)).toBe(0);
  });

  it('drops SMS text once it has expired, and the rows themselves after 30 days', async () => {
    const msg = (age: string, expiresAgo: string, body: string | null, status: string) =>
      db.execute(sql`
        INSERT INTO sms_messages (id, purpose, phone, body_sealed, status, purge_after_send, created_at, expires_at)
        VALUES (gen_random_uuid(), 'otp', '+8801711000001', ${body}, ${status}, false, ${ago(age)}, ${ago(expiresAgo)})`);
    await msg('1 hour', '-5 minutes', 'sealed', 'queued'); // not yet expired: kept whole
    await msg('2 hours', '1 hour', 'sealed', 'sent'); // expired: text dropped
    await msg('31 days', '31 days', null, 'expired'); // old: deleted
    expect(await pruneSms(db, NOW)).toBe(2);
    expect(await count('sms_messages')).toBe(2);
    expect(await count('sms_messages', 'body_sealed IS NOT NULL')).toBe(1);
    expect(await pruneSms(db, NOW)).toBe(0);
  });

  it('one failing job does not stop the others, and the failure is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ran: string[] = [];
    const jobs: SweepJob[] = [
      { name: 'broken', run: async () => Promise.reject(new Error('nope')) },
      {
        name: 'fine',
        run: async () => {
          ran.push('fine');
          return 3;
        },
      },
    ];
    expect(await runSweepOnce(db, jobs, NOW)).toEqual({ broken: 0, fine: 3 });
    expect(ran).toEqual(['fine']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('broken'), expect.anything());
    error.mockRestore();
  });

  it('the default jobs run together without error on an empty database', async () => {
    const result = await runSweepOnce(db, defaultSweepJobs(), NOW);
    expect(Object.keys(result).sort()).toEqual(['otp', 'sessions', 'sms']);
    expect(Object.values(result)).toEqual([0, 0, 0]);
  });
});
