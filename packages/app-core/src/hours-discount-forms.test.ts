import { describe, expect, it } from 'vitest';
import { buildDiscountBody, discountStatus } from './discount-form';
import { copyDayToAll, type HoursRow, hasNextDay, validateHours } from './hours-form';

const row = (day: number, open: string, close: string): HoursRow => ({ day, open, close });

describe('hours form', () => {
  it('marks a close at or before the open as the next day', () => {
    expect(hasNextDay(row(1, '18:00', '02:00'))).toBe(true);
    expect(hasNextDay(row(1, '11:00', '22:00'))).toBe(false);
    expect(hasNextDay(row(1, '10:00', '10:00'))).toBe(true);
  });

  it('copies one day to every day, replacing the others', () => {
    const rows = [row(1, '11:00', '15:00'), row(1, '18:00', '22:00'), row(3, '09:00', '10:00')];
    const copied = copyDayToAll(rows, 1);
    expect(copied).toHaveLength(14);
    expect(copied.filter((r) => r.day === 3)).toEqual([row(3, '11:00', '15:00'), row(3, '18:00', '22:00')]);
    expect(copied.some((r) => r.open === '09:00')).toBe(false);
  });

  it('copying an empty day clears every day', () => {
    expect(copyDayToAll([row(2, '10:00', '12:00')], 1)).toEqual([]);
  });

  it('accepts good hours as the API body and an empty week as "no auto-close"', () => {
    const rows = [row(1, '11:00', '15:00'), row(1, '18:00', '02:00')];
    expect(validateHours(rows)).toEqual({ ok: true, body: { intervals: rows } });
    expect(validateHours([])).toEqual({ ok: true, body: { intervals: [] } });
  });

  it('refuses bad times, overlaps, four intervals a day, spills into the next opening and a close after 04:00', () => {
    expect(validateHours([row(1, '25:00', '12:00')]).ok).toBe(false);
    expect(validateHours([row(1, '9:00', '12:00')]).ok).toBe(false);
    expect(validateHours([row(1, '11:00', '15:00'), row(1, '14:00', '20:00')]).ok).toBe(false);
    const four = [
      row(2, '01:00', '02:00'),
      row(2, '05:00', '06:00'),
      row(2, '09:00', '10:00'),
      row(2, '13:00', '14:00'),
    ];
    expect(validateHours(four).ok).toBe(false);
    expect(validateHours([row(1, '20:00', '02:00'), row(2, '01:00', '10:00')]).ok).toBe(false);
    expect(validateHours([row(1, '18:00', '05:00')]).ok).toBe(false);
    expect(validateHours([row(1, '18:00', '04:00')]).ok).toBe(true);
    expect(validateHours([row(7, '10:00', '12:00')]).ok).toBe(false);
  });

  it('lets Saturday night run into a Sunday that opens later', () => {
    expect(validateHours([row(6, '20:00', '02:00'), row(0, '11:00', '22:00')]).ok).toBe(true);
    expect(validateHours([row(6, '20:00', '02:00'), row(0, '01:30', '22:00')]).ok).toBe(false);
  });
});

describe('discount form', () => {
  const base = {
    kind: 'percent' as const,
    value: '15',
    scope: 'item' as const,
    menuItemId: 'item-1',
    categoryId: null,
    startDate: '2026-11-20',
    endDate: '2026-11-25',
  };

  it('builds a percent discount with Dhaka-time day boundaries', () => {
    expect(buildDiscountBody(base)).toEqual({
      ok: true,
      body: {
        kind: 'percent',
        value: 15,
        scope: 'item',
        menuItemId: 'item-1',
        startsAt: '2026-11-19T18:00:00.000Z',
        endsAt: '2026-11-25T17:59:59.000Z',
      },
    });
  });

  it('turns taka off into poisha, and a whole-menu discount carries no target', () => {
    const result = buildDiscountBody({ ...base, kind: 'amount', value: '50', scope: 'menu', menuItemId: null });
    expect(result).toEqual({
      ok: true,
      body: {
        kind: 'amount',
        value: 5000,
        scope: 'menu',
        startsAt: '2026-11-19T18:00:00.000Z',
        endsAt: '2026-11-25T17:59:59.000Z',
      },
    });
  });

  it('uses the category id for a category discount', () => {
    const result = buildDiscountBody({ ...base, scope: 'category', menuItemId: null, categoryId: 'cat-1' });
    expect(result.ok && result.body.categoryId).toBe('cat-1');
  });

  it('refuses a bad value, a missing target, bad dates and an end before the start', () => {
    expect(buildDiscountBody({ ...base, value: '95' }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, value: '0' }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, value: '1.5' }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, kind: 'amount', value: '0' }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, menuItemId: null }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, scope: 'category', categoryId: null }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, startDate: '20-11-2026' }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, endDate: '2026-02-30' }).ok).toBe(false);
    expect(buildDiscountBody({ ...base, endDate: '2026-11-19' }).ok).toBe(false);
  });

  it('says whether a discount is running, paused, not started or over', () => {
    const now = new Date('2026-11-21T06:00:00Z');
    const d = (over: Record<string, unknown>) => ({
      isActive: true,
      startsAt: '2026-11-20T00:00:00.000Z',
      endsAt: '2026-11-22T00:00:00.000Z',
      ...over,
    });
    expect(discountStatus(d({}), now)).toBe('live');
    expect(discountStatus(d({ isActive: false }), now)).toBe('paused');
    expect(discountStatus(d({ startsAt: '2026-11-23T00:00:00.000Z', endsAt: '2026-11-24T00:00:00.000Z' }), now)).toBe(
      'scheduled',
    );
    expect(discountStatus(d({ endsAt: '2026-11-21T00:00:00.000Z' }), now)).toBe('ended');
  });
});
