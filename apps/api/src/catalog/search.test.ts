import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

type Hit = { slug: string; isOpen: boolean };

describe('search', () => {
  const t = withTestApp();
  const search = async (q: string, extra = '') =>
    t.app().inject({ method: 'GET', url: `/v1/search?q=${encodeURIComponent(q)}${extra}` });
  const names = (r: { restaurants: { nameEn: string }[] }) => r.restaurants.map((x) => x.nameEn);
  const dishes = (r: { dishes: { item: { nameEn: string } }[] }) => r.dishes.map((d) => d.item.nameEn);

  async function addRestaurant(
    slug: string,
    name: string,
    cuisine: string,
    opts: { status?: string; open?: boolean; zoneId?: string } = {},
  ) {
    const row = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, is_open, status)
        VALUES (${opts.zoneId ?? t.demo().zoneId}, ${slug}, ${name}, ${name}, ${cuisine}, ${cuisine}, 'Main Road',
          ST_GeogFromText('SRID=4326;POINT(88.2780 24.5970)'), ${opts.open ?? true}, ${opts.status ?? 'approved'})
        RETURNING id`)
    )[0]?.id as string;
    await t.db.execute(sql`
      INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
      SELECT ${row}, d, 0, 1440 FROM generate_series(0, 6) d`);
    return row;
  }

  it('finds restaurants by name and dishes by name, grouped', async () => {
    const res = await search('bur');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(names(body)).toContain('Burger Lane');
    expect(dishes(body)).toEqual(expect.arrayContaining(['Beef Cheese Burger', 'Crispy Chicken Burger']));
    expect(body.dishes[0].restaurant.slug).toBe('burger-lane');
  });

  it('finds restaurants by cuisine', async () => {
    await addRestaurant('biryani-house', 'Haji House', 'Biryani');
    expect(names((await search('biryani')).json())).toContain('Haji House');
  });

  it('still finds a close misspelling', async () => {
    await addRestaurant('biryani-house', 'Haji House', 'Biryani');
    expect(names((await search('biriyani')).json())).toContain('Haji House');
  });

  it('matches percent and underscore signs literally, not as wildcards', async () => {
    for (const q of ['%%', '__', 'b_r', '\\\\']) {
      const body = (await search(q)).json();
      expect(body.restaurants, q).toEqual([]);
      expect(body.dishes, q).toEqual([]);
    }
  });

  it('refuses a one-character or over-long query', async () => {
    expect((await search('b')).statusCode).toBe(400);
    expect((await search('x'.repeat(61))).statusCode).toBe(400);
    expect((await t.app().inject({ method: 'GET', url: '/v1/search' })).statusCode).toBe(400);
  });

  it('never shows a suspended restaurant or an archived or sold-out dish', async () => {
    await addRestaurant('burger-ban', 'Burger Ban', 'Burgers', { status: 'suspended' });
    expect(names((await search('burger')).json())).not.toContain('Burger Ban');
    await t.db.execute(sql`UPDATE menu_items SET is_available = false WHERE id = ${t.demo().menuItemIds.coldCoffee}`);
    expect(dishes((await search('cold')).json())).toEqual([]);
    await t.db.execute(
      sql`UPDATE menu_items SET is_archived = true WHERE id = ${t.demo().menuItemIds.crispyChickenBurger}`,
    );
    expect(dishes((await search('crispy')).json())).toEqual([]);
  });

  it('keeps to the customer zone when a location is given', async () => {
    const zone2 = (
      await t.db.execute<{ id: string }>(sql`
        INSERT INTO zones (slug, name_en, name_bn, boundary, fee_per_km_poisha, min_fee_poisha)
        VALUES ('dhaka-test', 'Dhaka', 'Dhaka',
          ST_GeogFromText('SRID=4326;POLYGON((90.30 23.70, 90.50 23.70, 90.50 23.90, 90.30 23.90, 90.30 23.70))'), 1000, 2000)
        RETURNING id`)
    )[0]?.id as string;
    await addRestaurant('dhaka-burger', 'Dhaka Burger', 'Burgers', { zoneId: zone2 });
    const inTown = (await search('burger', '&lat=24.5965&lng=88.2775')).json();
    expect(names(inTown)).toEqual(['Burger Lane']);
    expect(names((await search('burger')).json())).toEqual(expect.arrayContaining(['Burger Lane', 'Dhaka Burger']));
  });

  it('lists open restaurants before closed ones', async () => {
    await addRestaurant('burrito-bar', 'Burrito Bar', 'Mexican');
    await t.db.execute(sql`UPDATE restaurants SET is_open = false WHERE slug = 'burger-lane'`);
    const body = (await search('bur')).json();
    expect(body.restaurants.map((r: Hit) => r.slug)).toEqual(['burrito-bar', 'burger-lane']);
  });

  it('shows a discounted dish price with its original', async () => {
    await t.db.execute(sql`
      INSERT INTO restaurant_discounts (restaurant_id, kind, value, scope, starts_at, ends_at)
      VALUES (${t.demo().restaurantId}, 'percent', 10, 'menu', now() - interval '1 day', now() + interval '1 day')`);
    const dish = (await search('cold coffee')).json().dishes[0].item;
    expect(dish.originalPrice).toBe(18000);
    expect(dish.price).toBe(16200);
  });

  it('suggests popular terms: cuisines when nothing was ordered, ordered dishes first after', async () => {
    const empty = (await t.app().inject({ method: 'GET', url: '/v1/search/popular' })).json();
    expect(empty.terms).toEqual(expect.arrayContaining(['Burgers', 'pizza']));
    const token = await t.signIn('01711000001');
    const order = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(token), 'idempotency-key': 'popular-key-0001' },
      payload: {
        restaurantId: t.demo().restaurantId,
        items: [{ menuItemId: t.demo().menuItemIds.coldCoffee, quantity: 3 }],
        delivery: { lat: 24.5965, lng: 88.2775, addressLine: 'Court Road', landmark: 'Gate', phone: '01711000001' },
      },
    });
    expect(order.statusCode).toBe(201);
    const after = (await t.app().inject({ method: 'GET', url: '/v1/search/popular' })).json();
    expect(after.terms[0]).toBe('Cold Coffee');
    expect(after.terms.length).toBeLessThanOrEqual(8);
  });
});

describe('search limit', () => {
  const t = withTestApp({ limits: { searchPerIpMinute: 2 } });
  it('answers 429 after the per-minute cap', async () => {
    const get = () => t.app().inject({ method: 'GET', url: '/v1/search?q=burger' });
    expect([(await get()).statusCode, (await get()).statusCode]).toEqual([200, 200]);
    expect((await get()).statusCode).toBe(429);
  });
});
