import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';
import { distanceMeters, getMenuItems, getRestaurantForOrder } from './repo';

describe('restaurants and menus', () => {
  const t = withTestApp();
  const get = (url: string) => t.app().inject({ method: 'GET', url });

  it('lists Burger Lane with a delivery fee for a town-centre pin', async () => {
    const res = await get('/v1/restaurants?lat=24.5965&lng=88.2775');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.zone.slug).toBe('chapainawabganj');
    expect(body.restaurants).toHaveLength(1);
    expect(body.restaurants[0]).toMatchObject({ slug: 'burger-lane', nameEn: 'Burger Lane', isOpen: true });
    expect(body.restaurants[0].deliveryFee).toBe(2000);
  });

  it('returns no zone for Dhaka', async () => {
    const res = await get('/v1/restaurants?lat=23.8103&lng=90.4125');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ zone: null, restaurants: [] });
  });

  it('rejects latitude 91 with invalid_location', async () => {
    const res = await get('/v1/restaurants?lat=91&lng=88.27');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_location');
  });

  it('rejects one coordinate, empty coordinates and non-numbers with invalid_location', async () => {
    for (const q of ['lat=24.59', 'lng=88.27', 'lat=&lng=', 'lat=&lng=88.27', 'lat=abc&lng=88.27']) {
      const res = await get(`/v1/restaurants?${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error.code, q).toBe('invalid_location');
    }
  });

  it('lists every active-zone restaurant with no fee when no location is given', async () => {
    const res = await get('/v1/restaurants');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.zone).toBeNull();
    expect(body.restaurants[0]).toMatchObject({ slug: 'burger-lane', deliveryFee: null });
  });

  it('lists open restaurants before closed ones, each by name', async () => {
    await t.db.execute(sql`UPDATE restaurants SET is_open = false WHERE slug = 'burger-lane'`);
    await t.db.execute(sql`
      INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, is_open)
      SELECT zone_id, 'zed-cafe', 'Zed Cafe', 'জেড ক্যাফে', 'Cafe', 'ক্যাফে', 'Main Road',
        ST_GeogFromText('SRID=4326;POINT(88.2780 24.5970)'), true FROM restaurants WHERE slug = 'burger-lane'`);
    try {
      const res = await get('/v1/restaurants');
      expect(res.json().restaurants.map((r: { slug: string }) => r.slug)).toEqual(['zed-cafe', 'burger-lane']);
    } finally {
      await t.db.execute(sql`DELETE FROM restaurants WHERE slug = 'zed-cafe'`);
    }
  });

  it('returns the menu grouped by category in position order', async () => {
    const res = await get('/v1/restaurants/burger-lane?lat=24.5965&lng=88.2775');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deliveryFee).toBe(2000);
    expect(body.addressLine).toBe('Court Road, Chapainawabganj');
    expect(body.categories.map((c: { nameEn: string }) => c.nameEn)).toEqual(['Burgers', 'Pizza', 'Drinks']);
    const burgers = body.categories[0].items;
    expect(burgers.map((i: { nameEn: string }) => i.nameEn)).toEqual(['Beef Cheese Burger', 'Crispy Chicken Burger']);
    expect(burgers[0].price).toBe(38000);
  });

  it('shows a sold-out item as unavailable', async () => {
    const id = t.demo().menuItemIds.coldCoffee;
    await t.db.execute(sql`UPDATE menu_items SET is_available = false WHERE id = ${id}`);
    const res = await get('/v1/restaurants/burger-lane');
    const items = res.json().categories.flatMap((c: { items: { id: string }[] }) => c.items);
    expect(items.find((i: { id: string }) => i.id === id).isAvailable).toBe(false);
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await get('/v1/restaurants/no-such-place');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('catalog repo for ordering', () => {
  const t = withTestApp();

  it('reads a restaurant for an order', async () => {
    const r = await getRestaurantForOrder(t.db, t.demo().restaurantId);
    expect(r).toMatchObject({ id: t.demo().restaurantId, isOpen: true, nameEn: 'Burger Lane' });
    expect(r?.zoneId).toBe(t.demo().zoneId);
    expect(r?.location.lat).toBeCloseTo(24.596, 4);
    expect(r?.location.lng).toBeCloseTo(88.271, 4);
    expect(await getRestaurantForOrder(t.db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('reads only the requested items of that restaurant', async () => {
    const { restaurantId, menuItemIds } = t.demo();
    const items = await getMenuItems(t.db, restaurantId, [
      menuItemIds.beefCheeseBurger,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: menuItemIds.beefCheeseBurger, price: 38000, isAvailable: true });
    expect(await getMenuItems(t.db, restaurantId, [])).toEqual([]);
  });

  it('measures distance in meters', async () => {
    const d = await distanceMeters(t.db, { lat: 24.596, lng: 88.271 }, { lat: 24.596, lng: 88.281 });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1030);
  });
});
