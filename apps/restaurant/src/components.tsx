import { ApiError } from '@oregano/app-core';
import { type MessageKey, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, useLocale } from '@oregano/ui-native';
import { StyleSheet, View } from 'react-native';

/** The words for a failure: offline and the few refusals staff can act on; anything else is generic. */
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
    default:
      return 'error.generic';
  }
}

/** A calm failure message with a way to try again. */
export function ErrorState(props: { error: unknown; onRetry: () => void }) {
  const { locale } = useLocale();
  return (
    <View style={styles.stack}>
      <View role="alert">
        <Body large>{t(locale, errorKey(props.error))}</Body>
      </View>
      <Button label={t(locale, 'action.tryAgain')} variant="secondary" onPress={props.onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.screenMargin / 2 },
});
