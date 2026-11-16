/**
 * Money is a whole number of poisha (1 Tk = 100 poisha). Never a float, never a string.
 * The brand makes it impossible to pass a plain number where Money is expected.
 */
export type Money = number & { readonly __unit: 'poisha' };

const POISHA_PER_TAKA = 100;

function assertMoney(poisha: number, label: string): Money {
  if (!Number.isSafeInteger(poisha) || poisha < 0) {
    throw new RangeError(`${label} must be a non-negative whole number of poisha, got ${poisha}`);
  }
  return poisha as Money;
}

/** Converts taka to Money. Rejects negatives, non-finite values and fractions finer than one poisha. */
export function taka(amount: number): Money {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`taka amount must be finite, got ${amount}`);
  }
  const poishaCount = Math.round(amount * POISHA_PER_TAKA);
  // Compare in taka: dividing a whole poisha count by 100 lands on the same double as any two-decimal
  // literal, at every size, so only amounts that really have a third decimal fail here.
  if (poishaCount / POISHA_PER_TAKA !== amount) {
    throw new RangeError(`taka amount ${amount} is finer than one poisha`);
  }
  return assertMoney(poishaCount, 'taka amount');
}

/** Money from a whole poisha count, as stored in the database. */
export function poisha(count: number): Money {
  return assertMoney(count, 'poisha count');
}

export function toTaka(amount: Money): number {
  return amount / POISHA_PER_TAKA;
}

export function addMoney(...amounts: Money[]): Money {
  return assertMoney(
    amounts.reduce((sum, amount) => sum + amount, 0),
    'sum',
  );
}

export function subtractMoney(a: Money, b: Money): Money {
  return assertMoney(a - b, 'difference');
}

export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative whole number, got ${quantity}`);
  }
  return assertMoney(amount * quantity, 'product');
}

export function maxMoney(a: Money, b: Money): Money {
  return (a > b ? a : b) as Money;
}

/** A percentage of an amount, rounded half up to the nearest whole taka. */
export function percentOf(amount: Money, percent: number): Money {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`percent must be between 0 and 100, got ${percent}`);
  }
  // Work in hundredths of a poisha to keep the arithmetic integral for whole and 2-decimal percents.
  const exactPoisha = (amount * Math.round(percent * 100)) / (100 * 100);
  const wholeTaka = Math.floor(exactPoisha / POISHA_PER_TAKA + 0.5);
  return assertMoney(wholeTaka * POISHA_PER_TAKA, 'percentage');
}
