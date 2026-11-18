import { type ItemBody, type ItemPatch, MAX_ITEMS_PER_RESTAURANT, type OptionsBody } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { AppError } from '../errors';

const notFound = () => new AppError('not_found', 404, 'Not found.');
const nameTaken = () => new AppError('invalid_menu_data', 409, 'That name is already used on this menu.');
const badList = () => new AppError('invalid_menu_data', 400, 'The list does not match this menu.');

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** The restaurant row is the lock that keeps counts and positions exact under concurrent edits. */
async function lockRestaurant(tx: Executor, restaurantId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM restaurants WHERE id = ${restaurantId} FOR UPDATE`);
}

export async function createCategory(
  tx: Executor,
  restaurantId: string,
  body: { nameEn: string; nameBn?: string },
): Promise<{ id: string; nameEn: string; nameBn: string }> {
  await lockRestaurant(tx, restaurantId);
  const rows = await tx.execute<{ id: string; name_en: string; name_bn: string }>(sql`
    INSERT INTO menu_categories (restaurant_id, name_en, name_bn, position)
    VALUES (${restaurantId}, ${body.nameEn}, ${body.nameBn ?? body.nameEn},
      (SELECT COALESCE(MAX(position), 0) + 1 FROM menu_categories WHERE restaurant_id = ${restaurantId}))
    ON CONFLICT ON CONSTRAINT menu_categories_restaurant_name_unique DO NOTHING
    RETURNING id, name_en, name_bn`);
  const row = rows[0];
  if (!row) throw nameTaken();
  return { id: row.id, nameEn: row.name_en, nameBn: row.name_bn };
}

export async function updateCategory(
  tx: Executor,
  restaurantId: string,
  categoryId: string,
  patch: { nameEn?: string; nameBn?: string },
): Promise<void> {
  try {
    const rows = await tx.execute(sql`
      UPDATE menu_categories SET name_en = COALESCE(${patch.nameEn ?? null}, name_en),
        name_bn = COALESCE(${patch.nameBn ?? null}, name_bn)
      WHERE id = ${categoryId} AND restaurant_id = ${restaurantId} AND NOT is_archived RETURNING id`);
    if (rows.length === 0) throw notFound();
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

/** Archives an empty category (its name is freed). Archived items in it do not count: they are already gone. */
export async function archiveCategory(tx: Executor, restaurantId: string, categoryId: string): Promise<void> {
  await lockRestaurant(tx, restaurantId);
  const found = await tx.execute(
    sql`SELECT id FROM menu_categories WHERE id = ${categoryId} AND restaurant_id = ${restaurantId} AND NOT is_archived`,
  );
  if (found.length === 0) throw notFound();
  const items = await tx.execute(
    sql`SELECT id FROM menu_items WHERE category_id = ${categoryId} AND NOT is_archived LIMIT 1`,
  );
  if (items.length > 0) throw new AppError('category_not_empty', 409, 'The category still has items.');
  await tx.execute(sql`
    UPDATE menu_categories SET is_archived = true, name_en = name_en || ' [archived ' || left(id::text, 8) || ']'
    WHERE id = ${categoryId}`);
}

async function applyOrder(
  tx: Executor,
  table: 'menu_categories' | 'menu_items',
  existing: string[],
  ids: string[],
): Promise<void> {
  if (ids.length !== existing.length || new Set(ids).size !== ids.length || !ids.every((id) => existing.includes(id))) {
    throw badList();
  }
  for (const [index, id] of ids.entries()) {
    await tx.execute(sql`UPDATE ${sql.raw(table)} SET position = ${index + 1} WHERE id = ${id}`);
  }
}

export async function reorderCategories(tx: Executor, restaurantId: string, ids: string[]): Promise<void> {
  await lockRestaurant(tx, restaurantId);
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM menu_categories WHERE restaurant_id = ${restaurantId} AND NOT is_archived`,
  );
  await applyOrder(
    tx,
    'menu_categories',
    rows.map((r) => r.id),
    ids,
  );
}

export async function reorderItems(
  tx: Executor,
  restaurantId: string,
  categoryId: string,
  ids: string[],
): Promise<void> {
  await lockRestaurant(tx, restaurantId);
  const category = await tx.execute(
    sql`SELECT id FROM menu_categories WHERE id = ${categoryId} AND restaurant_id = ${restaurantId} AND NOT is_archived`,
  );
  if (category.length === 0) throw notFound();
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM menu_items WHERE category_id = ${categoryId} AND NOT is_archived`,
  );
  await applyOrder(
    tx,
    'menu_items',
    rows.map((r) => r.id),
    ids,
  );
}

async function requireOwnCategory(tx: Executor, restaurantId: string, categoryId: string): Promise<void> {
  const rows = await tx.execute(
    sql`SELECT id FROM menu_categories WHERE id = ${categoryId} AND restaurant_id = ${restaurantId} AND NOT is_archived`,
  );
  if (rows.length === 0) throw notFound();
}

export async function createItem(
  tx: Executor,
  restaurantId: string,
  categoryId: string,
  body: ItemBody,
): Promise<string> {
  await lockRestaurant(tx, restaurantId);
  await requireOwnCategory(tx, restaurantId, categoryId);
  const count = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = ${restaurantId} AND NOT is_archived`,
  );
  if ((count[0]?.n ?? 0) >= MAX_ITEMS_PER_RESTAURANT) {
    throw new AppError('menu_limit_reached', 409, 'This menu already has the most items it can have.');
  }
  const rows = await tx.execute<{ id: string }>(sql`
    INSERT INTO menu_items (restaurant_id, category_id, name_en, name_bn, description_en, description_bn, price_poisha, position)
    VALUES (${restaurantId}, ${categoryId}, ${body.nameEn}, ${body.nameBn ?? body.nameEn},
      ${body.descriptionEn ?? null}, ${body.descriptionBn ?? body.descriptionEn ?? null}, ${body.price},
      (SELECT COALESCE(MAX(position), 0) + 1 FROM menu_items WHERE category_id = ${categoryId}))
    ON CONFLICT ON CONSTRAINT menu_items_restaurant_name_unique DO NOTHING RETURNING id`);
  const id = rows[0]?.id;
  if (!id) throw nameTaken();
  return id;
}

export async function updateItem(tx: Executor, restaurantId: string, itemId: string, patch: ItemPatch): Promise<void> {
  if (patch.categoryId) {
    await requireOwnCategory(tx, restaurantId, patch.categoryId);
  }
  const hasDescEn = patch.descriptionEn !== undefined;
  const hasDescBn = patch.descriptionBn !== undefined;
  try {
    const rows = await tx.execute(sql`
      UPDATE menu_items SET
        name_en = COALESCE(${patch.nameEn ?? null}, name_en),
        name_bn = COALESCE(${patch.nameBn ?? null}, name_bn),
        description_en = CASE WHEN ${hasDescEn} THEN ${patch.descriptionEn ?? null} ELSE description_en END,
        description_bn = CASE WHEN ${hasDescBn} THEN ${patch.descriptionBn ?? null} ELSE description_bn END,
        price_poisha = COALESCE(${patch.price ?? null}, price_poisha),
        category_id = COALESCE(${patch.categoryId ?? null}::uuid, category_id)
      WHERE id = ${itemId} AND restaurant_id = ${restaurantId} AND NOT is_archived RETURNING id`);
    if (rows.length === 0) throw notFound();
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

/** Hides an item for good but keeps the row, because past orders point at it. Its name is freed for a new item. */
export async function archiveItem(tx: Executor, restaurantId: string, itemId: string): Promise<void> {
  const rows = await tx.execute(sql`
    UPDATE menu_items SET is_archived = true, is_available = false,
      name_en = name_en || ' [archived ' || left(id::text, 8) || ']'
    WHERE id = ${itemId} AND restaurant_id = ${restaurantId} AND NOT is_archived RETURNING id`);
  if (rows.length === 0) throw notFound();
}

/** Replaces every option group of an item in one transaction. */
export async function replaceOptions(
  tx: Executor,
  restaurantId: string,
  itemId: string,
  body: OptionsBody,
): Promise<void> {
  const item = await tx.execute(
    sql`SELECT id FROM menu_items WHERE id = ${itemId} AND restaurant_id = ${restaurantId} AND NOT is_archived FOR UPDATE`,
  );
  if (item.length === 0) throw notFound();
  await tx.execute(sql`DELETE FROM option_groups WHERE menu_item_id = ${itemId}`);
  for (const [gi, group] of body.groups.entries()) {
    const rows = await tx.execute<{ id: string }>(sql`
      INSERT INTO option_groups (menu_item_id, name_en, name_bn, min_select, max_select, position)
      VALUES (${itemId}, ${group.nameEn}, ${group.nameBn ?? group.nameEn}, ${group.minSelect}, ${group.maxSelect}, ${gi + 1})
      RETURNING id`);
    const groupId = rows[0]?.id as string;
    for (const [oi, option] of group.options.entries()) {
      await tx.execute(sql`
        INSERT INTO options (group_id, name_en, name_bn, price_delta_poisha, is_available, position)
        VALUES (${groupId}, ${option.nameEn}, ${option.nameBn ?? option.nameEn}, ${option.priceDelta},
          ${option.isAvailable ?? true}, ${oi + 1})`);
    }
  }
}
