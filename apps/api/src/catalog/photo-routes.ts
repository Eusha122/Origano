import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../admin/audit';
import type { Services } from '../app';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { deletePublicImage, processPublicImage, putPublicImage } from '../media/public-image';
import { isUuid } from '../ordering/repo';
import { requireCatalogActor } from './access';
import { publicImageUrl } from './images';

const notFound = () => new AppError('not_found', 404, 'Not found.');

type Target = { table: 'menu_items' | 'restaurants'; column: 'image_key' | 'cover_image_key'; id: string };

/** Owners set and clear the photo of an item or the cover photo of the restaurant. */
export function photoRoutes(app: FastifyInstance, { db, store }: Services): void {
  async function setPhoto(
    request: Parameters<typeof requireUser>[0],
    restaurantId: string,
    target: Target,
    file: (() => Promise<Buffer>) | null,
  ): Promise<{ imageUrl: string | null }> {
    const user = requireUser(request);
    await requireCatalogActor(db, user, restaurantId, 'owner');
    if (target.table === 'menu_items') {
      if (!isUuid(target.id)) throw notFound();
      const own = await db.execute(
        sql`SELECT id FROM menu_items WHERE id = ${target.id} AND restaurant_id = ${restaurantId} AND NOT is_archived`,
      );
      if (own.length === 0) throw notFound();
    }
    let newKey: string | null = null;
    const bytes = file ? await file() : null;
    if (bytes) {
      const image = await processPublicImage(bytes);
      if (!image.ok) throw new AppError(image.code, 400, 'That photo cannot be used.');
      newKey = await putPublicImage(store, image);
    }
    let oldKey: string | null = null;
    try {
      oldKey = await db.transaction(async (tx) => {
        const rows = await tx.execute<{ old: string | null }>(sql`
          SELECT ${sql.raw(target.column)} AS old FROM ${sql.raw(target.table)} WHERE id = ${target.id} FOR UPDATE`);
        const previous = rows[0]?.old ?? null;
        await tx.execute(
          sql`UPDATE ${sql.raw(target.table)} SET ${sql.raw(target.column)} = ${newKey} WHERE id = ${target.id}`,
        );
        await writeAudit(tx, {
          actor: { type: 'user', id: user.id },
          action: target.table === 'menu_items' ? 'menu.item_photo_changed' : 'restaurant.photo_changed',
          targetType: target.table === 'menu_items' ? 'menu_item' : 'restaurant',
          targetId: target.id,
          data: { removed: newKey === null },
          requestId: request.id,
        });
        return previous;
      });
    } catch (error) {
      if (newKey) await deletePublicImage(store, newKey).catch(() => undefined);
      throw error;
    }
    // The old files go only after the new row is committed, so a page is never left pointing at nothing.
    if (oldKey) await deletePublicImage(store, oldKey).catch(() => undefined);
    return { imageUrl: publicImageUrl(newKey, 'large') };
  }

  const readFile = async (request: { file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined> }) => {
    const part = await request.file();
    if (!part) throw new AppError('validation_failed', 400, 'Some details are missing or wrong.');
    // toBuffer() throws FST_REQ_FILE_TOO_LARGE past the global limit; the error handler answers 413.
    return part.toBuffer();
  };

  app.put<{ Params: { id: string; itemId: string } }>('/restaurants/:id/items/:itemId/photo', async (request) =>
    setPhoto(request, request.params.id, { table: 'menu_items', column: 'image_key', id: request.params.itemId }, () =>
      readFile(request),
    ),
  );
  app.delete<{ Params: { id: string; itemId: string } }>('/restaurants/:id/items/:itemId/photo', async (request) =>
    setPhoto(request, request.params.id, { table: 'menu_items', column: 'image_key', id: request.params.itemId }, null),
  );
  app.put<{ Params: { id: string } }>('/restaurants/:id/photo', async (request) =>
    setPhoto(
      request,
      request.params.id,
      { table: 'restaurants', column: 'cover_image_key', id: request.params.id },
      () => readFile(request),
    ),
  );
  app.delete<{ Params: { id: string } }>('/restaurants/:id/photo', async (request) =>
    setPhoto(
      request,
      request.params.id,
      { table: 'restaurants', column: 'cover_image_key', id: request.params.id },
      null,
    ),
  );
}
