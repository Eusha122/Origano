import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';
import type { OtpSender } from './otp';

type PeekableSender = OtpSender & { last(phone: string): string | undefined };

function canPeek(sender: OtpSender): sender is PeekableSender {
  return typeof (sender as Partial<PeekableSender>).last === 'function';
}

/** Development only: lets a browser test read the code that was "sent". Registered only when DEV_OTP_PEEK is on. */
export function devRoutes(app: FastifyInstance, otpSender: OtpSender): void {
  app.get('/dev/otp/:phone', async (request) => {
    const { phone } = request.params as { phone: string };
    const normalised = normalizeBdPhone(phone);
    const code = normalised && canPeek(otpSender) ? otpSender.last(normalised) : undefined;
    if (!code) throw new AppError('not_found', 404, 'Not found.');
    return { code };
  });
}
