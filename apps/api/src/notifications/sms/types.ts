import type { BdPhone } from '@oregano/domain';

export interface SmsProvider {
  readonly name: string;
  send(phone: BdPhone, text: string): Promise<{ providerMessageId: string }>;
}

/** A provider could not send. `retryable` is false for a refusal that another attempt cannot fix. */
export class SmsSendError extends Error {
  constructor(
    readonly provider: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}
