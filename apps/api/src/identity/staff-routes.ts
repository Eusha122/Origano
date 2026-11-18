import { AddStaffBody, RiderInviteBody } from '@oregano/contracts';
import { normalizeBdPhone } from '@oregano/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Services } from '../app';
import type { Config } from '../config';
import { AppError } from '../errors';
import { createRiderInvite, deleteRiderInvite, listRiderInvites } from '../onboarding/rider-invites';
import { requireUser } from './auth';
import { addStaff, listStaff, removeStaff, requireOwner } from './staff';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () => new AppError('validation_failed', 400, 'Some details are missing or wrong.');

/** A restaurant's owner manages its staff and the riders it invites. Staff who are not owners get 403 on all of it. */
export function staffRoutes(app: FastifyInstance, config: Config, { db }: Services): void {
  /** The signed-in owner of the restaurant named in the path. Anyone else: 403 (404 for a malformed id). */
  const owner = async (request: FastifyRequest<{ Params: { restaurantId: string } }>) => {
    const user = requireUser(request);
    const { restaurantId } = request.params;
    if (!UUID.test(restaurantId)) throw new AppError('not_found', 404, 'Not found.');
    await requireOwner(db, user, restaurantId);
    return { user, restaurantId };
  };
  type P = { Params: { restaurantId: string } };

  app.get<P>('/restaurant/:restaurantId/staff', async (request) => {
    const { restaurantId } = await owner(request);
    return { members: await listStaff(db, restaurantId) };
  });

  app.post<P>('/restaurant/:restaurantId/staff', async (request, reply) => {
    const { user, restaurantId } = await owner(request);
    const body = AddStaffBody.safeParse(request.body);
    if (!body.success) throw invalid();
    const { member, created } = await addStaff(
      db,
      user.id,
      restaurantId,
      body.data.phone,
      config.limits.staffPerRestaurant,
    );
    reply.code(created ? 201 : 200);
    return member;
  });

  app.delete<{ Params: { restaurantId: string; userId: string } }>(
    '/restaurant/:restaurantId/staff/:userId',
    async (request, reply) => {
      const { user, restaurantId } = await owner(request);
      if (!UUID.test(request.params.userId)) throw new AppError('not_found', 404, 'Not found.');
      await removeStaff(db, user.id, restaurantId, request.params.userId);
      return reply.code(204).send();
    },
  );

  app.get<P>('/restaurant/:restaurantId/rider-invites', async (request) => {
    const { restaurantId } = await owner(request);
    return { invites: await listRiderInvites(db, restaurantId) };
  });

  app.post<P>('/restaurant/:restaurantId/rider-invites', async (request, reply) => {
    const { user, restaurantId } = await owner(request);
    const body = RiderInviteBody.safeParse(request.body);
    if (!body.success) throw invalid();
    const { invite, created } = await createRiderInvite(db, user.id, restaurantId, body.data.phone);
    reply.code(created ? 201 : 200);
    return invite;
  });

  app.delete<{ Params: { restaurantId: string; phone: string } }>(
    '/restaurant/:restaurantId/rider-invites/:phone',
    async (request, reply) => {
      const { user, restaurantId } = await owner(request);
      if (normalizeBdPhone(request.params.phone) === null) throw invalid();
      await deleteRiderInvite(db, user.id, restaurantId, request.params.phone);
      return reply.code(204).send();
    },
  );
}
