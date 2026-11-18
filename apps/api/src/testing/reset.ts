import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

/** Empties every application table (PostGIS's spatial_ref_sys stays). Callers must check the name first. */
export async function emptyAllTables(db: Executor): Promise<void> {
  const tables = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'`,
  );
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}
