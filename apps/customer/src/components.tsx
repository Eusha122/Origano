import { ApiError } from '@oregano/app-core';
import { type Locale, type MessageKey, t } from '@oregano/i18n';
import { colors, layout } from '@oregano/ui';
import { Body, Button, useLocale } from '@oregano/ui-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** The words for a failure: offline and the few refusals a customer can act on; anything else is generic. */
export function errorKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return 'error.generic';
  if (error.status === 0) return 'status.offline';
  switch (error.code) {
    case 'invalid_phone':
      return 'auth.invalidPhone';
    case 'otp_invalid':
    case 'otp_expired':
    case 'otp_attempts_exceeded':
      return 'auth.wrongCode';
    case 'outside_zone':
      return 'zone.outside';
    case 'idempotency_key_reused':
      return 'checkout.mayBePlaced';
    case 'restaurant_closed':
      return 'error.restaurantClosed';
    case 'item_not_in_restaurant':
      return 'error.itemNotInRestaurant';
    case 'validation_failed':
      return 'error.validationFailed';
    case 'item_unavailable':
      return 'item.soldOut';
    default:
      return 'error.generic';
  }
}

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
