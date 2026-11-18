import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const OWNER = '01711000002';
const STAFF = '01711000050';

describe('restaurant discounts', () => {
  const t = withTestApp();
  const url = (path: string) => `/v1/restaurants/${t.demo().restaurantId}${path}`;
  const call = async (phone: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown) =>
    t.app().inject({ method, url: url(path), payload: payload as object, headers: t.as(await t.signIn(phone)) });
  const itemId = () => t.demo().menuItemIds.beefCheeseBurger;
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  const body = (over: Record<string, unknown> = {}) => ({
    kind: 'percent',
    value: 15,
    scope: 'item',
    menuItemId: itemId(),
    startsAt: future(-1),
    endsAt: future(5),
    ...over,
  });

  it('creates, lists, pauses and deletes a discount, and the public menu follows', async () => {
    const created = await call(OWNER, 'POST', '/discounts', body());
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: 'percent', value: 15, scope: 'item', isActive: true });
    const id = created.json().id;
    const publicItem = async () =>
      (await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' }))
        .json()
        .categories.flatMap((c: { items: { id: string; discountLabel: unknown }[] }) => c.items)
        .find((i: { id: string }) => i.id === itemId());
    expect((await publicItem()).discountLabel).toEqual({ kind: 'percent', value: 15 });
    expect((await call(OWNER, 'GET', '/discounts')).json().discounts).toHaveLength(1);
    const paused = await call(OWNER, 'PATCH', `/discounts/${id}`, { isActive: false });
    expect(paused.json().isActive).toBe(false);
    expect((await publicItem()).discountLabel).toBeNull();
    expect((await call(OWNER, 'DELETE', `/discounts/${id}`)).statusCode).toBe(200);
    expect((await call(OWNER, 'GET', '/discounts')).json().discounts).toHaveLength(0);
  });

  it('lists a discount that has not started yet for the owner but not on the public menu', async () => {
    await call(OWNER, 'POST', '/discounts', body({ startsAt: future(2), endsAt: future(4) }));
    expect((await call(OWNER, 'GET', '/discounts')).json().discounts).toHaveLength(1);
    const item = (await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' }))
      .json()
      .categories.flatMap((c: { items: { id: string; discountLabel: unknown }[] }) => c.items)
      .find((i: { id: string }) => i.id === itemId());
    expect(item.discountLabel).toBeNull();
  });

  it('refuses bad values, scopes, targets and dates', async () => {
    const bad = (over: Record<string, unknown>) => call(OWNER, 'POST', '/discounts', body(over));
    for (const over of [
      { value: 95 },
      { value: 0 },
      { kind: 'amount', value: 0 },
      { scope: 'item', menuItemId: undefined },
      { scope: 'menu', menuItemId: itemId() },
      { scope: 'category', menuItemId: undefined, categoryId: undefined },
      { endsAt: future(-2) },
      { menuItemId: '00000000-0000-4000-8000-000000000001' },
    ]) {
      const res = await bad(over);
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(res.json().error.code).toBe('invalid_discount');
    }
  });

  it('refuses a target that belongs to another restaurant', async () => {
    const other = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, status)
        VALUES (${t.demo().zoneId}, 'other-place', 'Other', 'Other', 'Cafe', 'Cafe', 'x',
          ST_GeogFromText('SRID=4326;POINT(88.28 24.60)'), 'approved') RETURNING id`)
    )[0]?.id;
    const cat = (
      await t.db.execute<{ id: string }>(
        sql`INSERT INTO menu_categories (restaurant_id, name_en, name_bn, position) VALUES (${other}, 'C', 'C', 1) RETURNING id`,
      )
    )[0]?.id;
    const res = await call(
      OWNER,
      'POST',
      '/discounts',
      body({ scope: 'category', menuItemId: undefined, categoryId: cat }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('allows at most 20 live discounts', async () => {
    for (let n = 0; n < 20; n++) {
      expect((await call(OWNER, 'POST', '/discounts', body({ value: 5 + (n % 80) }))).statusCode).toBe(201);
    }
    const res = await call(OWNER, 'POST', '/discounts', body());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_discount');
  });

  it('is owner only', async () => {
    await t.signIn(STAFF);
    await t.db.execute(sql`
      INSERT INTO restaurant_staff (restaurant_id, user_id, role)
      SELECT ${t.demo().restaurantId}, id, 'staff' FROM users WHERE phone = '+8801711000050'`);
    expect((await call(STAFF, 'GET', '/discounts')).statusCode).toBe(403);
    expect((await call(STAFF, 'POST', '/discounts', body())).statusCode).toBe(403);
  });

  it('writes audit rows', async () => {
    const id = (await call(OWNER, 'POST', '/discounts', body())).json().id;
    await call(OWNER, 'PATCH', `/discounts/${id}`, { isActive: false });
    await call(OWNER, 'DELETE', `/discounts/${id}`);
    const rows = await t.db.execute<{ action: string }>(
      sql`SELECT action FROM audit_log WHERE action LIKE 'discount.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual(['discount.created', 'discount.updated', 'discount.deleted']);
  });
});
