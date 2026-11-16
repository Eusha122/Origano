import { colors, typeScale } from '@oregano/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocale } from './locale';
import { bodyFont, headingFont } from './typography';

/** A screen title (level 1) or section heading (level 2), announced as a heading. */
export function Heading(props: { children: ReactNode; level?: 1 | 2 }) {
  const { locale } = useLocale();
  const level = props.level ?? 1;
  const fontFamily = level === 1 ? headingFont(locale) : bodyFont(locale, true);
  return (
    <Text role="heading" aria-level={level} style={[level === 1 ? styles.title : styles.section, { fontFamily }]}>
      {props.children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.plum, fontSize: typeScale.title.size },
  section: { color: colors.plum, fontSize: typeScale.sectionHeading.size },
});
