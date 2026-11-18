import { queryKeys, useQueryClient, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { Body, Button, Heading, LanguageButton, Screen, useLocale } from '@oregano/ui-native';
import { ErrorState } from '../components';
import { OrdersScreen } from '../orders';
import { SignIn } from '../sign-in';

/** The orders screen is the whole app: sign in, then staff work the three lists. */
export default function Index() {
  const { locale } = useLocale();
  const session = useSession();
  const queryClient = useQueryClient();

  if (!session.isSignedIn) return <SignIn />;
  if (!session.me) {
    return (
      <Screen>
        {session.error ? (
          <ErrorState
            error={session.error}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: queryKeys.me })}
          />
        ) : null}
      </Screen>
    );
  }
  if (!session.me.roles.includes('restaurant')) {
    return (
      <Screen>
        <Heading>{t(locale, 'restaurant.title')}</Heading>
        <LanguageButton />
        <Body large>{t(locale, 'restaurant.staffOnly')}</Body>
        <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
      </Screen>
    );
  }
  return <OrdersScreen />;
}
