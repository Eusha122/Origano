import { AcceptBody, type Order, RejectBody } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { requireRole } from '../identity/auth';
import { loadOrder, loadOrders } from './present';
import { isUuid } from './repo';
import { applyTransition } from './service';

const notFound = () => new AppError('not_found', 404, 'Not found.');
const invalidBody = () => new AppError('validation_failed', 400, 'Some details are missing or wrong.');

export function restaurantRoutes(app: FastifyInstance, { db }: Services): void {
  /** The caller must be staff of the order's restaurant; anything else looks like a missing order. */
  const ownedOrderId = async (user: { restaurantIds: string[] }, orderId: string): Promise<string> => {
    if (!isUuid(orderId)) throw notFound();
    const rows = await db.execute<{ restaurant_id: string }>(
      sql`SELECT restaurant_id FROM orders WHERE id = ${orderId}`,
    );
    const restaurantId = rows[0]?.restaurant_id;
    if (!restaurantId || !user.restaurantIds.includes(restaurantId)) throw notFound();
    return orderId;
  };

  app.get('/restaurant/orders', async (request): Promise<{ orders: Order[] }> => {
    const user = requireRole(request, 'restaurant');
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM orders
      WHERE restaurant_id IN (${sql.join(
        user.restaurantIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND status IN ('placed', 'preparing', 'ready')
      ORDER BY created_at ASC, number ASC`);
    return {
      orders: await loadOrders(
        db,
        rows.map((r) => r.id),
        { kind: 'restaurant', userId: user.id },
      ),
    };
  });

  app.post<{ Params: { id: string } }>('/restaurant/orders/:id/accept', async (request): Promise<Order> => {
    const user = requireRole(request, 'restaurant');
    const orderId = await ownedOrderId(user, request.params.id);
    const body = AcceptBody.safeParse(request.body);
    if (!body.success) throw invalidBody();
    await applyTransition(db, {
      orderId,
      event: 'accept',
      actor: 'restaurant',
      actorId: user.id,
      data: { readyInMinutes: body.data.readyInMinutes },
    });
    return loadOrder(db, orderId, { kind: 'restaurant', userId: user.id });
  });

  app.post<{ Params: { id: string } }>('/restaurant/orders/:id/reject', async (request): Promise<Order> => {
    const user = requireRole(request, 'restaurant');
    const orderId = await ownedOrderId(user, request.params.id);
    const body = RejectBody.safeParse(request.body);
    if (!body.success) throw invalidBody();
    await applyTransition(db, {
      orderId,
      event: 'reject',
      actor: 'restaurant',
      actorId: user.id,
      data: { reason: body.data.reason },
    });
    return loadOrder(db, orderId, { kind: 'restaurant', userId: user.id });
  });

  app.post<{ Params: { id: string } }>('/restaurant/orders/:id/ready', async (request): Promise<Order> => {
    const user = requireRole(request, 'restaurant');
    const orderId = await ownedOrderId(user, request.params.id);
    await applyTransition(db, { orderId, event: 'mark_ready', actor: 'restaurant', actorId: user.id });
    return loadOrder(db, orderId, { kind: 'restaurant', userId: user.id });
  });
}
