import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { adminRoutes } from './admin/routes';
import { catalogRoutes } from './catalog/routes';
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
import type { SmsDeps } from './notifications/sms/queue';
import { restaurantRoutes } from './ordering/restaurant-routes';
import { orderRoutes } from './ordering/routes';

export type { ReadinessCheck } from './health/routes';

export type Services = { db: Db; sms: SmsDeps; realtime?: RealtimeHub };

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
    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== null) {
      request.log.info({ err: error }, 'client error');
      const known = CLIENT_ERRORS[clientStatus] ?? CLIENT_ERRORS[400];
      return reply.code(clientStatus).send({ error: { ...known, requestId: request.id } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Something went wrong.', requestId: request.id } });
  });

  await app.register(helmet);
  await app.register(cookie);

  // Only the listed origins may call the API from a browser; an empty list allows none.
  await app.register(cors, {
    origin: deps.config.corsOrigins,
    // The refresh cookie travels on /v1/auth calls from the web apps.
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // The apps quote the request id when something fails, so the browser must let them read it.
    exposedHeaders: ['x-request-id'],
  });

  healthRoutes(app, deps.checks);

  const { services, config } = deps;
  if (services) {
    registerAuth(app, services.db);
    await app.register(
      async (v1) => {
        identityRoutes(v1, config, services);
        catalogRoutes(v1, services);
        orderRoutes(v1, services);
        restaurantRoutes(v1, services);
        dispatchRoutes(v1, services);
        adminRoutes(v1, services);
        if (config.devOtpPeek) devRoutes(v1, services);
      },
      { prefix: '/v1' },
    );
  }
  if (services?.realtime) services.realtime.register(app, (token) => authenticateAccess(services.db, token));
  return app;
}
