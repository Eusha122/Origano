import { fileURLToPath } from 'node:url';
import { type BdPhone, normalizeBdPhone, TEAM_ROLES, type TeamRole } from '@oregano/domain';
import { createDb } from '../db/client';
import { grantTeamRole, listTeam, revokeTeamRole } from './team';

export type TeamCommand =
  | { kind: 'grant'; phone: BdPhone; role: TeamRole; operator: string }
  | { kind: 'revoke'; phone: BdPhone; operator: string }
  | { kind: 'list' };

const USAGE =
  'Usage: team grant <phone> <role> --operator "<name>" | team revoke <phone> --operator "<name>" | team list';

/** Turns the command line into a command, or an error message. Team roles are never granted any other way. */
export function parseTeamCommand(argv: string[]): TeamCommand | { error: string } {
  const args = argv.filter((a) => a !== '--');
  const flag = args.indexOf('--operator');
  const operator = flag >= 0 ? args[flag + 1]?.trim() : undefined;
  const words = flag >= 0 ? args.slice(0, flag) : args;
  const [verb, rawPhone, rawRole] = words;

  if (verb === 'list' && words.length === 1) return { kind: 'list' };
  if (verb !== 'grant' && verb !== 'revoke') return { error: USAGE };
  if (!operator) return { error: `--operator is required. ${USAGE}` };
  const phone = rawPhone ? normalizeBdPhone(rawPhone) : null;
  if (!phone) return { error: 'The phone is not a Bangladesh mobile number.' };
  if (verb === 'revoke') return { kind: 'revoke', phone, operator };
  const role = TEAM_ROLES.find((r) => r === rawRole);
  if (!role) return { error: `The role must be one of: ${TEAM_ROLES.join(', ')}.` };
  return { kind: 'grant', phone, role, operator };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = parseTeamCommand(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if ('error' in command || !url) {
    console.error('error' in command ? command.error : 'DATABASE_URL is required');
    process.exit(1);
  }
  const { db, close } = createDb(url);
  try {
    if (command.kind === 'grant') {
      await grantTeamRole(db, command.phone, command.role, command.operator);
      console.log(`${command.phone} is now ${command.role}. They were signed out everywhere.`);
    } else if (command.kind === 'revoke') {
      const had = await revokeTeamRole(db, command.phone, command.operator);
      console.log(had ? `${command.phone} has no team role now.` : `${command.phone} had no team role.`);
    } else {
      for (const m of await listTeam(db)) console.log(`${m.role.padEnd(11)} ${m.phone}  ${m.name ?? ''}`);
    }
  } finally {
    await close();
  }
}
