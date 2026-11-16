import type { Me, Role } from '@oregano/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { AppError } from '../errors';
import { type AuthUser, findUserByToken } from './sessions';

export type { AuthUser } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/** The token from `Authorization: Bearer <token>`, or null when absent or malformed. */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(header);
  return match?.[1] ?? null;
}

/** Sets `request.user` from the Bearer token on every request. A bad token just leaves it null. */
export function registerAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    if (token) request.user = await findUserByToken(db, token);
  });
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new AppError('unauthenticated', 401, 'Please sign in.');
  return request.user;
}

export function requireRole(request: FastifyRequest, role: 'restaurant' | 'rider' | 'admin'): AuthUser {
  const user = requireUser(request);
  const allowed =
    role === 'restaurant'
      ? user.restaurantIds.length > 0
      : role === 'rider'
        ? user.rider?.status === 'approved'
        : user.isAdmin;
  if (!allowed) throw new AppError('forbidden', 403, 'You cannot do that.');
  return user;
}

export function toMe(user: AuthUser): Me {
  const roles: Role[] = ['customer'];
  if (user.restaurantIds.length > 0) roles.push('restaurant');
  if (user.rider) roles.push('rider');
  if (user.isAdmin) roles.push('admin');
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    roles,
    restaurantIds: user.restaurantIds,
    rider: user.rider ? { zoneId: user.rider.zoneId, isOnline: user.rider.isOnline } : null,
  };
}
