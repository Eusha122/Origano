import { bestDiscount, type Discount, type Money, poisha } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { publicImageUrl } from './images';

export type OptionRow = {
  id: string;
  nameEn: string;
  nameBn: string;
  priceDelta: Money;
  isAvailable: boolean;
};

export type OptionGroupRow = {
  id: string;
  nameEn: string;
  nameBn: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: OptionRow[];
};

export type MenuItemRow = {
  id: string;
  nameEn: string;
  nameBn: string;
  descriptionEn: string | null;
  descriptionBn: string | null;
  /** What one unit costs now: the base price minus the best live discount. */
  price: Money;
  /** The base price, set only while a discount applies. */
  originalPrice: Money | null;
  discountLabel: { kind: 'percent' | 'amount'; value: number } | null;
  imageUrl: string | null;
  isAvailable: boolean;
  optionGroups: OptionGroupRow[];
};

export type MenuCategoryRow = { id: string; nameEn: string; nameBn: string; items: MenuItemRow[] };

type DiscountRow = {
  kind: 'percent' | 'amount';
  value: number;
  scope: 'item' | 'category' | 'menu';
  menu_item_id: string | null;
  category_id: string | null;
};

/** Live discounts of a restaurant at `now`: active, started and not yet ended. */
export async function liveDiscounts(db: Db, restaurantId: string, now: Date): Promise<Discount[]> {
  const rows = await db.execute<DiscountRow>(sql`
    SELECT kind, value, scope, menu_item_id, category_id FROM restaurant_discounts
    WHERE restaurant_id = ${restaurantId} AND is_active
      AND starts_at <= ${now.toISOString()}::timestamptz AND ends_at > ${now.toISOString()}::timestamptz`);
  return rows.map((d) => ({
    kind: d.kind,
    value: d.value,
    scope: d.scope,
    menuItemId: d.menu_item_id,
    categoryId: d.category_id,
  }));
}

/** Categories in position order, each with its visible items. Empty categories are kept; archived items are not. */
export async function getMenu(db: Db, restaurantId: string, now: Date): Promise<MenuCategoryRow[]> {
  const categories = await db.execute<{ id: string; name_en: string; name_bn: string }>(sql`
    SELECT id, name_en, name_bn FROM menu_categories WHERE restaurant_id = ${restaurantId} AND NOT is_archived
    ORDER BY position, name_en`);
  const items = await db.execute<{
    id: string;
    category_id: string;
    name_en: string;
    name_bn: string;
    description_en: string | null;
    description_bn: string | null;
    price_poisha: number;
    is_available: boolean;
    image_key: string | null;
  }>(sql`
    SELECT id, category_id, name_en, name_bn, description_en, description_bn, price_poisha, is_available, image_key
    FROM menu_items WHERE restaurant_id = ${restaurantId} AND NOT is_archived ORDER BY position, name_en`);
  const groups = await db.execute<{
    id: string;
    menu_item_id: string;
    name_en: string;
    name_bn: string;
    min_select: number;
    max_select: number;
  }>(sql`
    SELECT g.id, g.menu_item_id, g.name_en, g.name_bn, g.min_select, g.max_select
    FROM option_groups g JOIN menu_items i ON i.id = g.menu_item_id
    WHERE i.restaurant_id = ${restaurantId} ORDER BY g.position, g.name_en`);
  const options = await db.execute<{
    id: string;
    group_id: string;
    name_en: string;
    name_bn: string;
    price_delta_poisha: number;
    is_available: boolean;
  }>(sql`
    SELECT o.id, o.group_id, o.name_en, o.name_bn, o.price_delta_poisha, o.is_available
    FROM options o JOIN option_groups g ON g.id = o.group_id JOIN menu_items i ON i.id = g.menu_item_id
    WHERE i.restaurant_id = ${restaurantId} ORDER BY o.position, o.name_en`);
  const discounts = await liveDiscounts(db, restaurantId, now);

  const groupsFor = (itemId: string): OptionGroupRow[] =>
    groups
      .filter((g) => g.menu_item_id === itemId)
      .map((g) => ({
        id: g.id,
        nameEn: g.name_en,
        nameBn: g.name_bn,
        required: g.min_select >= 1,
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
      }));

  return categories.map((c) => ({
    id: c.id,
    nameEn: c.name_en,
    nameBn: c.name_bn,
    items: items
      .filter((i) => i.category_id === c.id)
      .map((i) => {
        const base = poisha(i.price_poisha);
        const applicable = discounts.filter(
          (d) =>
            d.scope === 'menu' ||
            (d.scope === 'item' && d.menuItemId === i.id) ||
            (d.scope === 'category' && d.categoryId === i.category_id),
        );
        const { discount, off } = bestDiscount(base, applicable);
        return {
          id: i.id,
          nameEn: i.name_en,
          nameBn: i.name_bn,
          descriptionEn: i.description_en,
          descriptionBn: i.description_bn,
          price: poisha(base - off),
          originalPrice: discount ? base : null,
          discountLabel: discount ? { kind: discount.kind, value: discount.value } : null,
          imageUrl: publicImageUrl(i.image_key, 'small'),
          isAvailable: i.is_available,
          optionGroups: groupsFor(i.id),
        };
      }),
  }));
}
