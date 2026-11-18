/**
 * One opening interval in a zone's local time. `day` is 0 (Sunday) to 6. `closeMinute` counts minutes from the start of
 * `day`, so a value above 1440 means the interval runs past midnight into the next day.
 */
export type OpeningInterval = { day: number; openMinute: number; closeMinute: number };

const MINUTES_PER_DAY = 1440;

/** Open from the opening minute up to, but not including, the closing minute. */
export function isOpenAt(intervals: readonly OpeningInterval[], localDay: number, localMinute: number): boolean {
  const yesterday = (localDay + 6) % 7;
  return intervals.some(
    (i) =>
      (i.day === localDay && localMinute >= i.openMinute && localMinute < i.closeMinute) ||
      (i.day === yesterday && i.closeMinute > MINUTES_PER_DAY && localMinute < i.closeMinute - MINUTES_PER_DAY),
  );
}

/** The next time an interval starts, strictly after now, looking a full week ahead. Null with no intervals. */
export function nextOpening(
  intervals: readonly OpeningInterval[],
  localDay: number,
  localMinute: number,
): { day: number; minute: number } | null {
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = (localDay + ahead) % 7;
    const starts = intervals
      .filter((i) => i.day === day && (ahead > 0 || i.openMinute > localMinute))
      .map((i) => i.openMinute);
    if (starts.length > 0) return { day, minute: Math.min(...starts) };
  }
  return null;
}
