import { queryKeys, useQueryClient, useSession } from '@oregano/app-core';
import { Screen } from '@oregano/ui-native';
import { ErrorState } from '../components';
import { RiderScreen, RidersOnly } from '../rider';
import { SignIn } from '../sign-in';

/** The rider screen is the whole app: sign in, then go online, claim an order and deliver it. */
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
  // Applicants have a rider record too; only an approved rider gets the delivery screen (joining screens: Task 18).
  if (session.me.rider?.status !== 'approved') return <RidersOnly />;
  return <RiderScreen isOnline={session.me.rider.isOnline} />;
}
