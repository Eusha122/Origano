import type { FastifyInstance } from 'fastify';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

const CHECK_TIMEOUT_MS = 2000;

async function runCheck(check: ReadinessCheck): Promise<'ok' | 'fail'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check.check(), timeout]);
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

export function healthRoutes(app: FastifyInstance, checks: ReadinessCheck[]): void {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    const results = await Promise.all(checks.map(async (c) => [c.name, await runCheck(c)] as const));
    const ready = results.every(([, result]) => result === 'ok');
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', checks: Object.fromEntries(results) });
  });
}
