import { describe, expect, it } from 'vitest';
import {
  buildOptionsBody,
  groupsFromItem,
  moveId,
  poishaToTakaText,
  takaToPoisha,
  validateItemForm,
} from './menu-forms';

describe('takaToPoisha', () => {
  it('reads whole and two-decimal taka', () => {
    expect(takaToPoisha('280')).toBe(28000);
    expect(takaToPoisha(' 280.5 ')).toBe(28050);
    expect(takaToPoisha('0.99')).toBe(99);
    expect(takaToPoisha('1,200')).toBe(120000);
  });
  it('refuses anything that is not a plain amount', () => {
    for (const bad of ['', 'abc', '-5', '12.345', '1e3', '12 Tk', '.', '٣٠٠']) {
      expect(takaToPoisha(bad), bad).toBeNull();
    }
  });
  it('formats back without a trailing .00', () => {
    expect(poishaToTakaText(28000)).toBe('280');
    expect(poishaToTakaText(28050)).toBe('280.50');
  });
});

describe('validateItemForm', () => {
  it('accepts a name and a price from Tk 1 to Tk 50,000, and trims', () => {
    expect(validateItemForm({ name: '  Fries ', price: '120', description: ' Crisp ' })).toEqual({
      ok: true,
      body: { nameEn: 'Fries', price: 12000, descriptionEn: 'Crisp' },
    });
    expect(validateItemForm({ name: 'A', price: '1', description: '' })).toEqual({
      ok: true,
      body: { nameEn: 'A', price: 100, descriptionEn: null },
    });
    expect(validateItemForm({ name: 'A', price: '50000', description: '' }).ok).toBe(true);
  });
  it('names each wrong field', () => {
    expect(validateItemForm({ name: '  ', price: '120', description: '' })).toEqual({
      ok: false,
      errors: { name: true },
    });
    expect(validateItemForm({ name: 'A', price: '0.5', description: '' })).toEqual({
      ok: false,
      errors: { price: true },
    });
    expect(validateItemForm({ name: 'A', price: '50001', description: '' })).toEqual({
      ok: false,
      errors: { price: true },
    });
    expect(validateItemForm({ name: '', price: 'x', description: '' })).toEqual({
      ok: false,
      errors: { name: true, price: true },
    });
  });
  it('refuses an over-long name or description', () => {
    expect(validateItemForm({ name: 'x'.repeat(81), price: '10', description: '' }).ok).toBe(false);
    expect(validateItemForm({ name: 'x', price: '10', description: 'y'.repeat(201) }).ok).toBe(false);
  });
});

describe('option groups', () => {
  it('turns a size and add-ons into required and optional groups', () => {
    const result = buildOptionsBody([
      {
        name: 'Size',
        kind: 'size',
        options: [
          { name: 'Regular', price: '0' },
          { name: 'Large', price: '30' },
        ],
      },
      {
        name: 'Extras',
        kind: 'addons',
        options: [
          { name: 'Cheese', price: '20' },
          { name: 'Egg', price: '15.5' },
        ],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      body: {
        groups: [
          {
            nameEn: 'Size',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { nameEn: 'Regular', priceDelta: 0 },
              { nameEn: 'Large', priceDelta: 3000 },
            ],
          },
          {
            nameEn: 'Extras',
            minSelect: 0,
            maxSelect: 2,
            options: [
              { nameEn: 'Cheese', priceDelta: 2000 },
              { nameEn: 'Egg', priceDelta: 1550 },
            ],
          },
        ],
      },
    });
  });
  it('refuses an empty name, a bad price, a group with no options and more than 6 groups', () => {
    const ok = { name: 'Size', kind: 'size' as const, options: [{ name: 'A', price: '0' }] };
    expect(buildOptionsBody([{ ...ok, name: ' ' }]).ok).toBe(false);
    expect(buildOptionsBody([{ ...ok, options: [{ name: 'A', price: 'x' }] }]).ok).toBe(false);
    expect(buildOptionsBody([{ ...ok, options: [] }]).ok).toBe(false);
    expect(buildOptionsBody([{ ...ok, options: [{ name: '', price: '0' }] }]).ok).toBe(false);
    expect(buildOptionsBody(Array.from({ length: 7 }, () => ok)).ok).toBe(false);
    expect(buildOptionsBody([]).ok).toBe(true);
  });
  it('allows a free option and refuses a negative one', () => {
    const base = { name: 'Size', kind: 'size' as const };
    expect(buildOptionsBody([{ ...base, options: [{ name: 'A', price: '' }] }]).ok).toBe(true);
    expect(buildOptionsBody([{ ...base, options: [{ name: 'A', price: '-1' }] }]).ok).toBe(false);
  });
  it('reads a saved item back into form rows', () => {
    const rows = groupsFromItem([
      {
        id: 'g1',
        nameEn: 'Size',
        nameBn: 'Size',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [{ id: 'o1', nameEn: 'Large', nameBn: 'Large', priceDelta: 3000, isAvailable: true }],
      },
      {
        id: 'g2',
        nameEn: 'Extras',
        nameBn: 'Extras',
        required: false,
        minSelect: 0,
        maxSelect: 2,
        options: [{ id: 'o2', nameEn: 'Egg', nameBn: 'Egg', priceDelta: 1550, isAvailable: false }],
      },
    ]);
    expect(rows).toEqual([
      { name: 'Size', kind: 'size', options: [{ name: 'Large', price: '30', isAvailable: true }] },
      { name: 'Extras', kind: 'addons', options: [{ name: 'Egg', price: '15.50', isAvailable: false }] },
    ]);
  });
});

describe('moveId', () => {
  it('moves one place up or down and stops at the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b']);
  });
});
