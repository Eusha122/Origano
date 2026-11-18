import type { Db } from '../db/client';
import { pruneOtp, pruneSessions } from '../identity/retention';
import { pruneSms } from '../notifications/sms/retention';

/** One pass over one kind of old data. `run` returns how many rows it changed, and must be safe to repeat. */
export type SweepJob = { name: string; run(db: Db, now: Date): Promise<number> };

/** Each module owns its own pruning; the sweeper only runs them, so it never touches another module's tables. */
export function defaultSweepJobs(): SweepJob[] {
  return [
    { name: 'otp', run: pruneOtp },
    { name: 'sessions', run: pruneSessions },
    { name: 'sms', run: pruneSms },
  ];
}

/** Runs every job once. A failing job is logged and counted as 0; it never stops the others. */
export async function runSweepOnce(db: Db, jobs: SweepJob[], now = new Date()): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const job of jobs) {
    try {
      result[job.name] = await job.run(db, now);
    } catch (error) {
      result[job.name] = 0;
      console.error(`sweep job ${job.name} failed`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Sweeps every five minutes until stopped. Logs counts, never rows. */
export function startSweeper(db: Db, jobs: SweepJob[], opts: { intervalMs?: number } = {}): { stop(): Promise<void> } {
  const intervalMs = opts.intervalMs ?? 300_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    const result = await runSweepOnce(db, jobs);
    const changed = Object.entries(result).filter(([, n]) => n > 0);
    if (changed.length > 0) console.log(`sweep: ${changed.map(([name, n]) => `${name} ${n}`).join(', ')}`);
    if (!stopped) {
      timer = setTimeout(() => {
        current = tick();
      }, intervalMs);
    }
  };
  current = tick();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}
