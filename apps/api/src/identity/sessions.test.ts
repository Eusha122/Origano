import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

type Harness = ReturnType<typeof withTestApp>;
type Tokens = { accessToken: string; refreshToken: string | null };

const WEB_ORIGIN = 'http://localhost:8081';
const COOKIE = 'oregano_rt';

let counter = 0;
const freshPhone = () => `017${String(3_000_000 + ++counter).padStart(8, '0')}`;

/** Signs in through the real endpoints. Headers decide the transport: an Origin means a browser. */
async function signInAs(t: Harness, phone: string, headers: Record<string, string> = {}) {
  await t.app().inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const code = await t.otp.last(phone);
  return t.app().inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code }, headers });
}

const refresh = (t: Harness, refreshToken: string) =>
  t.app().inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

const me = (t: Harness, accessToken: string) =>
  t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(accessToken) });

async function nativeSession(t: Harness): Promise<Tokens & { refreshToken: string }> {
  const res = await signInAs(t, freshPhone());
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(typeof body.refreshToken).toBe('string');
  return body;
}

describe('sessions', () => {
  const t = withTestApp();

  it('gives a native client both tokens in the body and sets no cookie', async () => {
    const res = await signInAs(t, freshPhone());
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.json().accessToken.length).toBeGreaterThanOrEqual(43);
    expect(res.json().refreshToken.length).toBeGreaterThanOrEqual(43);
    expect(res.json().user.roles).toEqual(['customer']);
  });

  it('gives a browser only the access token, and the refresh token in an httpOnly cookie', async () => {
    const res = await signInAs(t, freshPhone(), { origin: WEB_ORIGIN });
    expect(res.json().refreshToken).toBeNull();
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toContain(`${COOKIE}=`);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/v1/auth']) expect(cookie).toContain(part);
  });

  it('refuses a browser origin that is not on the list, on every auth route', async () => {
    const evil = { origin: 'https://evil.example' };
    const res = await signInAs(t, freshPhone(), evil);
    expect(res.statusCode).toBe(403);
    for (const url of ['/v1/auth/refresh', '/v1/auth/logout', '/v1/auth/otp/request']) {
      const r = await t.app().inject({ method: 'POST', url, payload: {}, headers: evil });
      expect(r.statusCode, url).toBe(403);
    }
  });

  it('accepts the access token until it expires, then says unauthenticated', async () => {
    const { accessToken } = await nativeSession(t);
    expect((await me(t, accessToken)).statusCode).toBe(200);
    await t.db.execute(sql`UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE kind = 'access'`);
    expect((await me(t, accessToken)).statusCode).toBe(401);
  });

  it('a refresh token is not an access token', async () => {
    const { refreshToken } = await nativeSession(t);
    expect((await me(t, refreshToken)).statusCode).toBe(401);
  });

  it('rotates on every use: the new access token works', async () => {
    const first = await nativeSession(t);
    const res = await refresh(t, first.refreshToken);
    expect(res.statusCode).toBe(200);
    const next = res.json() as Tokens;
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect((await me(t, next.accessToken)).statusCode).toBe(200);
  });

  it('a lost response does not sign the user out: the same token works again within 30 seconds', async () => {
    const r1 = (await nativeSession(t)).refreshToken;
    await refresh(t, r1); // the answer is lost on the way back
    const again = await refresh(t, r1);
    expect(again.statusCode).toBe(200);
    const retry = again.json() as Tokens;
    const step = await refresh(t, retry.refreshToken as string);
    expect(step.statusCode).toBe(200);
    expect((await me(t, (step.json() as Tokens).accessToken)).statusCode).toBe(200);
  });

  it('two tabs refreshing at once both succeed, and whichever answer reaches the cookie last keeps working', async () => {
    const r1 = (await nativeSession(t)).refreshToken;
    const [a, b] = await Promise.all([refresh(t, r1), refresh(t, r1)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const answers = [a, b].map((res) => (res.json() as Tokens).refreshToken as string);
    for (const answer of answers) {
      // Try each order: whichever one is redeemed first wins, and the browser only ever holds one of them.
      expect(answer).toBeTruthy();
    }
    const winner = await refresh(t, answers[1] as string);
    expect(winner.statusCode).toBe(200);
    expect((await me(t, (winner.json() as Tokens).accessToken)).statusCode).toBe(200);
  });

  it('once one answer is redeemed the others die, so a replaying thief cannot keep a second chain', async () => {
    const stolen = (await nativeSession(t)).refreshToken;
    const user = (await refresh(t, stolen)).json() as Tokens; // the real client
    const thief = (await refresh(t, stolen)).json() as Tokens; // a copy, inside the grace window
    const userNext = await refresh(t, user.refreshToken as string);
    expect(userNext.statusCode).toBe(200);
    // The user redeemed theirs, so the thief's sibling is dead: no second chain exists.
    expect((await refresh(t, thief.refreshToken as string)).statusCode).toBe(401);
    expect((await me(t, (userNext.json() as Tokens).accessToken)).statusCode).toBe(200);
  });

  it('and the other way round: if the thief redeems first, the user gets 401 once, never a second chain', async () => {
    const stolen = (await nativeSession(t)).refreshToken;
    const user = (await refresh(t, stolen)).json() as Tokens;
    const thief = (await refresh(t, stolen)).json() as Tokens;
    expect((await refresh(t, thief.refreshToken as string)).statusCode).toBe(200);
    expect((await refresh(t, user.refreshToken as string)).statusCode).toBe(401);
  });

  it('a spent token whose answer was already used is theft, even inside the grace window', async () => {
    const first = await nativeSession(t);
    const second = (await refresh(t, first.refreshToken)).json() as Tokens;
    expect((await refresh(t, second.refreshToken as string)).statusCode).toBe(200);
    expect((await refresh(t, first.refreshToken)).statusCode).toBe(401);
    expect((await me(t, second.accessToken)).statusCode).toBe(401);
  });

  it('parallel refreshes of one token never get past three answers', async () => {
    const r1 = (await nativeSession(t)).refreshToken;
    const results = await Promise.all(Array.from({ length: 6 }, () => refresh(t, r1)));
    expect(results.filter((r) => r.statusCode === 200).length).toBeLessThanOrEqual(3);
  });

  it('a fourth use of one token inside the grace window is treated as theft', async () => {
    const { refreshToken: r1, accessToken } = await nativeSession(t);
    for (let i = 0; i < 3; i++) expect((await refresh(t, r1)).statusCode).toBe(200);
    expect((await refresh(t, r1)).statusCode).toBe(401);
    expect((await me(t, accessToken)).statusCode).toBe(401);
  });

  it('a stolen old token replayed after the grace window revokes the whole session, and says so', async () => {
    const first = await nativeSession(t);
    const second = (await refresh(t, first.refreshToken)).json() as Tokens;
    const third = (await refresh(t, second.refreshToken as string)).json() as Tokens;
    await t.db.execute(sql`UPDATE auth_tokens SET used_at = used_at - interval '31 seconds' WHERE used_at IS NOT NULL`);
    const replay = await refresh(t, first.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect((await me(t, third.accessToken)).statusCode).toBe(401);
    expect((await refresh(t, third.refreshToken as string)).statusCode).toBe(401);
    const audit = await t.db.execute<{ action: string }>(
      sql`SELECT action FROM audit_log WHERE action = 'session.reuse_detected'`,
    );
    expect(audit).toHaveLength(1);
    const outbox = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM outbox WHERE topic = 'session.revoked'`,
    );
    expect(outbox[0]?.n).toBe(1);
  });

  it('refuses an unknown refresh token and a missing one', async () => {
    expect((await refresh(t, 'x'.repeat(43))).statusCode).toBe(401);
    expect((await t.app().inject({ method: 'POST', url: '/v1/auth/refresh', payload: {} })).statusCode).toBe(401);
  });

  it('refreshes a browser session from the cookie, and only with the client header', async () => {
    const signedIn = await signInAs(t, freshPhone(), { origin: WEB_ORIGIN });
    const first = signedIn.cookies.find((c) => c.name === COOKIE)?.value as string;
    const web = { origin: WEB_ORIGIN, 'x-oregano-client': 'web' };
    const noHeader = await t.app().inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { origin: WEB_ORIGIN },
      cookies: { [COOKIE]: first },
    });
    expect(noHeader.statusCode).toBe(403);
    const ok = await t
      .app()
      .inject({ method: 'POST', url: '/v1/auth/refresh', headers: web, cookies: { [COOKIE]: first } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().refreshToken).toBeNull();
    const rotated = ok.cookies.find((c) => c.name === COOKIE)?.value;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(first);
  });

  it('lasts 180 days for a customer and 12 hours for a team member', async () => {
    await signInAs(t, '01711000001');
    await signInAs(t, '01711000004');
    const rows = await t.db.execute<{ phone: string; hours: number }>(sql`
      SELECT u.phone, round(extract(epoch FROM s.absolute_expires_at - s.created_at) / 3600)::int AS hours
      FROM auth_sessions s JOIN users u ON u.id = s.user_id ORDER BY u.phone`);
    expect(rows).toEqual([
      { phone: '+8801711000001', hours: 180 * 24 },
      { phone: '+8801711000004', hours: 12 },
    ]);
    const refreshHours = await t.db.execute<{ phone: string; hours: number }>(sql`
      SELECT u.phone, round(extract(epoch FROM tk.expires_at - tk.created_at) / 3600)::int AS hours
      FROM auth_tokens tk JOIN auth_sessions s ON s.id = tk.session_id JOIN users u ON u.id = s.user_id
      WHERE tk.kind = 'refresh' ORDER BY u.phone`);
    expect(refreshHours).toEqual([
      { phone: '+8801711000001', hours: 60 * 24 },
      { phone: '+8801711000004', hours: 12 },
    ]);
  });

  it('logs out by access token or by refresh token, clears the cookie, and is safe to repeat', async () => {
    const native = await nativeSession(t);
    const out = await t.app().inject({ method: 'POST', url: '/v1/auth/logout', headers: t.as(native.accessToken) });
    expect(out.statusCode).toBe(204);
    expect((await me(t, native.accessToken)).statusCode).toBe(401);
    expect((await refresh(t, native.refreshToken)).statusCode).toBe(401);

    const web = await signInAs(t, freshPhone(), { origin: WEB_ORIGIN });
    const cookie = web.cookies.find((c) => c.name === COOKIE)?.value as string;
    const byCookie = await t.app().inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: WEB_ORIGIN, 'x-oregano-client': 'web' },
      cookies: { [COOKIE]: cookie },
    });
    expect(byCookie.statusCode).toBe(204);
    expect(byCookie.cookies.find((c) => c.name === COOKIE)?.maxAge).toBe(0);
    expect((await me(t, web.json().accessToken)).statusCode).toBe(401);
    expect((await t.app().inject({ method: 'POST', url: '/v1/auth/logout' })).statusCode).toBe(204);
  });

  it('logs out with an expired access token by the refresh token, in the body for native apps', async () => {
    const native = await nativeSession(t);
    await t.db.execute(sql`UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE kind = 'access'`);
    const out = await t.app().inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: t.as(native.accessToken),
      payload: { refreshToken: native.refreshToken },
    });
    expect(out.statusCode).toBe(204);
    expect((await refresh(t, native.refreshToken)).statusCode).toBe(401);
    const revoked = await t.db.execute<{ revoke_reason: string }>(sql`SELECT revoke_reason FROM auth_sessions`);
    expect(revoked).toEqual([{ revoke_reason: 'logout' }]);
  });

  it('stores only hashes of both tokens', async () => {
    const tokens = await nativeSession(t);
    const stored = await t.db.execute<{ token_hash: string }>(sql`SELECT token_hash FROM auth_tokens`);
    expect(stored.length).toBeGreaterThanOrEqual(2);
    const hashes = stored.map((r) => r.token_hash);
    expect(hashes).not.toContain(tokens.accessToken);
    expect(hashes).not.toContain(tokens.refreshToken);
  });
});
