import { afterEach, describe, expect, it } from 'vitest';
import { buildApp as build } from './app';
import { loadConfig } from './config';
import { AppError } from './errors';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost/x',
  REDIS_URL: 'redis://localhost',
  OTP_SECRET: 'x'.repeat(40),
});
const apps: Awaited<ReturnType<typeof build>>[] = [];
async function buildApp(deps: Parameters<typeof build>[0]) {
  const app = await build(deps);
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const pass = { name: 'postgres', check: async () => {} };
const fail = {
  name: 'redis',
  check: async () => {
    throw new Error('connection refused at 10.0.0.5');
  },
};

describe('api skeleton', () => {
  it('reports alive without touching dependencies', async () => {
    const app = await buildApp({ config, checks: [fail] });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when every check passes', async () => {
    const app = await buildApp({ config, checks: [pass] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { postgres: 'ok' } });
  });

  it('reports not ready, without leaking details, when a check fails', async () => {
    const app = await buildApp({ config, checks: [pass, fail] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { postgres: 'ok', redis: 'fail' } });
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('fails a check that hangs instead of hanging the request', async () => {
    const hang = { name: 'postgres', check: () => new Promise<void>(() => {}) };
    const app = await buildApp({ config, checks: [hang] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
  }, 5000);

  it('answers an unknown route with the error envelope', async () => {
    const app = await buildApp({ config, checks: [] });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.requestId).toBe(res.headers['x-request-id']);
  });

  it('maps AppError to its status and hides unexpected errors', async () => {
    const app = await buildApp({ config, checks: [] });
    app.get('/known', async () => {
      throw new AppError('zone_outside', 422, "We don't deliver here yet");
    });
    app.get('/boom', async () => {
      throw new Error('password=hunter2');
    });

    const known = await app.inject({ method: 'GET', url: '/known' });
    expect(known.statusCode).toBe(422);
    expect(known.json().error).toMatchObject({ code: 'zone_outside', message: "We don't deliver here yet" });

    const boom = await app.inject({ method: 'GET', url: '/boom' });
    expect(boom.statusCode).toBe(500);
    expect(boom.json().error).toMatchObject({ code: 'internal', message: 'Something went wrong.' });
    expect(boom.body).not.toContain('hunter2');
  });

  it('reuses a well-formed request id and replaces a malformed one', async () => {
    const app = await buildApp({ config, checks: [] });
    const good = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'abc12345-xyz' } });
    expect(good.headers['x-request-id']).toBe('abc12345-xyz');
    const bad = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': '<script>' } });
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });

  it('answers client mistakes with a 4xx, not an internal error', async () => {
    const app = await buildApp({ config, checks: [] });
    app.post('/echo', async (request) => request.body);

    const malformed = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken": ',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toMatchObject({ code: 'bad_request' });

    const wrongType = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'x',
    });
    expect(wrongType.statusCode).toBe(415);
    expect(wrongType.json().error).toMatchObject({ code: 'unsupported_media_type' });

    const tooLarge = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'x'.repeat(1_100_000) }),
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error).toMatchObject({ code: 'payload_too_large' });
  });
});
