import { type Discount, DiscountBody, DiscountPatch } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../admin/audit';
import type { Services } from '../app';
import type { Executor } from '../db/client';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { isUuid } from '../ordering/repo';
import { requireCatalogActor } from './access';

const invalidDiscount = (status = 400) => new AppError('invalid_discount', status, 'That discount does not work.');
const MAX_LIVE = 20;

type Row = {
  id: string;
  kind: 'percent' | 'amount';
  value: number;
  scope: 'item' | 'category' | 'menu';
  menu_item_id: string | null;
  category_id: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

const COLUMNS = sql`id, kind, value, scope, menu_item_id, category_id, starts_at, ends_at, is_active`;

const toDiscount = (r: Row): Discount => ({
  id: r.id,
  kind: r.kind,
  value: r.value,
  scope: r.scope,
  menuItemId: r.menu_item_id,
  categoryId: r.category_id,
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: new Date(r.ends_at).toISOString(),
  isActive: r.is_active,
});

async function requireTarget(tx: Executor, restaurantId: string, body: DiscountBody): Promise<void> {
  if (body.scope === 'item') {
    const rows = await tx.execute(
      sql`SELECT id FROM menu_items WHERE id = ${body.menuItemId} AND restaurant_id = ${restaurantId} AND NOT is_archived`,
    );
    if (rows.length === 0) throw invalidDiscount();
  } else if (body.scope === 'category') {
    const rows = await tx.execute(
      sql`SELECT id FROM menu_categories WHERE id = ${body.categoryId} AND restaurant_id = ${restaurantId} AND NOT is_archived`,
    );
    if (rows.length === 0) throw invalidDiscount();
  }
}

export function discountRoutes(app: FastifyInstance, { db }: Services): void {
  const owner = async (request: { user?: unknown; params: { id: string } }) => {
    const user = requireUser(request as Parameters<typeof requireUser>[0]);
    await requireCatalogActor(db, user, request.params.id, 'owner');
    return user.id;
  };

  app.get<{ Params: { id: string } }>('/restaurants/:id/discounts', async (request) => {
    await owner(request);
    const rows = await db.execute<Row>(
      sql`SELECT ${COLUMNS} FROM restaurant_discounts WHERE restaurant_id = ${request.params.id}
          ORDER BY ends_at DESC, id`,
    );
    return { discounts: rows.map(toDiscount) };
  });

  app.post<{ Params: { id: string } }>('/restaurants/:id/discounts', async (request, reply) => {
    const userId = await owner(request);
    const parsed = DiscountBody.safeParse(request.body);
    if (!parsed.success) throw invalidDiscount();
    const body = parsed.data;
    // A discount that has already ended is not worth creating.
    if (new Date(body.endsAt).getTime() <= Date.now()) throw invalidDiscount();
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM restaurants WHERE id = ${request.params.id} FOR UPDATE`);
      await requireTarget(tx, request.params.id, body);
      const live = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM restaurant_discounts
        WHERE restaurant_id = ${request.params.id} AND is_active AND ends_at > now()`);
      if ((live[0]?.n ?? 0) >= MAX_LIVE) throw invalidDiscount(409);
      const rows = await tx.execute<Row>(sql`
        INSERT INTO restaurant_discounts (restaurant_id, kind, value, scope, menu_item_id, category_id, starts_at, ends_at)
        VALUES (${request.params.id}, ${body.kind}, ${body.value}, ${body.scope}, ${body.menuItemId ?? null},
          ${body.categoryId ?? null}, ${body.startsAt}::timestamptz, ${body.endsAt}::timestamptz)
        RETURNING ${COLUMNS}`);
      const row = rows[0] as Row;
      await writeAudit(tx, {
        actor: { type: 'user', id: userId },
        action: 'discount.created',
        targetType: 'discount',
        targetId: row.id,
        data: { kind: body.kind, scope: body.scope },
        requestId: request.id,
      });
      return toDiscount(row);
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string; did: string } }>('/restaurants/:id/discounts/:did', async (request) => {
    const userId = await owner(request);
    if (!isUuid(request.params.did)) throw new AppError('not_found', 404, 'Not found.');
    const parsed = DiscountPatch.safeParse(request.body);
    if (!parsed.success) throw invalidDiscount();
    return db.transaction(async (tx) => {
      const rows = await tx.execute<Row>(sql`
        UPDATE restaurant_discounts SET is_active = COALESCE(${parsed.data.isActive ?? null}, is_active),
          ends_at = COALESCE(${parsed.data.endsAt ?? null}::timestamptz, ends_at)
        WHERE id = ${request.params.did} AND restaurant_id = ${request.params.id}
          AND COALESCE(${parsed.data.endsAt ?? null}::timestamptz, ends_at) > starts_at
        RETURNING ${COLUMNS}`);
      const row = rows[0];
      if (!row) throw new AppError('not_found', 404, 'Not found.');
      await writeAudit(tx, {
        actor: { type: 'user', id: userId },
        action: 'discount.updated',
        targetType: 'discount',
        targetId: row.id,
        requestId: request.id,
      });
      return toDiscount(row);
    });
  });

  app.delete<{ Params: { id: string; did: string } }>('/restaurants/:id/discounts/:did', async (request) => {
    const userId = await owner(request);
    if (!isUuid(request.params.did)) throw new AppError('not_found', 404, 'Not found.');
    await db.transaction(async (tx) => {
      const rows = await tx.execute(
        sql`DELETE FROM restaurant_discounts WHERE id = ${request.params.did} AND restaurant_id = ${request.params.id} RETURNING id`,
      );
      if (rows.length === 0) return; // a repeated delete is not an error
      await writeAudit(tx, {
        actor: { type: 'user', id: userId },
        action: 'discount.deleted',
        targetType: 'discount',
        targetId: request.params.did,
        requestId: request.id,
      });
    });
    return { ok: true };
  });
}
