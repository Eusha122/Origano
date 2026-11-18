import {
  CategoryBody,
  CategoryPatch,
  ItemBody,
  ItemPatch,
  type MenuItem,
  OptionsBody,
  OrderIdsBody,
} from '@oregano/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { AuditAction } from '../admin/audit';
import { writeAudit } from '../admin/audit';
import type { Services } from '../app';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { isUuid } from '../ordering/repo';
import { requireCatalogActor } from './access';
import { getMenu, type MenuCategoryRow } from './menu-read';
import {
  archiveCategory,
  archiveItem,
  createCategory,
  createItem,
  reorderCategories,
  reorderItems,
  replaceOptions,
  updateCategory,
  updateItem,
} from './menu-repo';

const notFound = () => new AppError('not_found', 404, 'Not found.');
const invalidBody = () => new AppError('invalid_menu_data', 400, 'Some menu details are missing or wrong.');

/** Owners see and edit the base price, so every discount is shown as the price before it. */
function ownerView(categories: MenuCategoryRow[]): MenuCategoryRow[] {
  return categories.map((c) => ({
    ...c,
    items: c.items.map((i) => ({ ...i, price: i.originalPrice ?? i.price, originalPrice: null, discountLabel: null })),
  }));
}

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw invalidBody();
  return result.data;
}

export function menuRoutes(app: FastifyInstance, { db, clock }: Services): void {
  const now = () => (clock ? clock() : new Date());
  const menuOf = async (restaurantId: string) => ownerView(await getMenu(db, restaurantId, now()));
  const itemOf = async (restaurantId: string, itemId: string): Promise<MenuItem> => {
    const item = (await menuOf(restaurantId)).flatMap((c) => c.items).find((i) => i.id === itemId);
    if (!item) throw notFound();
    return item;
  };

  /** The caller must be an owner (or an Oregano team member who manages accounts); returns the user id. */
  const owner = async (request: FastifyRequest<{ Params: { id: string } }>): Promise<string> => {
    const user = requireUser(request);
    await requireCatalogActor(db, user, request.params.id, 'owner');
    return user.id;
  };
  const audit = (
    tx: Parameters<typeof writeAudit>[0],
    request: FastifyRequest,
    userId: string,
    action: AuditAction,
    targetType: string,
    targetId: string,
  ) =>
    writeAudit(tx, {
      actor: { type: 'user', id: userId },
      action,
      targetType,
      targetId,
      requestId: request.id,
    });
  const checkId = (value: string) => {
    if (!isUuid(value)) throw notFound();
  };

  app.get<{ Params: { id: string } }>('/restaurants/:id/menu', async (request) => {
    const user = requireUser(request);
    await requireCatalogActor(db, user, request.params.id, 'staff');
    return { categories: await menuOf(request.params.id) };
  });

  app.post<{ Params: { id: string } }>('/restaurants/:id/categories', async (request, reply) => {
    const userId = await owner(request);
    const body = parse(CategoryBody, request.body);
    const created = await db.transaction(async (tx) => {
      const c = await createCategory(tx, request.params.id, body);
      await audit(tx, request, userId, 'menu.category_created', 'menu_category', c.id);
      return c;
    });
    return reply.code(201).send(created);
  });

  app.put<{ Params: { id: string } }>('/restaurants/:id/categories/order', async (request) => {
    const userId = await owner(request);
    const { ids } = parse(OrderIdsBody, request.body);
    await db.transaction(async (tx) => {
      await reorderCategories(tx, request.params.id, ids);
      await audit(tx, request, userId, 'menu.categories_reordered', 'restaurant', request.params.id);
    });
    return { categories: await menuOf(request.params.id) };
  });

  app.patch<{ Params: { id: string; cid: string } }>('/restaurants/:id/categories/:cid', async (request) => {
    const userId = await owner(request);
    checkId(request.params.cid);
    const body = parse(CategoryPatch, request.body);
    await db.transaction(async (tx) => {
      await updateCategory(tx, request.params.id, request.params.cid, body);
      await audit(tx, request, userId, 'menu.category_updated', 'menu_category', request.params.cid);
    });
    const category = (await menuOf(request.params.id)).find((c) => c.id === request.params.cid);
    if (!category) throw notFound();
    return { id: category.id, nameEn: category.nameEn, nameBn: category.nameBn };
  });

  app.delete<{ Params: { id: string; cid: string } }>('/restaurants/:id/categories/:cid', async (request) => {
    const userId = await owner(request);
    checkId(request.params.cid);
    await db.transaction(async (tx) => {
      await archiveCategory(tx, request.params.id, request.params.cid);
      await audit(tx, request, userId, 'menu.category_deleted', 'menu_category', request.params.cid);
    });
    return { categories: await menuOf(request.params.id) };
  });

  app.post<{ Params: { id: string; cid: string } }>(
    '/restaurants/:id/categories/:cid/items',
    async (request, reply) => {
      const userId = await owner(request);
      checkId(request.params.cid);
      const body = parse(ItemBody, request.body);
      const itemId = await db.transaction(async (tx) => {
        const id = await createItem(tx, request.params.id, request.params.cid, body);
        await audit(tx, request, userId, 'menu.item_created', 'menu_item', id);
        return id;
      });
      return reply.code(201).send(await itemOf(request.params.id, itemId));
    },
  );

  app.put<{ Params: { id: string; cid: string } }>('/restaurants/:id/categories/:cid/items/order', async (request) => {
    const userId = await owner(request);
    checkId(request.params.cid);
    const { ids } = parse(OrderIdsBody, request.body);
    await db.transaction(async (tx) => {
      await reorderItems(tx, request.params.id, request.params.cid, ids);
      await audit(tx, request, userId, 'menu.categories_reordered', 'menu_category', request.params.cid);
    });
    return { categories: await menuOf(request.params.id) };
  });

  app.patch<{ Params: { id: string; itemId: string } }>('/restaurants/:id/items/:itemId', async (request) => {
    const userId = await owner(request);
    checkId(request.params.itemId);
    const body = parse(ItemPatch, request.body);
    await db.transaction(async (tx) => {
      await updateItem(tx, request.params.id, request.params.itemId, body);
      await audit(tx, request, userId, 'menu.item_updated', 'menu_item', request.params.itemId);
    });
    return itemOf(request.params.id, request.params.itemId);
  });

  app.delete<{ Params: { id: string; itemId: string } }>('/restaurants/:id/items/:itemId', async (request) => {
    const userId = await owner(request);
    checkId(request.params.itemId);
    await db.transaction(async (tx) => {
      await archiveItem(tx, request.params.id, request.params.itemId);
      await audit(tx, request, userId, 'menu.item_archived', 'menu_item', request.params.itemId);
    });
    return { categories: await menuOf(request.params.id) };
  });

  app.put<{ Params: { id: string; itemId: string } }>('/restaurants/:id/items/:itemId/options', async (request) => {
    const userId = await owner(request);
    checkId(request.params.itemId);
    const body = parse(OptionsBody, request.body);
    await db.transaction(async (tx) => {
      await replaceOptions(tx, request.params.id, request.params.itemId, body);
      await audit(tx, request, userId, 'menu.options_replaced', 'menu_item', request.params.itemId);
    });
    return itemOf(request.params.id, request.params.itemId);
  });
}
