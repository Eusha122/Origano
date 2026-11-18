import { type Discount, type Money, type OptionGroupRule, poisha } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { liveDiscounts } from './menu-read';

export type PricingOption = OptionGroupRule['options'][number] & { nameEn: string; nameBn: string };
export type PricingGroup = Omit<OptionGroupRule, 'options'> & { options: PricingOption[] };

/** Everything the server needs to price one order line, read at `now`. */
export type PricingItem = {
  id: string;
  nameEn: string;
  nameBn: string;
  /** The base price before options and discounts. */
  price: Money;
  isAvailable: boolean;
  groups: PricingGroup[];
  /** The live discounts that apply to this item (the whole menu, its category, or the item itself). */
  discounts: Discount[];
};

/** The requested items that are on this restaurant's menu (not archived), with their options and live discounts. */
export async function getPricingContext(
  db: Executor,
  restaurantId: string,
  itemIds: string[],
  now: Date,
): Promise<PricingItem[]> {
  if (itemIds.length === 0) return [];
  const list = sql.join(
    itemIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const items = await db.execute<{
    id: string;
    category_id: string;
    name_en: string;
    name_bn: string;
    price_poisha: number;
    is_available: boolean;
  }>(sql`
    SELECT id, category_id, name_en, name_bn, price_poisha, is_available FROM menu_items
    WHERE restaurant_id = ${restaurantId} AND NOT is_archived AND id IN (${list})`);
  const groups = await db.execute<{ id: string; menu_item_id: string; min_select: number; max_select: number }>(sql`
    SELECT id, menu_item_id, min_select, max_select FROM option_groups
    WHERE menu_item_id IN (${list}) ORDER BY position, id`);
  const options = await db.execute<{
    id: string;
    group_id: string;
    name_en: string;
    name_bn: string;
    price_delta_poisha: number;
    is_available: boolean;
  }>(sql`
    SELECT o.id, o.group_id, o.name_en, o.name_bn, o.price_delta_poisha, o.is_available
    FROM options o JOIN option_groups g ON g.id = o.group_id
    WHERE g.menu_item_id IN (${list}) ORDER BY o.position, o.id`);
  const discounts = await liveDiscounts(db, restaurantId, now);

  return items.map((i) => ({
    id: i.id,
    nameEn: i.name_en,
    nameBn: i.name_bn,
    price: poisha(i.price_poisha),
    isAvailable: i.is_available,
    groups: groups
      .filter((g) => g.menu_item_id === i.id)
      .map((g) => ({
        id: g.id,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        options: options
          .filter((o) => o.group_id === g.id)
          .map((o) => ({
            id: o.id,
            nameEn: o.name_en,
            nameBn: o.name_bn,
            priceDelta: poisha(o.price_delta_poisha),
            isAvailable: o.is_available,
          })),
      })),
    discounts: discounts.filter(
      (d) =>
        d.scope === 'menu' ||
        (d.scope === 'item' && d.menuItemId === i.id) ||
        (d.scope === 'category' && d.categoryId === i.category_id),
    ),
  }));
}
