import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { catalogRoutes } from './catalog/routes';
import type { Config } from './config';
import type { Db } from './db/client';
import { AppError } from './errors';
import { healthRoutes, type ReadinessCheck } from './health/routes';
import { registerAuth } from './identity/auth';
import { devRoutes } from './identity/dev-routes';
import type { OtpSender } from './identity/otp';
import { identityRoutes } from './identity/routes';
import { orderRoutes } from './ordering/routes';

export type { ReadinessCheck } from './health/routes';

export type Services = { db: Db; otpSender: OtpSender };

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

export async function buildApp(deps: {
  config: Config;
  checks: ReadinessCheck[];
  services?: Services;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.nodeEnv === 'test' ? false : { level: deps.config.logLevel },
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

  // Only the listed origins may call the API from a browser; an empty list allows none.
  await app.register(cors, {
    origin: deps.config.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
        if (config.devOtpPeek) devRoutes(v1, services.otpSender);
      },
      { prefix: '/v1' },
    );
  }
  return app;
}
