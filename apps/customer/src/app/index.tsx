import { taka } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { colors, layout, typeScale } from '@oregano/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale } from '../locale';
import { bodyFont, headingFont } from '../typography';

export default function Home() {
  const { locale, setLocale } = useLocale();
  const switchLabel = t(locale, 'language.switchTo');

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text role="heading" aria-level={1} style={[styles.title, { fontFamily: headingFont(locale) }]}>
          {t(locale, 'brand.promise')}
        </Text>
        <Text style={[styles.body, { fontFamily: bodyFont(locale) }]}>{formatMoney(taka(280), locale)}</Text>
      </View>
      <Pressable
        role="button"
        accessibilityLabel={switchLabel}
        onPress={() => setLocale(locale === 'en' ? 'bn' : 'en')}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={[styles.buttonText, { fontFamily: bodyFont(locale, true) }]}>{switchLabel}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: layout.screenMargin,
    paddingBottom: layout.screenMargin,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: layout.screenMargin,
  },
  title: {
    color: colors.plum,
    fontSize: typeScale.title.size,
  },
  body: {
    color: colors.mutedPlum,
    fontSize: typeScale.body.size,
  },
  button: {
    minHeight: layout.minTapTarget,
    borderRadius: layout.buttonRadius,
    backgroundColor: colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenMargin,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.cream,
    fontSize: typeScale.bodyStrong.size,
  },
});
