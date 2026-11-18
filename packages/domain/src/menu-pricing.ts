import { addMoney, type Money, percentOf, poisha, subtractMoney, taka } from './money';

/** `value` is a whole percent for `percent`, and poisha for `amount`. */
export type Discount = {
  kind: 'percent' | 'amount';
  value: number;
  scope: 'item' | 'category' | 'menu';
  menuItemId: string | null;
  categoryId: string | null;
};

const MIN_UNIT: Money = taka(1);

/**
 * The single discount that takes off the most from one unit; discounts never stack. The unit never drops below Tk 1.
 * No discount (and `off` of zero) when none applies or the best would take off nothing.
 */
export function bestDiscount(unit: Money, applicable: readonly Discount[]): { discount: Discount | null; off: Money } {
  const room = unit > MIN_UNIT ? subtractMoney(unit, MIN_UNIT) : poisha(0);
  let best: Discount | null = null;
  let bestOff = poisha(0);
  for (const d of applicable) {
    const raw = d.kind === 'percent' ? percentOf(unit, d.value) : poisha(d.value);
    const capped = poisha(Math.min(raw, room));
    if (capped > bestOff) {
      best = d;
      bestOff = capped;
    }
  }
  return { discount: best, off: bestOff };
}

export type OptionGroupRule = {
  id: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; priceDelta: Money; isAvailable: boolean }[];
};

export type SelectionResult =
  | { ok: true; delta: Money }
  | {
      ok: false;
      reason:
        | 'unknown_option'
        | 'option_unavailable'
        | 'required_choice_missing'
        | 'too_many_choices'
        | 'duplicate_option';
    };

/** Checks a customer's chosen option ids against an item's groups and totals the price they add. */
export function checkSelections(groups: readonly OptionGroupRule[], optionIds: readonly string[]): SelectionResult {
  if (new Set(optionIds).size !== optionIds.length) return { ok: false, reason: 'duplicate_option' };
  const counts = new Map<string, number>();
  let delta = poisha(0);
  for (const id of optionIds) {
    const group = groups.find((g) => g.options.some((o) => o.id === id));
    const option = group?.options.find((o) => o.id === id);
    if (!group || !option) return { ok: false, reason: 'unknown_option' };
    if (!option.isAvailable) return { ok: false, reason: 'option_unavailable' };
    counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
    delta = addMoney(delta, option.priceDelta);
  }
  for (const g of groups) {
    const n = counts.get(g.id) ?? 0;
    if (n > g.maxSelect) return { ok: false, reason: 'too_many_choices' };
    if (n < g.minSelect) return { ok: false, reason: 'required_choice_missing' };
  }
  return { ok: true, delta };
}

/** The price of one unit: the item's price plus its options, minus the discount. */
export function priceLine(base: Money, delta: Money, off: Money): Money {
  return subtractMoney(addMoney(base, delta), off);
}
