import { randomBytes } from 'node:crypto';
import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../app';
import { type Limits, loadConfig, type SessionLimits } from '../config';
import type { Db } from '../db/client';
import { type DemoIds, seedDemo } from '../dev/seed-demo';
import { RealtimeHub } from '../events/realtime';
import { peekLatestOtpText } from '../notifications/sms/queue';
import { withTestDb } from './db';
import { TEST_DATA_KEYS } from './keys';

/** A real API on a real, migrated test database, with demo data seeded before each test. */
export function withTestApp(
  options: {
    devOtpPeek?: boolean;
    realtime?: boolean;
    /** Relaxed by default, so ordinary test files never trip a limit from 127.0.0.1. */
    limitsProfile?: 'standard' | 'relaxed';
    limits?: Partial<Limits>;
    trustProxy?: string[];
    /** Session lifetimes, for tests that need a short access token. */
    session?: Partial<SessionLimits>;
  } = {},
): {
  app: () => FastifyInstance;
  db: Db;
  /** The sign-in code in the newest queued SMS for a phone. */
  otp: { last(phone: string): Promise<string | undefined>; lastText(phone: string): Promise<string | null> };
  demo: () => DemoIds;
  signIn: (phone: string) => Promise<string>;
  as: (token: string) => { authorization: string };
} {
  const { db } = withTestDb();
  const base = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost/x',
    REDIS_URL: 'redis://localhost',
    OTP_SECRET: 'test-only-otp-secret-0123456789abcdef',
    DEV_OTP_PEEK: options.devOtpPeek ? 'true' : 'false',
    DATA_KEYS: TEST_DATA_KEYS,
    LIMITS_PROFILE: options.limitsProfile ?? 'relaxed',
    RATE_LIMIT_PREFIX: `test-${randomBytes(6).toString('hex')}`,
    TRUST_PROXY: options.trustProxy?.join(',') ?? '',
    CORS_ORIGINS: 'http://localhost:8081',
  });
  const config = {
    ...base,
    limits: { ...base.limits, ...options.limits },
    session: { ...base.session, ...options.session },
  };
  let instance: FastifyInstance | undefined;
  let ids: DemoIds | undefined;
  const otp = {
    lastText: async (phone: string): Promise<string | null> => {
      const normalised = normalizeBdPhone(phone);
      return normalised ? peekLatestOtpText(db, config.dataKeys, normalised) : null;
    },
    last: async (phone: string): Promise<string | undefined> => {
      const normalised = normalizeBdPhone(phone);
      const text = normalised ? await peekLatestOtpText(db, config.dataKeys, normalised) : null;
      return text?.match(/\b[0-9]{6}\b/)?.[0];
    },
  };
  const hub = options.realtime ? new RealtimeHub(config.redisUrl) : undefined;
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => {});

  beforeAll(async () => {
    // The limits fail open until Redis is connected, so a test must not start before it is.
    if (redis.status !== 'ready') await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
    instance = await buildApp({
      config,
      checks: [],
      services: { db, sms: { keys: config.dataKeys, retainUntilExpiry: true }, redis, realtime: hub },
    });
    if (hub) {
      await hub.start();
      await instance.listen({ port: 0, host: '127.0.0.1' });
    }
  });

  beforeEach(async () => {
    ids = await seedDemo(db);
  });

  afterAll(async () => {
    await instance?.close();
    await hub?.stop();
    redis.disconnect();
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
      const code = await otp.last(normalised);
      const verified = await app().inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code } });
      if (verified.statusCode !== 200) throw new Error(`OTP verify failed: ${verified.body}`);
      return (verified.json() as { accessToken: string }).accessToken;
    },
    as: (token) => ({ authorization: `Bearer ${token}` }),
  };
}
