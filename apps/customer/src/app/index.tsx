import { queryKeys, useApi, useQuery } from '@oregano/app-core';
import { taka } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, useLocale } from '@oregano/ui-native';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Card, ErrorState, pick } from '../components';
import { TOWN_CENTRE } from '../config';

export default function Home() {
  const { locale, setLocale } = useLocale();
  const api = useApi();
  const restaurants = useQuery({ queryKey: queryKeys.restaurants, queryFn: () => api.restaurants(TOWN_CENTRE) });

  return (
    <Screen scroll>
      <View style={styles.content}>
        <Heading>{t(locale, 'brand.promise')}</Heading>
        <Body muted>{formatMoney(taka(280), locale)}</Body>
      </View>
      <Button label={t(locale, 'language.switchTo')} onPress={() => setLocale(locale === 'en' ? 'bn' : 'en')} />

      <Heading level={2}>{t(locale, 'restaurant.listTitle')}</Heading>
      {restaurants.isPending ? <ActivityIndicator /> : null}
      {restaurants.isError ? <ErrorState error={restaurants.error} onRetry={() => void restaurants.refetch()} /> : null}
      {restaurants.data && restaurants.data.zone === null ? <Body>{t(locale, 'zone.outside')}</Body> : null}
      {restaurants.data && restaurants.data.zone !== null && restaurants.data.restaurants.length === 0 ? (
        <Body>{t(locale, 'restaurant.noneYet')}</Body>
      ) : null}
      {restaurants.data?.restaurants.map((r) => {
        const name = pick(locale, r.nameEn, r.nameBn);
        return (
          <Link key={r.id} href={`/r/${r.slug}`} asChild>
            <Pressable role="link" accessibilityLabel={name}>
              <Card>
                <Heading level={2}>{name}</Heading>
                <Body muted>{pick(locale, r.cuisineEn, r.cuisineBn)}</Body>
                {r.isOpen ? null : <Body strong>{t(locale, 'restaurant.closed')}</Body>}
              </Card>
            </Pressable>
          </Link>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: layout.screenMargin },
});
