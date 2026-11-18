import { addMoney, type Money, maxMoney, multiplyMoney, poisha } from './money';

const POISHA_PER_TAKA = 100;

/** max(zone minimum, straight-line km x road factor x fee per km, rounded up to a whole taka). Integer arithmetic only. */
export function deliveryFee(
  distanceMeters: number,
  zone: { feePerKm: Money; minFee: Money; roadFactor: number },
): Money {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError(`distance must be a non-negative number of meters, got ${distanceMeters}`);
  }
  const meters = Math.round(distanceMeters);
  const factorHundredths = Math.round(zone.roadFactor * 100);
  // feePerKm (poisha) x km (meters / 1000) x factor (hundredths / 100)
  const exactPoisha = (zone.feePerKm * meters * factorHundredths) / 100_000;
  const wholeTakaPoisha = Math.ceil(exactPoisha / POISHA_PER_TAKA) * POISHA_PER_TAKA;
  return maxMoney(poisha(wholeTakaPoisha), zone.minFee);
}

export type PricedLine = { unitPrice: Money; quantity: number };

export function lineTotal(line: PricedLine): Money {
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) {
    throw new RangeError(`quantity must be a whole number from 1 to 20, got ${line.quantity}`);
  }
  return multiplyMoney(line.unitPrice, line.quantity);
}

export function orderTotals(lines: PricedLine[], fee: Money): { subtotal: Money; deliveryFee: Money; total: Money } {
  if (lines.length === 0) {
    throw new RangeError('an order needs at least one line');
  }
  const subtotal = addMoney(...lines.map(lineTotal));
  return { subtotal, deliveryFee: fee, total: addMoney(subtotal, fee) };
}

export const READY_MINUTES = [10, 20, 30] as const;
export type ReadyMinutes = (typeof READY_MINUTES)[number];
