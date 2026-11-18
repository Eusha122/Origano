import { BusyBody, ItemAvailabilityBody, OpenBody, type RestaurantControls } from '@oregano/contracts';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../admin/audit';
import type { Services } from '../app';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { isUuid } from '../ordering/repo';
import { requireCatalogActor } from './access';
import { getControls, setBusyMinutes, setItemAvailability, setOpenSwitch } from './controls-repo';

const notFound = () => new AppError('not_found', 404, 'Not found.');
const invalidBody = () => new AppError('validation_failed', 400, 'Some details are missing or wrong.');

/** The switch, busy mode and sold-out toggles: anyone on the restaurant's staff may use these. */
export function catalogStaffRoutes(app: FastifyInstance, { db, clock }: Services): void {
  const now = () => (clock ? clock() : new Date());

  app.get<{ Params: { id: string } }>('/restaurants/:id/controls', async (request): Promise<RestaurantControls> => {
    const user = requireUser(request);
    await requireCatalogActor(db, user, request.params.id, 'staff');
    const controls = await getControls(db, request.params.id, now());
    if (!controls) throw notFound();
    return controls;
  });

  app.put<{ Params: { id: string } }>('/restaurants/:id/open', async (request): Promise<RestaurantControls> => {
    const user = requireUser(request);
    const body = OpenBody.safeParse(request.body);
    if (!body.success) throw invalidBody();
    await requireCatalogActor(db, user, request.params.id, 'staff');
    await db.transaction(async (tx) => {
      if (!(await setOpenSwitch(tx, request.params.id, body.data.isOpen))) return;
      await writeAudit(tx, {
        actor: { type: 'user', id: user.id },
        action: 'restaurant.open_changed',
        targetType: 'restaurant',
        targetId: request.params.id,
        data: { isOpen: body.data.isOpen },
        requestId: request.id,
      });
    });
    return (await getControls(db, request.params.id, now())) as RestaurantControls;
  });

  app.put<{ Params: { id: string } }>('/restaurants/:id/busy', async (request): Promise<RestaurantControls> => {
    const user = requireUser(request);
    const body = BusyBody.safeParse(request.body);
    if (!body.success) throw invalidBody();
    await requireCatalogActor(db, user, request.params.id, 'staff');
    await db.transaction(async (tx) => {
      if (!(await setBusyMinutes(tx, request.params.id, body.data.extraMinutes))) return;
      await writeAudit(tx, {
        actor: { type: 'user', id: user.id },
        action: 'restaurant.busy_changed',
        targetType: 'restaurant',
        targetId: request.params.id,
        data: { extraMinutes: body.data.extraMinutes },
        requestId: request.id,
      });
    });
    return (await getControls(db, request.params.id, now())) as RestaurantControls;
  });

  app.put<{ Params: { id: string; itemId: string } }>(
    '/restaurants/:id/items/:itemId/availability',
    async (request): Promise<{ id: string; isAvailable: boolean }> => {
      const user = requireUser(request);
      const body = ItemAvailabilityBody.safeParse(request.body);
      if (!body.success) throw invalidBody();
      await requireCatalogActor(db, user, request.params.id, 'staff');
      if (!isUuid(request.params.itemId)) throw notFound();
      await db.transaction(async (tx) => {
        const result = await setItemAvailability(tx, request.params.id, request.params.itemId, body.data.isAvailable);
        if (!result) throw notFound();
        if (!result.changed) return;
        await writeAudit(tx, {
          actor: { type: 'user', id: user.id },
          action: 'item.availability_changed',
          targetType: 'menu_item',
          targetId: request.params.itemId,
          data: { isAvailable: body.data.isAvailable },
          requestId: request.id,
        });
      });
      return { id: request.params.itemId, isAvailable: body.data.isAvailable };
    },
  );
}
