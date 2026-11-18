import { type Me, OnlineBody, type Order, type RiderOffer } from '@oregano/contracts';
import { TERMINAL_STATUSES } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { requireRiderAccount, requireWorkingRider, toMe } from '../identity/auth';
import { findUserById } from '../identity/sessions';
import { loadOrder, loadOrders } from '../ordering/present';
import { isUuid } from '../ordering/repo';
import { applyTransition } from '../ordering/service';
import { claimOrder, listOffers } from './repo';

const notFound = () => new AppError('not_found', 404, 'Not found.');

export function dispatchRoutes(app: FastifyInstance, { db }: Services): void {
  app.post('/rider/online', async (request): Promise<Me> => {
    const user = requireWorkingRider(request);
    const body = OnlineBody.safeParse(request.body);
    if (!body.success) throw new AppError('validation_failed', 400, 'Some details are missing or wrong.');
    await db.execute(sql`UPDATE riders SET is_online = ${body.data.online} WHERE user_id = ${user.id}`);
    const fresh = await findUserById(db, user.id);
    if (!fresh) throw notFound();
    return toMe(fresh);
  });

  app.get('/rider/offers', async (request): Promise<{ offers: RiderOffer[] }> => {
    const user = requireWorkingRider(request);
    if (!user.rider?.isOnline) return { offers: [] };
    return { offers: await listOffers(db, user.rider.zoneId) };
  });

  app.get('/rider/orders', async (request): Promise<{ orders: Order[] }> => {
    const user = requireRiderAccount(request);
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM orders
      WHERE rider_id = ${user.id} AND status NOT IN (${sql.join(
        TERMINAL_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      )})
      ORDER BY created_at ASC, number ASC`);
    return {
      orders: await loadOrders(
        db,
        rows.map((r) => r.id),
        { kind: 'rider', userId: user.id },
      ),
    };
  });

  app.post<{ Params: { id: string } }>('/rider/orders/:id/claim', async (request): Promise<Order> => {
    const user = requireWorkingRider(request);
    if (!user.rider?.isOnline) throw new AppError('rider_offline', 409, 'Go online to take orders.');
    if (!isUuid(request.params.id)) throw notFound();
    const result = await claimOrder(db, user.id, request.params.id);
    if (result === 'taken') throw new AppError('already_claimed', 409, 'Another rider took this order.');
    if (result === 'not_claimable') throw notFound();
    return loadOrder(db, request.params.id, { kind: 'rider', userId: user.id });
  });

  const holdingStep = (path: 'pick-up' | 'deliver', event: 'pick_up' | 'deliver') =>
    app.post<{ Params: { id: string } }>(`/rider/orders/:id/${path}`, async (request): Promise<Order> => {
      const user = (path === 'deliver' ? requireRiderAccount : requireWorkingRider)(request);
      const orderId = request.params.id;
      if (!isUuid(orderId)) throw notFound();
      const rows = await db.execute<{ rider_id: string | null }>(
        sql`SELECT rider_id FROM orders WHERE id = ${orderId}`,
      );
      if (rows[0]?.rider_id !== user.id) throw notFound();
      await applyTransition(db, { orderId, event, actor: 'rider', actorId: user.id });
      return loadOrder(db, orderId, { kind: 'rider', userId: user.id });
    });
  holdingStep('pick-up', 'pick_up');
  holdingStep('deliver', 'deliver');
}
