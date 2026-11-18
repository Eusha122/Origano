import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { BdPhone } from '@oregano/domain';
import { type Locale, t } from '@oregano/i18n';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { AppError } from '../errors';
import { enqueueSms, type SmsDeps } from '../notifications/sms/queue';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

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

/**
 * Starts a challenge. Any earlier challenge for the phone is replaced. The SMS is queued in the same
 * transaction, so a code exists exactly when its message is on its way.
 */
export async function requestOtp(
  db: Db,
  deps: { secret: string; sms: SmsDeps; webOtpDomain: string | null },
  phone: BdPhone,
  locale: Locale = 'en',
): Promise<void> {
  const code = generateCode();
  const codeHash = hashCode(deps.secret, phone, code).toString('hex');
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM otp_challenges WHERE phone = ${phone}`);
    await tx.execute(sql`
      INSERT INTO otp_challenges (phone, code_hash, expires_at)
      VALUES (${phone}, ${codeHash}, now() + make_interval(secs => ${OTP_TTL_SECONDS}))`);
    await enqueueSms(tx, deps.sms, {
      purpose: 'otp',
      phone,
      text: otpText(locale, code, deps.webOtpDomain),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });
  });
}

type Challenge = { id: string; code_hash: string; attempts: number; consumed: boolean; expired: boolean };

const invalid = () => new AppError('otp_invalid', 401, 'That code is not right.');
const exceeded = () =>
  new AppError('otp_attempts_exceeded', 401, 'Too many wrong tries. Ask for a new code and try again.');

/**
 * Checks a code against the newest challenge for the phone. A wrong code is counted at once, outside
 * any later transaction, so a rejected code always uses up a try. Messages never reveal whether the
 * phone has an account.
 */
export async function checkOtp(
  db: Pick<Db, 'execute'>,
  secret: string,
  phone: BdPhone,
  code: string,
): Promise<{ challengeId: string }> {
  const rows = await db.execute<Challenge>(sql`
    SELECT id, code_hash, attempts, consumed_at IS NOT NULL AS consumed, expires_at <= now() AS expired
    FROM otp_challenges WHERE phone = ${phone}
    ORDER BY created_at DESC LIMIT 1`);
  const challenge = rows[0];
  if (!challenge) throw invalid();
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw exceeded();
  if (challenge.consumed) throw invalid();
  if (challenge.expired) throw new AppError('otp_expired', 401, 'That code has expired. Ask for a new one.');

  const expected = Buffer.from(challenge.code_hash, 'hex');
  const actual = hashCode(secret, phone, code);
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    const updated = await db.execute<{ attempts: number }>(sql`
      UPDATE otp_challenges
      SET attempts = attempts + 1,
          consumed_at = CASE WHEN attempts + 1 >= ${OTP_MAX_ATTEMPTS} THEN now() ELSE consumed_at END
      WHERE id = ${challenge.id} AND consumed_at IS NULL AND attempts < ${OTP_MAX_ATTEMPTS}
      RETURNING attempts`);
    const attempts = updated[0]?.attempts;
    if (attempts !== undefined && attempts >= OTP_MAX_ATTEMPTS) throw exceeded();
    throw invalid();
  }
  return { challengeId: challenge.id };
}

/** Marks the challenge used. Only one of two simultaneous correct submissions can win. */
export async function consumeChallenge(db: Pick<Db, 'execute'>, challengeId: string): Promise<void> {
  const consumed = await db.execute(sql`
    UPDATE otp_challenges SET consumed_at = now() WHERE id = ${challengeId} AND consumed_at IS NULL RETURNING id`);
  if (consumed.length === 0) throw invalid();
}
