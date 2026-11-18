import type { OrderStatus } from '@oregano/domain';
import { type Locale, orderStatusKey, t } from '@oregano/i18n';
import { type ColorName, colors, layout, typeScale } from '@oregano/ui';
import { StyleSheet, Text, View } from 'react-native';
import { bodyFont } from './typography';

const DOTS: Record<OrderStatus, ColorName> = {
  placed: 'champagne',
  preparing: 'coral',
  ready: 'coral',
  on_the_way: 'coral',
  delivered: 'plum',
  rejected: 'mutedPlum',
  cancelled: 'mutedPlum',
  expired: 'mutedPlum',
  undeliverable: 'mutedPlum',
};

/** The status dot is half the caption size, so it sits level with the text. */
const DOT = typeScale.caption.size / 2;

/** An order's status as a coloured dot plus words; the words carry the meaning, never the colour alone. */
export function StatusLine(props: {
  status: OrderStatus;
  locale: Locale;
  audience: 'customer' | 'rider';
  hasRider: boolean;
}) {
  return (
    <View style={styles.row}>
      <View aria-hidden style={[styles.dot, { backgroundColor: colors[DOTS[props.status]] }]} />
      <Text style={[styles.label, { fontFamily: bodyFont(props.locale, true) }]}>
        {t(props.locale, orderStatusKey(props.status, props.audience, props.hasRider))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.screenMargin / 2 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  label: { flexShrink: 1, color: colors.plum, fontSize: typeScale.body.size },
});
