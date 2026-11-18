import { Redis } from 'ioredis';
import { buildApp } from './app';
import { type Config, ConfigError, loadConfig } from './config';
import { createDb, postgresCheck, redisCheck } from './db/client';
import { RealtimeHub } from './events/realtime';
import { openStore } from './media/store';

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const { db, close } = createDb(config.databaseUrl);
  // Fails at once when Redis is down (no offline queue), so the limits fail open instead of slowing every request.
  const limitsRedis = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });
  limitsRedis.on('error', () => {});
  const realtime = new RealtimeHub(config.redisUrl);
  const app = await buildApp({
    config,
    checks: [postgresCheck(db), redisCheck(config.redisUrl)],
    services: {
      db,
      sms: { keys: config.dataKeys, retainUntilExpiry: config.devOtpPeek },
      redis: limitsRedis,
      store: await openStore(config),
      realtime,
    },
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
      await realtime.stop();
      limitsRedis.disconnect();
      await close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await realtime.start();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

void main();
