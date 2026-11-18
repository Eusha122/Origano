import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type { ReadinessCheck } from '../app';
import * as schema from './schema';

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export type Db = ReturnType<typeof createDb>['db'];

/** The handle a service receives inside `db.transaction`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Anything that can run SQL: the database or an open transaction. */
export type Executor = Pick<Db, 'execute'>;

export function postgresCheck(db: Db): ReadinessCheck {
  return {
    name: 'postgres',
    check: async () => {
      await db.execute(sql`SELECT 1`);
    },
  };
}

/** Opens a short-lived connection per check so a dead Redis never leaves a reconnect loop behind. */
export function redisCheck(redisUrl: string): ReadinessCheck {
  return {
    name: 'redis',
    check: async () => {
      const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
      redis.on('error', () => {});
      try {
        await redis.connect();
        await redis.ping();
      } finally {
        redis.disconnect();
      }
    },
  };
}
