import type { HoursBody } from '@oregano/contracts';

/** One row of the weekly hours form: a day (0 = Sunday) and "HH:MM" times in the restaurant's local time. */
export type HoursRow = { day: number; open: string; close: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CLOSE = 1680; // 04:00 the next day
const MAX_PER_DAY = 3;

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A close at or before the open means the restaurant closes the next day. */
export function hasNextDay(row: HoursRow): boolean {
  return minutes(row.close) <= minutes(row.open);
}

/** Every day gets a copy of one day's rows; whatever the other days had is replaced. */
export function copyDayToAll(rows: readonly HoursRow[], day: number): HoursRow[] {
  const source = rows.filter((r) => r.day === day);
  return [0, 1, 2, 3, 4, 5, 6].flatMap((d) => source.map((r) => ({ ...r, day: d })));
}

/** The same rules the API applies, so a wrong form is caught before it is sent. An empty week is fine: no auto-close. */
export function validateHours(rows: readonly HoursRow[]): { ok: true; body: HoursBody } | { ok: false } {
  const spans: { day: number; open: number; close: number }[] = [];
  for (const r of rows) {
    if (!Number.isInteger(r.day) || r.day < 0 || r.day > 6 || !TIME.test(r.open) || !TIME.test(r.close)) {
      return { ok: false };
    }
    const open = minutes(r.open);
    const close = minutes(r.close);
    const end = close <= open ? close + 1440 : close;
    if (end > MAX_CLOSE) return { ok: false };
    spans.push({ day: r.day, open, close: end });
  }
  for (let day = 0; day < 7; day++) {
    const today = spans.filter((s) => s.day === day).sort((a, b) => a.open - b.open);
    if (today.length > MAX_PER_DAY) return { ok: false };
    for (let n = 1; n < today.length; n++) {
      if ((today[n]?.open ?? 0) < (today[n - 1]?.close ?? 0)) return { ok: false };
    }
    const spill = Math.max(0, ...today.map((s) => s.close - 1440));
    if (spill > 0 && spans.some((s) => s.day === (day + 1) % 7 && s.open < spill)) return { ok: false };
  }
  return { ok: true, body: { intervals: rows.map((r) => ({ day: r.day, open: r.open, close: r.close })) } };
}
