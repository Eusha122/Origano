import { ApiError, errorMessageKey as errorKey } from '@oregano/app-core';
import { type Locale, type MessageKey, t } from '@oregano/i18n';
import { colors, layout } from '@oregano/ui';
import { Body, Button, useLocale } from '@oregano/ui-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export { errorKey };

/** "2 × Cold Coffee". */
export function quantityLine(quantity: number, name: string): string {
  return `${quantity} × ${name}`;
}

export function pick(locale: Locale, en: string, bn: string): string {
  return locale === 'bn' ? bn : en;
}

/** A calm failure message with a way to try again. */
export function ErrorState(props: { error: unknown; onRetry: () => void }) {
  const { locale } = useLocale();
  return (
    <View style={styles.stack}>
      <View role="alert">
        <Body>{t(locale, errorKey(props.error))}</Body>
      </View>
      <Button label={t(locale, 'action.tryAgain')} variant="secondary" onPress={props.onRetry} />
    </View>
  );
}

/** A white rounded block that groups one thing, such as a restaurant or a menu item. */
export function Card(props: { children: ReactNode }) {
  return <View style={styles.card}>{props.children}</View>;
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
