import { taka } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, Screen, useLocale } from '@oregano/ui-native';
import { StyleSheet, View } from 'react-native';

export default function Home() {
  const { locale, setLocale } = useLocale();

  return (
    <Screen>
      <View style={styles.content}>
        <Heading>{t(locale, 'brand.promise')}</Heading>
        <Body muted>{formatMoney(taka(280), locale)}</Body>
      </View>
      <Button label={t(locale, 'language.switchTo')} onPress={() => setLocale(locale === 'en' ? 'bn' : 'en')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: layout.screenMargin,
  },
});
