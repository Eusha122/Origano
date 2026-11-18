import { createHash, randomBytes } from 'node:crypto';
import type { BdPhone, TeamRole } from '@oregano/domain';
import { type SQL, sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import type { SessionLimits } from '../config';
import type { Db, Executor } from '../db/client';
import { writeOutbox } from '../events/outbox';

export type AuthUser = {
  id: string;
  phone: BdPhone;
  name: string | null;
  teamRoles: TeamRole[];
  restaurantIds: string[];
  rider: { zoneId: string; status: string; isOnline: boolean } | null;
};

export type RevokeReason = 'logout' | 'reuse_detected' | 'team_change' | 'operator';

export type IssuedTokens = {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const newToken = (): string => randomBytes(32).toString('base64url');

/** Most times one refresh token may be answered inside the grace window before it counts as theft. */
const MAX_GRACE_CHILDREN = 3;

type Timed = { expires_at: string };

/** Inserts an access token and a refresh token for a session. Only their SHA-256 is stored. */
async function issueTokens(
  tx: Executor,
  sessionId: string,
  parentId: string | null,
  limits: SessionLimits,
): Promise<IssuedTokens> {
  const accessToken = newToken();
  const refreshToken = newToken();
  const access = await tx.execute<Timed>(sql`
    INSERT INTO auth_tokens (session_id, kind, token_hash, expires_at)
    VALUES (${sessionId}, 'access', ${hashToken(accessToken)}, now() + make_interval(secs => ${limits.accessSeconds}))
    RETURNING expires_at`);
  // A refresh token slides forward on every use, but never past the session's absolute end.
  const refresh = await tx.execute<Timed>(sql`
    INSERT INTO auth_tokens (session_id, kind, token_hash, parent_id, expires_at)
    VALUES (${sessionId}, 'refresh', ${hashToken(refreshToken)}, ${parentId},
      LEAST(now() + make_interval(days => ${limits.refreshDays}),
            (SELECT absolute_expires_at FROM auth_sessions WHERE id = ${sessionId})))
    RETURNING expires_at`);
  return {
    accessToken,
    accessExpiresAt: new Date(access[0]?.expires_at ?? 0),
    refreshToken,
    refreshExpiresAt: new Date(refresh[0]?.expires_at ?? 0),
  };
}

/** A new sign-in. Team members get a short session, because their accounts can see identity documents. */
export async function startSession(
  tx: Executor,
  user: AuthUser,
  client: 'web' | 'native',
  limits: SessionLimits,
): Promise<IssuedTokens & { sessionId: string }> {
  const life =
    user.teamRoles.length > 0
      ? sql`now() + make_interval(hours => ${limits.teamAbsoluteHours})`
      : sql`now() + make_interval(days => ${limits.absoluteDays})`;
  const rows = await tx.execute<{ id: string }>(sql`
    INSERT INTO auth_sessions (user_id, client, absolute_expires_at) VALUES (${user.id}, ${client}, ${life})
    RETURNING id`);
  const sessionId = rows[0]?.id;
  if (!sessionId) throw new Error('Session could not be created');
  return { sessionId, ...(await issueTokens(tx, sessionId, null, limits)) };
}

type RefreshRow = {
  id: string;
  session_id: string;
  user_id: string;
  parent_id: string | null;
  used: boolean;
  used_ago: number | null;
  usable: boolean;
};

/**
 * Trades a refresh token for a new pair. 'invalid' means unknown, expired or revoked. 'reused' means the
 * token was spent long ago, or its answer was already put to use: someone else may hold a copy, so the
 * whole session is revoked.
 *
 * A token spent a moment ago is answered again with a sibling pair (up to three times), because on a weak
 * connection the first answer may never have arrived, and two browser tabs may refresh together. But only
 * one answer may ever be redeemed: the moment a sibling is redeemed, its unused siblings die. Otherwise
 * a thief who replayed the token inside the window would keep a second chain of tokens that reuse
 * detection never sees, for the rest of the session. A real client holds one answer, so nothing is lost.
 */
export function refreshSession(
  db: Db,
  refreshToken: string,
  limits: SessionLimits,
): Promise<IssuedTokens | 'invalid' | 'reused'> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<RefreshRow>(sql`
      SELECT t.id, t.session_id, s.user_id, t.parent_id, t.used_at IS NOT NULL AS used,
        extract(epoch FROM now() - t.used_at)::float AS used_ago,
        (t.expires_at > now() AND s.revoked_at IS NULL AND s.absolute_expires_at > now()) AS usable
      FROM auth_tokens t JOIN auth_sessions s ON s.id = t.session_id
      WHERE t.token_hash = ${hashToken(refreshToken)} AND t.kind = 'refresh'
      FOR UPDATE OF t, s`);
    const row = rows[0];
    if (!row?.usable) return 'invalid';

    if (!row.used) {
      await tx.execute(sql`UPDATE auth_tokens SET used_at = now() WHERE id = ${row.id}`);
      if (row.parent_id !== null) {
        await tx.execute(sql`
          UPDATE auth_tokens SET expires_at = now()
          WHERE parent_id = ${row.parent_id} AND id <> ${row.id} AND kind = 'refresh'
            AND used_at IS NULL AND expires_at > now()`);
      }
      return issueTokens(tx, row.session_id, row.id, limits);
    }

    // Counted in a statement of its own, after the lock: a request that waited for the lock must see the
    // children the request ahead of it created.
    const counts = await tx.execute<{ children: number; redeemed: number }>(sql`
      SELECT count(*)::int AS children, count(used_at)::int AS redeemed FROM auth_tokens WHERE parent_id = ${row.id}`);
    const children = counts[0]?.children ?? 0;
    const redeemed = counts[0]?.redeemed ?? 0;
    const recent = row.used_ago !== null && row.used_ago <= limits.reuseGraceSeconds;
    // A child that was used proves the client received an answer, so a lost response is no excuse.
    if (recent && redeemed === 0 && children < MAX_GRACE_CHILDREN) {
      return issueTokens(tx, row.session_id, row.id, limits);
    }

    await revokeSession(tx, row.session_id, 'reuse_detected');
    await writeAudit(tx, {
      actor: { type: 'system' },
      action: 'session.reuse_detected',
      targetType: 'user',
      targetId: row.user_id,
      data: { sessionId: row.session_id },
    });
    return 'reused';
  });
}

/** The user behind a live access token, the session it belongs to, and when it stops working. */
export async function authenticateAccess(
  db: Executor,
  accessToken: string,
): Promise<{ user: AuthUser; sessionId: string; expiresAt: Date } | null> {
  // Touches last_used_at at most once a minute, in the same statement as the lookup.
  const rows = await db.execute<{ session_id: string; user_id: string; expires_at: string }>(sql`
    WITH live AS (
      SELECT s.id AS session_id, s.user_id, LEAST(t.expires_at, s.absolute_expires_at) AS expires_at
      FROM auth_tokens t JOIN auth_sessions s ON s.id = t.session_id
      WHERE t.token_hash = ${hashToken(accessToken)} AND t.kind = 'access' AND t.expires_at > now()
        AND s.revoked_at IS NULL AND s.absolute_expires_at > now()
    ), touched AS (
      UPDATE auth_sessions SET last_used_at = now()
      WHERE id IN (SELECT session_id FROM live) AND last_used_at < now() - interval '1 minute'
    )
    SELECT session_id, user_id, expires_at FROM live`);
  const live = rows[0];
  if (!live) return null;
  const user = await findUserById(db, live.user_id);
  return user ? { user, sessionId: live.session_id, expiresAt: new Date(live.expires_at) } : null;
}

/** Signs one device out, and tells any open WebSocket on it to close. */
export async function revokeSession(tx: Executor, sessionId: string, reason: RevokeReason): Promise<void> {
  const revoked = await tx.execute<{ id: string }>(sql`
    UPDATE auth_sessions SET revoked_at = now(), revoke_reason = ${reason}
    WHERE id = ${sessionId} AND revoked_at IS NULL RETURNING id`);
  if (revoked.length > 0) await writeOutbox(tx, 'session.revoked', { sessionId });
}

/** Signs a user out everywhere. */
export async function revokeUserSessions(tx: Executor, userId: string, reason: RevokeReason): Promise<void> {
  const revoked = await tx.execute<{ id: string }>(sql`
    UPDATE auth_sessions SET revoked_at = now(), revoke_reason = ${reason}
    WHERE user_id = ${userId} AND revoked_at IS NULL RETURNING id`);
  for (const { id } of revoked) await writeOutbox(tx, 'session.revoked', { sessionId: id });
}

/** The session a refresh token belongs to, for logging out when the access token has already expired. */
export async function sessionOfRefreshToken(db: Executor, refreshToken: string): Promise<string | null> {
  const rows = await db.execute<{ session_id: string }>(
    sql`SELECT session_id FROM auth_tokens WHERE token_hash = ${hashToken(refreshToken)} AND kind = 'refresh'`,
  );
  return rows[0]?.session_id ?? null;
}

type UserRow = {
  id: string;
  phone: string;
  name: string | null;
  team_roles: TeamRole[];
  restaurant_ids: string[];
  rider_zone_id: string | null;
  rider_status: string | null;
  rider_is_online: boolean | null;
};

async function loadUser(db: Pick<Db, 'execute'>, where: SQL): Promise<AuthUser | null> {
  const rows = await db.execute<UserRow>(sql`
    SELECT u.id, u.phone, u.name,
      COALESCE((SELECT array_agg(tm.role ORDER BY tm.role) FROM team_members tm WHERE tm.user_id = u.id), '{}') AS team_roles,
      COALESCE((SELECT array_agg(rs.restaurant_id::text ORDER BY rs.restaurant_id)
                FROM restaurant_staff rs WHERE rs.user_id = u.id), '{}') AS restaurant_ids,
      r.zone_id AS rider_zone_id, r.status AS rider_status, r.is_online AS rider_is_online
    FROM users u
    LEFT JOIN riders r ON r.user_id = u.id
    WHERE ${where}`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone as BdPhone,
    name: row.name,
    teamRoles: row.team_roles,
    restaurantIds: row.restaurant_ids,
    rider:
      row.rider_zone_id === null
        ? null
        : { zoneId: row.rider_zone_id, status: row.rider_status ?? '', isOnline: row.rider_is_online ?? false },
  };
}

export function findUserById(db: Pick<Db, 'execute'>, id: string): Promise<AuthUser | null> {
  return loadUser(db, sql`u.id = ${id}`);
}

/** Finds the user for a phone, creating a plain customer on first sign-in. */
export async function findOrCreateUser(db: Pick<Db, 'execute'>, phone: BdPhone): Promise<AuthUser> {
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO users (phone) VALUES (${phone})
    ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
    RETURNING id`);
  const id = inserted[0]?.id;
  const user = id ? await findUserById(db, id) : null;
  if (!user) throw new Error('User could not be created');
  return user;
}
