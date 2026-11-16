/** A Bangladeshi mobile number in its stored form, +8801[3-9]XXXXXXXX. */
export type BdPhone = string & { readonly __brand: 'BdPhone' };

const BD_MOBILE = /^(?:\+?880|0)?(1[3-9]\d{8})$/;

/** Accepts 01X, 8801X or +8801X (spaces and dashes ignored, ASCII digits only). Returns null for anything else. */
export function normalizeBdPhone(input: string): BdPhone | null {
  const match = BD_MOBILE.exec(input.replace(/[\s-]/g, ''));
  return match ? (`+880${match[1]}` as BdPhone) : null;
}
