import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

export type AuditAction =
  | 'team.granted'
  | 'team.revoked'
  | 'session.reuse_detected'
  | 'otp.unlocked'
  | 'application.created'
  | 'application.submitted'
  | 'application.approved'
  | 'application.rejected'
  | 'application.licence_waived'
  | 'document.uploaded'
  | 'document.link_issued'
  | 'document.opened'
  | 'document.deleted'
  | 'rider.suspended'
  | 'rider.reinstated'
  | 'restaurant.suspended'
  | 'restaurant.reinstated'
  | 'agency.created'
  | 'agency.suspended'
  | 'agency.reinstated'
  | 'staff.added'
  | 'staff.removed'
  | 'rider_invite.created'
  | 'rider_invite.deleted'
  | 'restaurant.open_changed'
  | 'restaurant.busy_changed'
  | 'restaurant.hours_replaced'
  | 'restaurant.prep_changed'
  | 'restaurant.photo_changed'
  | 'item.availability_changed'
  | 'menu.category_created'
  | 'menu.category_updated'
  | 'menu.category_deleted'
  | 'menu.categories_reordered'
  | 'menu.item_created'
  | 'menu.item_updated'
  | 'menu.item_archived'
  | 'menu.item_photo_changed'
  | 'menu.options_replaced'
  | 'discount.created'
  | 'discount.updated'
  | 'discount.deleted'
  | 'zone.created'
  | 'zone.updated';

export type AuditEntry = {
  actor: { type: 'user'; id: string } | { type: 'operator'; label: string } | { type: 'system' };
  action: AuditAction;
  targetType: string;
  targetId: string;
  /** Never personal data: ids, kinds and outcomes only. */
  data?: Record<string, string | number | boolean | null>;
  requestId?: string;
  ipHash?: string;
};

/** Call inside the transaction that makes the change, so the record exists exactly when the change does. */
export async function writeAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  const { actor } = entry;
  await tx.execute(sql`
    INSERT INTO audit_log (actor_type, actor_id, actor_label, action, target_type, target_id, data, request_id, ip_hash)
    VALUES (${actor.type}, ${actor.type === 'user' ? actor.id : null}, ${actor.type === 'operator' ? actor.label : null},
      ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${JSON.stringify(entry.data ?? {})}::jsonb,
      ${entry.requestId ?? null}, ${entry.ipHash ?? null})`);
}
