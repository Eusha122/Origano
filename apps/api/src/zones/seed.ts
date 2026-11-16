import { taka } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

/** Launch approximation of Chapainawabganj town. The admin redraws it in Plan 04. */
const CHAPAINAWABGANJ_BOUNDARY = 'POLYGON((88.22 24.55, 88.33 24.55, 88.33 24.65, 88.22 24.65, 88.22 24.55))';

/** Safe to run repeatedly: upserts on slug. */
export async function seedZones(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO zones (slug, name_en, name_bn, boundary, fee_per_km_poisha, min_fee_poisha, road_factor)
    VALUES (
      'chapainawabganj', 'Chapainawabganj', 'চাঁপাইনবাবগঞ্জ',
      ST_GeogFromText(${`SRID=4326;${CHAPAINAWABGANJ_BOUNDARY}`}),
      ${taka(10)}, ${taka(20)}, 1.30
    )
    ON CONFLICT (slug) DO UPDATE SET
      name_en = EXCLUDED.name_en,
      name_bn = EXCLUDED.name_bn,
      boundary = EXCLUDED.boundary,
      fee_per_km_poisha = EXCLUDED.fee_per_km_poisha,
      min_fee_poisha = EXCLUDED.min_fee_poisha,
      road_factor = EXCLUDED.road_factor,
      updated_at = now()
  `);
}
