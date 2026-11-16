import { type Money, poisha } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';

type Point = { lat: number; lng: number };

export type RestaurantRow = {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  cuisineEn: string;
  cuisineBn: string;
  addressLine: string;
  isOpen: boolean;
  prepMinutes: number;
  zoneId: string;
  /** Straight-line meters from the given point; null when no point was given. */
  distanceMeters: number | null;
};

type RestaurantDbRow = {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  cuisine_en: string;
  cuisine_bn: string;
  address_line: string;
  is_open: boolean;
  prep_minutes: number;
  zone_id: string;
  distance_m: number | null;
};

function toRestaurantRow(r: RestaurantDbRow): RestaurantRow {
  return {
    id: r.id,
    slug: r.slug,
    nameEn: r.name_en,
    nameBn: r.name_bn,
    cuisineEn: r.cuisine_en,
    cuisineBn: r.cuisine_bn,
    addressLine: r.address_line,
    isOpen: r.is_open,
    prepMinutes: r.prep_minutes,
    zoneId: r.zone_id,
    distanceMeters: r.distance_m === null ? null : Number(r.distance_m),
  };
}

function distanceColumn(point: Point | undefined) {
  return point
    ? sql`ST_Distance(r.location, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)`
    : sql`NULL`;
}

/** Open restaurants first, then closed, each by name. `zoneId` limits to one zone; otherwise every active zone. */
export async function listRestaurants(db: Db, opts: { zoneId?: string; point?: Point }): Promise<RestaurantRow[]> {
  const zoneFilter = opts.zoneId ? sql`r.zone_id = ${opts.zoneId}` : sql`z.is_active`;
  const rows = await db.execute<RestaurantDbRow>(sql`
    SELECT r.id, r.slug, r.name_en, r.name_bn, r.cuisine_en, r.cuisine_bn, r.address_line,
      r.is_open, r.prep_minutes, r.zone_id, ${distanceColumn(opts.point)} AS distance_m
    FROM restaurants r JOIN zones z ON z.id = r.zone_id
    WHERE ${zoneFilter}
    ORDER BY r.is_open DESC, r.name_en ASC`);
  return rows.map(toRestaurantRow);
}

export async function findRestaurantBySlug(db: Db, slug: string, point?: Point): Promise<RestaurantRow | null> {
  const rows = await db.execute<RestaurantDbRow>(sql`
    SELECT r.id, r.slug, r.name_en, r.name_bn, r.cuisine_en, r.cuisine_bn, r.address_line,
      r.is_open, r.prep_minutes, r.zone_id, ${distanceColumn(point)} AS distance_m
    FROM restaurants r WHERE r.slug = ${slug}`);
  const row = rows[0];
  return row ? toRestaurantRow(row) : null;
}

export type MenuCategoryRow = {
  id: string;
  nameEn: string;
  nameBn: string;
  items: {
    id: string;
    nameEn: string;
    nameBn: string;
    descriptionEn: string | null;
    descriptionBn: string | null;
    price: Money;
    isAvailable: boolean;
  }[];
};

/** Categories in position order, each with its items in position order. Empty categories are kept. */
export async function getMenu(db: Db, restaurantId: string): Promise<MenuCategoryRow[]> {
  const categories = await db.execute<{ id: string; name_en: string; name_bn: string }>(sql`
    SELECT id, name_en, name_bn FROM menu_categories WHERE restaurant_id = ${restaurantId} ORDER BY position, name_en`);
  const items = await db.execute<{
    id: string;
    category_id: string;
    name_en: string;
    name_bn: string;
    description_en: string | null;
    description_bn: string | null;
    price_poisha: number;
    is_available: boolean;
  }>(sql`
    SELECT id, category_id, name_en, name_bn, description_en, description_bn, price_poisha, is_available
    FROM menu_items WHERE restaurant_id = ${restaurantId} ORDER BY position, name_en`);
  return categories.map((c) => ({
    id: c.id,
    nameEn: c.name_en,
    nameBn: c.name_bn,
    items: items
      .filter((i) => i.category_id === c.id)
      .map((i) => ({
        id: i.id,
        nameEn: i.name_en,
        nameBn: i.name_bn,
        descriptionEn: i.description_en,
        descriptionBn: i.description_bn,
        price: poisha(i.price_poisha),
        isAvailable: i.is_available,
      })),
  }));
}

export type RestaurantForOrder = {
  id: string;
  zoneId: string;
  isOpen: boolean;
  nameEn: string;
  nameBn: string;
  location: { lat: number; lng: number };
};

export async function getRestaurantForOrder(db: Executor, id: string): Promise<RestaurantForOrder | null> {
  const rows = await db.execute<{
    id: string;
    zone_id: string;
    is_open: boolean;
    name_en: string;
    name_bn: string;
    lat: number;
    lng: number;
  }>(sql`
    SELECT id, zone_id, is_open, name_en, name_bn,
      ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM restaurants WHERE id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    zoneId: r.zone_id,
    isOpen: r.is_open,
    nameEn: r.name_en,
    nameBn: r.name_bn,
    location: { lat: Number(r.lat), lng: Number(r.lng) },
  };
}

/** The requested items that belong to this restaurant. Unknown ids and other restaurants' items are left out. */
export async function getMenuItems(
  db: Executor,
  restaurantId: string,
  ids: string[],
): Promise<{ id: string; restaurantId: string; nameEn: string; nameBn: string; price: Money; isAvailable: boolean }[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{
    id: string;
    restaurant_id: string;
    name_en: string;
    name_bn: string;
    price_poisha: number;
    is_available: boolean;
  }>(sql`
    SELECT id, restaurant_id, name_en, name_bn, price_poisha, is_available
    FROM menu_items
    WHERE restaurant_id = ${restaurantId} AND id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  return rows.map((r) => ({
    id: r.id,
    restaurantId: r.restaurant_id,
    nameEn: r.name_en,
    nameBn: r.name_bn,
    price: poisha(r.price_poisha),
    isAvailable: r.is_available,
  }));
}

/** Straight-line distance in meters between two points (PostGIS geography). */
export async function distanceMeters(db: Executor, from: Point, to: Point): Promise<number> {
  const rows = await db.execute<{ d: number }>(sql`
    SELECT ST_Distance(
      ST_SetSRID(ST_MakePoint(${from.lng}, ${from.lat}), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${to.lng}, ${to.lat}), 4326)::geography) AS d`);
  const row = rows[0];
  if (!row) throw new Error('Distance query returned no row');
  return Number(row.d);
}
