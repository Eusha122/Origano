import { taka } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';
import { findZoneForPoint } from './repo';
import { seedZones } from './seed';

const townCentre = { lat: 24.5965, lng: 88.2775 };
const dhaka = { lat: 23.8103, lng: 90.4125 };

describe('zones', () => {
  const { db } = withTestDb();

  it('finds Chapainawabganj for a point in the town', async () => {
    await seedZones(db);
    const zone = await findZoneForPoint(db, townCentre);
    expect(zone).toMatchObject({
      slug: 'chapainawabganj',
      nameEn: 'Chapainawabganj',
      nameBn: 'চাঁপাইনবাবগঞ্জ',
      feePerKm: taka(10),
      minFee: taka(20),
      roadFactor: 1.3,
      timezone: 'Asia/Dhaka',
      isActive: true,
    });
  });

  it('returns null outside every zone', async () => {
    await seedZones(db);
    expect(await findZoneForPoint(db, dhaka)).toBeNull();
  });

  it('ignores a zone that is switched off', async () => {
    await seedZones(db);
    await db.execute(sql`UPDATE zones SET is_active = false`);
    expect(await findZoneForPoint(db, townCentre)).toBeNull();
  });

  it('rejects impossible coordinates', async () => {
    await expect(findZoneForPoint(db, { lat: 91, lng: 88 })).rejects.toThrow(RangeError);
    await expect(findZoneForPoint(db, { lat: 24, lng: 181 })).rejects.toThrow(RangeError);
    await expect(findZoneForPoint(db, { lat: Number.NaN, lng: 88 })).rejects.toThrow(RangeError);
  });

  it('can be seeded twice without duplicating the zone', async () => {
    await seedZones(db);
    await seedZones(db);
    const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM zones`);
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses a negative fee at the database level', async () => {
    await seedZones(db);
    await expect(db.execute(sql`UPDATE zones SET min_fee_poisha = -1`)).rejects.toThrow();
  });
});
