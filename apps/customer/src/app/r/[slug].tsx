import { queryKeys, useApi, useQuery } from '@oregano/app-core';
import type { RestaurantDetail } from '@oregano/contracts';
import { poisha } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, useLocale } from '@oregano/ui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { type CartItem, type CartRestaurant, useCart } from '../../cart';
import { Card, ErrorState, pick, quantityLine } from '../../components';

export default function RestaurantPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { locale } = useLocale();
  const api = useApi();
  const router = useRouter();
  const cart = useCart();
  const [pending, setPending] = useState<CartItem | null>(null);

  const restaurant = useQuery({ queryKey: queryKeys.restaurant(slug), queryFn: () => api.restaurant(slug) });

  const data: RestaurantDetail | undefined = restaurant.data;
  const cartRestaurant: CartRestaurant | null = data
    ? { id: data.id, slug: data.slug, nameEn: data.nameEn, nameBn: data.nameBn }
    : null;

  function addItem(item: CartItem) {
    if (cartRestaurant === null) return;
    if (!cart.add(cartRestaurant, item)) setPending(item);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.list}>
        <Button
          label={t(locale, 'restaurant.listTitle')}
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        {restaurant.isPending ? <ActivityIndicator /> : null}
        {restaurant.isError ? <ErrorState error={restaurant.error} onRetry={() => void restaurant.refetch()} /> : null}
        {data ? (
          <>
            <Heading>{pick(locale, data.nameEn, data.nameBn)}</Heading>
            <Body muted>{pick(locale, data.cuisineEn, data.cuisineBn)}</Body>
            <Body muted>{t(locale, 'restaurant.samePrice')}</Body>
            {data.isOpen ? null : <Body strong>{t(locale, 'restaurant.closed')}</Body>}
            {pending !== null ? (
              <Card>
                <Heading level={2}>{t(locale, 'cart.replaceTitle')}</Heading>
                <Body>
                  {t(locale, 'cart.replaceBody', {
                    restaurant: cart.restaurant ? pick(locale, cart.restaurant.nameEn, cart.restaurant.nameBn) : '',
                  })}
                </Body>
                <Button
                  label={t(locale, 'cart.replace')}
                  onPress={() => {
                    if (cartRestaurant) cart.replaceWith(cartRestaurant, pending);
                    setPending(null);
                  }}
                />
                <Button label={t(locale, 'cart.keep')} variant="secondary" onPress={() => setPending(null)} />
              </Card>
            ) : null}
            {data.categories.map((category) => (
              <View key={category.id} style={styles.list}>
                <Heading level={2}>{pick(locale, category.nameEn, category.nameBn)}</Heading>
                {category.items.map((item) => {
                  const name = pick(locale, item.nameEn, item.nameBn);
                  const description = pick(locale, item.descriptionEn ?? '', item.descriptionBn ?? '');
                  const inCart = cart.lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0;
                  return (
                    <Card key={item.id}>
                      <Body strong>{name}</Body>
                      {description === '' ? null : <Body muted>{description}</Body>}
                      <Body>{formatMoney(poisha(item.price), locale)}</Body>
                      {item.isAvailable && data.isOpen ? (
                        <>
                          <Button
                            label={`${t(locale, 'cart.add')} ${name}`}
                            onPress={() =>
                              addItem({
                                menuItemId: item.id,
                                nameEn: item.nameEn,
                                nameBn: item.nameBn,
                                price: item.price,
                              })
                            }
                          />
                          {inCart > 0 ? (
                            <>
                              <Body muted>{quantityLine(inCart, name)}</Body>
                              <Button
                                label={`${t(locale, 'cart.remove')} ${name}`}
                                variant="secondary"
                                onPress={() => cart.remove(item.id)}
                              />
                            </>
                          ) : null}
                        </>
                      ) : item.isAvailable ? null : (
                        <Body strong>{t(locale, 'item.soldOut')}</Body>
                      )}
                    </Card>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      {cart.count > 0 ? (
        <Button
          label={t(locale, 'cart.viewCart', { count: cart.count, total: formatMoney(cart.subtotal, locale) })}
          onPress={() => router.push('/checkout')}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: layout.screenMargin },
});
