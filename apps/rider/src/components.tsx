import { ApiError, errorMessageKey as errorKey } from '@oregano/app-core';
import { type MessageKey, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, useLocale } from '@oregano/ui-native';
import { StyleSheet, View } from 'react-native';

export { errorKey };

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
