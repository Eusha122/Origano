import type { Locale } from '@oregano/i18n';
import { fonts } from '@oregano/ui';

/** Registered font names for weights that need their own file. */
export const fontFamily = {
  bodySemiBold: `${fonts.body} SemiBold`,
  banglaSemiBold: `${fonts.bangla} SemiBold`,
} as const;

/** Bangla text always uses Hind Siliguri; English uses the brand's heading or body face. */
export function headingFont(locale: Locale): string {
  return locale === 'bn' ? fonts.bangla : fonts.heading;
}

export function bodyFont(locale: Locale, strong = false): string {
  if (locale === 'bn') return strong ? fontFamily.banglaSemiBold : fonts.bangla;
  return strong ? fontFamily.bodySemiBold : fonts.body;
}
