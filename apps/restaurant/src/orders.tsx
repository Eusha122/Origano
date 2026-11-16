import {
  OPEN_ORDER_REFETCH_MS,
  queryKeys,
  useApi,
  useMutation,
  useQuery,
  useQueryClient,
  useSession,
} from '@oregano/app-core';
import type { Order } from '@oregano/contracts';
import { poisha, READY_MINUTES, REJECT_REASONS, type ReadyMinutes, type RejectReason } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { colors, layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, useLocale } from '@oregano/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorState } from './components';

type Tab = 'placed' | 'preparing' | 'ready';
const TABS: ReadonlyArray<{ status: Tab; label: 'restaurant.new' | 'restaurant.preparing' | 'restaurant.ready' }> = [
  { status: 'placed', label: 'restaurant.new' },
  { status: 'preparing', label: 'restaurant.preparing' },
  { status: 'ready', label: 'restaurant.ready' },
];

/** "2 × Cold Coffee". */
function quantityLine(quantity: number, name: string): string {
  return `${quantity} × ${name}`;
}

/** The three lists of open orders, refreshed by realtime hints and every 15 seconds. */
export function OrdersScreen() {
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const [tab, setTab] = useState<Tab>('placed');
  const orders = useQuery({
    queryKey: queryKeys.restaurantOrders,
    queryFn: () => api.restaurantOrders(),
    refetchInterval: OPEN_ORDER_REFETCH_MS,
  });

  const all = orders.data ?? [];
  const shown = all.filter((order) => order.status === tab);

  return (
    <Screen scroll>
      <Heading>{t(locale, 'restaurant.title')}</Heading>
      <View style={styles.tabs}>
        {TABS.map((entry) => (
          <View key={entry.status} style={styles.tab}>
            <Button
              label={`${t(locale, entry.label)} ${all.filter((order) => order.status === entry.status).length}`}
              selected={tab === entry.status}
              onPress={() => setTab(entry.status)}
            />
          </View>
        ))}
      </View>
      {orders.isError && !orders.data ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : shown.length === 0 ? (
        orders.isPending ? null : (
          <Body large muted>
            {t(locale, 'restaurant.empty')}
          </Body>
        )
      ) : (
        shown.map((order) => <OrderCard key={order.id} order={order} />)
      )}
      <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
    </Screen>
  );
}

function OrderCard(props: { order: Order }) {
  const { order } = props;
  const { locale } = useLocale();
  const heading = `#${order.number}`;
  return (
    <View style={styles.card}>
      <Heading level={2}>{heading}</Heading>
      {order.items.map((item) => (
        <Body large key={item.menuItemId}>
          {quantityLine(item.quantity, locale === 'bn' ? item.nameBn : item.nameEn)}
        </Body>
      ))}
      <Body large strong>
        {formatMoney(poisha(order.total), locale)}
      </Body>
      <Body large muted>
        {t(locale, 'checkout.cash')}
      </Body>
      {order.delivery.landmark ? (
        <Body large muted>
          {order.delivery.landmark}
        </Body>
      ) : null}
      {order.status === 'placed' ? <NewActions order={order} /> : null}
      {order.status === 'preparing' ? <PreparingActions order={order} /> : null}
    </View>
  );
}

/** Runs an order action, then refreshes the orders; the failure shows under the buttons. */
function useOrderAction<V>(run: (variables: V) => Promise<Order>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.restaurantOrders }),
  });
}

function NewActions(props: { order: Order }) {
  const { locale } = useLocale();
  const api = useApi();
  const [minutes, setMinutes] = useState<ReadyMinutes | null>(null);
  const [declining, setDeclining] = useState(false);
  const accept = useOrderAction((value: ReadyMinutes) => api.acceptOrder(props.order.id, value));
  const reject = useOrderAction((reason: RejectReason) => api.rejectOrder(props.order.id, reason));
  const failure = accept.error ?? reject.error;

  return (
    <View style={styles.actions}>
      {READY_MINUTES.map((value) => (
        <Button
          key={value}
          label={t(locale, 'restaurant.readyIn', { minutes: value })}
          selected={minutes === value}
          onPress={() => setMinutes(value)}
        />
      ))}
      <Button
        label={t(locale, 'restaurant.accept')}
        disabled={minutes === null}
        busy={accept.isPending}
        onPress={() => {
          if (minutes !== null) accept.mutate(minutes);
        }}
      />
      <Button label={t(locale, 'restaurant.reject')} variant="secondary" onPress={() => setDeclining(true)} />
      {declining
        ? REJECT_REASONS.map((reason) => (
            <Button
              key={reason}
              label={t(locale, `reject.${reason}`)}
              variant="secondary"
              busy={reject.isPending}
              onPress={() => reject.mutate(reason)}
            />
          ))
        : null}
      {failure ? <ErrorState error={failure} onRetry={() => (declining ? reject.reset() : accept.reset())} /> : null}
    </View>
  );
}

function PreparingActions(props: { order: Order }) {
  const { locale } = useLocale();
  const api = useApi();
  const ready = useOrderAction(() => api.markReady(props.order.id));
  return (
    <View style={styles.actions}>
      <Button label={t(locale, 'restaurant.markReady')} busy={ready.isPending} onPress={() => ready.mutate()} />
      {ready.error ? <ErrorState error={ready.error} onRetry={() => ready.reset()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: layout.screenMargin / 2 },
  tab: { flex: 1 },
  card: {
    backgroundColor: colors.white,
    borderRadius: layout.cardRadiusMin,
    borderWidth: layout.iconStroke,
    borderColor: colors.line,
    padding: layout.screenMargin,
    gap: layout.screenMargin / 2,
  },
  actions: { gap: layout.screenMargin / 2 },
});
