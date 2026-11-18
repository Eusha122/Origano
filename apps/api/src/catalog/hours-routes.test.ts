import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const OWNER = '01711000002';
const STAFF = '01711000050';

describe('opening hours and prep time', () => {
  const t = withTestApp();
  const url = (path: string) => `/v1/restaurants/${t.demo().restaurantId}${path}`;
  const call = async (phone: string, method: 'GET' | 'PUT', path: string, payload?: unknown) =>
    t.app().inject({ method, url: url(path), payload: payload as object, headers: t.as(await t.signIn(phone)) });

  async function makeStaff() {
    await t.signIn(STAFF);
    await t.db.execute(sql`
      INSERT INTO restaurant_staff (restaurant_id, user_id, role)
      SELECT ${t.demo().restaurantId}, id, 'staff' FROM users WHERE phone = '+8801711000050'`);
  }

  it('round-trips hours, and stores an after-midnight close as minutes past 24:00', async () => {
    const intervals = [
      { day: 1, open: '11:00', close: '15:00' },
      { day: 1, open: '18:00', close: '02:00' },
    ];
    const res = await call(OWNER, 'PUT', '/hours', { intervals });
    expect(res.statusCode).toBe(200);
    expect(res.json().intervals).toEqual(intervals);
    const rows = await t.db.execute<{ close_minute: number }>(
      sql`SELECT close_minute FROM restaurant_hours WHERE open_minute = 1080`,
    );
    expect(rows[0]?.close_minute).toBe(1560);
    expect((await call(OWNER, 'GET', '/hours')).json().intervals).toEqual(intervals);
  });

  it('refuses overlapping intervals, including one spilling into the next morning', async () => {
    const overlap = [
      { day: 1, open: '11:00', close: '15:00' },
      { day: 1, open: '14:00', close: '20:00' },
    ];
    expect((await call(OWNER, 'PUT', '/hours', { intervals: overlap })).json().error.code).toBe('invalid_hours');
    const spill = [
      { day: 1, open: '20:00', close: '02:00' },
      { day: 2, open: '01:00', close: '10:00' },
    ];
    expect((await call(OWNER, 'PUT', '/hours', { intervals: spill })).statusCode).toBe(400);
  });

  it('refuses a close after 04:00 the next day, bad times, 4 intervals on a day and day 7', async () => {
    const bad = (i: unknown[]) => call(OWNER, 'PUT', '/hours', { intervals: i });
    expect((await bad([{ day: 1, open: '18:00', close: '05:00' }])).statusCode).toBe(400);
    expect((await bad([{ day: 1, open: '25:00', close: '05:00' }])).statusCode).toBe(400);
    expect((await bad([{ day: 7, open: '10:00', close: '12:00' }])).statusCode).toBe(400);
    const four = [60, 300, 600, 900].map((m) => ({
      day: 2,
      open: `${String(Math.floor(m / 60)).padStart(2, '0')}:00`,
      close: `${String(Math.floor(m / 60) + 2).padStart(2, '0')}:00`,
    }));
    expect((await bad(four)).statusCode).toBe(400);
  });

  it('an empty list clears the hours, so the restaurant is never auto-closed', async () => {
    expect((await call(OWNER, 'PUT', '/hours', { intervals: [] })).statusCode).toBe(200);
    const rows = await t.db.execute(sql`SELECT 1 FROM restaurant_hours`);
    expect(rows).toHaveLength(0);
  });

  it('lets staff read the hours but only an owner change them', async () => {
    await makeStaff();
    expect((await call(STAFF, 'GET', '/hours')).statusCode).toBe(200);
    expect((await call(STAFF, 'PUT', '/hours', { intervals: [] })).statusCode).toBe(403);
    expect((await call(STAFF, 'PUT', '/prep', { prepMinutes: 30 })).statusCode).toBe(403);
    expect(
      Number((await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM restaurant_hours`))[0]?.n),
    ).toBe(7);
  });

  it('sets the prep time between 5 and 120 minutes', async () => {
    const ok = await call(OWNER, 'PUT', '/prep', { prepMinutes: 35 });
    expect(ok.json()).toMatchObject({ prepMinutes: 35 });
    for (const prepMinutes of [4, 121, 20.5]) {
      expect((await call(OWNER, 'PUT', '/prep', { prepMinutes })).statusCode, String(prepMinutes)).toBe(400);
    }
  });

  it('writes audit rows for hours and prep changes', async () => {
    await call(OWNER, 'PUT', '/hours', { intervals: [{ day: 3, open: '10:00', close: '12:00' }] });
    await call(OWNER, 'PUT', '/prep', { prepMinutes: 40 });
    const rows = await t.db.execute<{ action: string }>(
      sql`SELECT action FROM audit_log WHERE action LIKE 'restaurant.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual(['restaurant.hours_replaced', 'restaurant.prep_changed']);
  });
});
