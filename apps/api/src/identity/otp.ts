import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { BdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { AppError } from '../errors';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

export interface OtpSender {
  send(phone: BdPhone, code: string): Promise<void>;
}

/** Development sender: writes the code to the log. Never use it where logs are shared. */
export class LoggingOtpSender implements OtpSender {
  private readonly remembered = new Map<string, string>();

  constructor(
    private readonly log: { info(message: string): void },
    private readonly remember = false,
  ) {}

  async send(phone: BdPhone, code: string): Promise<void> {
    if (this.remember) this.remembered.set(phone, code);
    this.log.info(`OTP for ${phone} is ${code}`);
  }

  /** Only answers when built with `remember`, which exists for the dev peek route. */
  last(phone: string): string | undefined {
    return this.remembered.get(phone);
  }
}

/** Test sender: keeps every code in memory. */
export class CapturingOtpSender implements OtpSender {
  readonly sent: { phone: string; code: string }[] = [];

  async send(phone: BdPhone, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }

  last(phone: string): string | undefined {
    return this.sent.findLast((entry) => entry.phone === phone)?.code;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC-SHA256 of the code, bound to the phone so a hash cannot be moved between numbers. */
export function hashCode(secret: string, phone: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest();
}

/** Starts a challenge. Any earlier challenge for the phone is replaced. */
export async function requestOtp(db: Db, secret: string, sender: OtpSender, phone: BdPhone): Promise<void> {
  const code = generateCode();
  const codeHash = hashCode(secret, phone, code).toString('hex');
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM otp_challenges WHERE phone = ${phone}`);
    await tx.execute(sql`
      INSERT INTO otp_challenges (phone, code_hash, expires_at)
      VALUES (${phone}, ${codeHash}, now() + make_interval(secs => ${OTP_TTL_SECONDS}))`);
  });
  await sender.send(phone, code);
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
