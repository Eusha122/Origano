import { type Money, taka } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

export type Zone = {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  feePerKm: Money;
  minFee: Money;
  roadFactor: number;
  timezone: string;
  isActive: boolean;
};

type ZoneRow = {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  fee_per_km_poisha: number;
  min_fee_poisha: number;
  road_factor: string;
  timezone: string;
  is_active: boolean;
};

function assertCoordinates(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError(`latitude out of range: ${lat}`);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new RangeError(`longitude out of range: ${lng}`);
}

/** The active zone that covers the point, or null. Overlapping zones resolve to the smallest one. */
export async function findZoneForPoint(db: Db, point: { lat: number; lng: number }): Promise<Zone | null> {
  assertCoordinates(point.lat, point.lng);
  const rows = await db.execute<ZoneRow>(sql`
    SELECT id, slug, name_en, name_bn, fee_per_km_poisha, min_fee_poisha, road_factor, timezone, is_active
    FROM zones
    WHERE is_active AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)
    ORDER BY ST_Area(boundary) ASC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    feePerKm: taka(row.fee_per_km_poisha / 100),
    minFee: taka(row.min_fee_poisha / 100),
    roadFactor: Number(row.road_factor),
    timezone: row.timezone,
    isActive: row.is_active,
  };
}
