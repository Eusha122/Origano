import { createDb } from '@oregano/api/db/client';
import { runMigrations } from '@oregano/api/db/migrate';
import { seedDemo } from '@oregano/api/dev/seed-demo';
import { emptyE2eBucket } from '@oregano/api/media/store';
import { assertTestDatabaseUrl } from '@oregano/api/testing/guard';
import { emptyAllTables } from '@oregano/api/testing/reset';
import { APP_URLS, E2E_DATABASE_URL, E2E_S3_ENDPOINT } from './journey';

/** Migrates the e2e database, empties it and seeds the demo data, so every run starts from the same state. */
async function resetDatabase(): Promise<void> {
  // Every table is emptied below: refuse anything but a database named *_test.
  assertTestDatabaseUrl(E2E_DATABASE_URL);
  await runMigrations(E2E_DATABASE_URL);
  const { db, close } = createDb(E2E_DATABASE_URL);
  try {
    await emptyAllTables(db);
    await seedDemo(db);
  } finally {
    await close();
  }
}

/**
 * Asks each Expo dev server for its page and its scripts. Metro bundles on the first request, which can take a
 * minute or more; doing it here keeps that wait out of the tests, whose timeouts then mean what they say.
 */
async function warmBundles(): Promise<void> {
  const expoApps = [APP_URLS.customer, APP_URLS.restaurant, APP_URLS.rider];
  await Promise.all(
    expoApps.map(async (base) => {
      const html = await (await fetch(base)).text();
      const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1] ?? '');
      for (const src of scripts) {
        const response = await fetch(new URL(src, base));
        if (!response.ok) throw new Error(`Could not bundle ${base}: ${response.status}`);
        await response.arrayBuffer();
      }
    }),
  );
}

/** Empties the e2e document bucket (it refuses any bucket not named *-e2e), so uploads never pile up between runs. */
async function resetStorage(): Promise<void> {
  await emptyE2eBucket({
    endpoint: E2E_S3_ENDPOINT,
    region: 'us-east-1',
    bucket: 'oregano-e2e',
    accessKeyId: 'oregano',
    secretAccessKey: 'oregano-dev-secret',
    forcePathStyle: true,
  });
}

export default async function globalSetup(): Promise<void> {
  await resetDatabase();
  await resetStorage();
  await warmBundles();
}
