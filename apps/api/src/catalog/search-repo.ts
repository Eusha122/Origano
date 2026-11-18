import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

const SIMILARITY = 0.3;

/** Wraps the customer's words for ILIKE, so `%`, `_` and `\` in them match themselves instead of acting as wildcards. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

const zoneFilter = (zoneId: string | undefined) => (zoneId ? sql`r.zone_id = ${zoneId}` : sql`z.is_active`);

/** Approved restaurants whose name or cuisine contains the words or is spelled close to them, best first. */
export async function matchRestaurantIds(db: Db, q: string, zoneId: string | undefined): Promise<string[]> {
  const like = containsPattern(q);
  const rows = await db.execute<{ id: string }>(sql`
    SELECT r.id FROM restaurants r JOIN zones z ON z.id = r.zone_id
    WHERE r.status = 'approved' AND ${zoneFilter(zoneId)}
      AND (r.name_en ILIKE ${like} OR r.cuisine_en ILIKE ${like}
        OR similarity(r.name_en, ${q}) > ${SIMILARITY} OR similarity(r.cuisine_en, ${q}) > ${SIMILARITY})
    ORDER BY GREATEST(
        similarity(r.name_en, ${q}), similarity(r.cuisine_en, ${q}),
        CASE WHEN r.name_en ILIKE ${like} OR r.cuisine_en ILIKE ${like} THEN 0.9 ELSE 0 END) DESC,
      r.name_en
    LIMIT 30`);
  return rows.map((r) => r.id);
}

/** Dishes you can order now (on an approved restaurant's menu, in stock) that match, best first. */
export async function matchDishes(
  db: Db,
  q: string,
  zoneId: string | undefined,
): Promise<{ id: string; restaurantId: string }[]> {
  const like = containsPattern(q);
  const rows = await db.execute<{ id: string; restaurant_id: string }>(sql`
    SELECT i.id, i.restaurant_id FROM menu_items i
    JOIN restaurants r ON r.id = i.restaurant_id JOIN zones z ON z.id = r.zone_id
    WHERE NOT i.is_archived AND i.is_available AND r.status = 'approved' AND ${zoneFilter(zoneId)}
      AND (i.name_en ILIKE ${like} OR similarity(i.name_en, ${q}) > ${SIMILARITY})
    ORDER BY GREATEST(similarity(i.name_en, ${q}), CASE WHEN i.name_en ILIKE ${like} THEN 0.9 ELSE 0 END) DESC,
      i.name_en
    LIMIT 40`);
  return rows.map((r) => ({ id: r.id, restaurantId: r.restaurant_id }));
}

/** Cuisine words of the approved restaurants in a zone (or every active zone), most common first. */
export async function listCuisineTerms(db: Db, zoneId: string | undefined): Promise<string[]> {
  const rows = await db.execute<{ cuisine_en: string }>(sql`
    SELECT r.cuisine_en FROM restaurants r JOIN zones z ON z.id = r.zone_id
    WHERE r.status = 'approved' AND ${zoneFilter(zoneId)}`);
  const counts = new Map<string, { label: string; n: number }>();
  for (const row of rows) {
    for (const part of row.cuisine_en.split(',')) {
      const label = part.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      counts.set(key, { label: counts.get(key)?.label ?? label, n: (counts.get(key)?.n ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((c) => c.label);
}
