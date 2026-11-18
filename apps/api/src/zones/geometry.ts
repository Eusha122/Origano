import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

export type BoundaryProblem =
  | 'too_few_points'
  | 'too_many_points'
  | 'not_closed'
  | 'self_intersecting'
  | 'too_large'
  | 'overlaps_zone'
  | 'outside_bangladesh';

export const MAX_VERTICES = 500;
/** About the size of the biggest city area Oregano would serve; also stops a planet-sized polygon. */
export const MAX_AREA_KM2 = 5000;
/** Bangladesh and its coast, with a little margin. */
const BOUNDS = { minLat: 20.5, maxLat: 26.8, minLng: 87.9, maxLng: 92.8 };

export type Ring = [number, number][];

/**
 * Checks a drawn boundary (one ring of [lng, lat], first point repeated at the end) and answers the first problem, or
 * null. `exceptZoneId` is the zone being edited, so it never overlaps itself.
 */
export async function validateBoundary(
  db: Executor,
  ring: Ring,
  exceptZoneId?: string,
): Promise<BoundaryProblem | null> {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) return 'not_closed';
  const vertices = ring.length - 1;
  if (vertices < 3) return 'too_few_points';
  if (vertices > MAX_VERTICES) return 'too_many_points';
  if (
    ring.some(([lng, lat]) => lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng)
  ) {
    return 'outside_bangladesh';
  }
  const wkt = `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ')}))`;
  const checked = await db.execute<{ valid: boolean; km2: number }>(sql`
    SELECT ST_IsValid(g) AS valid,
      CASE WHEN ST_IsValid(g) THEN ST_Area(g::geography) / 1000000.0 ELSE 0 END AS km2
    FROM (SELECT ST_SetSRID(ST_GeomFromText(${wkt}), 4326) AS g) s`);
  const row = checked[0];
  if (!row?.valid || !(Number(row.km2) > 0)) return 'self_intersecting';
  if (Number(row.km2) > MAX_AREA_KM2) return 'too_large';
  const except = exceptZoneId ? sql`AND id <> ${exceptZoneId}` : sql``;
  const overlap = await db.execute(sql`
    SELECT 1 FROM zones
    WHERE is_active ${except}
      AND ST_Intersects(boundary, ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromText(${wkt}), 4326))::geography)
    LIMIT 1`);
  return overlap.length > 0 ? 'overlaps_zone' : null;
}
