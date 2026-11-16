import type { OrderStatus } from '@oregano/domain';
import { type Locale, type MessageKey, t } from '@oregano/i18n';
import { type ColorName, colors, layout, typeScale } from '@oregano/ui';
import { StyleSheet, Text, View } from 'react-native';
import { bodyFont } from './typography';

const LABELS: Record<OrderStatus, MessageKey> = {
  placed: 'order.placed',
  preparing: 'order.preparing',
  ready: 'order.ready',
  on_the_way: 'order.onTheWay',
  delivered: 'order.delivered',
  rejected: 'order.rejected',
  cancelled: 'order.cancelled',
  // Plan 02 never produces these two; until they get their own words they read as the nearest outcome.
  expired: 'order.rejected',
  undeliverable: 'order.cancelled',
};

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
export function StatusLine(props: { status: OrderStatus; locale: Locale }) {
  return (
    <View style={styles.row}>
      <View aria-hidden style={[styles.dot, { backgroundColor: colors[DOTS[props.status]] }]} />
      <Text style={[styles.label, { fontFamily: bodyFont(props.locale, true) }]}>
        {t(props.locale, LABELS[props.status])}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.screenMargin / 2 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  label: { flexShrink: 1, color: colors.plum, fontSize: typeScale.body.size },
});
