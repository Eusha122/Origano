import {
  OtpRequestBody,
  type OtpRequestResponse,
  OtpVerifyBody,
  RefreshBody,
  type RefreshResponse,
  type SessionResponse,
} from '@oregano/contracts';
import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Services } from '../app';
import type { Config } from '../config';
import { AppError } from '../errors';
import { hashIp, subkey } from '../security/crypto';
import { requireUser, toMe } from './auth';
import { consumeChallenge, requestOtp, verifyOtp } from './otp';
import {
  findOrCreateUser,
  type IssuedTokens,
  refreshSession,
  revokeSession,
  sessionOfRefreshToken,
  startSession,
} from './sessions';

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

const unauthenticated = () => new AppError('unauthenticated', 401, 'Please sign in.');

export function identityRoutes(app: FastifyInstance, config: Config, { db, sms }: Services): void {
  const ipKey = subkey(config.otpSecret, 'ip-hash');
  const { limits, session } = config;
  const production = config.nodeEnv === 'production';
  const cookieName = production ? '__Secure-oregano_rt' : 'oregano_rt';
  const cookiePath = '/v1/auth';

  /**
   * A request with an Origin header comes from a browser: its refresh token lives in an httpOnly cookie and
   * never reaches page scripts. A request with none (a native app) gets the token in the body. An Origin
   * that is not on the list is refused outright.
   */
  const transportOf = (request: FastifyRequest): 'cookie' | 'body' => {
    const origin = request.headers.origin;
    if (origin === undefined) return 'body';
    if (!config.corsOrigins.includes(origin)) throw new AppError('forbidden', 403, 'You cannot do that.');
    return 'cookie';
  };

  app.addHook('onRequest', async (request) => {
    if (request.method !== 'OPTIONS' && request.url.startsWith('/v1/auth/')) transportOf(request);
  });

  const setRefreshCookie = (reply: FastifyReply, tokens: IssuedTokens) => {
    reply.setCookie(cookieName, tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: cookiePath,
      expires: tokens.refreshExpiresAt,
    });
  };
  const clearRefreshCookie = (reply: FastifyReply) => {
    reply.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'strict', path: cookiePath });
  };

  /** The refresh token from the cookie (browsers, which must also send the client header) or the body. */
  const presentedRefreshToken = (request: FastifyRequest): { token: string | null; fromCookie: boolean } => {
    if (transportOf(request) === 'cookie') {
      if (request.headers['x-oregano-client'] !== 'web') throw new AppError('forbidden', 403, 'You cannot do that.');
      return { token: request.cookies[cookieName] ?? null, fromCookie: true };
    }
    const body = request.body === undefined || request.body === null ? {} : parseBody(RefreshBody, request.body);
    return { token: body.refreshToken ?? null, fromCookie: false };
  };

  const answer = (request: FastifyRequest, reply: FastifyReply, tokens: IssuedTokens) => {
    const cookie = transportOf(request) === 'cookie';
    if (cookie) setRefreshCookie(reply, tokens);
    return {
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt.toISOString(),
      refreshToken: cookie ? null : tokens.refreshToken,
    };
  };

  // 202: the code is on its way by SMS; it has not arrived yet.
  app.post('/auth/otp/request', async (request, reply): Promise<OtpRequestResponse> => {
    const body = parseBody(OtpRequestBody, request.body);
    const phone = requirePhone(body.phone);
    const deps = { secret: config.otpSecret, limits, sms, webOtpDomain: config.webOtpDomain, log: request.log };
    await requestOtp(db, deps, { phone, ipHash: hashIp(ipKey, request.ip), locale: body.locale ?? 'en' });
    reply.code(202);
    return { expiresInSeconds: limits.otpTtlSeconds, resendInSeconds: limits.otpResendSeconds };
  });

  app.post('/auth/otp/verify', async (request, reply): Promise<SessionResponse> => {
    const body = parseBody(OtpVerifyBody, request.body);
    const phone = requirePhone(body.phone);
    const transport = transportOf(request);
    // Wrong-code counting is committed on its own, so a rejected code still uses up a try.
    const deps = { secret: config.otpSecret, limits, log: request.log };
    await verifyOtp(db, deps, { phone, ipHash: hashIp(ipKey, request.ip) }, body.code);
    const { user, tokens } = await db.transaction(async (tx) => {
      await consumeChallenge(tx, config.otpSecret, phone, body.code);
      const signedIn = await findOrCreateUser(tx, phone);
      const started = await startSession(tx, signedIn, transport === 'cookie' ? 'web' : 'native', session);
      return { user: signedIn, tokens: started };
    });
    return { ...answer(request, reply, tokens), user: toMe(user) };
  });

  app.post('/auth/refresh', async (request, reply): Promise<RefreshResponse> => {
    const { token } = presentedRefreshToken(request);
    if (!token) throw unauthenticated();
    const result = await refreshSession(db, token, session);
    if (result === 'invalid' || result === 'reused') {
      clearRefreshCookie(reply);
      throw unauthenticated();
    }
    return answer(request, reply, result);
  });

  // Safe to repeat, and never an error: signing out must always work, even with an expired access token.
  app.post('/auth/logout', async (request, reply) => {
    let sessionId = request.sessionId;
    // An expired access token identifies nobody, and most sign-outs happen after the 15 minutes are up.
    if (!sessionId) {
      const { token } = presentedRefreshToken(request);
      if (token) sessionId = await sessionOfRefreshToken(db, token);
    }
    if (sessionId) await db.transaction((tx) => revokeSession(tx, sessionId as string, 'logout'));
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', async (request) => toMe(requireUser(request)));
}
