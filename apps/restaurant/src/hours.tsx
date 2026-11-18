import {
  copyDayToAll,
  type HoursRow,
  hasNextDay,
  queryKeys,
  useApi,
  useMutation,
  useQuery,
  useQueryClient,
  validateHours,
} from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, LanguageButton, Screen, TextField, useLocale } from '@oregano/ui-native';
import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorState, errorKey } from './components';

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Weekly opening hours (up to three spans a day) and the usual preparation time. Owner only. */
export function HoursScreen(props: { restaurantId: string; header: ReactNode }) {
  const { restaurantId } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: queryKeys.hours(restaurantId), queryFn: () => api.openingHours(restaurantId) });
  const controls = useQuery({
    queryKey: queryKeys.controls(restaurantId),
    queryFn: () => api.restaurantControls(restaurantId),
  });
  const [edited, setEdited] = useState<HoursRow[] | null>(null);
  const [prep, setPrep] = useState<string | null>(null);
  const [formError, setFormError] = useState<'hours' | 'prep' | null>(null);
  const [done, setDone] = useState(false);
  const rows = edited ?? saved.data?.intervals ?? [];
  const change = (next: HoursRow[]) => {
    setEdited(next);
    setDone(false);
  };

  const saveHours = useMutation({
    mutationFn: async () => {
      const checked = validateHours(rows);
      if (!checked.ok) {
        setFormError('hours');
        return null;
      }
      setFormError(null);
      return api.setOpeningHours(restaurantId, checked.body);
    },
    onSuccess: async (result) => {
      if (!result) return;
      setEdited(null);
      setDone(true);
      queryClient.setQueryData(queryKeys.hours(restaurantId), result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.controls(restaurantId) });
    },
  });
  const savePrep = useMutation({
    mutationFn: async () => {
      const minutes = Number(prep);
      if (!/^\d{1,3}$/.test((prep ?? '').trim()) || minutes < 5 || minutes > 120) {
        setFormError('prep');
        return null;
      }
      setFormError(null);
      return api.setPrepMinutes(restaurantId, minutes);
    },
    onSuccess: (result) => {
      if (result) queryClient.setQueryData(queryKeys.controls(restaurantId), result);
    },
  });

  return (
    <Screen scroll>
      <Heading>{t(locale, 'hours.title')}</Heading>
      <LanguageButton />
      {props.header}
      <Body muted>{t(locale, 'hours.hint')}</Body>
      {saved.isError ? <ErrorState error={saved.error} onRetry={() => void saved.refetch()} /> : null}

      {DAYS.map((day) => {
        const dayRows = rows.filter((r) => r.day === day);
        return (
          <View key={day} style={styles.day}>
            <Heading level={2}>{t(locale, `day.${day}` as 'day.0')}</Heading>
            {dayRows.map((row) => {
              const index = rows.indexOf(row);
              const update = (next: Partial<HoursRow>) =>
                change(rows.map((r, i) => (i === index ? { ...r, ...next } : r)));
              return (
                <View key={`${row.day}-${index}`} style={styles.stack}>
                  <View style={styles.row}>
                    <View style={styles.grow}>
                      <TextField
                        label={t(locale, 'hours.open')}
                        value={row.open}
                        onChangeText={(v) => update({ open: v })}
                      />
                    </View>
                    <View style={styles.grow}>
                      <TextField
                        label={t(locale, 'hours.close')}
                        value={row.close}
                        onChangeText={(v) => update({ close: v })}
                      />
                    </View>
                  </View>
                  {/\d\d:\d\d/.test(row.open) && /\d\d:\d\d/.test(row.close) && hasNextDay(row) ? (
                    <Body muted>{t(locale, 'hours.nextDay')}</Body>
                  ) : null}
                  <Button
                    label={t(locale, 'hours.remove')}
                    variant="secondary"
                    onPress={() => change(rows.filter((_, i) => i !== index))}
                  />
                </View>
              );
            })}
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button
                  label={t(locale, 'hours.addInterval')}
                  variant="secondary"
                  disabled={dayRows.length >= 3}
                  onPress={() => change([...rows, { day, open: '11:00', close: '22:00' }])}
                />
              </View>
              {dayRows.length > 0 ? (
                <View style={styles.grow}>
                  <Button
                    label={t(locale, 'hours.copyAll')}
                    variant="secondary"
                    onPress={() => change(copyDayToAll(rows, day))}
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}

      {formError === 'hours' ? (
        <View role="alert">
          <Body strong>{t(locale, 'hours.error')}</Body>
        </View>
      ) : null}
      {saveHours.isError ? (
        <View role="alert">
          <Body strong>{t(locale, errorKey(saveHours.error))}</Body>
        </View>
      ) : null}
      {done ? (
        <View role="status">
          <Body strong>{t(locale, 'hours.saved')}</Body>
        </View>
      ) : null}
      <Button label={t(locale, 'hours.save')} busy={saveHours.isPending} onPress={() => saveHours.mutate()} />

      <TextField
        label={t(locale, 'hours.prepLabel')}
        value={prep ?? String(controls.data?.prepMinutes ?? '')}
        onChangeText={setPrep}
        keyboardType="number-pad"
        error={formError === 'prep' ? t(locale, 'hours.prepError') : null}
      />
      <Button label={t(locale, 'hours.savePrep')} busy={savePrep.isPending} onPress={() => savePrep.mutate()} />
      {savePrep.isError ? (
        <View role="alert">
          <Body strong>{t(locale, errorKey(savePrep.error))}</Body>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { gap: layout.screenMargin / 2, paddingVertical: layout.screenMargin / 2 },
  stack: { gap: layout.screenMargin / 2 },
  row: { flexDirection: 'row', gap: layout.screenMargin / 2 },
  grow: { flex: 1 },
});
