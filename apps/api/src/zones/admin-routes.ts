import { type AdminZone, ZoneBody, ZonePatch } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../admin/audit';
import type { Services } from '../app';
import type { Executor } from '../db/client';
import { AppError } from '../errors';
import { requirePermission } from '../identity/auth';
import { countOpenOrdersInZone } from '../ordering/open-orders';
import { isUuid } from '../ordering/repo';
import { type BoundaryProblem, type Ring, validateBoundary } from './geometry';

const invalidZone = (detail: string, status = 400) =>
  new AppError('invalid_zone', status, `That zone is not valid: ${detail}.`);
const notFound = () => new AppError('not_found', 404, 'Not found.');

type Row = {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  geojson: string;
  fee_per_km_poisha: number;
  min_fee_poisha: number;
  road_factor: string;
  timezone: string;
  is_active: boolean;
};

const SELECT = sql`
  SELECT id, slug, name_en, name_bn, ST_AsGeoJSON(boundary::geometry) AS geojson, fee_per_km_poisha, min_fee_poisha,
    road_factor, timezone, is_active FROM zones`;

const toZone = (r: Row): AdminZone => ({
  id: r.id,
  slug: r.slug,
  nameEn: r.name_en,
  nameBn: r.name_bn,
  boundary: JSON.parse(r.geojson) as AdminZone['boundary'],
  feePerKm: r.fee_per_km_poisha,
  minFee: r.min_fee_poisha,
  roadFactor: Number(r.road_factor),
  timezone: r.timezone,
  isActive: r.is_active,
});

async function loadZone(db: Executor, id: string): Promise<AdminZone | null> {
  const rows = await db.execute<Row>(sql`${SELECT} WHERE id = ${id}`);
  return rows[0] ? toZone(rows[0]) : null;
}

const problemText: Record<BoundaryProblem, string> = {
  too_few_points: 'it needs at least 3 corners',
  too_many_points: 'it has too many corners',
  not_closed: 'the outline is not closed',
  self_intersecting: 'the outline crosses itself',
  too_large: 'the area is too large',
  overlaps_zone: 'it overlaps another active zone',
  outside_bangladesh: 'it is outside Bangladesh',
};

const validTimezone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const geoJson = (boundary: AdminZone['boundary']) => JSON.stringify(boundary);

export function zoneAdminRoutes(app: FastifyInstance, { db }: Services): void {
  app.get('/admin/zones', async (request): Promise<{ zones: AdminZone[] }> => {
    requirePermission(request, 'zones.manage');
    const rows = await db.execute<Row>(sql`${SELECT} ORDER BY name_en`);
    return { zones: rows.map(toZone) };
  });

  app.post('/admin/zones', async (request, reply): Promise<AdminZone> => {
    const user = requirePermission(request, 'zones.manage');
    const parsed = ZoneBody.safeParse(request.body);
    if (!parsed.success) throw invalidZone('some details are missing or wrong');
    const body = parsed.data;
    const timezone = body.timezone ?? 'Asia/Dhaka';
    if (!validTimezone(timezone)) throw invalidZone('unknown time zone');
    const created = await db.transaction(async (tx) => {
      // One writer at a time, so two zones drawn together cannot both pass the overlap check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('zones'))`);
      const problem = await validateBoundary(tx, body.boundary.coordinates[0] as Ring);
      if (problem) throw invalidZone(problemText[problem]);
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO zones (slug, name_en, name_bn, boundary, fee_per_km_poisha, min_fee_poisha, road_factor, timezone)
        VALUES (${body.slug}, ${body.nameEn}, ${body.nameBn},
          ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromGeoJSON(${geoJson(body.boundary)}), 4326))::geography,
          ${body.feePerKm}, ${body.minFee}, ${body.roadFactor}, ${timezone})
        ON CONFLICT (slug) DO NOTHING RETURNING id`);
      const id = rows[0]?.id;
      if (!id) throw invalidZone('that short name is already used', 409);
      await writeAudit(tx, {
        actor: { type: 'user', id: user.id },
        action: 'zone.created',
        targetType: 'zone',
        targetId: id,
        requestId: request.id,
      });
      return (await loadZone(tx, id)) as AdminZone;
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/admin/zones/:id', async (request): Promise<AdminZone> => {
    const user = requirePermission(request, 'zones.manage');
    if (!isUuid(request.params.id)) throw notFound();
    const parsed = ZonePatch.safeParse(request.body);
    if (!parsed.success) throw invalidZone('some details are missing or wrong');
    const patch = parsed.data;
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('zones'))`);
      const current = await loadZone(tx, request.params.id);
      if (!current) throw notFound();
      const willBeActive = patch.isActive ?? current.isActive;
      if (patch.isActive === false && current.isActive && (await countOpenOrdersInZone(tx, current.id)) > 0) {
        throw new AppError('zone_has_open_orders', 409, 'This zone still has open orders.');
      }
      if (willBeActive && (patch.boundary !== undefined || patch.isActive === true)) {
        const ring = (patch.boundary ?? current.boundary).coordinates[0] as Ring;
        const problem = await validateBoundary(tx, ring, current.id);
        if (problem) throw invalidZone(problemText[problem]);
      }
      await tx.execute(sql`
        UPDATE zones SET
          name_en = COALESCE(${patch.nameEn ?? null}, name_en),
          name_bn = COALESCE(${patch.nameBn ?? null}, name_bn),
          fee_per_km_poisha = COALESCE(${patch.feePerKm ?? null}, fee_per_km_poisha),
          min_fee_poisha = COALESCE(${patch.minFee ?? null}, min_fee_poisha),
          road_factor = COALESCE(${patch.roadFactor ?? null}, road_factor),
          is_active = COALESCE(${patch.isActive ?? null}, is_active),
          updated_at = now()
        WHERE id = ${current.id}`);
      if (patch.boundary !== undefined) {
        await tx.execute(sql`
          UPDATE zones SET boundary =
            ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromGeoJSON(${geoJson(patch.boundary)}), 4326))::geography
          WHERE id = ${current.id}`);
      }
      await writeAudit(tx, {
        actor: { type: 'user', id: user.id },
        action: 'zone.updated',
        targetType: 'zone',
        targetId: current.id,
        data: { fields: Object.keys(patch).sort().join(',') },
        requestId: request.id,
      });
      return (await loadZone(tx, current.id)) as AdminZone;
    });
  });
}
