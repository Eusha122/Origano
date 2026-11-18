import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { TEST_DATA_KEYS } from '../testing/keys';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWithProxy(trust: string) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost/x',
    REDIS_URL: 'redis://localhost',
    OTP_SECRET: 'x'.repeat(40),
    DATA_KEYS: TEST_DATA_KEYS,
    TRUST_PROXY: trust,
  });
  const app = await buildApp({ config, checks: [] });
  app.get('/probe-ip', async (request) => ({ ip: request.ip }));
  apps.push(app);
  return app;
}

const forwarded = { 'x-forwarded-for': '203.0.113.9' };

describe('client IP behind a proxy', () => {
  it('believes X-Forwarded-For from a trusted proxy', async () => {
    const app = await appWithProxy('10.0.0.1');
    const res = await app.inject({ method: 'GET', url: '/probe-ip', remoteAddress: '10.0.0.1', headers: forwarded });
    expect(res.json()).toEqual({ ip: '203.0.113.9' });
  });

  it('ignores a forged X-Forwarded-For from an address that is not trusted', async () => {
    const app = await appWithProxy('10.0.0.1');
    const res = await app.inject({
      method: 'GET',
      url: '/probe-ip',
      remoteAddress: '198.51.100.7',
      headers: forwarded,
    });
    expect(res.json()).toEqual({ ip: '198.51.100.7' });
  });

  it('trusts no proxy at all when none is configured', async () => {
    const app = await appWithProxy('');
    const res = await app.inject({ method: 'GET', url: '/probe-ip', remoteAddress: '10.0.0.1', headers: forwarded });
    expect(res.json()).toEqual({ ip: '10.0.0.1' });
  });
});
