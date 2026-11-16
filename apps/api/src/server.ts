import { buildApp } from './app';
import { type Config, ConfigError, loadConfig } from './config';
import { createDb, postgresCheck, redisCheck } from './db/client';

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
  const app = await buildApp({ config, checks: [postgresCheck(db), redisCheck(config.redisUrl)] });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

void main();
