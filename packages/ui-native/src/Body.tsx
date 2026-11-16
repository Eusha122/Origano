import { colors, typeScale } from '@oregano/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocale } from './locale';
import { bodyFont } from './typography';

/** Body text: plum, or muted plum for secondary details; strong uses the semi-bold face. */
export function Body(props: { children: ReactNode; muted?: boolean; strong?: boolean }) {
  const { locale } = useLocale();
  return (
    <Text style={[styles.body, props.muted && styles.muted, { fontFamily: bodyFont(locale, props.strong ?? false) }]}>
      {props.children}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.plum, fontSize: typeScale.body.size },
  muted: { color: colors.mutedPlum },
});
