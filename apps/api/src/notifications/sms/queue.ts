import { randomUUID } from 'node:crypto';
import type { BdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Db, Executor } from '../../db/client';
import { openString, sealString } from '../../security/crypto';
import { maskPhone } from '../../security/mask';
import type { SmsProvider } from './types';

export type SmsDeps = {
  keys: Config['dataKeys'];
  /** Keep the sealed text after sending, until it expires. Only for the development peek route. */
  retainUntilExpiry: boolean;
};

/** Call inside the transaction that decided the message must go out. Returns the message id. */
export async function enqueueSms(
  tx: Executor,
  deps: SmsDeps,
  msg: { purpose: 'otp'; phone: BdPhone; text: string; expiresAt: Date },
): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    INSERT INTO sms_messages (id, purpose, phone, body_sealed, purge_after_send, expires_at)
    VALUES (${id}, ${msg.purpose}, ${msg.phone}, ${sealString(deps.keys, msg.text, id)},
      ${!deps.retainUntilExpiry}, ${msg.expiresAt.toISOString()})`);
  return id;
}

type DueRow = { id: string; phone: BdPhone; body_sealed: string | null; attempts: number; expired: boolean };

const BACKOFF_SECONDS = [2, 5, 15];
const BREAKER_FAILURES = 3;
const BREAKER_SECONDS = 60;

export type ProviderHealth = Map<string, { failures: number; openUntil: number }>;

type DispatchDeps = {
  keys: Config['dataKeys'];
  providers: SmsProvider[];
  /** Per provider, how long one send may take. */
  timeoutMs?: number;
  /** Remembers failing providers between calls. A fresh map each call means no memory. */
  health?: ProviderHealth;
  log?: { warn(message: string): void };
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The SMS provider timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sends the next batch of due messages. Several dispatchers can run at once: SKIP LOCKED gives each its
 * own rows. A provider that failed three times in a row is skipped for a minute, unless all are failing.
 */
export function dispatchSmsOnce(db: Db, deps: DispatchDeps, batch = 10): Promise<number> {
  const timeoutMs = deps.timeoutMs ?? 5000;
  const health: ProviderHealth = deps.health ?? new Map();

  return db.transaction(async (tx) => {
    const due = await tx.execute<DueRow>(sql`
      SELECT id, phone, body_sealed, attempts, expires_at <= now() AS expired
      FROM sms_messages
      WHERE status = 'queued' AND next_attempt_at <= now()
      ORDER BY next_attempt_at LIMIT ${batch} FOR UPDATE SKIP LOCKED`);

    for (const message of due) {
      if (message.expired || message.body_sealed === null) {
        await tx.execute(sql`UPDATE sms_messages SET status = 'expired', body_sealed = NULL WHERE id = ${message.id}`);
        continue;
      }
      const text = openString(deps.keys, message.body_sealed, message.id);
      const now = Date.now();
      const open = deps.providers.filter((p) => (health.get(p.name)?.openUntil ?? 0) <= now);
      let sent: { provider: string; providerMessageId: string } | null = null;

      for (const provider of open.length > 0 ? open : deps.providers) {
        try {
          const result = await withTimeout(provider.send(message.phone, text), timeoutMs);
          health.delete(provider.name);
          sent = { provider: provider.name, providerMessageId: result.providerMessageId };
          break;
        } catch (error) {
          const failures = (health.get(provider.name)?.failures ?? 0) + 1;
          health.set(provider.name, {
            failures,
            openUntil: failures >= BREAKER_FAILURES ? Date.now() + BREAKER_SECONDS * 1000 : 0,
          });
          const reason = error instanceof Error ? error.message : 'error';
          deps.log?.warn(`sms provider ${provider.name} failed for ${maskPhone(message.phone)}: ${reason}`);
        }
      }

      if (sent) {
        await tx.execute(sql`
          UPDATE sms_messages
          SET status = 'sent', provider = ${sent.provider}, provider_message_id = ${sent.providerMessageId},
            sent_at = now(), attempts = attempts + 1,
            body_sealed = CASE WHEN purge_after_send THEN NULL ELSE body_sealed END
          WHERE id = ${message.id}`);
      } else {
        const wait = BACKOFF_SECONDS[Math.min(message.attempts, BACKOFF_SECONDS.length - 1)] ?? 15;
        await tx.execute(sql`
          UPDATE sms_messages
          SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => ${wait})
          WHERE id = ${message.id}`);
      }
    }
    return due.length;
  });
}

/** Polls the queue until stopped. Errors are logged and retried on the next tick. */
export function startSmsDispatcher(
  db: Db,
  deps: Omit<DispatchDeps, 'health'>,
  opts: { intervalMs?: number } = {},
): { stop: () => Promise<void> } {
  const intervalMs = opts.intervalMs ?? 250;
  const health: ProviderHealth = new Map();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();
  let failures = 0;
  let lastLogged = '';

  const tick = async (): Promise<void> => {
    try {
      let count: number;
      do {
        count = await dispatchSmsOnce(db, { ...deps, health });
      } while (count > 0 && !stopped);
      failures = 0;
      lastLogged = '';
    } catch (error) {
      failures++;
      // The database's own message is on the cause; the outer message repeats the whole query.
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      const reason = cause instanceof Error ? cause.message : 'unknown error';
      if (reason !== lastLogged) console.error(`sms dispatch failed, will retry: ${reason}`);
      lastLogged = reason;
    }
    if (!stopped) {
      const wait = Math.min(intervalMs * 2 ** Math.min(failures, 5), 5000);
      timer = setTimeout(() => {
        current = tick();
      }, wait);
    }
  };
  current = tick();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}

/** Development and tests: the newest message text for a phone, while its sealed text is still held. */
export async function peekLatestOtpText(
  db: Executor,
  keys: Config['dataKeys'],
  phone: BdPhone,
): Promise<string | null> {
  const rows = await db.execute<{ id: string; body_sealed: string }>(sql`
    SELECT id, body_sealed FROM sms_messages
    WHERE phone = ${phone} AND purpose = 'otp' AND body_sealed IS NOT NULL
    ORDER BY created_at DESC, id LIMIT 1`);
  const row = rows[0];
  return row ? openString(keys, row.body_sealed, row.id) : null;
}
