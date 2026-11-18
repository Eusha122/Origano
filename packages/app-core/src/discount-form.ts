import type { DiscountBody } from '@oregano/contracts';
import { takaToPoisha } from './menu-forms';

export type DiscountForm = {
  kind: 'percent' | 'amount';
  /** A whole percent, or taka. */
  value: string;
  scope: 'item' | 'category' | 'menu';
  menuItemId: string | null;
  categoryId: string | null;
  /** "YYYY-MM-DD" in Bangladesh time. The discount runs from the start of the first day to the end of the last. */
  startDate: string;
  endDate: string;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_AMOUNT = 5_000_000;

function validDate(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === mo - 1 && parsed.getUTCDate() === d;
}

/** Bangladesh has no daylight saving: its day boundaries are always +06:00. */
const startOfDay = (date: string) => new Date(`${date}T00:00:00+06:00`).toISOString();
const endOfDay = (date: string) => new Date(`${date}T23:59:59+06:00`).toISOString();

/** The form as the API's body, or `ok: false` when anything is wrong. */
export function buildDiscountBody(form: DiscountForm): { ok: true; body: DiscountBody } | { ok: false } {
  let value: number;
  if (form.kind === 'percent') {
    if (!/^\d{1,2}$/.test(form.value.trim())) return { ok: false };
    value = Number(form.value.trim());
    if (value < 1 || value > 90) return { ok: false };
  } else {
    const poisha = takaToPoisha(form.value);
    if (poisha === null || poisha < 1 || poisha > MAX_AMOUNT) return { ok: false };
    value = poisha;
  }
  if (form.scope === 'item' && !form.menuItemId) return { ok: false };
  if (form.scope === 'category' && !form.categoryId) return { ok: false };
  if (!validDate(form.startDate) || !validDate(form.endDate)) return { ok: false };
  const startsAt = startOfDay(form.startDate);
  const endsAt = endOfDay(form.endDate);
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return { ok: false };
  return {
    ok: true,
    body: {
      kind: form.kind,
      value,
      scope: form.scope,
      ...(form.scope === 'item' && form.menuItemId ? { menuItemId: form.menuItemId } : {}),
      ...(form.scope === 'category' && form.categoryId ? { categoryId: form.categoryId } : {}),
      startsAt,
      endsAt,
    },
  };
}

/** Paused wins; otherwise by the clock. */
export function discountStatus(
  d: { isActive: boolean; startsAt: string; endsAt: string },
  now: Date,
): 'live' | 'paused' | 'scheduled' | 'ended' {
  if (!d.isActive) return 'paused';
  if (now.getTime() >= new Date(d.endsAt).getTime()) return 'ended';
  if (now.getTime() < new Date(d.startsAt).getTime()) return 'scheduled';
  return 'live';
}
