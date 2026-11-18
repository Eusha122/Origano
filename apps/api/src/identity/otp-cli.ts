import { fileURLToPath } from 'node:url';
import { type BdPhone, normalizeBdPhone } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../admin/audit';
import { createDb, type Db } from '../db/client';

export type OtpCommand = { kind: 'unlock'; phone: BdPhone; operator: string };

const USAGE = 'Usage: otp unlock <phone> --operator "<name>"';

/** Turns the command line into a command, or an error message. */
export function parseOtpCommand(argv: string[]): OtpCommand | { error: string } {
  const args = argv.filter((a) => a !== '--');
  const flag = args.indexOf('--operator');
  const operator = flag >= 0 ? args[flag + 1]?.trim() : undefined;
  const words = flag >= 0 ? args.slice(0, flag) : args;
  if (words[0] !== 'unlock') return { error: USAGE };
  if (!operator) return { error: `--operator is required. ${USAGE}` };
  const phone = words[1] ? normalizeBdPhone(words[1]) : null;
  if (!phone) return { error: 'The phone is not a Bangladesh mobile number.' };
  return { kind: 'unlock', phone, operator };
}

/** Clears a phone's wrong-code history after support has checked it really is the owner. Audited. Returns the rows cleared. */
export async function unlockPhone(db: Db, phone: BdPhone, operator: string): Promise<number> {
  return db.transaction(async (tx) => {
    const cleared = await tx.execute<{ id: number }>(
      sql`DELETE FROM otp_events WHERE phone = ${phone} AND kind = 'failure' RETURNING id`,
    );
    await writeAudit(tx, {
      actor: { type: 'operator', label: operator },
      action: 'otp.unlocked',
      targetType: 'phone',
      targetId: `${phone.slice(0, 5)}*****${phone.slice(-3)}`,
      data: { cleared: cleared.length },
    });
    return cleared.length;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = parseOtpCommand(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if ('error' in command || !url) {
    console.error('error' in command ? command.error : 'DATABASE_URL is required');
    process.exit(1);
  }
  const { db, close } = createDb(url);
  try {
    const cleared = await unlockPhone(db, command.phone, command.operator);
    console.log(`${command.phone} is unlocked (${cleared} wrong-code records cleared).`);
  } finally {
    await close();
  }
}
