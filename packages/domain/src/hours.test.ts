import { describe, expect, it } from 'vitest';
import { isOpenAt, nextOpening, type OpeningInterval } from './hours';

const everyDay = (open: number, close: number): OpeningInterval[] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, openMinute: open, closeMinute: close }));

describe('isOpenAt', () => {
  const day = everyDay(660, 1320); // 11:00 to 22:00
  it('is open from the opening minute and closed at the closing minute', () => {
    expect(isOpenAt(day, 3, 659)).toBe(false);
    expect(isOpenAt(day, 3, 660)).toBe(true);
    expect(isOpenAt(day, 3, 1319)).toBe(true);
    expect(isOpenAt(day, 3, 1320)).toBe(false);
  });
  it('is closed with no intervals', () => {
    expect(isOpenAt([], 1, 700)).toBe(false);
  });
  it('carries an interval past midnight into the next day', () => {
    const late: OpeningInterval[] = [{ day: 1, openMinute: 1080, closeMinute: 1560 }]; // Monday 18:00 to Tuesday 02:00
    expect(isOpenAt(late, 1, 1100)).toBe(true);
    expect(isOpenAt(late, 2, 60)).toBe(true);
    expect(isOpenAt(late, 2, 120)).toBe(false);
    expect(isOpenAt(late, 2, 1100)).toBe(false);
  });
  it('carries Saturday night into Sunday', () => {
    const late: OpeningInterval[] = [{ day: 6, openMinute: 1200, closeMinute: 1500 }];
    expect(isOpenAt(late, 0, 30)).toBe(true);
    expect(isOpenAt(late, 0, 70)).toBe(false);
  });
  it('treats 24:00 as the end of an all-day interval', () => {
    const all = everyDay(0, 1440);
    expect(isOpenAt(all, 2, 0)).toBe(true);
    expect(isOpenAt(all, 2, 1439)).toBe(true);
  });
});

describe('nextOpening', () => {
  const day = everyDay(660, 1320);
  it('is later today when it has not opened yet', () => {
    expect(nextOpening(day, 3, 300)).toEqual({ day: 3, minute: 660 });
  });
  it('is tomorrow after closing', () => {
    expect(nextOpening(day, 3, 1400)).toEqual({ day: 4, minute: 660 });
  });
  it('is strictly after now, even at the opening minute', () => {
    expect(nextOpening(day, 3, 660)).toEqual({ day: 4, minute: 660 });
  });
  it('wraps from Saturday night to Sunday', () => {
    expect(nextOpening(day, 6, 1400)).toEqual({ day: 0, minute: 660 });
  });
  it('finds a weekly single day, the same weekday a week on', () => {
    const monday: OpeningInterval[] = [{ day: 1, openMinute: 600, closeMinute: 900 }];
    expect(nextOpening(monday, 1, 800)).toEqual({ day: 1, minute: 600 });
    expect(nextOpening(monday, 3, 0)).toEqual({ day: 1, minute: 600 });
  });
  it('picks the earliest of several intervals on a day', () => {
    const split: OpeningInterval[] = [
      { day: 2, openMinute: 1000, closeMinute: 1100 },
      { day: 2, openMinute: 700, closeMinute: 800 },
    ];
    expect(nextOpening(split, 2, 0)).toEqual({ day: 2, minute: 700 });
  });
  it('is null with no intervals', () => {
    expect(nextOpening([], 2, 0)).toBeNull();
  });
});
