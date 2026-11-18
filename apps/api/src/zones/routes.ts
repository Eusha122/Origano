import type { RiderZone } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';

export function zoneRoutes(app: FastifyInstance, { db }: Services): void {
  /** Where Oregano delivers; a rider applicant picks one. Public. */
  app.get('/zones', async (): Promise<{ zones: RiderZone[] }> => {
    const rows = await db.execute<{ id: string; name_en: string }>(
      sql`SELECT id, name_en FROM zones WHERE is_active ORDER BY name_en`,
    );
    return { zones: rows.map((r) => ({ id: r.id, name: r.name_en })) };
  });
}
