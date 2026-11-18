import { isOpenAt, nextOpening, type OpeningInterval } from '@oregano/domain';

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday (0 = Sunday) and minute of the day at `now` in the zone's time zone. */
export function zoneLocalNow(timezone: string, now: Date): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: WEEKDAYS[get('weekday')] ?? 0, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Minutes from midnight as "HH:MM"; minutes past 24:00 wrap to the next day. */
export function formatMinute(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export type StateInput = {
  switchOn: boolean;
  timezone: string;
  intervals: readonly OpeningInterval[];
  prepMinutes: number;
  busyExtraMinutes: number;
};

/**
 * What customers see: open only when the owner's switch is on AND the clock is inside the weekly hours (no hours at all
 * means the switch alone decides). `opensAt` is the next opening time when the switch is on but the hours say closed.
 */
export function restaurantState(
  r: StateInput,
  now: Date,
): { isOpen: boolean; opensAt: string | null; prepMinutes: number } {
  const local = zoneLocalNow(r.timezone, now);
  const withinHours = r.intervals.length === 0 || isOpenAt(r.intervals, local.day, local.minute);
  const next = r.switchOn && !withinHours ? nextOpening(r.intervals, local.day, local.minute) : null;
  return {
    isOpen: r.switchOn && withinHours,
    opensAt: next ? formatMinute(next.minute) : null,
    prepMinutes: r.prepMinutes + r.busyExtraMinutes,
  };
}
