import { ApiError, queryKeys, useApi, useMutation, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import { addMoney, isTerminal, poisha } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, TextField, useLocale } from '@oregano/ui-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useCart } from '../cart';
import { ErrorState, errorKey, pick, quantityLine } from '../components';
import { TOWN_CENTRE } from '../config';

export default function Checkout() {
  const { locale } = useLocale();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const cart = useCart();

  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [phoneEdit, setPhoneEdit] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const phone = phoneEdit ?? session.me?.phone ?? '';

  // Sign-in happens only here. A signed-in customer who is offline is still signed in, so never sent away.
  useEffect(() => {
    if (!session.isSignedIn) router.replace('/sign-in');
  }, [session.isSignedIn, router]);

  // The list was already fetched for the home screen, so this is normally a cache hit.
  const restaurants = useQuery({
    queryKey: queryKeys.restaurants,
    queryFn: () => api.restaurants(TOWN_CENTRE),
  });
  // A total is shown and submitted only once the fee is known: never a guess, never Tk 0 by default.
  const fee = restaurants.data?.restaurants.find((r) => r.id === cart.restaurant?.id)?.deliveryFee ?? null;
  const outsideZone = restaurants.isSuccess && fee === null;
  const total = fee === null ? null : addMoney(cart.subtotal, poisha(fee));

  const place = useMutation({
    mutationFn: () => {
      if (cart.restaurant === null) throw new Error('The cart is empty');
      const trimmedNote = note.trim();
      return api.placeOrder(
        {
          restaurantId: cart.restaurant.id,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          delivery: {
            lat: TOWN_CENTRE.lat,
            lng: TOWN_CENTRE.lng,
            addressLine: address.trim(),
            landmark: landmark.trim(),
            phone: phone.trim(),
          },
          ...(trimmedNote === '' ? {} : { note: trimmedNote }),
        },
        cart.idempotencyKey,
      );
    },
    onSuccess: (order) => {
      queryClient.setQueryData(queryKeys.order(order.id), order);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myOrders });
      router.replace(`/orders/${order.id}`);
      cart.clear();
    },
  });

  // The answer to an earlier tap may have been lost on the way back, so the order may exist: lead to it.
  const seeOrder = useMutation({
    mutationFn: () => api.myOrders(),
    onSuccess: (orders) => {
      const newest = orders.filter((o) => !isTerminal(o.status)).sort((a, b) => b.number - a.number)[0];
      if (newest) {
        queryClient.setQueryData(queryKeys.order(newest.id), newest);
        router.replace(`/orders/${newest.id}`);
        cart.clear();
      }
    },
  });
  const mayBePlaced = place.error instanceof ApiError && place.error.code === 'idempotency_key_reused';

  const required = t(locale, 'checkout.requiredField');
  const addressError = submitted && address.trim() === '' ? required : null;
  const landmarkError = submitted && landmark.trim() === '' ? required : null;
  const phoneError = submitted && phone.trim() === '' ? required : null;

  function onPlaceOrder() {
    setSubmitted(true);
    if (total === null) return;
    if (address.trim() === '' || landmark.trim() === '' || phone.trim() === '') return;
    place.mutate();
  }

  if (cart.lines.length === 0 && !place.isPending && !place.isSuccess) {
    return (
      <Screen>
        <Heading>{t(locale, 'checkout.title')}</Heading>
        <Body>{t(locale, 'cart.empty')}</Body>
        <Button label={t(locale, 'restaurant.listTitle')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Heading>{t(locale, 'checkout.title')}</Heading>
      {cart.restaurant ? <Body strong>{pick(locale, cart.restaurant.nameEn, cart.restaurant.nameBn)}</Body> : null}
      {cart.lines.map((l) => (
        <View key={l.menuItemId} style={styles.row}>
          <Body>{quantityLine(l.quantity, pick(locale, l.nameEn, l.nameBn))}</Body>
          <Body>{formatMoney(poisha(l.price * l.quantity))}</Body>
        </View>
      ))}
      <TextField label={t(locale, 'checkout.address')} value={address} onChangeText={setAddress} error={addressError} />
      <TextField
        label={t(locale, 'checkout.landmark')}
        value={landmark}
        onChangeText={setLandmark}
        error={landmarkError}
      />
      <Body muted>{t(locale, 'checkout.landmarkHint')}</Body>
      <TextField
        label={t(locale, 'auth.phoneLabel')}
        value={phone}
        onChangeText={setPhoneEdit}
        keyboardType="phone-pad"
        error={phoneError}
      />
      <TextField label={t(locale, 'checkout.note')} value={note} onChangeText={setNote} />
      <View style={styles.row}>
        <Body>{t(locale, 'checkout.subtotal')}</Body>
        <Body>{formatMoney(cart.subtotal)}</Body>
      </View>
      {restaurants.isError ? <ErrorState error={restaurants.error} onRetry={() => void restaurants.refetch()} /> : null}
      {outsideZone ? <Body>{t(locale, 'zone.outside')}</Body> : null}
      {restaurants.isPending ? <ActivityIndicator /> : null}
      {fee !== null && total !== null ? (
        <>
          <View style={styles.row}>
            <Body>{t(locale, 'checkout.deliveryFee')}</Body>
            <Body>{formatMoney(poisha(fee))}</Body>
          </View>
          <View style={styles.row}>
            <Body strong>{t(locale, 'checkout.total')}</Body>
            <Body strong>{formatMoney(total)}</Body>
          </View>
        </>
      ) : null}
      <Body muted>{t(locale, 'checkout.cash')}</Body>
      {place.isError ? (
        <View role="alert">
          <Body>{t(locale, errorKey(place.error))}</Body>
        </View>
      ) : null}
      {mayBePlaced ? (
        <Button
          label={t(locale, 'checkout.seeOrder')}
          variant="secondary"
          busy={seeOrder.isPending}
          onPress={() => seeOrder.mutate()}
        />
      ) : null}
      <Button
        label={
          total === null
            ? t(locale, 'action.placeOrder')
            : t(locale, 'checkout.placeOrder', { total: formatMoney(total) })
        }
        disabled={total === null}
        busy={place.isPending}
        onPress={onPlaceOrder}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: layout.screenMargin },
});
