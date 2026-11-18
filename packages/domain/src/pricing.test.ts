import { describe, expect, it } from 'vitest';
import { taka } from './money';
import { deliveryFee, lineTotal, orderTotals } from './pricing';

const zone = { feePerKm: taka(10), minFee: taka(20), roadFactor: 1.3 };

describe('deliveryFee', () => {
  it('never charges less than the zone minimum', () => {
    expect(deliveryFee(0, zone)).toBe(taka(20));
    expect(deliveryFee(670, zone)).toBe(taka(20)); // 0.871 km -> Tk 8.71 -> minimum
  });

  it('charges straight-line distance times road factor times fee per km', () => {
    expect(deliveryFee(5000, zone)).toBe(taka(65)); // 6.5 km
  });

  it('rounds up to the next whole taka', () => {
    expect(deliveryFee(2310, zone)).toBe(taka(31)); // 3.003 km -> Tk 30.03 -> Tk 31
  });

  it('rejects a negative or non-finite distance', () => {
    expect(() => deliveryFee(-1, zone)).toThrow(RangeError);
    expect(() => deliveryFee(Number.NaN, zone)).toThrow(RangeError);
  });
});

describe('order totals', () => {
  it('multiplies each line and adds the delivery fee', () => {
    const first = { unitPrice: taka(380), quantity: 2 };
    const lines = [first, { unitPrice: taka(180), quantity: 1 }];
    expect(lineTotal(first)).toBe(taka(760));
    expect(orderTotals(lines, taka(20))).toEqual({ subtotal: taka(940), deliveryFee: taka(20), total: taka(960) });
  });

  it('refuses an empty order or a quantity outside 1 to 20', () => {
    expect(() => orderTotals([], taka(20))).toThrow(RangeError);
    expect(() => lineTotal({ unitPrice: taka(380), quantity: 0 })).toThrow(RangeError);
    expect(() => lineTotal({ unitPrice: taka(380), quantity: 21 })).toThrow(RangeError);
  });
});
