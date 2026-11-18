import { describe, expect, it } from 'vitest';
import { bestDiscount, checkSelections, type Discount, type OptionGroupRule, priceLine } from './menu-pricing';
import { poisha, taka } from './money';

const pct = (value: number): Discount => ({
  kind: 'percent',
  value,
  scope: 'menu',
  menuItemId: null,
  categoryId: null,
});
const off = (value: number): Discount => ({ kind: 'amount', value, scope: 'menu', menuItemId: null, categoryId: null });

describe('bestDiscount', () => {
  it('rounds a percentage half up to the whole taka', () => {
    expect(bestDiscount(taka(305), [pct(10)]).off).toBe(taka(31));
  });
  it('picks the discount that takes off the most, and does not stack', () => {
    const a = pct(10);
    const b = off(taka(50));
    expect(bestDiscount(taka(300), [a, b])).toEqual({ discount: b, off: taka(50) });
    expect(bestDiscount(taka(300), [b, a]).discount).toBe(b);
  });
  it('never takes the unit below Tk 1', () => {
    expect(bestDiscount(taka(40), [off(taka(100))]).off).toBe(taka(39));
    expect(bestDiscount(taka(1), [off(taka(100))])).toEqual({ discount: null, off: poisha(0) });
  });
  it('is no discount when none applies or the best takes off nothing', () => {
    expect(bestDiscount(taka(300), [])).toEqual({ discount: null, off: poisha(0) });
    expect(bestDiscount(taka(1), [pct(10)])).toEqual({ discount: null, off: poisha(0) });
  });
});

const groups: OptionGroupRule[] = [
  {
    id: 'size',
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: 'small', priceDelta: taka(0), isAvailable: true },
      { id: 'large', priceDelta: taka(30), isAvailable: true },
      { id: 'xl', priceDelta: taka(60), isAvailable: false },
    ],
  },
  {
    id: 'extras',
    minSelect: 0,
    maxSelect: 2,
    options: [
      { id: 'cheese', priceDelta: taka(20), isAvailable: true },
      { id: 'egg', priceDelta: taka(15), isAvailable: true },
      { id: 'bacon', priceDelta: taka(40), isAvailable: true },
    ],
  },
];

describe('checkSelections', () => {
  it('sums the deltas of a valid pick', () => {
    expect(checkSelections(groups, ['large', 'cheese', 'egg'])).toEqual({ ok: true, delta: taka(65) });
  });
  it('accepts no options when there are no groups', () => {
    expect(checkSelections([], [])).toEqual({ ok: true, delta: taka(0) });
  });
  it('requires a choice in a required group', () => {
    expect(checkSelections(groups, ['cheese'])).toEqual({ ok: false, reason: 'required_choice_missing' });
  });
  it('refuses too many choices in a group', () => {
    expect(checkSelections(groups, ['small', 'large'])).toEqual({ ok: false, reason: 'too_many_choices' });
    expect(checkSelections(groups, ['small', 'cheese', 'egg', 'bacon'])).toEqual({
      ok: false,
      reason: 'too_many_choices',
    });
  });
  it('refuses an unknown option, an unavailable one and a repeated one', () => {
    expect(checkSelections(groups, ['small', 'nope'])).toEqual({ ok: false, reason: 'unknown_option' });
    expect(checkSelections(groups, ['xl'])).toEqual({ ok: false, reason: 'option_unavailable' });
    expect(checkSelections(groups, ['small', 'small'])).toEqual({ ok: false, reason: 'duplicate_option' });
  });
});

describe('priceLine', () => {
  it('is base plus options minus the discount', () => {
    expect(priceLine(taka(280), taka(30), taka(31))).toBe(taka(279));
  });
});
