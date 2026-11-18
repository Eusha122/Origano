import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';
import { writeAudit } from './audit';

describe('audit log', () => {
  const { db } = withTestDb();

  it('writes one row per action, for a user, an operator or the system', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    await writeAudit(db, {
      actor: { type: 'user', id: userId },
      action: 'application.approved',
      targetType: 'restaurant_application',
      targetId: 'a1',
      data: { waived: false },
      requestId: 'req-12345678',
    });
    await writeAudit(db, {
      actor: { type: 'operator', label: 'Rina' },
      action: 'team.granted',
      targetType: 'user',
      targetId: 'u1',
    });
    await writeAudit(db, {
      actor: { type: 'system' },
      action: 'document.deleted',
      targetType: 'document',
      targetId: 'd1',
    });
    const rows = await db.execute<{ actor_type: string; actor_id: string | null; actor_label: string | null }>(
      sql`SELECT actor_type, actor_id, actor_label FROM audit_log ORDER BY id`,
    );
    expect(rows).toEqual([
      { actor_type: 'user', actor_id: userId, actor_label: null },
      { actor_type: 'operator', actor_id: null, actor_label: 'Rina' },
      { actor_type: 'system', actor_id: null, actor_label: null },
    ]);
  });

  it('can never be changed or deleted afterwards', async () => {
    await writeAudit(db, {
      actor: { type: 'system' },
      action: 'document.deleted',
      targetType: 'document',
      targetId: 'd1',
    });
    for (const statement of [sql`UPDATE audit_log SET action = 'team.revoked'`, sql`DELETE FROM audit_log`]) {
      const failure = await db.execute(statement).then(
        () => null,
        (error: Error) => String(error.cause ?? error),
      );
      expect(failure).toMatch(/append-only/);
    }
    const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log`);
    expect(rows[0]?.n).toBe(1);
  });
});
