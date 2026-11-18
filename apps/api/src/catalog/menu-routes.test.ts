import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const OWNER = '01711000002';
const STAFF = '01711000050';
const CUSTOMER = '01711000001';

describe('menu manager', () => {
  const t = withTestApp();
  const base = () => `/v1/restaurants/${t.demo().restaurantId}`;

  const call = async (
    phone: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    t
      .app()
      .inject({ method, url: `${base()}${url}`, payload: payload as object, headers: t.as(await t.signIn(phone)) });

  const menu = async () =>
    (await call(OWNER, 'GET', '/menu')).json().categories as {
      id: string;
      nameEn: string;
      items: { id: string; nameEn: string; price: number; optionGroups: { options: { nameEn: string }[] }[] }[];
    }[];

  async function makeStaff() {
    await t.signIn(STAFF);
    await t.db.execute(sql`
      INSERT INTO restaurant_staff (restaurant_id, user_id, role)
      SELECT ${t.demo().restaurantId}, id, 'staff' FROM users WHERE phone = '+8801711000050'`);
  }

  it('creates a category and an item, defaulting Bangla to the English text', async () => {
    const cat = await call(OWNER, 'POST', '/categories', { nameEn: 'Sides' });
    expect(cat.statusCode).toBe(201);
    expect(cat.json()).toMatchObject({ nameEn: 'Sides', nameBn: 'Sides' });
    const item = await call(OWNER, 'POST', `/categories/${cat.json().id}/items`, { nameEn: 'Fries', price: 12000 });
    expect(item.statusCode).toBe(201);
    expect(item.json()).toMatchObject({ nameEn: 'Fries', nameBn: 'Fries', price: 12000, isAvailable: true });
    const shown = (await menu()).find((c) => c.nameEn === 'Sides');
    expect(shown?.items.map((i) => i.nameEn)).toEqual(['Fries']);
  });

  it('refuses a duplicate name and a price outside Tk 1 to Tk 50,000', async () => {
    const cat = (await menu())[0];
    const dup = await call(OWNER, 'POST', '/categories', { nameEn: cat?.nameEn });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('invalid_menu_data');
    for (const price of [0, 99, 5_000_001, 12.5]) {
      const res = await call(OWNER, 'POST', `/categories/${cat?.id}/items`, { nameEn: `X${price}`, price });
      expect(res.statusCode, String(price)).toBe(400);
    }
  });

  it('updates an item and moves it between categories', async () => {
    const [first, second] = await menu();
    const item = first?.items[0];
    const res = await call(OWNER, 'PATCH', `/items/${item?.id}`, { price: 31000, categoryId: second?.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ price: 31000 });
    expect((await menu()).find((c) => c.id === second?.id)?.items.map((i) => i.id)).toContain(item?.id);
  });

  it('gives every route a 403 to staff who are not owners, and a 404 to a customer', async () => {
    await makeStaff();
    const cat = (await menu())[0];
    const item = cat?.items[0];
    const calls: [string, string, unknown?][] = [
      ['POST', '/categories', { nameEn: 'Nope' }],
      ['PATCH', `/categories/${cat?.id}`, { nameEn: 'Nope' }],
      ['DELETE', `/categories/${cat?.id}`],
      ['PUT', '/categories/order', { ids: [] }],
      ['POST', `/categories/${cat?.id}/items`, { nameEn: 'Nope', price: 10000 }],
      ['PATCH', `/items/${item?.id}`, { price: 10000 }],
      ['DELETE', `/items/${item?.id}`],
      ['PUT', `/items/${item?.id}/options`, { groups: [] }],
    ];
    for (const [method, url, body] of calls) {
      expect((await call(STAFF, method as 'POST', url, body)).statusCode, `${method} ${url}`).toBe(403);
      expect((await call(CUSTOMER, method as 'POST', url, body)).statusCode, `customer ${method} ${url}`).toBe(404);
    }
    expect((await call(STAFF, 'GET', '/menu')).statusCode).toBe(200);
  });

  it('reorders categories only with exactly the restaurant categories, and writes nothing on a bad list', async () => {
    const cats = await menu();
    const ids = cats.map((c) => c.id);
    const ok = await call(OWNER, 'PUT', '/categories/order', { ids: [...ids].reverse() });
    expect(ok.statusCode).toBe(200);
    expect((await menu()).map((c) => c.id)).toEqual([...ids].reverse());
    const bad = await call(OWNER, 'PUT', '/categories/order', {
      ids: [...ids.slice(1), '00000000-0000-4000-8000-000000000001'],
    });
    expect(bad.statusCode).toBe(400);
    expect((await menu()).map((c) => c.id)).toEqual([...ids].reverse());
  });

  it('refuses to delete a category that has items, and archives an empty one', async () => {
    const withItems = (await menu())[0];
    const refused = await call(OWNER, 'DELETE', `/categories/${withItems?.id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('category_not_empty');
    const empty = await call(OWNER, 'POST', '/categories', { nameEn: 'Empty' });
    expect((await call(OWNER, 'DELETE', `/categories/${empty.json().id}`)).statusCode).toBe(200);
    expect((await menu()).map((c) => c.nameEn)).not.toContain('Empty');
    expect((await call(OWNER, 'POST', '/categories', { nameEn: 'Empty' })).statusCode).toBe(201);
  });

  it('archives an item that was ordered: it vanishes from the public menu and its name is free again', async () => {
    const item = (await menu())[0]?.items[0];
    const res = await call(OWNER, 'DELETE', `/items/${item?.id}`);
    expect(res.statusCode).toBe(200);
    const pub = (await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' })).json();
    const ids = pub.categories.flatMap((c: { items: { id: string }[] }) => c.items.map((i) => i.id));
    expect(ids).not.toContain(item?.id);
    const again = await call(OWNER, 'POST', `/categories/${(await menu())[0]?.id}/items`, {
      nameEn: item?.nameEn,
      price: 20000,
    });
    expect(again.statusCode).toBe(201);
  });

  it('replaces option groups atomically and rejects a bad set without touching the old one', async () => {
    const item = (await menu())[0]?.items[0];
    const good = {
      groups: [
        {
          nameEn: 'Size',
          minSelect: 1,
          maxSelect: 1,
          options: [
            { nameEn: 'Regular', priceDelta: 0 },
            { nameEn: 'Large', priceDelta: 3000 },
          ],
        },
        {
          nameEn: 'Extras',
          minSelect: 0,
          maxSelect: 2,
          options: [
            { nameEn: 'Cheese', priceDelta: 2000 },
            { nameEn: 'Egg', priceDelta: 1500 },
          ],
        },
      ],
    };
    expect((await call(OWNER, 'PUT', `/items/${item?.id}/options`, good)).statusCode).toBe(200);
    const bad = {
      groups: [
        good.groups[1],
        { nameEn: 'Broken', minSelect: 2, maxSelect: 1, options: [{ nameEn: 'A', priceDelta: 0 }] },
      ],
    };
    const res = await call(OWNER, 'PUT', `/items/${item?.id}/options`, bad);
    expect(res.statusCode).toBe(400);
    const groups = (await menu())[0]?.items.find((i) => i.id === item?.id)?.optionGroups;
    expect(groups?.map((g) => g.options.map((o) => o.nameEn))).toEqual([
      ['Regular', 'Large'],
      ['Cheese', 'Egg'],
    ]);
    expect((await call(OWNER, 'PUT', `/items/${item?.id}/options`, { groups: [] })).statusCode).toBe(200);
    expect((await menu())[0]?.items.find((i) => i.id === item?.id)?.optionGroups).toEqual([]);
  });

  it('refuses more than 200 items in a restaurant', async () => {
    const cat = (await menu())[0];
    await t.db.execute(sql`
      INSERT INTO menu_items (restaurant_id, category_id, name_en, name_bn, price_poisha, position)
      SELECT ${t.demo().restaurantId}, ${cat?.id}, 'Bulk ' || g, 'Bulk ' || g, 10000, 100 + g
      FROM generate_series(1, 200 - (SELECT count(*) FROM menu_items WHERE restaurant_id = ${t.demo().restaurantId})::int) g`);
    const res = await call(OWNER, 'POST', `/categories/${cat?.id}/items`, { nameEn: 'One too many', price: 10000 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('menu_limit_reached');
  });

  it('records an audit row for each structural change, with ids only', async () => {
    const cat = await call(OWNER, 'POST', '/categories', { nameEn: 'Audited' });
    await call(OWNER, 'POST', `/categories/${cat.json().id}/items`, { nameEn: 'Secret dish name', price: 10000 });
    const rows = await t.db.execute<{ action: string; data: unknown }>(
      sql`SELECT action, data FROM audit_log WHERE action LIKE 'menu.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual(['menu.category_created', 'menu.item_created']);
    expect(JSON.stringify(rows)).not.toContain('Secret dish name');
  });
});
