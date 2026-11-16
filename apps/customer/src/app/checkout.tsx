import {
  newIdempotencyKey,
  queryKeys,
  useApi,
  useMutation,
  useQuery,
  useQueryClient,
  useSession,
} from '@oregano/app-core';
import { addMoney, poisha } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, TextField, useLocale } from '@oregano/ui-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCart } from '../cart';
import { errorKey, pick, quantityLine } from '../components';
import { TOWN_CENTRE } from '../config';

export default function Checkout() {
  const { locale } = useLocale();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const cart = useCart();

  // One key for this visit to the screen: every tap and retry of the same attempt reuses it.
  const [idempotencyKey] = useState(newIdempotencyKey);
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
  const fee = restaurants.data?.restaurants.find((r) => r.id === cart.restaurant?.id)?.deliveryFee ?? 0;
  const total = addMoney(cart.subtotal, poisha(fee));

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
        idempotencyKey,
      );
    },
    onSuccess: (order) => {
      queryClient.setQueryData(queryKeys.order(order.id), order);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myOrders });
      router.replace(`/orders/${order.id}`);
      cart.clear();
    },
  });

  const required = t(locale, 'checkout.requiredField');
  const addressError = submitted && address.trim() === '' ? required : null;
  const landmarkError = submitted && landmark.trim() === '' ? required : null;
  const phoneError = submitted && phone.trim() === '' ? required : null;

  function onPlaceOrder() {
    setSubmitted(true);
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
          <Body>{formatMoney(poisha(l.price * l.quantity), locale)}</Body>
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
        <Body>{formatMoney(cart.subtotal, locale)}</Body>
      </View>
      <View style={styles.row}>
        <Body>{t(locale, 'checkout.deliveryFee')}</Body>
        <Body>{formatMoney(poisha(fee), locale)}</Body>
      </View>
      <View style={styles.row}>
        <Body strong>{t(locale, 'checkout.total')}</Body>
        <Body strong>{formatMoney(total, locale)}</Body>
      </View>
      <Body muted>{t(locale, 'checkout.cash')}</Body>
      {place.isError ? (
        <View role="alert">
          <Body>{t(locale, errorKey(place.error))}</Body>
        </View>
      ) : null}
      <Button
        label={t(locale, 'checkout.placeOrder', { total: formatMoney(total, locale) })}
        busy={place.isPending}
        onPress={onPlaceOrder}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: layout.screenMargin },
});
