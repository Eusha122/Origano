import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createDb, type Db } from '../db/client';
import { runMigrations } from '../db/migrate';
import { assertTestDatabaseUrl } from './guard';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://oregano:oregano@localhost:5432/oregano_test';

/** A real PostgreSQL database for tests: migrated once, every table emptied before each test. */
export function withTestDb(): { db: Db } {
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  const handle = createDb(TEST_DATABASE_URL);

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    const tables = await handle.db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'`,
    );
    if (tables.length > 0) {
      const list = tables.map((t) => `"${t.tablename}"`).join(', ');
      await handle.db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
    }
  });

  afterAll(async () => {
    await handle.close();
  });

  return { db: handle.db };
}
