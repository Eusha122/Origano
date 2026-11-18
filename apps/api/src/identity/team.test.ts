import type { BdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';
import { grantTeamRole, listTeam, revokeTeamRole } from './team';
import { parseTeamCommand } from './team-cli';

const NEW_PHONE = '+8801711000099' as BdPhone;
const SUPPORT = '01711000007';
const ONBOARDING = '01711000006';
const ADMIN = '01711000004';

describe('team roles', () => {
  const t = withTestApp();

  const get = async (url: string, phone: string) =>
    t.app().inject({ method: 'GET', url, headers: t.as(await t.signIn(phone)) });

  it('shows the seeded admin as a superadmin and keeps the admin role for existing app gates', async () => {
    const me = (await get('/v1/me', ADMIN)).json();
    expect(me.teamRoles).toEqual(['superadmin']);
    expect(me.roles).toContain('admin');
    const customer = (await get('/v1/me', '01711000001')).json();
    expect(customer.teamRoles).toEqual([]);
    expect(customer.roles).not.toContain('admin');
  });

  it('lets support read orders but not the team list, onboarding the same, and superadmin both', async () => {
    expect((await get('/v1/admin/orders', SUPPORT)).statusCode).toBe(200);
    expect((await get('/v1/admin/team', SUPPORT)).statusCode).toBe(403);
    expect((await get('/v1/admin/orders', ONBOARDING)).statusCode).toBe(200);
    expect((await get('/v1/admin/team', ONBOARDING)).statusCode).toBe(403);
    expect((await get('/v1/admin/orders', ADMIN)).statusCode).toBe(200);
    const team = await get('/v1/admin/team', ADMIN);
    expect(team.statusCode).toBe(200);
    expect(
      team
        .json()
        .members.map((m: { role: string }) => m.role)
        .sort(),
    ).toEqual(['onboarding', 'superadmin', 'support']);
    expect((await get('/v1/admin/orders', '01711000001')).statusCode).toBe(403);
  });

  it('grants a role to a new phone, audits it as the operator, and signs their sessions out', async () => {
    const token = await t.signIn('01711000099');
    await grantTeamRole(t.db, NEW_PHONE, 'support', 'Rina');
    const me = await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) });
    expect(me.statusCode).toBe(401);
    const again = (await get('/v1/me', '01711000099')).json();
    expect(again.teamRoles).toEqual(['support']);
    const rows = await t.db.execute<{ actor_type: string; actor_label: string; action: string }>(
      sql`SELECT actor_type, actor_label, action FROM audit_log WHERE action = 'team.granted'`,
    );
    expect(rows).toEqual([{ actor_type: 'operator', actor_label: 'Rina', action: 'team.granted' }]);
  });

  it('creates the account when the phone has none, then revokes the role and the sessions', async () => {
    await grantTeamRole(t.db, NEW_PHONE, 'onboarding', 'Rina');
    const token = await t.signIn('01711000099');
    expect(await revokeTeamRole(t.db, NEW_PHONE, 'Rina')).toBe(true);
    expect((await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) })).statusCode).toBe(401);
    expect((await listTeam(t.db)).map((m) => m.phone)).not.toContain(NEW_PHONE);
    expect(await revokeTeamRole(t.db, NEW_PHONE, 'Rina')).toBe(false);
  });
});

describe('team command line', () => {
  it('parses grant, revoke and list, and ignores the pnpm separator', () => {
    expect(parseTeamCommand(['--', 'grant', '01711000099', 'support', '--operator', 'Rina'])).toEqual({
      kind: 'grant',
      phone: '+8801711000099',
      role: 'support',
      operator: 'Rina',
    });
    expect(parseTeamCommand(['revoke', '01711000099', '--operator', 'Rina'])).toEqual({
      kind: 'revoke',
      phone: '+8801711000099',
      operator: 'Rina',
    });
    expect(parseTeamCommand(['list'])).toEqual({ kind: 'list' });
  });

  it('refuses a missing operator, an unknown role and a bad phone', () => {
    for (const argv of [
      ['grant', '01711000099', 'support'],
      ['grant', '01711000099', 'boss', '--operator', 'Rina'],
      ['grant', '123', 'support', '--operator', 'Rina'],
      ['revoke', '01711000099'],
      ['explode'],
    ]) {
      expect(parseTeamCommand(argv), argv.join(' ')).toHaveProperty('error');
    }
  });
});
