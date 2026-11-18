import { optimisticUpdate, queryKeys, useApi, useMutation, useQuery, useQueryClient } from '@oregano/app-core';
import type { RestaurantControls } from '@oregano/contracts';
import { t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, LanguageButton, Screen, useLocale } from '@oregano/ui-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorState, errorKey } from './components';

const BUSY_CHOICES = [
  { minutes: 0, label: 'today.busyOff' },
  { minutes: 10, label: 'today.busyTen' },
  { minutes: 20, label: 'today.busyTwenty' },
] as const;

/** The two things the kitchen changes during the day: the Open/Closed switch and busy mode. Any staff member may. */
export function TodayScreen(props: { restaurantId: string; header: ReactNode }) {
  const { restaurantId } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = queryKeys.controls(restaurantId);
  const controls = useQuery({
    queryKey: key,
    queryFn: () => api.restaurantControls(restaurantId),
    refetchInterval: 60_000,
  });

  // The change shows at once; if the server refuses it, the old state comes back and the error is shown.
  const setOpen = useMutation({
    mutationFn: (isOpen: boolean) => api.setRestaurantOpen(restaurantId, isOpen),
    onMutate: async (isOpen) => {
      await queryClient.cancelQueries({ queryKey: key });
      return {
        rollback: optimisticUpdate<RestaurantControls>(queryClient, key, (old) => ({
          ...old,
          switchOn: isOpen,
          isOpen: isOpen ? old.isOpen : false,
        })),
      };
    },
    onError: (_error, _isOpen, context) => context?.rollback(),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const setBusy = useMutation({
    mutationFn: (minutes: 0 | 10 | 20) => api.setBusyMode(restaurantId, minutes),
    onMutate: async (minutes) => {
      await queryClient.cancelQueries({ queryKey: key });
      return {
        rollback: optimisticUpdate<RestaurantControls>(queryClient, key, (old) => ({
          ...old,
          busyExtraMinutes: minutes,
        })),
      };
    },
    onError: (_error, _minutes, context) => context?.rollback(),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  const state = controls.data;
  const status = !state
    ? null
    : state.isOpen
      ? t(locale, 'today.openNow')
      : state.switchOn
        ? t(locale, 'today.closedByHours', { time: state.opensAt ?? '' })
        : t(locale, 'today.closedSwitch');

  return (
    <Screen scroll>
      <Heading>{t(locale, 'today.title')}</Heading>
      <LanguageButton />
      {props.header}
      {controls.isError ? <ErrorState error={controls.error} onRetry={() => void controls.refetch()} /> : null}
      {state ? (
        <>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button
                label={t(locale, 'today.switchOpen')}
                selected={state.switchOn}
                onPress={() => setOpen.mutate(true)}
              />
            </View>
            <View style={styles.grow}>
              <Button
                label={t(locale, 'today.switchClosed')}
                selected={!state.switchOn}
                onPress={() => setOpen.mutate(false)}
              />
            </View>
          </View>
          <View role="status">
            <Body large strong>
              {status}
            </Body>
          </View>
          <Heading level={2}>{t(locale, 'today.busyTitle')}</Heading>
          <Body muted>{t(locale, 'today.busyHint')}</Body>
          <View style={styles.row}>
            {BUSY_CHOICES.map((choice) => (
              <View key={choice.minutes} style={styles.grow}>
                <Button
                  label={t(locale, choice.label)}
                  selected={state.busyExtraMinutes === choice.minutes}
                  onPress={() => setBusy.mutate(choice.minutes)}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {setOpen.isError ? (
        <View role="alert">
          <Body strong>{t(locale, errorKey(setOpen.error))}</Body>
        </View>
      ) : null}
      {setBusy.isError ? (
        <View role="alert">
          <Body strong>{t(locale, errorKey(setBusy.error))}</Body>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: layout.screenMargin / 2 },
  grow: { flex: 1 },
});
