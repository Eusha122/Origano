import { queryKeys, useApi, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Button, Screen, useLocale } from '@oregano/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApplyScreen } from '../apply';
import { ErrorState } from '../components';
import { MenuScreen } from '../menu/menu-screen';
import { OrdersScreen } from '../orders';
import { SignIn } from '../sign-in';
import { StaffScreen } from '../staff';
import { TodayScreen } from '../today-controls';

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

type Tab = 'orders' | 'today' | 'menu' | 'staff';

/** The working app: orders and today for everyone on staff; the owner also gets the Staff tab. */
function RestaurantHome(props: { restaurantId: string }) {
  const { locale } = useLocale();
  const api = useApi();
  const [tab, setTab] = useState<Tab>('orders');
  // Only an owner may read the staff list, so a refusal means this person gets no owner tabs.
  const owner = useQuery({
    queryKey: queryKeys.staff(props.restaurantId),
    queryFn: () => api.staff(props.restaurantId),
    retry: false,
  });
  const entries: { id: Tab; label: string }[] = [
    { id: 'orders', label: t(locale, 'staff.ordersTab') },
    { id: 'today', label: t(locale, 'tabs.today') },
    { id: 'menu', label: t(locale, 'menu.title') },
    ...(owner.isSuccess ? [{ id: 'staff' as const, label: t(locale, 'staff.title') }] : []),
  ];
  const tabs = (
    <View style={styles.tabs}>
      {entries.map((entry) => (
        <View key={entry.id} style={styles.tab}>
          <Button label={entry.label} selected={tab === entry.id} onPress={() => setTab(entry.id)} />
        </View>
      ))}
    </View>
  );

  if (tab === 'staff' && owner.isSuccess) return <StaffScreen restaurantId={props.restaurantId} header={tabs} />;
  if (tab === 'menu') {
    return <MenuScreen restaurantId={props.restaurantId} isOwner={owner.isSuccess} header={tabs} />;
  }
  if (tab === 'today') return <TodayScreen restaurantId={props.restaurantId} header={tabs} />;
  return <OrdersScreen header={tabs} />;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.screenMargin / 2 },
  tab: { flexGrow: 1, flexBasis: 120 },
});
