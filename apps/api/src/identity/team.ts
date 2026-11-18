import type { BdPhone, TeamRole } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { Db, Executor } from '../db/client';
import { revokeUserSessions } from './sessions';

export type TeamMember = { userId: string; phone: string; name: string | null; role: TeamRole; grantedAt: string };

/** Gives a phone a team role, creating a plain account if it has none. Signs the user out everywhere. */
export async function grantTeamRole(db: Db, phone: BdPhone, role: TeamRole, operator: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      INSERT INTO users (phone) VALUES (${phone})
      ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
      RETURNING id`);
    const userId = rows[0]?.id;
    if (!userId) throw new Error('User could not be created');
    await tx.execute(sql`
      INSERT INTO team_members (user_id, role, granted_by_label) VALUES (${userId}, ${role}, ${operator})
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by_label = EXCLUDED.granted_by_label,
        granted_at = now()`);
    await revokeUserSessions(tx, userId, 'team_change');
    await writeAudit(tx, {
      actor: { type: 'operator', label: operator },
      action: 'team.granted',
      targetType: 'user',
      targetId: userId,
      data: { role },
    });
  });
}

/** Takes a team role away and signs the user out everywhere. False when the phone had no role. */
export async function revokeTeamRole(db: Db, phone: BdPhone, operator: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx.execute<{ user_id: string; role: string }>(sql`
      DELETE FROM team_members WHERE user_id = (SELECT id FROM users WHERE phone = ${phone})
      RETURNING user_id, role`);
    const row = removed[0];
    if (!row) return false;
    await revokeUserSessions(tx, row.user_id, 'team_change');
    await writeAudit(tx, {
      actor: { type: 'operator', label: operator },
      action: 'team.revoked',
      targetType: 'user',
      targetId: row.user_id,
      data: { role: row.role },
    });
    return true;
  });
}

export async function listTeam(db: Executor): Promise<TeamMember[]> {
  const rows = await db.execute<{
    user_id: string;
    phone: string;
    name: string | null;
    role: TeamRole;
    granted_at: string;
  }>(sql`
    SELECT tm.user_id, u.phone, u.name, tm.role,
      to_char(tm.granted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS granted_at
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    ORDER BY tm.granted_at, u.phone`);
  return rows.map((r) => ({ userId: r.user_id, phone: r.phone, name: r.name, role: r.role, grantedAt: r.granted_at }));
}
