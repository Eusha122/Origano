import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { documentRoutes } from './admin/document-routes';
import { adminRoutes } from './admin/routes';
import { discountRoutes } from './catalog/discount-routes';
import { hoursRoutes } from './catalog/hours-routes';
import { menuRoutes } from './catalog/menu-routes';
import { photoRoutes } from './catalog/photo-routes';
import { catalogRoutes } from './catalog/routes';
import { searchRoutes } from './catalog/search-routes';
import { catalogStaffRoutes } from './catalog/staff-routes';
import type { Config } from './config';
import type { Db } from './db/client';
import { dispatchRoutes } from './dispatch/routes';
import { AppError } from './errors';
import type { RealtimeHub } from './events/realtime';
import { healthRoutes, type ReadinessCheck } from './health/routes';
import { registerAuth } from './identity/auth';
import { devRoutes } from './identity/dev-routes';
import { identityRoutes } from './identity/routes';
import { authenticateAccess } from './identity/sessions';
import { staffRoutes } from './identity/staff-routes';
import { MAX_DOCUMENT_BYTES } from './media/image';
import { publicMediaRoutes } from './media/public-routes';
import type { ObjectStore } from './media/store';
import type { SmsDeps } from './notifications/sms/queue';
import { onboardingRoutes } from './onboarding/routes';
import { restaurantRoutes } from './ordering/restaurant-routes';
import { orderRoutes } from './ordering/routes';
import { hashIp, subkey } from './security/crypto';
import { registerRateLimits } from './security/rate-limit';
import { zoneAdminRoutes } from './zones/admin-routes';
import { zoneRoutes } from './zones/routes';

export type { ReadinessCheck } from './health/routes';

export type Services = {
  db: Db;
  sms: SmsDeps;
  redis: Redis;
  store: ObjectStore;
  realtime?: RealtimeHub;
  /** Tests only: the time document links are issued and checked against. */
  clock?: () => Date;
};

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Fixed, safe answers for requests the framework rejected because of what the client sent. */
const CLIENT_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'bad_request', message: 'The request could not be read.' },
  413: { code: 'payload_too_large', message: 'The request is too large.' },
  415: { code: 'unsupported_media_type', message: 'This content type is not supported.' },
};

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const { statusCode, code, validation } = error as { statusCode?: unknown; code?: unknown; validation?: unknown };
  const fromFramework = validation !== undefined || (typeof code === 'string' && code.startsWith('FST_'));
  if (!fromFramework || typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 500) return null;
  return statusCode;
}

/** Anything logged with request headers must never carry these. */
const REDACTED_PATHS = [
  'headers.authorization',
  'headers.cookie',
  'headers["x-document-ticket"]',
  'headers["set-cookie"]',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.headers["x-document-ticket"]',
  '*.headers["set-cookie"]',
];

/**
 * What may be logged about a failure. A failed database query's message carries its parameters (phones, names,
 * guarantor details) and PostgreSQL's `detail` repeats the offending values, so only the code, table and
 * constraint are kept from those.
 */
export function safeError(error: unknown): unknown {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const source = typeof cause === 'object' && cause !== null ? cause : error;
  if (typeof source !== 'object' || source === null) return { message: 'unknown error' };
  const pg = source as {
    code?: unknown;
    table_name?: unknown;
    constraint_name?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const isDatabase = typeof pg.code === 'string' && typeof cause === 'object';
  if (isDatabase || (error as { name?: unknown }).name === 'DrizzleQueryError') {
    return { name: 'DatabaseError', code: pg.code, table: pg.table_name, constraint: pg.constraint_name };
  }
  return error;
}

export async function buildApp(deps: {
  config: Config;
  checks: ReadinessCheck[];
  services?: Services;
  /** Tests only: send logs here instead of the default, so they can be inspected. */
  logStream?: { write(line: string): void };
}): Promise<FastifyInstance> {
  const logger =
    deps.logStream !== undefined
      ? { level: 'info', redact: REDACTED_PATHS, stream: deps.logStream }
      : deps.config.nodeEnv === 'test'
        ? false
        : { level: deps.config.logLevel, redact: REDACTED_PATHS };
  const app = Fastify({
    logger,
    trustProxy: deps.config.trustProxy,
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found.', requestId: request.id } });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.retryAfterSeconds !== undefined) reply.header('retry-after', String(error.retryAfterSeconds));
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, requestId: request.id } });
    }
    if ((error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(413)
        .send({ error: { code: 'document_too_large', message: 'That file is too large', requestId: request.id } });
    }
    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== null) {
      request.log.info({ err: error }, 'client error');
      const known = CLIENT_ERRORS[clientStatus] ?? CLIENT_ERRORS[400];
      return reply.code(clientStatus).send({ error: { ...known, requestId: request.id } });
    }
    request.log.error({ err: safeError(error) }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Something went wrong.', requestId: request.id } });
  });

  await app.register(helmet);
  await app.register(cookie);
  // Documents only: one file of at most 8 MB, no other fields. A truncated file is refused as too large.
  await app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 0 } });

  // Only the listed origins may call the API from a browser; an empty list allows none.
  await app.register(cors, {
    origin: deps.config.corsOrigins,
    // The refresh cookie travels on /v1/auth calls from the web apps.
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-oregano-client',
      'x-request-id',
      'x-document-ticket',
    ],
    // The apps quote the request id when something fails, so the browser must let them read it.
    exposedHeaders: ['x-request-id', 'retry-after'],
  });

  healthRoutes(app, deps.checks);

  const { services, config } = deps;
  if (services) {
    await registerRateLimits(app, {
      redis: services.redis,
      limits: config.limits,
      prefix: config.rateLimitPrefix,
      otpSecret: config.otpSecret,
    });
    registerAuth(app, services.db);
    await app.register(
      async (v1) => {
        identityRoutes(v1, config, services);
        catalogRoutes(v1, services);
        catalogStaffRoutes(v1, services);
        menuRoutes(v1, services);
        hoursRoutes(v1, services);
        discountRoutes(v1, services);
        photoRoutes(v1, services);
        searchRoutes(v1, services);
        publicMediaRoutes(v1, services);
        orderRoutes(v1, config, services);
        restaurantRoutes(v1, services);
        dispatchRoutes(v1, services);
        adminRoutes(v1, config, services);
        documentRoutes(v1, config, services);
        onboardingRoutes(v1, config, services);
        staffRoutes(v1, config, services);
        zoneRoutes(v1, services);
        zoneAdminRoutes(v1, services);
        if (config.devOtpPeek) devRoutes(v1, services);
      },
      { prefix: '/v1' },
    );
  }
  if (services?.realtime) {
    const ipKey = subkey(config.otpSecret, 'ip-hash');
    services.realtime.register(app, (token) => authenticateAccess(services.db, token), {
      maxPerIp: config.limits.wsConnectionsPerIp,
      clientKey: (ip) => hashIp(ipKey, ip),
    });
  }
  return app;
}
