import { colors, layout, typeScale } from '@oregano/ui';
import { useId } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocale } from './locale';
import { bodyFont } from './typography';

/** A labelled text input. An error is written out in words, not shown by colour alone. */
export function TextField(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  error?: string | null;
}) {
  const { locale } = useLocale();
  const labelId = `${useId()}-label`;
  const error = props.error ?? null;
  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={[styles.label, { fontFamily: bodyFont(locale, true) }]}>
        {props.label}
      </Text>
      <TextInput
        accessibilityLabel={props.label}
        aria-labelledby={labelId}
        aria-invalid={error !== null}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType ?? 'default'}
        style={[styles.input, error !== null && styles.inputError, { fontFamily: bodyFont(locale) }]}
      />
      {error !== null ? (
        <Text role="alert" style={[styles.error, { fontFamily: bodyFont(locale, true) }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: layout.screenMargin / 4 },
  label: { color: colors.plum, fontSize: typeScale.caption.size },
  input: {
    minHeight: layout.minTapTarget,
    borderRadius: layout.buttonRadius,
    borderWidth: layout.iconStroke,
    borderColor: colors.line,
    backgroundColor: colors.white,
    color: colors.plum,
    fontSize: typeScale.body.size,
    paddingHorizontal: layout.screenMargin * 0.75,
  },
  // The border is decoration; the message below says what is wrong.
  inputError: { borderColor: colors.coral },
  error: { color: colors.plum, fontSize: typeScale.caption.size },
});
