import { taka } from '@oregano/domain';
import { describe, expect, it } from 'vitest';
import { formatMoney, messages, t, toBanglaDigits } from './index';

describe('i18n', () => {
  it('has exactly the same keys in English and Bangla', () => {
    expect(Object.keys(messages.bn).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('has no empty string in either language', () => {
    for (const locale of ['en', 'bn'] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('translates the brand promise exactly as the book writes it', () => {
    expect(t('en', 'brand.promise')).toBe("Your town's food, in one place.");
    expect(t('bn', 'brand.promise')).toBe('শহরের সব খাবার, এক ঠিকানায়।');
  });

  it('fills parameters', () => {
    expect(t('en', 'restaurant.opensAt', { time: '4 PM' })).toBe('Opens at 4 PM');
  });

  it('throws when a parameter is missing', () => {
    expect(() => t('en', 'restaurant.opensAt')).toThrow(/time/);
  });

  it('converts digits to Bangla', () => {
    expect(toBanglaDigits('280')).toBe('২৮০');
    expect(toBanglaDigits('Tk 1,050')).toBe('Tk ১,০৫০');
  });

  it('formats money as the book specifies', () => {
    expect(formatMoney(taka(280), 'en')).toBe('Tk 280');
    expect(formatMoney(taka(280), 'bn')).toBe('৳২৮০');
    expect(formatMoney(taka(0), 'en')).toBe('Tk 0');
  });

  it('groups large amounts and shows poisha only when present', () => {
    expect(formatMoney(taka(20000), 'en')).toBe('Tk 20,000');
    expect(formatMoney(taka(20000), 'bn')).toBe('৳২০,০০০');
    expect(formatMoney(taka(150000), 'en')).toBe('Tk 1,50,000');
    expect(formatMoney(taka(15.5), 'en')).toBe('Tk 15.50');
  });
});
