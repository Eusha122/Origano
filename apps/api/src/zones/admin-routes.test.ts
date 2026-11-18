import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const SUPERADMIN = '01711000004';
const ONBOARDING = '01711000006';
const SUPPORT = '01711000007';

const ring = (pts: [number, number][]) => ({
  type: 'Polygon' as const,
  coordinates: [[...pts, pts[0] as [number, number]]],
});
// Rajshahi-ish square, well away from Chapainawabganj (88.22 to 88.33, 24.55 to 24.65).
const rajshahi = ring([
  [88.55, 24.3],
  [88.65, 24.3],
  [88.65, 24.4],
  [88.55, 24.4],
]);

describe('zones admin', () => {
  const t = withTestApp();
  const call = async (phone: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    t.app().inject({
      method,
      url: `/v1/admin/zones${url}`,
      payload: payload as object,
      headers: t.as(await t.signIn(phone)),
    });
  const body = (over: Record<string, unknown> = {}) => ({
    slug: 'rajshahi',
    nameEn: 'Rajshahi',
    nameBn: 'Rajshahi',
    boundary: rajshahi,
    feePerKm: 1200,
    minFee: 2500,
    roadFactor: 1.4,
    ...over,
  });

  it('lists zones with their boundary as GeoJSON', async () => {
    const res = await call(SUPERADMIN, 'GET', '');
    expect(res.statusCode).toBe(200);
    const zone = res.json().zones[0];
    expect(zone).toMatchObject({
      slug: 'chapainawabganj',
      feePerKm: 1000,
      minFee: 2000,
      roadFactor: 1.3,
      isActive: true,
    });
    expect(zone.boundary.type).toBe('Polygon');
    expect(zone.boundary.coordinates[0].length).toBeGreaterThanOrEqual(4);
  });

  it('creates a zone that then finds a point inside it', async () => {
    const res = await call(SUPERADMIN, 'POST', '', body());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ slug: 'rajshahi', feePerKm: 1200, timezone: 'Asia/Dhaka', isActive: true });
    const found = await t.app().inject({ method: 'GET', url: '/v1/restaurants?lat=24.35&lng=88.6' });
    expect(found.json().zone.slug).toBe('rajshahi');
  });

  it('finds a point inside a clockwise-drawn zone as well', async () => {
    const cw = ring([
      [88.55, 24.3],
      [88.55, 24.4],
      [88.65, 24.4],
      [88.65, 24.3],
    ]);
    expect((await call(SUPERADMIN, 'POST', '', body({ boundary: cw }))).statusCode).toBe(201);
    expect((await t.app().inject({ method: 'GET', url: '/v1/restaurants?lat=24.35&lng=88.6' })).json().zone.slug).toBe(
      'rajshahi',
    );
    expect((await t.app().inject({ method: 'GET', url: '/v1/restaurants?lat=24.9&lng=88.6' })).json().zone).toBeNull();
  });

  const refused = async (boundary: unknown) => {
    const res = await call(SUPERADMIN, 'POST', '', body({ boundary }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_zone');
    const n = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM zones WHERE slug = 'rajshahi'`);
    expect(n[0]?.n).toBe(0);
  };

  it('refuses a bow-tie, a polygon with too few or too many points, and an unclosed ring', async () => {
    await refused(
      ring([
        [88.55, 24.3],
        [88.65, 24.4],
        [88.65, 24.3],
        [88.55, 24.4],
      ]),
    );
    await refused({
      type: 'Polygon',
      coordinates: [
        [
          [88.55, 24.3],
          [88.65, 24.3],
          [88.55, 24.3],
        ],
      ],
    });
    const many = Array.from({ length: 501 }, (_, i): [number, number] => [
      88.6 + 0.01 * Math.cos(i / 80),
      24.3 + 0.01 * Math.sin(i / 80),
    ]);
    await refused(ring(many));
    await refused({
      type: 'Polygon',
      coordinates: [
        [
          [88.55, 24.3],
          [88.65, 24.3],
          [88.65, 24.4],
          [88.55, 24.4],
        ],
      ],
    });
  });

  it('refuses a zone that is too large or outside Bangladesh', async () => {
    await refused(
      ring([
        [88.1, 21],
        [92.6, 21],
        [92.6, 26.5],
        [88.1, 26.5],
      ]),
    );
    await refused(
      ring([
        [-170, -80],
        [170, -80],
        [170, 80],
        [-170, 80],
      ]),
    );
    await refused(
      ring([
        [2.2, 48.8],
        [2.4, 48.8],
        [2.4, 48.9],
        [2.2, 48.9],
      ]),
    );
  });

  it('refuses a zone that overlaps another active zone', async () => {
    await refused(
      ring([
        [88.3, 24.6],
        [88.4, 24.6],
        [88.4, 24.7],
        [88.3, 24.7],
      ]),
    );
  });

  it('refuses fees out of range and a duplicate slug', async () => {
    for (const over of [
      { feePerKm: -1 },
      { feePerKm: 20001 },
      { minFee: 50001 },
      { roadFactor: 0.9 },
      { roadFactor: 3.1 },
      { slug: 'Bad Slug' },
    ]) {
      expect((await call(SUPERADMIN, 'POST', '', body(over))).statusCode, JSON.stringify(over)).toBe(400);
    }
    expect((await call(SUPERADMIN, 'POST', '', body())).statusCode).toBe(201);
    const dup = await call(
      SUPERADMIN,
      'POST',
      '',
      body({
        boundary: ring([
          [88.8, 24.3],
          [88.9, 24.3],
          [88.9, 24.4],
          [88.8, 24.4],
        ]),
      }),
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('invalid_zone');
  });

  it('changes fees at once: the public restaurant list shows the new delivery fee', async () => {
    const id = (await call(SUPERADMIN, 'GET', '')).json().zones[0].id;
    const before = (await t.app().inject({ method: 'GET', url: '/v1/restaurants?lat=24.5965&lng=88.2775' })).json();
    expect(before.restaurants[0].deliveryFee).toBe(2000);
    const res = await call(SUPERADMIN, 'PATCH', `/${id}`, { minFee: 4000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().minFee).toBe(4000);
    const after = (await t.app().inject({ method: 'GET', url: '/v1/restaurants?lat=24.5965&lng=88.2775' })).json();
    expect(after.restaurants[0].deliveryFee).toBe(4000);
  });

  it('lets only a superadmin in', async () => {
    for (const phone of [ONBOARDING, SUPPORT]) {
      expect((await call(phone, 'GET', '')).statusCode).toBe(403);
      expect((await call(phone, 'POST', '', body())).statusCode).toBe(403);
    }
    expect((await t.app().inject({ method: 'GET', url: '/v1/admin/zones' })).statusCode).toBe(401);
  });

  it('will not switch a zone off while it has open orders', async () => {
    const id = (await call(SUPERADMIN, 'GET', '')).json().zones[0].id;
    const token = await t.signIn('01711000001');
    const placed = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(token), 'idempotency-key': 'zone-key-000001' },
      payload: {
        restaurantId: t.demo().restaurantId,
        items: [{ menuItemId: t.demo().menuItemIds.coldCoffee, quantity: 1 }],
        delivery: { lat: 24.5965, lng: 88.2775, addressLine: 'Court Road', landmark: 'Gate', phone: '01711000001' },
      },
    });
    expect(placed.statusCode).toBe(201);
    const res = await call(SUPERADMIN, 'PATCH', `/${id}`, { isActive: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('zone_has_open_orders');
    await t.db.execute(sql`UPDATE orders SET status = 'delivered'`);
    expect((await call(SUPERADMIN, 'PATCH', `/${id}`, { isActive: false })).json().isActive).toBe(false);
  });

  it('writes audit rows with ids and field names only', async () => {
    const created = (await call(SUPERADMIN, 'POST', '', body())).json();
    await call(SUPERADMIN, 'PATCH', `/${created.id}`, { feePerKm: 1500 });
    const rows = await t.db.execute<{ action: string; data: Record<string, unknown> }>(
      sql`SELECT action, data FROM audit_log WHERE action LIKE 'zone.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual(['zone.created', 'zone.updated']);
    expect(rows[1]?.data).toEqual({ fields: 'feePerKm' });
  });
});

describe('zones admin: boundaries on switched-off zones, and neighbours', () => {
  const t = withTestApp();
  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    t.app().inject({
      method,
      url: `/v1/admin/zones${url}`,
      payload: payload as object,
      headers: t.as(await t.signIn(SUPERADMIN)),
    });
  const townId = async () => (await call('GET', '')).json().zones[0].id as string;
  const townRing = async () => (await call('GET', '')).json().zones[0].boundary.coordinates[0];
  const bowTie = ring([
    [88.55, 24.3],
    [88.65, 24.4],
    [88.65, 24.3],
    [88.55, 24.4],
  ]);

  it('checks a new outline even when the same request switches the zone off', async () => {
    const before = await townRing();
    const res = await call('PATCH', `/${await townId()}`, { isActive: false, boundary: bowTie });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_zone');
    const after = (await call('GET', '')).json().zones[0];
    expect(after.boundary.coordinates[0]).toEqual(before);
    expect(after.isActive).toBe(true);
  });

  it('checks an outline sent to a zone that is already switched off', async () => {
    const id = await townId();
    expect((await call('PATCH', `/${id}`, { isActive: false })).statusCode).toBe(200);
    const res = await call('PATCH', `/${id}`, { boundary: bowTie });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_zone');
    const tooMany = Array.from({ length: 550 }, (_, i): [number, number] => [
      88.6 + 0.01 * Math.cos(i / 90),
      24.3 + 0.01 * Math.sin(i / 90),
    ]);
    expect((await call('PATCH', `/${id}`, { boundary: ring(tooMany) })).statusCode).toBe(400);
  });

  it('lets a switched-off zone take an outline that overlaps others, until it is switched back on', async () => {
    const id = await townId();
    await call('PATCH', `/${id}`, { isActive: false });
    const other = await call('POST', '', {
      slug: 'rajshahi',
      nameEn: 'Rajshahi',
      nameBn: 'Rajshahi',
      boundary: rajshahi,
      feePerKm: 1000,
      minFee: 2000,
      roadFactor: 1.3,
    });
    expect(other.statusCode).toBe(201);
    const overlapping = ring([
      [88.55, 24.3],
      [88.65, 24.3],
      [88.65, 24.45],
      [88.55, 24.45],
    ]);
    expect((await call('PATCH', `/${id}`, { boundary: overlapping })).statusCode).toBe(200);
    const back = await call('PATCH', `/${id}`, { isActive: true });
    expect(back.statusCode).toBe(400);
    expect(back.json().error.code).toBe('invalid_zone');
  });

  it('accepts a zone that only shares an edge with another', async () => {
    const neighbour = ring([
      [88.33, 24.55],
      [88.43, 24.55],
      [88.43, 24.65],
      [88.33, 24.65],
    ]);
    const res = await call('POST', '', {
      slug: 'next-door',
      nameEn: 'Next door',
      nameBn: 'Next door',
      boundary: neighbour,
      feePerKm: 1000,
      minFee: 2000,
      roadFactor: 1.3,
    });
    expect(res.statusCode).toBe(201);
  });
});
