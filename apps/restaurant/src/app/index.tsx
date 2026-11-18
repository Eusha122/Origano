import { queryKeys, useApi, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Button, Screen, useLocale } from '@oregano/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApplyScreen } from '../apply';
import { ErrorState } from '../components';
import { OrdersScreen } from '../orders';
import { SignIn } from '../sign-in';
import { StaffScreen } from '../staff';

/** Sign in, then either the orders (with Staff for an owner) or the application to join Oregano. */
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
  const restaurantId = session.me.restaurantIds[0];
  if (session.me.roles.includes('restaurant') && restaurantId) return <RestaurantHome restaurantId={restaurantId} />;
  return <ApplyScreen />;
}

/** The working app. The owner gets a second tab for staff; for anyone else the staff page would only say no. */
function RestaurantHome(props: { restaurantId: string }) {
  const { locale } = useLocale();
  const api = useApi();
  const [tab, setTab] = useState<'orders' | 'staff'>('orders');
  // Only an owner may read the staff list, so a refusal means this person gets no Staff tab.
  const owner = useQuery({
    queryKey: queryKeys.staff(props.restaurantId),
    queryFn: () => api.staff(props.restaurantId),
    retry: false,
  });
  const tabs = owner.isSuccess ? (
    <View style={styles.tabs}>
      <View style={styles.tab}>
        <Button label={t(locale, 'staff.ordersTab')} selected={tab === 'orders'} onPress={() => setTab('orders')} />
      </View>
      <View style={styles.tab}>
        <Button label={t(locale, 'staff.title')} selected={tab === 'staff'} onPress={() => setTab('staff')} />
      </View>
    </View>
  ) : null;

  if (tab === 'staff' && owner.isSuccess) return <StaffScreen restaurantId={props.restaurantId} header={tabs} />;
  return <OrdersScreen header={tabs} />;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: layout.screenMargin / 2 },
  tab: { flex: 1 },
});
