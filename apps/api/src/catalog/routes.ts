import { LocationQuery, type RestaurantDetail, type RestaurantListResponse } from '@oregano/contracts';
import { deliveryFee } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { findZoneForPoint, type Zone } from '../zones/repo';
import { findRestaurantBySlug, getMenu, listRestaurants, type RestaurantRow } from './repo';

const invalidLocation = () => new AppError('invalid_location', 400, 'That location is not valid.');

/**
 * The customer's point, or null when neither coordinate was sent. Sending only one, an empty one
 * or a non-number is an error (the contract's number coercion would turn an empty value into 0).
 */
function parseLocation(query: unknown): { lat: number; lng: number } | null {
  const q = (query ?? {}) as Record<string, unknown>;
  if (q.lat === undefined && q.lng === undefined) return null;
  if (typeof q.lat !== 'string' || typeof q.lng !== 'string' || q.lat.trim() === '' || q.lng.trim() === '') {
    throw invalidLocation();
  }
  const parsed = LocationQuery.safeParse(q);
  if (!parsed.success) throw invalidLocation();
  return parsed.data;
}

async function zoneFor(db: Services['db'], point: { lat: number; lng: number }): Promise<Zone | null> {
  try {
    return await findZoneForPoint(db, point);
  } catch (error) {
    if (error instanceof RangeError) throw invalidLocation();
    throw error;
  }
}

function summary(r: RestaurantRow, zone: Zone | null) {
  return {
    id: r.id,
    slug: r.slug,
    nameEn: r.nameEn,
    nameBn: r.nameBn,
    cuisineEn: r.cuisineEn,
    cuisineBn: r.cuisineBn,
    isOpen: r.isOpen,
    prepMinutes: r.prepMinutes,
    deliveryFee: zone && r.zoneId === zone.id && r.distanceMeters !== null ? deliveryFee(r.distanceMeters, zone) : null,
  };
}

export function catalogRoutes(app: FastifyInstance, { db }: Services): void {
  app.get('/restaurants', async (request): Promise<RestaurantListResponse> => {
    const point = parseLocation(request.query);
    if (!point) {
      const restaurants = await listRestaurants(db, {});
      return { zone: null, restaurants: restaurants.map((r) => summary(r, null)) };
    }
    const zone = await zoneFor(db, point);
    if (!zone) return { zone: null, restaurants: [] };
    const restaurants = await listRestaurants(db, { zoneId: zone.id, point });
    return {
      zone: { id: zone.id, slug: zone.slug, nameEn: zone.nameEn, nameBn: zone.nameBn },
      restaurants: restaurants.map((r) => summary(r, zone)),
    };
  });

  app.get<{ Params: { slug: string } }>('/restaurants/:slug', async (request): Promise<RestaurantDetail> => {
    const point = parseLocation(request.query);
    const zone = point ? await zoneFor(db, point) : null;
    const restaurant = await findRestaurantBySlug(db, request.params.slug, point ?? undefined);
    if (!restaurant) throw new AppError('not_found', 404, 'Not found.');
    const categories = await getMenu(db, restaurant.id);
    return { ...summary(restaurant, zone), addressLine: restaurant.addressLine, categories };
  });
}
