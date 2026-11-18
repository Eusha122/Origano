import { OtpRequestBody, type OtpRequestResponse, OtpVerifyBody, type SessionResponse } from '@oregano/contracts';
import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Services } from '../app';
import type { Config } from '../config';
import { AppError } from '../errors';
import { hashIp, subkey } from '../security/crypto';
import { bearerToken, requireUser, toMe } from './auth';
import { consumeChallenge, requestOtp, verifyOtp } from './otp';
import { createSession, findOrCreateUser, revokeSession } from './sessions';

/** Parses a request body with a contract schema. The reply never repeats what the client sent. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError('validation_failed', 400, 'Some details are missing or wrong.');
  return result.data;
}

function requirePhone(input: string) {
  const phone = normalizeBdPhone(input);
  if (!phone) throw new AppError('invalid_phone', 400, 'Enter a Bangladesh mobile number.');
  return phone;
}

export function identityRoutes(app: FastifyInstance, config: Config, { db, sms }: Services): void {
  const ipKey = subkey(config.otpSecret, 'ip-hash');
  const { limits } = config;

  // 202: the code is on its way by SMS; it has not arrived yet.
  app.post('/auth/otp/request', async (request, reply): Promise<OtpRequestResponse> => {
    const body = parseBody(OtpRequestBody, request.body);
    const phone = requirePhone(body.phone);
    const deps = { secret: config.otpSecret, limits, sms, webOtpDomain: config.webOtpDomain, log: request.log };
    await requestOtp(db, deps, { phone, ipHash: hashIp(ipKey, request.ip), locale: body.locale ?? 'en' });
    reply.code(202);
    return { expiresInSeconds: limits.otpTtlSeconds, resendInSeconds: limits.otpResendSeconds };
  });

  app.post('/auth/otp/verify', async (request): Promise<SessionResponse> => {
    const body = parseBody(OtpVerifyBody, request.body);
    const phone = requirePhone(body.phone);
    // Wrong-code counting is committed on its own, so a rejected code still uses up a try.
    const deps = { secret: config.otpSecret, limits, log: request.log };
    await verifyOtp(db, deps, { phone, ipHash: hashIp(ipKey, request.ip) }, body.code);
    return db.transaction(async (tx) => {
      await consumeChallenge(tx, config.otpSecret, phone, body.code);
      const user = await findOrCreateUser(tx, phone);
      const token = await createSession(tx, user.id, config.sessionTtlDays);
      return { token, user: toMe(user) };
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    requireUser(request);
    const token = bearerToken(request);
    if (token) await revokeSession(db, token);
    return reply.code(204).send();
  });

  app.get('/me', async (request) => toMe(requireUser(request)));
}
