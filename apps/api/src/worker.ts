import { type Config, ConfigError, loadConfig } from './config';
import { createDb, type Db } from './db/client';
import { startRelay } from './events/relay';
import { openStore } from './media/store';
import { type DocumentSubject, pruneDocuments } from './media/vault';
import { createProviders } from './notifications/sms/providers';
import { startSmsDispatcher } from './notifications/sms/queue';
import { restaurantApplicationAbandoned } from './onboarding/restaurant-applications';
import { riderApplicationAbandoned } from './onboarding/rider-applications';
import { defaultSweepJobs, startSweeper } from './worker/sweeper';

/** Each kind of subject says for itself when its files are no longer wanted. */
async function isAbandoned(db: Db, subject: DocumentSubject): Promise<boolean> {
  return subject.type === 'restaurant_application'
    ? restaurantApplicationAbandoned(db, subject.id)
    : riderApplicationAbandoned(db, subject.id);
}

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
  const documents = {
    name: 'documents',
    run: (_db: typeof db, now: Date) =>
      pruneDocuments({ db, store, keys: config.dataKeys }, now, (subject) => isAbandoned(db, subject)),
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
