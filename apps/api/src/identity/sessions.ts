import { createHash, randomBytes } from 'node:crypto';
import type { BdPhone } from '@oregano/domain';
import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';

export type AuthUser = {
  id: string;
  phone: BdPhone;
  name: string | null;
  isAdmin: boolean;
  restaurantIds: string[];
  rider: { zoneId: string; status: string; isOnline: boolean } | null;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes, base64url. Only the SHA-256 is stored. */
export async function createSession(db: Pick<Db, 'execute'>, userId: string, ttlDays: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.execute(sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashToken(token)}, now() + make_interval(days => ${ttlDays}))`);
  return token;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.execute(
    sql`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL`,
  );
}

type UserRow = {
  id: string;
  phone: string;
  name: string | null;
  is_admin: boolean;
  restaurant_ids: string[];
  rider_zone_id: string | null;
  rider_status: string | null;
  rider_is_online: boolean | null;
};

async function loadUser(db: Pick<Db, 'execute'>, where: SQL): Promise<AuthUser | null> {
  const rows = await db.execute<UserRow>(sql`
    SELECT u.id, u.phone, u.name, u.is_admin,
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
    isAdmin: row.is_admin,
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

/** The user behind a live (not expired, not revoked) session token, or null. */
export async function findUserByToken(db: Db, token: string): Promise<AuthUser | null> {
  const rows = await db.execute<{ user_id: string }>(sql`
    SELECT user_id FROM sessions
    WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL AND expires_at > now()`);
  const session = rows[0];
  return session ? findUserById(db, session.user_id) : null;
}
