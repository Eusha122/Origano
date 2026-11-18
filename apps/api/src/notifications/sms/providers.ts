import type { BdPhone } from '@oregano/domain';
import { maskPhone } from '../../security/mask';
import { type SmsProvider, SmsSendError } from './types';

type Log = { info(message: string): void };

/** Development only: writes the text to the log. Production refuses to start with it (see config). */
export class LoggingSmsProvider implements SmsProvider {
  readonly name = 'log';
  private count = 0;

  constructor(private readonly log: Log) {}

  async send(phone: BdPhone, text: string): Promise<{ providerMessageId: string }> {
    this.log.info(`SMS to ${maskPhone(phone)}: ${text}`);
    return { providerMessageId: `log-${++this.count}` };
  }
}

/** Tests: keeps every message in memory, and can be told to fail. */
export class CapturingSmsProvider implements SmsProvider {
  readonly sent: { phone: string; text: string }[] = [];
  private failures = 0;

  constructor(readonly name = 'capture') {}

  failNext(times: number): void {
    this.failures = times;
  }

  async send(phone: BdPhone, text: string): Promise<{ providerMessageId: string }> {
    if (this.failures > 0) {
      this.failures--;
      throw new SmsSendError(this.name, true, 'simulated failure');
    }
    this.sent.push({ phone, text });
    return { providerMessageId: `${this.name}-${this.sent.length}` };
  }
}

/** The providers named in SMS_PROVIDERS, in order of preference. Real providers arrive in Task 21. */
export function createProviders(names: string[], log: Log): SmsProvider[] {
  return names.map((name) => {
    if (name === 'log') return new LoggingSmsProvider(log);
    throw new Error(`Unknown SMS provider "${name}"`);
  });
}
