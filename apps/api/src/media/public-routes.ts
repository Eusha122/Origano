import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { AppError } from '../errors';
import { getPublicImage, isPublicImageKey } from './public-image';

/** Public menu and restaurant photos. The key is a random id, so the answer never changes: cache it for a year. */
export function publicMediaRoutes(app: FastifyInstance, { store }: Services): void {
  app.get<{ Params: { key: string }; Querystring: { size?: string } }>('/media/public/:key', async (request, reply) => {
    const size = request.query.size ?? 'large';
    if (!isPublicImageKey(request.params.key) || (size !== 'large' && size !== 'small')) {
      throw new AppError('not_found', 404, 'Not found.');
    }
    const bytes = await getPublicImage(store, request.params.key, size);
    if (!bytes) throw new AppError('not_found', 404, 'Not found.');
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(bytes);
  });
}
