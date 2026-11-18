import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

type Harness = ReturnType<typeof withTestApp>;

async function post(t: Harness, url: string, payload?: unknown, token?: string) {
  return t.app().inject({
    method: 'POST',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
    headers: token ? t.as(token) : {},
  });
}

describe('sign-in by OTP', () => {
  const t = withTestApp();

  it('signs a new customer in with the code that was sent', async () => {
    const requested = await post(t, '/v1/auth/otp/request', { phone: '017 1100 0099' });
    expect(requested.statusCode).toBe(202);
    // The harness runs the relaxed profile, which has no resend gap; otp-limits.test.ts pins 60.
    expect(requested.json()).toEqual({ expiresInSeconds: 300, resendInSeconds: 0 });

    const code = await t.otp.last('+8801711000099');
    expect(code).toMatch(/^[0-9]{6}$/);
    const verified = await post(t, '/v1/auth/otp/verify', { phone: '01711000099', code });
    expect(verified.statusCode).toBe(200);
    const body = verified.json();
    expect(body.user.phone).toBe('+8801711000099');
    expect(body.user.roles).toEqual(['customer']);
    expect(body.token.length).toBeGreaterThanOrEqual(43);

    const me = await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(body.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual(body.user);
  });

  it('gives the seeded owner, rider and admin their roles', async () => {
    const me = async (phone: string) => {
      const token = await t.signIn(phone);
      const res = await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) });
      return res.json();
    };
    const owner = await me('01711000002');
    expect(owner.roles).toContain('restaurant');
    expect(owner.restaurantIds).toEqual([t.demo().restaurantId]);
    const rider = await me('01711000003');
    expect(rider.roles).toContain('rider');
    expect(rider.rider.isOnline).toBe(false);
    expect(rider.rider.zoneId).toBe(t.demo().zoneId);
    const admin = await me('01711000004');
    expect(admin.roles).toContain('admin');
    const customer = await me('01711000001');
    expect(customer.roles).toEqual(['customer']);
    expect(customer.rider).toBeNull();
  });

  it('rejects a wrong code, then locks the code after five wrong tries', async () => {
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const code = (await t.otp.last('+8801711000001')) as string;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const res = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code: wrong });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('otp_invalid');
    }
    const fifth = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code: wrong });
    expect(fifth.statusCode).toBe(401);
    expect(fifth.json().error.code).toBe('otp_attempts_exceeded');
    const afterwards = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code });
    expect(afterwards.statusCode).toBe(401);
    expect(afterwards.json().error.code).toBe('otp_attempts_exceeded');
  });

  it('rejects an expired code', async () => {
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const code = await t.otp.last('+8801711000001');
    await t.db.execute(sql`UPDATE otp_challenges SET expires_at = now() - interval '1 second'`);
    const res = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('otp_expired');
  });

  it('a code works once', async () => {
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const code = await t.otp.last('+8801711000001');
    expect((await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code })).statusCode).toBe(200);
    expect((await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code })).statusCode).toBe(401);
  });

  it('a new request replaces the earlier code', async () => {
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const first = (await t.otp.last('+8801711000001')) as string;
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const second = (await t.otp.last('+8801711000001')) as string;
    const rows = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM otp_challenges`);
    expect(rows[0]?.n).toBe(1);
    if (first !== second) {
      expect((await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code: first })).statusCode).toBe(401);
    }
    expect((await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code: second })).statusCode).toBe(200);
  });

  it('stores neither codes nor tokens in plain text', async () => {
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const code = (await t.otp.last('+8801711000001')) as string;
    const verified = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code });
    const token = verified.json().token as string;
    const codes = await t.db.execute<{ code_hash: string }>(sql`SELECT code_hash FROM otp_challenges`);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.map((c) => c.code_hash)).not.toContain(code);
    const tokens = await t.db.execute<{ token_hash: string }>(sql`SELECT token_hash FROM sessions`);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((s) => s.token_hash)).not.toContain(token);
  });

  it('rejects foreign and malformed phone numbers', async () => {
    for (const phone of ['+447911123456', '12345']) {
      const res = await post(t, '/v1/auth/otp/request', { phone });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_phone');
    }
    const queued = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sms_messages`);
    expect(queued[0]?.n).toBe(0);
    const verify = await post(t, '/v1/auth/otp/verify', { phone: '12345', code: '123456' });
    expect(verify.json().error.code).toBe('invalid_phone');
  });

  it('answers a bad body with validation_failed', async () => {
    const res = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code: 'abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('answers a code for a phone with no challenge the same as a wrong code', async () => {
    const res = await post(t, '/v1/auth/otp/verify', { phone: '01711000001', code: '123456' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('otp_invalid');
  });

  it('logs out', async () => {
    const token = await t.signIn('01711000001');
    const out = await post(t, '/v1/auth/logout', undefined, token);
    expect(out.statusCode).toBe(204);
    const me = await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('unauthenticated');
  });

  it('an expired or unknown token is unauthenticated', async () => {
    const token = await t.signIn('01711000001');
    await t.db.execute(sql`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    const expired = await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) });
    expect(expired.statusCode).toBe(401);
    const unknown = await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as('not-a-real-token') });
    expect(unknown.statusCode).toBe(401);
    const none = await t.app().inject({ method: 'GET', url: '/v1/me' });
    expect(none.statusCode).toBe(401);
  });
});

describe('dev OTP peek disabled', () => {
  const t = withTestApp({ devOtpPeek: false });
  it('is not found', async () => {
    const res = await t.app().inject({ method: 'GET', url: '/v1/dev/otp/+8801711000001' });
    expect(res.statusCode).toBe(404);
  });
});

describe('dev OTP peek enabled', () => {
  const t = withTestApp({ devOtpPeek: true });
  it('returns the last code', async () => {
    await post(t, '/v1/auth/otp/request', { phone: '01711000001' });
    const res = await t.app().inject({ method: 'GET', url: '/v1/dev/otp/+8801711000001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ code: await t.otp.last('+8801711000001') });
  });
});
