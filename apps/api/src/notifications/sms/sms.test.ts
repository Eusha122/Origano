import { randomUUID } from 'node:crypto';
import type { BdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { maskPhone } from '../../security/mask';
import { withTestDb } from '../../testing/db';
import { TEST_DATA_KEYS } from '../../testing/keys';
import { CapturingSmsProvider, createProviders, LoggingSmsProvider } from './providers';
import { dispatchSmsOnce, enqueueSms, peekLatestOtpText } from './queue';
import type { SmsProvider } from './types';

const keys = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost/x',
  REDIS_URL: 'redis://localhost',
  OTP_SECRET: 'x'.repeat(40),
  DATA_KEYS: TEST_DATA_KEYS,
}).dataKeys;

const PHONE = '+8801711000001' as BdPhone;
const inFuture = (seconds: number) => new Date(Date.now() + seconds * 1000);

type Row = { status: string; attempts: number; provider: string | null; body_sealed: string | null; wait: number };
const row = async (db: ReturnType<typeof withTestDb>['db'], id: string): Promise<Row> => {
  const rows = await db.execute<Row>(sql`
    SELECT status, attempts, provider, body_sealed, extract(epoch FROM next_attempt_at - now())::float AS wait
    FROM sms_messages WHERE id = ${id}`);
  return rows[0] as Row;
};

describe('SMS queue', () => {
  const { db } = withTestDb();
  const deps = { keys, retainUntilExpiry: false };

  const queue = (text = 'Your code is 123456', over: Partial<typeof deps> = {}) =>
    enqueueSms(db, { ...deps, ...over }, { purpose: 'otp', phone: PHONE, text, expiresAt: inFuture(300) });

  it('stores no plain text', async () => {
    const id = await queue('Your code is 123456');
    const stored = (await row(db, id)).body_sealed;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('123456');
    expect(await peekLatestOtpText(db, keys, PHONE)).toBe('Your code is 123456');
  });

  it('sends once, records the provider and drops the plain text', async () => {
    const a = new CapturingSmsProvider('a');
    const id = await queue();
    expect(await dispatchSmsOnce(db, { keys, providers: [a] })).toBe(1);
    expect(a.sent).toEqual([{ phone: PHONE, text: 'Your code is 123456' }]);
    const after = await row(db, id);
    expect(after).toMatchObject({ status: 'sent', provider: 'a', body_sealed: null });
    expect(await dispatchSmsOnce(db, { keys, providers: [a] })).toBe(0);
  });

  it('keeps the sealed text after sending when asked to (the dev peek)', async () => {
    const id = await queue('Your code is 654321', { retainUntilExpiry: true });
    await dispatchSmsOnce(db, { keys, providers: [new CapturingSmsProvider('a')] });
    expect((await row(db, id)).body_sealed).not.toBeNull();
    expect(await peekLatestOtpText(db, keys, PHONE)).toBe('Your code is 654321');
  });

  it('falls over to the second provider when the first fails', async () => {
    const a = new CapturingSmsProvider('a');
    const b = new CapturingSmsProvider('b');
    a.failNext(1);
    const id = await queue();
    await dispatchSmsOnce(db, { keys, providers: [a, b] });
    expect(b.sent).toHaveLength(1);
    expect(await row(db, id)).toMatchObject({ status: 'sent', provider: 'b' });
  });

  it('retries later when every provider fails', async () => {
    const a = new CapturingSmsProvider('a');
    a.failNext(1);
    const id = await queue();
    await dispatchSmsOnce(db, { keys, providers: [a] });
    const after = await row(db, id);
    expect(after).toMatchObject({ status: 'queued', attempts: 1 });
    expect(after.wait).toBeGreaterThan(0.5);
    expect(after.wait).toBeLessThanOrEqual(2.1);
    expect(await dispatchSmsOnce(db, { keys, providers: [a] })).toBe(0);
  });

  it('never sends a message past its expiry, and drops its text', async () => {
    const a = new CapturingSmsProvider('a');
    const id = await queue();
    await db.execute(sql`UPDATE sms_messages SET expires_at = now() - interval '1 second' WHERE id = ${id}`);
    await dispatchSmsOnce(db, { keys, providers: [a] });
    expect(a.sent).toHaveLength(0);
    expect(await row(db, id)).toMatchObject({ status: 'expired', body_sealed: null });
  });

  it('sends each message exactly once when two dispatchers run at the same time', async () => {
    const a = new CapturingSmsProvider('a');
    for (let i = 0; i < 6; i++) await queue(`Your code is 00000${i}`);
    await Promise.all([
      dispatchSmsOnce(db, { keys, providers: [a] }, 3),
      dispatchSmsOnce(db, { keys, providers: [a] }, 3),
      dispatchSmsOnce(db, { keys, providers: [a] }, 3),
    ]);
    await dispatchSmsOnce(db, { keys, providers: [a] }, 10);
    expect(a.sent.map((m) => m.text).sort()).toEqual([0, 1, 2, 3, 4, 5].map((i) => `Your code is 00000${i}`));
  });

  it('counts a provider that hangs past the timeout as a failure', async () => {
    const hang: SmsProvider = { name: 'hang', send: () => new Promise(() => {}) };
    const b = new CapturingSmsProvider('b');
    const id = await queue();
    await dispatchSmsOnce(db, { keys, providers: [hang, b], timeoutMs: 50 });
    expect(await row(db, id)).toMatchObject({ status: 'sent', provider: 'b' });
  });

  it('peeks only the newest message for a phone, and nothing for another', async () => {
    await queue('Your code is 111111');
    await queue('Your code is 222222');
    expect(await peekLatestOtpText(db, keys, PHONE)).toBe('Your code is 222222');
    expect(await peekLatestOtpText(db, keys, '+8801711000002' as BdPhone)).toBeNull();
    void randomUUID;
  });
});

describe('providers', () => {
  it('builds the log provider, and refuses a name it does not know', () => {
    const log = { info: () => {} };
    expect(createProviders(['log'], log)[0]).toBeInstanceOf(LoggingSmsProvider);
    expect(() => createProviders(['nope'], log)).toThrow(/nope/);
  });

  it('masks phones for logs', () => {
    expect(maskPhone('+8801711000001')).toBe('+8801******001');
  });
});
