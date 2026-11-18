import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import type { Config } from '../config';
import { AppError } from '../errors';
import { requirePermission } from '../identity/auth';
import { checkDocumentTicket, DOCUMENT_TICKET_SECONDS, issueDocumentTicket } from '../media/tickets';
import { readDocument } from '../media/vault';
import { hashIp, subkey } from '../security/crypto';
import { writeAudit } from './audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Identity documents reach a screen only through here. A link is a short-lived ticket tied to one admin and one
 * document, carried in a header (never the URL, which gets logged), and every issue and every opening is audited.
 */
export function documentRoutes(app: FastifyInstance, config: Config, { db, store, clock }: Services): void {
  const ticketKey = subkey(config.otpSecret, 'doc-ticket');
  const ipKey = subkey(config.otpSecret, 'ip-hash');
  const now = (): Date => clock?.() ?? new Date();
  const gone = () => new AppError('document_deleted', 410, 'This document has been deleted.');
  const notFound = () => new AppError('not_found', 404, 'Not found.');

  app.post<{ Params: { id: string } }>('/admin/documents/:id/link', async (request) => {
    const admin = requirePermission(request, 'documents.view');
    const { id } = request.params;
    if (!UUID.test(id)) throw notFound();
    const expiresAt = new Date(now().getTime() + DOCUMENT_TICKET_SECONDS * 1000);
    await db.transaction(async (tx) => {
      const rows = await tx.execute<{ status: string; kind: string }>(
        sql`SELECT status, kind FROM identity_documents WHERE id = ${id}`,
      );
      const doc = rows[0];
      if (!doc || doc.status === 'pending') throw notFound();
      if (doc.status === 'deleted') throw gone();
      await writeAudit(tx, {
        actor: { type: 'user', id: admin.id },
        action: 'document.link_issued',
        targetType: 'document',
        targetId: id,
        data: { kind: doc.kind },
        requestId: request.id,
        ipHash: hashIp(ipKey, request.ip),
      });
    });
    return {
      url: `/v1/admin/documents/${id}/content`,
      ticket: issueDocumentTicket(ticketKey, { documentId: id, adminId: admin.id, expiresAt }),
      expiresAt: expiresAt.toISOString(),
    };
  });

  app.get<{ Params: { id: string } }>('/admin/documents/:id/content', async (request, reply) => {
    const admin = requirePermission(request, 'documents.view');
    const { id } = request.params;
    const ticket = request.headers['x-document-ticket'];
    if (typeof ticket !== 'string' || !checkDocumentTicket(ticketKey, ticket, id, admin.id, now())) {
      throw new AppError('link_expired', 403, 'This link has expired or is not yours.');
    }
    const bytes = await readDocument({ db, store, keys: config.dataKeys }, id);
    if (bytes === 'deleted') throw gone();
    if (bytes === null) throw notFound();
    await writeAudit(db, {
      actor: { type: 'user', id: admin.id },
      action: 'document.opened',
      targetType: 'document',
      targetId: id,
      requestId: request.id,
      ipHash: hashIp(ipKey, request.ip),
    });
    return reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('content-disposition', 'inline; filename="document.jpg"')
      .header('cross-origin-resource-policy', 'same-site')
      .header('referrer-policy', 'no-referrer')
      .send(bytes);
  });
}
