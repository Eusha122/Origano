import { layout } from '@oregano/ui';
import { StyleSheet, View } from 'react-native';
import { Button } from './Button';

/** One choice among a few, as a row of buttons; the chosen one is filled and announced as pressed. */
export function Choice<T extends string>(props: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View role="radiogroup" style={styles.row}>
      {props.options.map((option) => (
        <View key={option.value} style={styles.item}>
          <Button
            label={option.label}
            selected={props.value === option.value}
            onPress={() => props.onChange(option.value)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.screenMargin / 2 },
  item: { flexGrow: 1, minWidth: 96 },
});
