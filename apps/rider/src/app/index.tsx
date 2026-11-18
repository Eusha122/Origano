import { queryKeys, useApi, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { Body, Button, Heading, LanguageButton, Screen, useLocale } from '@oregano/ui-native';
import { ErrorState } from '../components';
import { JoinScreen } from '../join';
import { RiderScreen } from '../rider';
import { SignIn } from '../sign-in';

/** Sign in, then by where the rider's application stands: join, wait, fix it, work, or paused. */
export default function Index() {
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
  const rider = session.me.rider;
  if (rider?.status === 'approved') return <RiderScreen isOnline={rider.isOnline} />;
  return <Applicant status={rider?.status ?? null} />;
}

/** Everyone who is not an approved rider: a new person, an applicant, or a rider whose account is paused. */
function Applicant(props: { status: 'applied' | 'under_review' | 'approved' | 'rejected' | 'suspended' | null }) {
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const application = useQuery({
    queryKey: queryKeys.riderApplication,
    queryFn: () => api.riderApplication(),
  });

  if (application.isError) {
    return (
      <Screen scroll>
        <Heading>{t(locale, 'apply.rideCta')}</Heading>
        <LanguageButton />
        <ErrorState error={application.error} onRetry={() => void application.refetch()} />
        <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
      </Screen>
    );
  }
  if (application.isPending) {
    return (
      <Screen>
        <Heading>{t(locale, 'apply.rideCta')}</Heading>
      </Screen>
    );
  }
  const view = application.data;

  if (props.status === 'suspended') {
    // The rider can still finish an order already on the road; the delivery screen shows it, without going online.
    return <RiderScreen isOnline={false} pausedReason={view?.suspendedReason ?? ''} />;
  }
  if (props.status === 'under_review') {
    return (
      <Screen scroll>
        <Heading>{t(locale, 'apply.rideCta')}</Heading>
        <LanguageButton />
        <Body large>{t(locale, 'rider.underReview')}</Body>
        <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
      </Screen>
    );
  }
  return <JoinScreen view={view} />;
}
