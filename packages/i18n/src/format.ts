import type { Money } from '@oregano/domain';
import type { Locale } from './translate';

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number(digit)] ?? digit);
}

/** Groups digits the way Bangladesh writes them: last three, then pairs (1,50,000). */
function groupSouthAsian(whole: string): string {
  if (whole.length <= 3) return whole;
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${pairs},${lastThree}`;
}

/** "Tk 280" in English, "৳২৮০" in Bangla. Poisha appear only when the amount is not whole taka. */
export function formatMoney(amount: Money, locale: Locale): string {
  const whole = Math.floor(amount / 100);
  const poisha = amount % 100;
  const grouped = groupSouthAsian(String(whole));
  const number = poisha === 0 ? grouped : `${grouped}.${String(poisha).padStart(2, '0')}`;
  return locale === 'bn' ? `৳${toBanglaDigits(number)}` : `Tk ${number}`;
}
