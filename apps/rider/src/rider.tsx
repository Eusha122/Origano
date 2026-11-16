import {
  ApiError,
  OPEN_ORDER_REFETCH_MS,
  queryKeys,
  useApi,
  useMutation,
  useQuery,
  useQueryClient,
  useSession,
} from '@oregano/app-core';
import type { Order, RiderOffer } from '@oregano/contracts';
import { isTerminal, poisha } from '@oregano/domain';
import { formatMoney, type Locale, t, toBanglaDigits } from '@oregano/i18n';
import { colors, layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, StatusLine, useLocale } from '@oregano/ui-native';
import { Linking, StyleSheet, View } from 'react-native';
import { ErrorState } from './components';

/** "1.2 km away" in English digits or Bangla digits. */
function distanceText(km: number, locale: Locale): string {
  const value = km.toFixed(1);
  return t(locale, 'rider.distance', { km: locale === 'bn' ? toBanglaDigits(value) : value });
}

/** A signed-in person who is not an approved rider gets a plain message and a way out. */
export function RidersOnly() {
  const { locale } = useLocale();
  const session = useSession();
  return (
    <Screen>
      <Heading>{t(locale, 'rider.title')}</Heading>
      <Body large>{t(locale, 'rider.ridersOnly')}</Body>
      <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
    </Screen>
  );
}

/** Online switch, then the order the rider holds, or else the offers to claim. */
export function RiderScreen(props: { isOnline: boolean }) {
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const queryClient = useQueryClient();

  const held = useQuery({
    queryKey: queryKeys.riderOrders,
    queryFn: () => api.riderOrders(),
    refetchInterval: OPEN_ORDER_REFETCH_MS,
  });
  const order = held.data?.find((entry) => !isTerminal(entry.status)) ?? null;
  const browsing = props.isOnline && held.isSuccess && order === null;

  const toggle = useMutation({
    mutationFn: () => api.setOnline(!props.isOnline),
    onSuccess: (me) => queryClient.setQueryData(queryKeys.me, me),
  });

  if (held.error instanceof ApiError && held.error.status === 403) return <RidersOnly />;

  return (
    <Screen scroll>
      <Heading>{t(locale, 'rider.title')}</Heading>
      <Button
        label={t(locale, props.isOnline ? 'rider.goOffline' : 'rider.goOnline')}
        variant={props.isOnline ? 'secondary' : 'primary'}
        busy={toggle.isPending}
        onPress={() => toggle.mutate()}
      />
      {toggle.error ? <ErrorState error={toggle.error} onRetry={() => toggle.reset()} /> : null}
      {held.isError && !held.data ? (
        <ErrorState error={held.error} onRetry={() => void held.refetch()} />
      ) : order ? (
        <HeldOrder order={order} />
      ) : browsing ? (
        <Offers />
      ) : null}
      <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
    </Screen>
  );
}

function Offers() {
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const offers = useQuery({
    queryKey: queryKeys.offers,
    queryFn: () => api.offers(),
    refetchInterval: OPEN_ORDER_REFETCH_MS,
  });
  const claim = useMutation({
    mutationFn: (orderId: string) => api.claimOrder(orderId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.offers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.riderOrders }),
      ]),
  });
  const taken = claim.error instanceof ApiError && claim.error.code === 'already_claimed';

  if (offers.isError && !offers.data) return <ErrorState error={offers.error} onRetry={() => void offers.refetch()} />;
  const list = offers.data ?? [];
  return (
    <View style={styles.stack}>
      {taken ? (
        <View role="alert">
          <Body large strong>
            {t(locale, 'rider.taken')}
          </Body>
        </View>
      ) : claim.error ? (
        <ErrorState error={claim.error} onRetry={() => claim.reset()} />
      ) : null}
      {list.length === 0 ? (
        offers.isPending ? null : (
          <Body large muted>
            {t(locale, 'rider.noOffers')}
          </Body>
        )
      ) : (
        list.map((offer) => (
          <OfferCard
            key={offer.orderId}
            offer={offer}
            busy={claim.isPending && claim.variables === offer.orderId}
            onClaim={() => claim.mutate(offer.orderId)}
          />
        ))
      )}
    </View>
  );
}

function OfferCard(props: { offer: RiderOffer; busy: boolean; onClaim: () => void }) {
  const { offer } = props;
  const { locale } = useLocale();
  return (
    <View style={styles.card}>
      <Heading level={2}>{locale === 'bn' ? offer.restaurant.nameBn : offer.restaurant.nameEn}</Heading>
      <Body large muted>
        {offer.landmark}
      </Body>
      <Body large>{distanceText(offer.distanceKm, locale)}</Body>
      <Body large strong>
        {formatMoney(poisha(offer.deliveryFee), locale)}
      </Body>
      <Button label={t(locale, 'rider.claim')} busy={props.busy} onPress={props.onClaim} />
    </View>
  );
}

function HeldOrder(props: { order: Order }) {
  const { order } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.offers }),
      queryClient.invalidateQueries({ queryKey: queryKeys.riderOrders }),
    ]);
  const pickUp = useMutation({ mutationFn: () => api.pickUp(order.id), onSuccess: refresh });
  const deliver = useMutation({ mutationFn: () => api.deliver(order.id), onSuccess: refresh });
  const failure = pickUp.error ?? deliver.error;

  return (
    <View style={styles.card}>
      <Heading level={2}>{locale === 'bn' ? order.restaurant.nameBn : order.restaurant.nameEn}</Heading>
      <StatusLine status={order.status} locale={locale} />
      <Body large strong>
        {t(locale, 'rider.deliverTo')}
      </Body>
      <Body large>{order.delivery.addressLine}</Body>
      <Body large muted>
        {order.delivery.landmark}
      </Body>
      {order.customerPhone ? (
        <Button
          label={t(locale, 'rider.callCustomer')}
          variant="secondary"
          onPress={() => void Linking.openURL(`tel:${order.customerPhone}`)}
        />
      ) : null}
      {order.status === 'on_the_way' ? (
        <>
          <Body large strong>
            {t(locale, 'rider.collectCash', { amount: formatMoney(poisha(order.total), locale) })}
          </Body>
          <Button label={t(locale, 'rider.delivered')} busy={deliver.isPending} onPress={() => deliver.mutate()} />
        </>
      ) : (
        <Button
          label={t(locale, 'rider.pickedUp')}
          disabled={order.status !== 'ready'}
          busy={pickUp.isPending}
          onPress={() => pickUp.mutate()}
        />
      )}
      {failure ? (
        <ErrorState error={failure} onRetry={() => (deliver.error ? deliver.reset() : pickUp.reset())} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.screenMargin / 2 },
  card: {
    backgroundColor: colors.white,
    borderRadius: layout.cardRadiusMin,
    borderWidth: layout.iconStroke,
    borderColor: colors.line,
    padding: layout.screenMargin,
    gap: layout.screenMargin / 2,
  },
});
