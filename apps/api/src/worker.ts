import { type Config, ConfigError, loadConfig } from './config';
import { createDb } from './db/client';
import { startRelay } from './events/relay';
import { openStore } from './media/store';
import { pruneDocuments } from './media/vault';
import { createProviders } from './notifications/sms/providers';
import { startSmsDispatcher } from './notifications/sms/queue';
import { defaultSweepJobs, startSweeper } from './worker/sweeper';

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
  const relay = startRelay(db, config.redisUrl);
  const providers = createProviders(config.smsProviders, { info: (message) => console.log(message) });
  const sms = startSmsDispatcher(db, {
    keys: config.dataKeys,
    providers,
    log: { warn: (message) => console.warn(message) },
  });
  const store = await openStore(config);
  // Task 12 replaces the always-false predicate with onboarding's "is this application abandoned".
  const documents = {
    name: 'documents',
    run: (_db: typeof db, now: Date) => pruneDocuments({ db, store, keys: config.dataKeys }, now, async () => false),
  };
  const sweeper = startSweeper(db, [...defaultSweepJobs(), documents]);
  console.log('worker started: relaying outbox to redis, sending SMS, sweeping old data');

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await relay.stop();
      await sms.stop();
      await sweeper.stop();
      await close();
      process.exit(0);
    } catch (error) {
      console.error('shutdown failed', error);
      process.exit(1);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
