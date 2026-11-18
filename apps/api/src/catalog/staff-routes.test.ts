import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const OWNER = '01711000002';
const ONBOARDING = '01711000006';
const SUPPORT = '01711000007';
const CUSTOMER = '01711000001';
const STAFF = '01711000050';
const OTHER_OWNER = '01711000051';

describe('staff controls', () => {
  const t = withTestApp();

  const put = async (phone: string, url: string, payload: unknown) =>
    t.app().inject({ method: 'PUT', url, payload: payload as object, headers: t.as(await t.signIn(phone)) });
  const audits = async (action: string) =>
    Number(
      (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE action = ${action}`))[0]?.n,
    );

  async function makeStaff(phone: string, restaurantId: string, role: 'staff' | 'owner' = 'staff') {
    await t.signIn(phone);
    await t.db.execute(sql`
      INSERT INTO restaurant_staff (restaurant_id, user_id, role)
      SELECT ${restaurantId}, id, ${role} FROM users WHERE phone = ${`+88${phone}`}`);
  }

  it('reports the controls, then lets staff switch the restaurant off and on', async () => {
    const id = t.demo().restaurantId;
    await makeStaff(STAFF, id);
    const controls = await t
      .app()
      .inject({ method: 'GET', url: `/v1/restaurants/${id}/controls`, headers: t.as(await t.signIn(STAFF)) });
    expect(controls.json()).toMatchObject({ switchOn: true, busyExtraMinutes: 0 });
    const off = await put(STAFF, `/v1/restaurants/${id}/open`, { isOpen: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ switchOn: false, isOpen: false });
    const on = await put(STAFF, `/v1/restaurants/${id}/open`, { isOpen: true });
    expect(on.json()).toMatchObject({ switchOn: true, isOpen: true });
  });

  it('sets busy mode to 0, 10 or 20 only', async () => {
    const id = t.demo().restaurantId;
    const ok = await put(OWNER, `/v1/restaurants/${id}/busy`, { extraMinutes: 20 });
    expect(ok.json()).toMatchObject({ busyExtraMinutes: 20 });
    const bad = await put(OWNER, `/v1/restaurants/${id}/busy`, { extraMinutes: 15 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_failed');
  });

  it('marks an item sold out and back, and the menu shows it', async () => {
    const id = t.demo().restaurantId;
    const item = t.demo().menuItemIds.beefCheeseBurger;
    const res = await put(OWNER, `/v1/restaurants/${id}/items/${item}/availability`, { isAvailable: false });
    expect(res.json()).toEqual({ id: item, isAvailable: false });
    const menu = (await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' })).json();
    const shown = menu.categories
      .flatMap((c: { items: { id: string; isAvailable: boolean }[] }) => c.items)
      .find((i: { id: string }) => i.id === item);
    expect(shown.isAvailable).toBe(false);
  });

  it('writes one audit row per change and none for a repeat', async () => {
    const id = t.demo().restaurantId;
    await put(OWNER, `/v1/restaurants/${id}/open`, { isOpen: false });
    await put(OWNER, `/v1/restaurants/${id}/open`, { isOpen: false });
    expect(await audits('restaurant.open_changed')).toBe(1);
    const item = t.demo().menuItemIds.coldCoffee;
    await put(OWNER, `/v1/restaurants/${id}/items/${item}/availability`, { isAvailable: false });
    await put(OWNER, `/v1/restaurants/${id}/items/${item}/availability`, { isAvailable: false });
    expect(await audits('item.availability_changed')).toBe(1);
  });

  it('answers 404 to a member of another restaurant and to a customer', async () => {
    const id = t.demo().restaurantId;
    const other = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, status)
        VALUES (${t.demo().zoneId}, 'other-place', 'Other', 'Other', 'Cafe', 'Cafe', 'x',
          ST_GeogFromText('SRID=4326;POINT(88.28 24.60)'), 'approved') RETURNING id`)
    )[0]?.id as string;
    await makeStaff(OTHER_OWNER, other, 'owner');
    expect((await put(OTHER_OWNER, `/v1/restaurants/${id}/open`, { isOpen: false })).statusCode).toBe(404);
    expect((await put(CUSTOMER, `/v1/restaurants/${id}/open`, { isOpen: false })).statusCode).toBe(404);
    expect((await put(SUPPORT, `/v1/restaurants/${id}/open`, { isOpen: false })).statusCode).toBe(404);
    const state = await t.db.execute<{ is_open: boolean }>(sql`SELECT is_open FROM restaurants WHERE id = ${id}`);
    expect(state[0]?.is_open).toBe(true);
  });

  it("answers 404 for another restaurant's item", async () => {
    const id = t.demo().restaurantId;
    const res = await put(OWNER, `/v1/restaurants/${id}/items/00000000-0000-4000-8000-000000000001/availability`, {
      isAvailable: false,
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets a team member who manages accounts do the same for any restaurant', async () => {
    const id = t.demo().restaurantId;
    const res = await put(ONBOARDING, `/v1/restaurants/${id}/busy`, { extraMinutes: 10 });
    expect(res.statusCode).toBe(200);
  });
});

describe('catalog write limit', () => {
  const t = withTestApp({ limits: { catalogWritesPerUserHour: 3 } });

  it('answers 429 once a user passes the hourly cap', async () => {
    const id = t.demo().restaurantId;
    const headers = t.as(await t.signIn(OWNER));
    const send = (n: number) =>
      t.app().inject({
        method: 'PUT',
        url: `/v1/restaurants/${id}/busy`,
        payload: { extraMinutes: n % 2 ? 10 : 0 },
        headers,
      });
    expect([(await send(1)).statusCode, (await send(2)).statusCode, (await send(3)).statusCode]).toEqual([
      200, 200, 200,
    ]);
    expect((await send(4)).statusCode).toBe(429);
  });
});
