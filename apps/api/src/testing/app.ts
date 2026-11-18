import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db } from '../db/client';
import { type DemoIds, seedDemo } from '../dev/seed-demo';
import { RealtimeHub } from '../events/realtime';
import { CapturingOtpSender } from '../identity/otp';
import { withTestDb } from './db';

/** A real API on a real, migrated test database, with demo data seeded before each test. */
export function withTestApp(options: { devOtpPeek?: boolean; realtime?: boolean } = {}): {
  app: () => FastifyInstance;
  db: Db;
  otp: CapturingOtpSender;
  demo: () => DemoIds;
  signIn: (phone: string) => Promise<string>;
  as: (token: string) => { authorization: string };
} {
  const { db } = withTestDb();
  const otp = new CapturingOtpSender();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost/x',
    REDIS_URL: 'redis://localhost',
    OTP_SECRET: 'test-only-otp-secret-0123456789abcdef',
    DEV_OTP_PEEK: options.devOtpPeek ? 'true' : 'false',
  });
  let instance: FastifyInstance | undefined;
  let ids: DemoIds | undefined;
  const hub = options.realtime ? new RealtimeHub(config.redisUrl) : undefined;

  beforeAll(async () => {
    instance = await buildApp({ config, checks: [], services: { db, otpSender: otp, realtime: hub } });
    if (hub) {
      await hub.start();
      await instance.listen({ port: 0, host: '127.0.0.1' });
    }
  });

  beforeEach(async () => {
    otp.clear();
    ids = await seedDemo(db);
  });

  afterAll(async () => {
    await instance?.close();
    await hub?.stop();
  });

  const app = (): FastifyInstance => {
    if (!instance) throw new Error('The test app is built in beforeAll; use it inside a test');
    return instance;
  };

  return {
    app,
    db,
    otp,
    demo: () => {
      if (!ids) throw new Error('Demo data is seeded in beforeEach; use it inside a test');
      return ids;
    },
    signIn: async (phone) => {
      const normalised = normalizeBdPhone(phone);
      if (!normalised) throw new Error(`Not a valid phone: ${phone}`);
      const requested = await app().inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
      if (requested.statusCode !== 202) throw new Error(`OTP request failed: ${requested.body}`);
      const code = otp.last(normalised);
      const verified = await app().inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code } });
      if (verified.statusCode !== 200) throw new Error(`OTP verify failed: ${verified.body}`);
      return (verified.json() as { token: string }).token;
    },
    as: (token) => ({ authorization: `Bearer ${token}` }),
  };
}
