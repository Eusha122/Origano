import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { HindSiliguri_400Regular } from '@expo-google-fonts/hind-siliguri/400Regular';
import { HindSiliguri_600SemiBold } from '@expo-google-fonts/hind-siliguri/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { fonts } from '@oregano/ui';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LocaleProvider } from '../locale';
import { fontFamily } from '../typography';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Each family is registered under the name the brand tokens use, so styles can say fontFamily: fonts.heading.
  const [loaded, error] = useFonts({
    [fonts.heading]: Fraunces_400Regular,
    [fonts.body]: PlusJakartaSans_400Regular,
    [fontFamily.bodySemiBold]: PlusJakartaSans_600SemiBold,
    [fonts.bangla]: HindSiliguri_400Regular,
    [fontFamily.banglaSemiBold]: HindSiliguri_600SemiBold,
  });

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  // A font that fails to load falls back to the system font rather than blocking the app.
  if (!loaded && !error) return null;

  return (
    <LocaleProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </LocaleProvider>
  );
}
