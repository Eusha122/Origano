import type { PopularTermsResponse, SearchResponse } from '@oregano/contracts';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { popularDishNames } from '../ordering/popular';
import { getMenu } from './menu-read';
import { listRestaurantsByIds } from './repo';
import { parseLocation, summary, zoneFor } from './routes';
import { listCuisineTerms, matchDishes, matchRestaurantIds } from './search-repo';

const MAX_RESTAURANTS = 10;
const MAX_DISHES = 20;
const MAX_TERMS = 8;

const badQuery = () => new AppError('validation_failed', 400, 'Some details are missing or wrong.');

export function searchRoutes(app: FastifyInstance, { db, clock }: Services): void {
  const now = () => (clock ? clock() : new Date());

  app.get('/search', async (request): Promise<SearchResponse> => {
    const raw = (request.query as Record<string, unknown>).q;
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (q.length < 2 || q.length > 60) throw badQuery();
    const point = parseLocation(request.query);
    const zone = point ? await zoneFor(db, point) : null;
    if (point && !zone) return { restaurants: [], dishes: [] };
    const at = now();

    const restaurantIds = await matchRestaurantIds(db, q, zone?.id);
    const dishHits = await matchDishes(db, q, zone?.id);
    const dishRestaurantIds = [...new Set(dishHits.map((d) => d.restaurantId))].slice(0, MAX_RESTAURANTS);
    const rows = await listRestaurantsByIds(
      db,
      [...new Set([...restaurantIds, ...dishRestaurantIds])],
      point ?? undefined,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const summaryOf = (id: string) => {
      const r = byId.get(id);
      return r ? summary(r, zone, at) : null;
    };

    // Open restaurants first; within each group the best match stays first.
    const matched = restaurantIds.map((id) => summaryOf(id)).filter((s) => s !== null);
    const restaurants = [...matched.filter((s) => s.isOpen), ...matched.filter((s) => !s.isOpen)].slice(
      0,
      MAX_RESTAURANTS,
    );

    const menus = new Map<string, Awaited<ReturnType<typeof getMenu>>>();
    for (const id of dishRestaurantIds) menus.set(id, await getMenu(db, id, at));
    const dishes: SearchResponse['dishes'] = [];
    for (const hit of dishHits) {
      const restaurant = summaryOf(hit.restaurantId);
      const item = menus
        .get(hit.restaurantId)
        ?.flatMap((c) => c.items)
        .find((i) => i.id === hit.id);
      if (!restaurant || !item) continue;
      dishes.push({
        item: {
          id: item.id,
          nameEn: item.nameEn,
          nameBn: item.nameBn,
          price: item.price,
          originalPrice: item.originalPrice,
          imageUrl: item.imageUrl,
          isAvailable: item.isAvailable,
        },
        restaurant,
      });
      if (dishes.length === MAX_DISHES) break;
    }
    return { restaurants, dishes };
  });

  /** What to suggest when the box is empty: dishes ordered most in the last 14 days, then cuisines. */
  app.get('/search/popular', async (request): Promise<PopularTermsResponse> => {
    const point = parseLocation(request.query);
    const zone = point ? await zoneFor(db, point) : null;
    const dishNames = await popularDishNames(db, zone?.id ?? null, MAX_TERMS);
    const cuisines = await listCuisineTerms(db, zone?.id);
    const terms: string[] = [];
    for (const term of [...dishNames, ...cuisines]) {
      if (!terms.some((t) => t.toLowerCase() === term.toLowerCase())) terms.push(term);
    }
    return { terms: terms.slice(0, MAX_TERMS) };
  });
}
