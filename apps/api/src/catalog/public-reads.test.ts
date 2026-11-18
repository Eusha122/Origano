import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

// 2026-11-19 is a Thursday. Dhaka is UTC+6.
let now = new Date('2026-11-19T06:00:00Z'); // 12:00 in Dhaka

describe('restaurant reads: effective state, options, discounts', () => {
  const t = withTestApp({ clock: () => now });
  const detail = async () => (await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' })).json();

  async function setHours(open: number, close: number) {
    await t.db.execute(
      sql`DELETE FROM restaurant_hours WHERE restaurant_id = (SELECT id FROM restaurants WHERE slug = 'burger-lane')`,
    );
    await t.db.execute(sql`
      INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
      SELECT r.id, d, ${open}, ${close} FROM restaurants r, generate_series(0, 6) d WHERE r.slug = 'burger-lane'`);
  }

  it('is closed outside the hours even with the switch on, and says when it opens', async () => {
    await setHours(660, 1320);
    now = new Date('2026-11-19T17:00:00Z'); // 23:00
    const body = await detail();
    expect(body).toMatchObject({ isOpen: false, opensAt: '11:00' });
    expect(body.categories.length).toBeGreaterThan(0); // the menu stays visible
    now = new Date('2026-11-19T06:00:00Z'); // 12:00
    expect(await detail()).toMatchObject({ isOpen: true, opensAt: null });
  });

  it('is closed with the switch off and has no opening time', async () => {
    await setHours(660, 1320);
    await t.db.execute(sql`UPDATE restaurants SET is_open = false WHERE slug = 'burger-lane'`);
    now = new Date('2026-11-19T06:00:00Z');
    expect(await detail()).toMatchObject({ isOpen: false, opensAt: null });
  });

  it('is never auto-closed when it has no hours', async () => {
    await t.db.execute(sql`DELETE FROM restaurant_hours`);
    now = new Date('2026-11-19T21:00:00Z'); // 03:00
    expect(await detail()).toMatchObject({ isOpen: true, opensAt: null });
  });

  it('keeps a restaurant open after midnight from the day before', async () => {
    await setHours(1080, 1560); // 18:00 to 02:00
    now = new Date('2026-11-19T19:00:00Z'); // Friday 01:00
    expect(await detail()).toMatchObject({ isOpen: true });
    now = new Date('2026-11-19T21:00:00Z'); // Friday 03:00
    expect(await detail()).toMatchObject({ isOpen: false, opensAt: '18:00' });
  });

  it('adds busy minutes to the prep time and reports hours, cover and popular items', async () => {
    now = new Date('2026-11-19T06:00:00Z');
    await t.db.execute(sql`UPDATE restaurants SET busy_extra_minutes = 10 WHERE slug = 'burger-lane'`);
    const body = await detail();
    expect(body.prepMinutes).toBe(30);
    expect(body.coverImageUrl).toBeNull();
    expect(body.popularItemIds).toEqual([]);
    expect(body.hours).toHaveLength(7);
    expect(body.hours[0]).toEqual({ day: 0, open: '00:00', close: '00:00' });
  });

  it('shows a live discount as the price, the original and a label; an expired one does nothing', async () => {
    now = new Date('2026-11-19T06:00:00Z');
    const before = (await detail()).categories[0].items[0];
    await t.db.execute(sql`
      INSERT INTO restaurant_discounts (restaurant_id, kind, value, scope, menu_item_id, starts_at, ends_at)
      VALUES ((SELECT restaurant_id FROM menu_items WHERE id = ${before.id}), 'percent', 20, 'item', ${before.id},
        '2026-11-19T00:00:00Z', '2026-11-20T00:00:00Z')`);
    const during = (await detail()).categories[0].items[0];
    expect(during.originalPrice).toBe(before.price);
    expect(during.price).toBeLessThan(before.price);
    expect(during.discountLabel).toEqual({ kind: 'percent', value: 20 });
    now = new Date('2026-11-21T06:00:00Z');
    const after = (await detail()).categories[0].items[0];
    expect(after).toMatchObject({ price: before.price, originalPrice: null, discountLabel: null });
  });

  it('lists option groups in position order with required and prices', async () => {
    now = new Date('2026-11-19T06:00:00Z');
    const item = (await detail()).categories[0].items[0];
    const g = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO option_groups (menu_item_id, name_en, name_bn, min_select, max_select, position)
        VALUES (${item.id}, 'Size', 'Size', 1, 1, 1) RETURNING id`)
    )[0];
    await t.db.execute(sql`
      INSERT INTO options (group_id, name_en, name_bn, price_delta_poisha, position)
      VALUES (${g?.id}, 'Large', 'Large', 3000, 2), (${g?.id}, 'Regular', 'Regular', 0, 1)`);
    const groups = (await detail()).categories[0].items[0].optionGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ nameEn: 'Size', required: true, minSelect: 1, maxSelect: 1 });
    expect(groups[0].options.map((o: { nameEn: string; priceDelta: number }) => [o.nameEn, o.priceDelta])).toEqual([
      ['Regular', 0],
      ['Large', 3000],
    ]);
  });

  it('hides archived items', async () => {
    now = new Date('2026-11-19T06:00:00Z');
    const item = (await detail()).categories[0].items[0];
    await t.db.execute(sql`UPDATE menu_items SET is_archived = true WHERE id = ${item.id}`);
    const ids = (await detail()).categories.flatMap((c: { items: { id: string }[] }) => c.items.map((i) => i.id));
    expect(ids).not.toContain(item.id);
  });

  it('the list shows the effective open state and opening time', async () => {
    await setHours(660, 1320);
    now = new Date('2026-11-19T17:00:00Z');
    const res = await t.app().inject({ method: 'GET', url: '/v1/restaurants' });
    expect(res.json().restaurants[0]).toMatchObject({ slug: 'burger-lane', isOpen: false, opensAt: '11:00' });
  });
});
