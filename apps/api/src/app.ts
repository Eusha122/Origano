import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { AppError } from './errors';
import { healthRoutes, type ReadinessCheck } from './health/routes';

export type { ReadinessCheck } from './health/routes';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export async function buildApp(deps: { config: Config; checks: ReadinessCheck[] }): Promise<FastifyInstance> {
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
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Something went wrong.', requestId: request.id } });
  });

  healthRoutes(app, deps.checks);
  return app;
}
