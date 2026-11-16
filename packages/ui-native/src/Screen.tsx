import { colors, layout } from '@oregano/ui';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** A full screen on cream, inside the safe area, with the brand's 20 px side margins. */
export function Screen(props: { children: ReactNode; scroll?: boolean }) {
  if (props.scroll) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {props.children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.fill]}>{props.children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  fill: { flex: 1 },
  content: {
    paddingHorizontal: layout.screenMargin,
    paddingBottom: layout.screenMargin,
    gap: layout.screenMargin,
  },
});
