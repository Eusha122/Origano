import { LocationQuery, type RestaurantDetail, type RestaurantListResponse } from '@oregano/contracts';
import { deliveryFee } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { popularItemIds } from '../ordering/popular';
import { findZoneForPoint, type Zone } from '../zones/repo';
import { publicImageUrl } from './images';
import { getMenu } from './menu-read';
import { findRestaurantBySlug, listRestaurants, type RestaurantRow, stateOf } from './repo';
import { formatMinute } from './state';

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

function summary(r: RestaurantRow, zone: Zone | null, now: Date) {
  const state = stateOf(r, now);
  return {
    id: r.id,
    slug: r.slug,
    nameEn: r.nameEn,
    nameBn: r.nameBn,
    cuisineEn: r.cuisineEn,
    cuisineBn: r.cuisineBn,
    isOpen: state.isOpen,
    opensAt: state.opensAt,
    prepMinutes: state.prepMinutes,
    coverImageUrl: publicImageUrl(r.coverImageKey, 'large'),
    deliveryFee: zone && r.zoneId === zone.id && r.distanceMeters !== null ? deliveryFee(r.distanceMeters, zone) : null,
  };
}

export function catalogRoutes(app: FastifyInstance, { db, clock }: Services): void {
  const now = () => (clock ? clock() : new Date());
  app.get('/restaurants', async (request): Promise<RestaurantListResponse> => {
    const point = parseLocation(request.query);
    if (!point) {
      const restaurants = await listRestaurants(db, {});
      return { zone: null, restaurants: restaurants.map((r) => summary(r, null, now())) };
    }
    const zone = await zoneFor(db, point);
    if (!zone) return { zone: null, restaurants: [] };
    const restaurants = await listRestaurants(db, { zoneId: zone.id, point });
    return {
      zone: { id: zone.id, slug: zone.slug, nameEn: zone.nameEn, nameBn: zone.nameBn },
      restaurants: restaurants.map((r) => summary(r, zone, now())),
    };
  });

  app.get<{ Params: { slug: string } }>('/restaurants/:slug', async (request): Promise<RestaurantDetail> => {
    const point = parseLocation(request.query);
    const zone = point ? await zoneFor(db, point) : null;
    const restaurant = await findRestaurantBySlug(db, request.params.slug, point ?? undefined);
    if (!restaurant) throw new AppError('not_found', 404, 'Not found.');
    const at = now();
    const categories = await getMenu(db, restaurant.id, at);
    return {
      ...summary(restaurant, zone, at),
      addressLine: restaurant.addressLine,
      hours: restaurant.intervals.map((i) => ({
        day: i.day,
        open: formatMinute(i.openMinute),
        close: formatMinute(i.closeMinute),
      })),
      popularItemIds: await popularItemIds(db, restaurant.id, 4),
      categories,
    };
  });
}
