import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { BdPhone } from '@oregano/domain';
import { type Locale, t } from '@oregano/i18n';
import { sql } from 'drizzle-orm';
import type { Limits } from '../config';
import type { Db, Executor } from '../db/client';
import { AppError } from '../errors';
import { enqueueSms, type SmsDeps } from '../notifications/sms/queue';
import { maskPhone } from '../security/mask';

type Log = { warn(object: object, message: string): void; error(object: object, message: string): void };

export type OtpContext = { phone: BdPhone; ipHash: string };

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC-SHA256 of the code, bound to the phone so a hash cannot be moved between numbers. */
export function hashCode(secret: string, phone: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest();
}

/** The SMS text. With a web OTP domain, a last line lets Chrome on Android fill the code in. */
export function otpText(locale: Locale, code: string, webOtpDomain: string | null): string {
  const text = t(locale, 'sms.otp', { code });
  return webOtpDomain ? `${text}\n\n@${webOtpDomain} #${code}` : text;
}

const invalid = () => new AppError('otp_invalid', 401, 'That code is not right.');
const exceeded = () =>
  new AppError('otp_attempts_exceeded', 401, 'Too many wrong tries. Ask for a new code and try again.');
const locked = () =>
  new AppError(
    'otp_locked',
    429,
    'Too many wrong tries on this number. Try again tomorrow, or contact Oregano support.',
  );
const limited = () => new AppError('otp_rate_limited', 429, 'Too many codes asked for. Try again later.');

/** How many events of `kinds` match, inside a window counted by the database clock. */
async function countEvents(
  tx: Executor,
  where: { phone?: string; ipHash?: string },
  kinds: string[],
  window: string,
): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM otp_events
    WHERE kind IN (${sql.join(
      kinds.map((kind) => sql`${kind}`),
      sql`, `,
    )})
      AND created_at > now() - ${window}::interval
      AND (${where.phone ?? null}::text IS NULL OR phone = ${where.phone ?? null})
      AND (${where.ipHash ?? null}::text IS NULL OR ip_hash = ${where.ipHash ?? null})`);
  return rows[0]?.n ?? 0;
}

/**
 * Starts a challenge. A new code replaces the old one, and the SMS is queued in the same transaction, so a
 * code exists exactly when its message is on its way. The checks run under a per-phone lock, so two
 * simultaneous requests cannot both get past the resend gap.
 */
export async function requestOtp(
  db: Db,
  deps: { secret: string; limits: Limits; sms: SmsDeps; webOtpDomain: string | null; log?: Log },
  ctx: OtpContext & { locale: Locale },
): Promise<void> {
  const { phone, ipHash } = ctx;
  const { limits } = deps;
  const code = generateCode();
  const codeHash = hashCode(deps.secret, phone, code).toString('hex');

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`otp:${phone}`}))`);

    if ((await countEvents(tx, { phone }, ['failure'], '24 hours')) >= limits.otpFailuresPerPhoneDay) throw locked();

    const last = await tx.execute<{ wait: number }>(sql`
      SELECT ceil(${limits.otpResendSeconds}::int - extract(epoch FROM now() - max(created_at)))::int AS wait
      FROM otp_events WHERE kind = 'send' AND phone = ${phone}`);
    const wait = last[0]?.wait;
    if (wait !== null && wait !== undefined && wait > 0) {
      throw new AppError('otp_resend_too_soon', 429, 'Wait a moment before asking for another code.', wait);
    }

    if (
      (await countEvents(tx, { phone }, ['send'], '1 hour')) >= limits.otpSendsPerPhoneHour ||
      (await countEvents(tx, { phone }, ['send'], '24 hours')) >= limits.otpSendsPerPhoneDay ||
      (await countEvents(tx, { ipHash }, ['send'], '1 hour')) >= limits.otpSendsPerIpHour ||
      (await countEvents(tx, { ipHash }, ['send'], '24 hours')) >= limits.otpSendsPerIpDay
    ) {
      throw limited();
    }

    if ((await countEvents(tx, {}, ['send'], '1 hour')) >= limits.otpSendsGlobalHour) {
      deps.log?.error({ event: 'sms_budget_exceeded', limit: limits.otpSendsGlobalHour }, 'sms_budget_exceeded');
      throw new AppError('sms_unavailable', 503, 'We could not send a code right now. Try again in a few minutes.');
    }

    await tx.execute(sql`
      INSERT INTO otp_challenges (phone, code_hash, expires_at, attempts, consumed_at, created_at)
      VALUES (${phone}, ${codeHash}, now() + make_interval(secs => ${limits.otpTtlSeconds}), 0, NULL, now())
      ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
        attempts = 0, consumed_at = NULL, created_at = now()`);
    await tx.execute(sql`INSERT INTO otp_events (kind, phone, ip_hash) VALUES ('send', ${phone}, ${ipHash})`);
    await enqueueSms(tx, deps.sms, {
      purpose: 'otp',
      phone,
      text: otpText(ctx.locale, code, deps.webOtpDomain),
      expiresAt: new Date(Date.now() + limits.otpTtlSeconds * 1000),
    });
  });
}

type Challenge = { code_hash: string; attempts: number; consumed: boolean; expired: boolean };

/**
 * Checks a code. Wrong guesses are recorded in their own statement, outside any later transaction, so a
 * rejected code always uses up a try, and the counts outlive the code (a new code does not reset them).
 * Messages never reveal whether the phone has an account.
 */
export async function verifyOtp(
  db: Db,
  deps: { secret: string; limits: Limits; log?: Log },
  ctx: OtpContext,
  code: string,
): Promise<void> {
  const { phone, ipHash } = ctx;
  const { limits } = deps;

  if ((await countEvents(db, { ipHash }, ['failure', 'probe'], '1 hour')) >= limits.otpFailuresPerIpHour) {
    throw limited();
  }
  if ((await countEvents(db, { phone }, ['failure'], '24 hours')) >= limits.otpFailuresPerPhoneDay) throw locked();

  const rows = await db.execute<Challenge>(sql`
    SELECT code_hash, attempts, consumed_at IS NOT NULL AS consumed, expires_at <= now() AS expired
    FROM otp_challenges WHERE phone = ${phone}`);
  const challenge = rows[0];
  if (!challenge) {
    // Counts against the address only: guessing for a number that has no code must not lock that number.
    await db.execute(sql`INSERT INTO otp_events (kind, phone, ip_hash) VALUES ('probe', ${phone}, ${ipHash})`);
    throw invalid();
  }
  if (challenge.attempts >= limits.otpMaxAttempts) throw exceeded();
  if (challenge.consumed) throw invalid();
  if (challenge.expired) throw new AppError('otp_expired', 401, 'That code has expired. Ask for a new one.');

  const expected = Buffer.from(challenge.code_hash, 'hex');
  const actual = hashCode(deps.secret, phone, code);
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) return;

  const updated = await db.execute<{ attempts: number }>(sql`
    WITH bumped AS (
      UPDATE otp_challenges
      SET attempts = attempts + 1,
          consumed_at = CASE WHEN attempts + 1 >= ${limits.otpMaxAttempts} THEN now() ELSE consumed_at END
      WHERE phone = ${phone} AND consumed_at IS NULL AND attempts < ${limits.otpMaxAttempts}
      RETURNING attempts
    ), noted AS (
      INSERT INTO otp_events (kind, phone, ip_hash) SELECT 'failure', ${phone}, ${ipHash} FROM bumped
    )
    SELECT attempts FROM bumped`);
  const attempts = updated[0]?.attempts;
  if (attempts !== undefined) {
    const failures = await countEvents(db, { phone }, ['failure'], '24 hours');
    if (failures === limits.otpFailuresPerPhoneDay) {
      deps.log?.warn({ event: 'otp_phone_locked', phone: maskPhone(phone), ipHash }, 'otp_phone_locked');
    }
  }
  if (attempts !== undefined && attempts >= limits.otpMaxAttempts) throw exceeded();
  throw invalid();
}

/**
 * Marks the code used, atomically. Of two simultaneous correct submissions only one wins, and a code that
 * was replaced in the meantime no longer matches.
 */
export async function consumeChallenge(
  tx: Pick<Db, 'execute'>,
  secret: string,
  phone: BdPhone,
  code: string,
): Promise<void> {
  const codeHash = hashCode(secret, phone, code).toString('hex');
  const consumed = await tx.execute(sql`
    UPDATE otp_challenges SET consumed_at = now()
    WHERE phone = ${phone} AND code_hash = ${codeHash} AND consumed_at IS NULL AND expires_at > now()
    RETURNING phone`);
  if (consumed.length === 0) throw invalid();
}
