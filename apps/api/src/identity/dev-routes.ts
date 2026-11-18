import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { peekLatestOtpText } from '../notifications/sms/queue';

/** Development only: lets a browser test read the code that was "sent". Registered only when DEV_OTP_PEEK is on. */
export function devRoutes(app: FastifyInstance, { db, sms }: Services): void {
  app.get('/dev/otp/:phone', async (request) => {
    const { phone } = request.params as { phone: string };
    const normalised = normalizeBdPhone(phone);
    const text = normalised ? await peekLatestOtpText(db, sms.keys, normalised) : null;
    const code = text?.match(/\b[0-9]{6}\b/)?.[0];
    if (!code) throw new AppError('not_found', 404, 'Not found.');
    return { code };
  });
}
