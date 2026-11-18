import { OPEN_ORDER_REFETCH_MS, queryKeys, useApi, useQuery } from '@oregano/app-core';
import { isTerminal, poisha } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, StatusLine, useLocale } from '@oregano/ui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ErrorState, pick, quantityLine } from '../../components';

export default function OrderTracking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locale } = useLocale();
  const api = useApi();
  const router = useRouter();

  // Realtime hints (mounted in the root layout) refresh this sooner; polling covers a missed hint.
  const order = useQuery({
    queryKey: queryKeys.order(id),
    queryFn: () => api.order(id),
    refetchInterval: (query) => {
      const current = query.state.data;
      return current !== undefined && isTerminal(current.status) ? false : OPEN_ORDER_REFETCH_MS;
    },
  });
  const data = order.data;

  return (
    <Screen scroll>
      {order.isPending ? <ActivityIndicator /> : null}
      {order.isError && !data ? <ErrorState error={order.error} onRetry={() => void order.refetch()} /> : null}
      {data ? (
        <>
          <Heading>{t(locale, 'order.number', { number: data.number })}</Heading>
          <StatusLine status={data.status} locale={locale} audience="customer" hasRider={data.rider !== null} />
          <Body strong>{pick(locale, data.restaurant.nameEn, data.restaurant.nameBn)}</Body>
          {data.items.map((item) => (
            <View key={item.menuItemId} style={styles.row}>
              <Body>{quantityLine(item.quantity, pick(locale, item.nameEn, item.nameBn))}</Body>
              <Body>{formatMoney(poisha(item.lineTotal), locale)}</Body>
            </View>
          ))}
          <View style={styles.row}>
            <Body>{t(locale, 'checkout.deliveryFee')}</Body>
            <Body>{formatMoney(poisha(data.deliveryFee), locale)}</Body>
          </View>
          <View style={styles.row}>
            <Body strong>{t(locale, 'checkout.total')}</Body>
            <Body strong>{formatMoney(poisha(data.total), locale)}</Body>
          </View>
          <Body muted>{t(locale, 'checkout.cash')}</Body>
          <Body muted>{[data.delivery.addressLine, data.delivery.landmark].join(', ')}</Body>
        </>
      ) : null}
      <Button label={t(locale, 'restaurant.listTitle')} variant="secondary" onPress={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: layout.screenMargin },
});
