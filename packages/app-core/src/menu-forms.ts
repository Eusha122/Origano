import type { ItemBody, OptionGroup, OptionsBody } from '@oregano/contracts';

const MIN_PRICE = 100;
const MAX_PRICE = 5_000_000;
const MAX_OPTION_DELTA = 500_000;

/** Taka as typed ("280", "280.5", "1,200") to poisha. Null unless it is a plain amount with at most two decimals. */
export function takaToPoisha(text: string): number | null {
  const clean = text.trim().replace(/,/g, '');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

/** Poisha as taka for a text box: "280", or "280.50" when there are poisha. */
export function poishaToTakaText(poisha: number): string {
  return poisha % 100 === 0 ? String(poisha / 100) : (poisha / 100).toFixed(2);
}

export type ItemFormResult =
  | { ok: true; body: Pick<ItemBody, 'nameEn' | 'price'> & { descriptionEn: string | null } }
  | { ok: false; errors: { name?: true; price?: true; description?: true } };

/** Checks the item form the way the API will: a name, a price from Tk 1 to Tk 50,000, a short description. */
export function validateItemForm(form: { name: string; price: string; description: string }): ItemFormResult {
  const name = form.name.trim();
  const description = form.description.trim();
  const price = takaToPoisha(form.price);
  const errors: { name?: true; price?: true; description?: true } = {};
  if (name.length < 1 || name.length > 80) errors.name = true;
  if (price === null || price < MIN_PRICE || price > MAX_PRICE) errors.price = true;
  if (description.length > 200) errors.description = true;
  if (errors.name || errors.price || errors.description || price === null) return { ok: false, errors };
  return { ok: true, body: { nameEn: name, price, descriptionEn: description === '' ? null : description } };
}

export type OptionFormGroup = {
  name: string;
  /** A size is one required choice; add-ons are optional and may be several. */
  kind: 'size' | 'addons';
  options: { name: string; price: string; isAvailable?: boolean }[];
};

/** The form rows as the API's option groups, or `ok: false` when any row is not valid. */
export function buildOptionsBody(groups: readonly OptionFormGroup[]): { ok: true; body: OptionsBody } | { ok: false } {
  if (groups.length > 6) return { ok: false };
  const out: OptionsBody['groups'] = [];
  for (const group of groups) {
    const name = group.name.trim();
    if (name.length < 1 || name.length > 40) return { ok: false };
    if (group.options.length < 1 || group.options.length > 20) return { ok: false };
    const options: OptionsBody['groups'][number]['options'] = [];
    for (const option of group.options) {
      const optionName = option.name.trim();
      if (optionName.length < 1 || optionName.length > 40) return { ok: false };
      const delta = option.price.trim() === '' ? 0 : takaToPoisha(option.price);
      if (delta === null || delta > MAX_OPTION_DELTA) return { ok: false };
      options.push({
        nameEn: optionName,
        priceDelta: delta,
        ...(option.isAvailable === undefined ? {} : { isAvailable: option.isAvailable }),
      });
    }
    out.push(
      group.kind === 'size'
        ? { nameEn: name, minSelect: 1, maxSelect: 1, options }
        : { nameEn: name, minSelect: 0, maxSelect: Math.min(options.length, 10), options },
    );
  }
  return { ok: true, body: { groups: out } };
}

/** A saved item's option groups as form rows. */
export function groupsFromItem(groups: readonly OptionGroup[]): OptionFormGroup[] {
  return groups.map((g) => ({
    name: g.nameEn,
    kind: g.minSelect === 1 && g.maxSelect === 1 ? ('size' as const) : ('addons' as const),
    options: g.options.map((o) => ({
      name: o.nameEn,
      price: poishaToTakaText(o.priceDelta),
      isAvailable: o.isAvailable,
    })),
  }));
}

/** The ids with one moved a place up (-1) or down (+1). Ids at an end, or not in the list, stay where they are. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Whether the option rows differ from what the item already has. Saving options replaces them all, which gives every
 * option a new id and breaks the carts that hold the old ones, so an unchanged set must not be sent again.
 */
export function optionsChanged(saved: readonly OptionGroup[], rows: readonly OptionFormGroup[]): boolean {
  const shape = (groups: readonly OptionFormGroup[]) =>
    JSON.stringify(
      groups.map((g) => [
        g.name.trim(),
        g.kind,
        g.options.map((o) => [o.name.trim(), o.price.trim() === '' ? 0 : takaToPoisha(o.price), o.isAvailable ?? true]),
      ]),
    );
  return shape(groupsFromItem(saved)) !== shape(rows);
}
