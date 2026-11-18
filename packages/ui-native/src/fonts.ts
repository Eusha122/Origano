import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { HindSiliguri_400Regular } from '@expo-google-fonts/hind-siliguri/400Regular';
import { HindSiliguri_600SemiBold } from '@expo-google-fonts/hind-siliguri/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { fonts } from '@oregano/ui';
import { useFonts } from 'expo-font';
import { fontFamily } from './typography';

/**
 * Loads the brand faces, one file per weight (per-weight imports keep the web bundle small).
 * Each family is registered under the name the brand tokens use, so styles can say fontFamily: fonts.heading.
 */
export function useBrandFonts(): [loaded: boolean, error: Error | null] {
  return useFonts({
    [fonts.heading]: Fraunces_400Regular,
    [fonts.body]: PlusJakartaSans_400Regular,
    [fontFamily.bodySemiBold]: PlusJakartaSans_600SemiBold,
    [fonts.bangla]: HindSiliguri_400Regular,
    [fontFamily.banglaSemiBold]: HindSiliguri_600SemiBold,
  });
}
