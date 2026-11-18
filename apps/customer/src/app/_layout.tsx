import {
  ApiProvider,
  createMemorySessionStore,
  createWebSessionStore,
  useRealtimeHints,
  useSession,
} from '@oregano/app-core';
import { LocaleProvider, useBrandFonts } from '@oregano/ui-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { CartProvider } from '../cart';
import { apiUrl, realtimeUrl } from '../config';

void SplashScreen.preventAutoHideAsync();

// The browser keeps the session in localStorage; native keeps it in memory until secure storage (Plan 10).
// Browsers keep the refresh token in an httpOnly cookie; native apps hold it themselves until the keystore arrives in Plan 10.
const session = Platform.OS === 'web' ? createWebSessionStore() : createMemorySessionStore();

/** Runs the session check and the realtime connection once for the whole app. */
function AppShell() {
  useSession();
  useRealtimeHints();
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [loaded, error] = useBrandFonts();

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  // A font that fails to load falls back to the system font rather than blocking the app.
  if (!loaded && !error) return null;

  return (
    <LocaleProvider>
      <ApiProvider baseUrl={apiUrl} realtimeUrl={realtimeUrl} session={session}>
        <CartProvider>
          <AppShell />
        </CartProvider>
      </ApiProvider>
    </LocaleProvider>
  );
}
