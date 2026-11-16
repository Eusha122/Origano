import { colors, layout, typeScale } from '@oregano/ui';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocale } from './locale';
import { bodyFont } from './typography';

/** A button at least 48 px tall. Busy shows a spinner and ignores presses. */
export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
}) {
  const { locale } = useLocale();
  const primary = (props.variant ?? 'primary') === 'primary';
  const inactive = Boolean(props.disabled || props.busy);
  return (
    <Pressable
      role="button"
      accessibilityLabel={props.label}
      aria-disabled={inactive}
      aria-busy={props.busy ?? false}
      disabled={inactive}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        props.disabled && styles.disabled,
      ]}
    >
      <View style={styles.row}>
        {props.busy ? <ActivityIndicator color={primary ? colors.cream : colors.plum} /> : null}
        <Text
          style={[
            styles.label,
            primary ? styles.primaryLabel : styles.secondaryLabel,
            { fontFamily: bodyFont(locale, true) },
          ]}
        >
          {props.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.minTapTarget,
    borderRadius: layout.buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenMargin,
  },
  primary: { backgroundColor: colors.plum },
  secondary: { backgroundColor: colors.white, borderWidth: layout.iconStroke, borderColor: colors.plum },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.screenMargin / 2 },
  label: { fontSize: typeScale.bodyStrong.size },
  primaryLabel: { color: colors.cream },
  secondaryLabel: { color: colors.plum },
});
