import type { BdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { withTestApp } from '../testing/app';
import { TEST_DATA_KEYS } from '../testing/keys';
import { verifyOtp } from './otp';
import { parseOtpCommand, unlockPhone } from './otp-cli';

type Harness = ReturnType<typeof withTestApp>;

const standardLimits = () =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost/x',
    REDIS_URL: 'redis://localhost',
    OTP_SECRET: 'x'.repeat(40),
    DATA_KEYS: TEST_DATA_KEYS,
  }).limits;

let counter = 0;
/** A fresh valid phone, so one test never collides with another. */
const freshPhone = () => `017${String(2_000_000 + ++counter).padStart(8, '0')}`;
const e164 = (local: string) => `+880${local.slice(1)}`;

const request = (t: Harness, phone: string, ip = '203.0.113.1', locale?: 'en' | 'bn') =>
  t.app().inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    payload: { phone, ...(locale ? { locale } : {}) },
    remoteAddress: ip,
  });

const verify = (t: Harness, phone: string, code: string, ip = '203.0.113.1') =>
  t.app().inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code }, remoteAddress: ip });

const wrongCode = (real: string | undefined) => (real === '000000' ? '111111' : '000000');

/** Pretend time has passed for everything the limits remember. */
const age = (t: Harness, interval: string) =>
  t.db.execute(sql.raw(`UPDATE otp_events SET created_at = created_at - interval '${interval}'`));

const codeOf = async (t: Harness, phone: string) => (await t.otp.last(phone)) as string;

describe('OTP limits (standard profile)', () => {
  const t = withTestApp({ limitsProfile: 'standard' });

  it('answers with the real lifetime and resend gap', async () => {
    const res = await request(t, freshPhone());
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ expiresInSeconds: 300, resendInSeconds: 60 });
  });

  it('refuses a second code within 60 seconds, with a Retry-After, and allows it after', async () => {
    const phone = freshPhone();
    expect((await request(t, phone)).statusCode).toBe(202);
    const early = await request(t, phone);
    expect(early.statusCode).toBe(429);
    expect(early.json().error.code).toBe('otp_resend_too_soon');
    const wait = Number(early.headers['retry-after']);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    await age(t, '61 seconds');
    expect((await request(t, phone)).statusCode).toBe(202);
  });

  it('caps sends per phone at 5 an hour', async () => {
    const phone = freshPhone();
    for (let i = 0; i < 5; i++) {
      expect((await request(t, phone, `198.51.100.${i + 1}`)).statusCode).toBe(202);
      await age(t, '61 seconds');
    }
    const sixth = await request(t, phone, '198.51.100.9');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('otp_rate_limited');
  });

  it('caps sends per IP at 20 an hour, across phones, but another IP is fine', async () => {
    for (let i = 0; i < 20; i++) expect((await request(t, freshPhone(), '192.0.2.50')).statusCode).toBe(202);
    const over = await request(t, freshPhone(), '192.0.2.50');
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('otp_rate_limited');
    expect((await request(t, freshPhone(), '192.0.2.51')).statusCode).toBe(202);
  });

  it('keeps the per-phone limits even when the IP changes', async () => {
    const phone = freshPhone();
    await request(t, phone, '192.0.2.60');
    const again = await request(t, phone, '192.0.2.61');
    expect(again.json().error.code).toBe('otp_resend_too_soon');
  });

  it('wrong-code counts survive a new code: ten wrong in a day locks the phone', async () => {
    const phone = freshPhone();
    for (let round = 0; round < 2; round++) {
      await request(t, phone);
      const wrong = wrongCode(await codeOf(t, phone));
      for (let i = 0; i < 5; i++) await verify(t, phone, wrong);
      await age(t, '61 seconds');
    }
    const code = await codeOf(t, phone);
    const locked = await verify(t, phone, code);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('otp_locked');
    const asking = await request(t, phone);
    expect(asking.statusCode).toBe(429);
    expect(asking.json().error.code).toBe('otp_locked');
  });

  it('locks a phone that is attacked from many addresses', async () => {
    const phone = freshPhone();
    let n = 0;
    for (let round = 0; round < 2; round++) {
      await request(t, phone, `203.0.113.${100 + round}`);
      const wrong = wrongCode(await codeOf(t, phone));
      for (let i = 0; i < 5; i++) await verify(t, phone, wrong, `198.18.${round}.${++n}`);
      await age(t, '61 seconds');
    }
    const res = await verify(t, phone, await codeOf(t, phone), '198.18.9.9');
    expect(res.json().error.code).toBe('otp_locked');
  });

  it('limits wrong guesses from one IP across many phones to 30 an hour', async () => {
    const phones = Array.from({ length: 31 }, freshPhone);
    for (const [i, phone] of phones.entries()) await request(t, phone, `198.51.100.${i + 1}`);
    for (const phone of phones.slice(0, 30)) {
      const res = await verify(t, phone, wrongCode(await codeOf(t, phone)), '192.0.2.70');
      expect(res.json().error.code).toBe('otp_invalid');
    }
    const next = await verify(t, phones[30] as string, wrongCode(await codeOf(t, phones[30] as string)), '192.0.2.70');
    expect(next.statusCode).toBe(429);
    expect(next.json().error.code).toBe('otp_rate_limited');
    const other = await verify(t, phones[30] as string, wrongCode(await codeOf(t, phones[30] as string)), '192.0.2.71');
    expect(other.json().error.code).toBe('otp_invalid');
  });

  it('answers alike, and charges nothing, for a number with no code, a used code and an unknown number', async () => {
    const used = freshPhone();
    await request(t, used);
    expect((await verify(t, used, await codeOf(t, used))).statusCode).toBe(200);
    const unknown = freshPhone();
    for (let i = 0; i < 40; i++) {
      for (const phone of [used, unknown]) {
        const res = await verify(t, phone, '123456', '192.0.2.72');
        expect([res.statusCode, res.json().error.code]).toEqual([401, 'otp_invalid']);
      }
    }
    const events = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM otp_events WHERE kind <> 'send'`,
    );
    expect(events[0]?.n).toBe(0);
    expect((await request(t, unknown, '192.0.2.73')).statusCode).toBe(202);
  });

  it('counts a whole IPv6 /64 as one address, so rotating inside it gains nothing', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await request(t, freshPhone(), `2001:db8:77:1::${(i + 1).toString(16)}`)).statusCode).toBe(202);
    }
    const next = await request(t, freshPhone(), '2001:db8:77:1:aaaa::9');
    expect(next.json().error.code).toBe('otp_rate_limited');
    expect((await request(t, freshPhone(), '2001:db8:77:2::1')).statusCode).toBe(202);
  });

  it('never lets parallel wrong guesses push a phone past the daily cap of ten', async () => {
    const phone = freshPhone();
    await t.db.execute(
      sql`INSERT INTO otp_events (kind, phone, ip_hash) SELECT 'failure', ${e164(phone)}, 'seed' FROM generate_series(1, 9)`,
    );
    await request(t, phone);
    const wrong = wrongCode(await codeOf(t, phone));
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => verify(t, phone, wrong, `198.18.50.${i + 1}`)),
    );
    const failures = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM otp_events WHERE kind = 'failure' AND phone = ${e164(phone)}`,
    );
    expect(failures[0]?.n).toBe(10);
    expect(results.filter((r) => r.json().error.code === 'otp_locked')).toHaveLength(4);
  });

  it('warns once, with the masked number, the moment a phone becomes locked', async () => {
    const phone = freshPhone();
    await t.db.execute(
      sql`INSERT INTO otp_events (kind, phone, ip_hash) SELECT 'failure', ${e164(phone)}, 'seed' FROM generate_series(1, 9)`,
    );
    await request(t, phone);
    const warnings: object[] = [];
    const log = { warn: (o: object) => void warnings.push(o), error: () => {} };
    const deps = { secret: 'test-only-otp-secret-0123456789abcdef', limits: standardLimits(), log };
    const attempt = verifyOtp(
      t.db,
      deps,
      { phone: e164(phone) as BdPhone, ipHash: 'x' },
      wrongCode(await codeOf(t, phone)),
    );
    await expect(attempt).rejects.toMatchObject({ code: 'otp_invalid' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ event: 'otp_phone_locked', phone: expect.stringMatching(/^\+8801\*+\d{3}$/) });
  });

  it('leaves exactly one challenge and one SMS when two requests race', async () => {
    const phone = freshPhone();
    const [a, b] = await Promise.all([request(t, phone, '192.0.2.80'), request(t, phone, '192.0.2.81')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 429]);
    const loser = a.statusCode === 429 ? a : b;
    expect(loser.json().error.code).toBe('otp_resend_too_soon');
    const rows = await t.db.execute<{ challenges: number; messages: number }>(sql`
      SELECT (SELECT count(*)::int FROM otp_challenges WHERE phone = ${e164(phone)}) AS challenges,
             (SELECT count(*)::int FROM sms_messages WHERE phone = ${e164(phone)}) AS messages`);
    expect(rows[0]).toEqual({ challenges: 1, messages: 1 });
  });

  it('lets only one of two simultaneous correct codes in', async () => {
    const phone = freshPhone();
    await request(t, phone);
    const code = await codeOf(t, phone);
    const results = await Promise.all([verify(t, phone, code), verify(t, phone, code)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('queues the code that the challenge holds, in the language asked for', async () => {
    const phone = freshPhone();
    await request(t, phone, '192.0.2.90', 'bn');
    const code = await codeOf(t, phone);
    const text = await t.db.execute<{ id: string }>(sql`SELECT id FROM sms_messages WHERE phone = ${e164(phone)}`);
    expect(text).toHaveLength(1);
    expect((await verify(t, phone, code, '192.0.2.90')).statusCode).toBe(200);
    const bn = await t.otp.lastText(phone);
    expect(bn).toContain('আপনার');
  });

  it('unlocks a locked phone only through the audited operator command', async () => {
    const phone = freshPhone();
    for (let round = 0; round < 2; round++) {
      await request(t, phone);
      const wrong = wrongCode(await codeOf(t, phone));
      for (let i = 0; i < 5; i++) await verify(t, phone, wrong);
      await age(t, '61 seconds');
    }
    expect((await request(t, phone)).json().error.code).toBe('otp_locked');
    expect(await unlockPhone(t.db, e164(phone) as never, 'Rina')).toBeGreaterThan(0);
    expect((await request(t, phone)).statusCode).toBe(202);
    const audit = await t.db.execute<{ actor_label: string }>(
      sql`SELECT actor_label FROM audit_log WHERE action = 'otp.unlocked'`,
    );
    expect(audit).toEqual([{ actor_label: 'Rina' }]);
  });
});

describe('OTP platform budget', () => {
  const t = withTestApp({ limitsProfile: 'standard', limits: { otpSendsGlobalHour: 3 } });

  it('stops sending when the whole platform has sent too many, and writes nothing for the refused one', async () => {
    for (let i = 0; i < 3; i++) expect((await request(t, freshPhone(), `192.0.2.${100 + i}`)).statusCode).toBe(202);
    const phone = freshPhone();
    const refused = await request(t, phone, '192.0.2.120');
    expect(refused.statusCode).toBe(503);
    expect(refused.json().error.code).toBe('sms_unavailable');
    const rows = await t.db.execute<{ challenges: number; messages: number }>(sql`
      SELECT (SELECT count(*)::int FROM otp_challenges WHERE phone = ${e164(phone)}) AS challenges,
             (SELECT count(*)::int FROM sms_messages WHERE phone = ${e164(phone)}) AS messages`);
    expect(rows[0]).toEqual({ challenges: 0, messages: 0 });
  });
});

describe('OTP per-phone daily cap', () => {
  const t = withTestApp({
    limitsProfile: 'standard',
    limits: { otpSendsPerPhoneHour: 100, otpSendsPerIpHour: 1000, otpSendsPerIpDay: 1000 },
  });

  it('caps sends per phone at 10 in 24 hours even when the hourly cap is not reached', async () => {
    const phone = freshPhone();
    for (let i = 0; i < 10; i++) {
      expect((await request(t, phone)).statusCode).toBe(202);
      await age(t, '61 seconds');
    }
    const eleventh = await request(t, phone);
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().error.code).toBe('otp_rate_limited');
  });
});

describe('OTP parallel sends from one address', () => {
  const t = withTestApp({ limitsProfile: 'standard', limits: { otpSendsPerIpHour: 5 } });

  it('lets exactly the hourly number through when requests for different phones arrive together', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => request(t, freshPhone(), '192.0.2.150')));
    expect(results.filter((r) => r.statusCode === 202)).toHaveLength(5);
    expect(results.filter((r) => r.json().error?.code === 'otp_rate_limited')).toHaveLength(7);
  });
});

describe('OTP per-IP daily cap', () => {
  const t = withTestApp({ limitsProfile: 'standard', limits: { otpSendsPerIpHour: 1000, otpSendsPerIpDay: 5 } });

  it('caps sends per IP at the daily number', async () => {
    for (let i = 0; i < 5; i++) expect((await request(t, freshPhone(), '192.0.2.200')).statusCode).toBe(202);
    expect((await request(t, freshPhone(), '192.0.2.200')).json().error.code).toBe('otp_rate_limited');
  });
});

describe('otp command line', () => {
  it('needs an operator name', () => {
    expect(parseOtpCommand(['unlock', '01711000099', '--operator', 'Rina'])).toEqual({
      kind: 'unlock',
      phone: '+8801711000099',
      operator: 'Rina',
    });
    for (const argv of [['unlock', '01711000099'], ['unlock', '123', '--operator', 'Rina'], ['lock']]) {
      expect(parseOtpCommand(argv), argv.join(' ')).toHaveProperty('error');
    }
  });
});
