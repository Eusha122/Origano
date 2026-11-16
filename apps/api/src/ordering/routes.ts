import { type Order, PlaceOrderBody } from '@oregano/contracts';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { assertIdempotencyKey, withIdempotency } from './idempotency';
import { loadOrder, loadOrders } from './present';
import { findOrderCustomerId, listCustomerOrderIds, resolveViewer } from './repo';
import { applyTransition, placeOrderIn } from './service';

const notFound = () => new AppError('not_found', 404, 'Not found.');

export function orderRoutes(app: FastifyInstance, { db }: Services): void {
  app.post('/orders', async (request, reply): Promise<Order> => {
    const user = requireUser(request);
    const header = request.headers['idempotency-key'];
    const key = assertIdempotencyKey(typeof header === 'string' ? header : undefined);
    const parsed = PlaceOrderBody.safeParse(request.body);
    if (!parsed.success) throw new AppError('validation_failed', 400, 'Some details are missing or wrong.');

    const result = await withIdempotency(db, { userId: user.id, key, requestBody: request.body }, async (tx) => {
      const { orderId } = await placeOrderIn(tx, user, parsed.data);
      return { status: 201, body: await loadOrder(tx, orderId, { kind: 'customer', userId: user.id }) };
    });
    reply.code(result.status);
    return result.body;
  });

  app.get('/orders', async (request): Promise<Order[]> => {
    const user = requireUser(request);
    const ids = await listCustomerOrderIds(db, user.id, 50);
    return loadOrders(db, ids, { kind: 'customer', userId: user.id });
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request): Promise<Order> => {
    const user = requireUser(request);
    const viewer = await resolveViewer(db, user, request.params.id);
    if (!viewer) throw notFound();
    return loadOrder(db, request.params.id, viewer);
  });

  app.post<{ Params: { id: string } }>('/orders/:id/cancel', async (request): Promise<Order> => {
    const user = requireUser(request);
    const customerId = await findOrderCustomerId(db, request.params.id);
    if (customerId !== user.id) throw notFound();
    await applyTransition(db, {
      orderId: request.params.id,
      event: 'cancel',
      actor: 'customer',
      actorId: user.id,
    });
    return loadOrder(db, request.params.id, { kind: 'customer', userId: user.id });
  });
}
