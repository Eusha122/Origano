import {
  buildDiscountBody,
  type DiscountForm,
  discountStatus,
  queryKeys,
  useApi,
  useMutation,
  useQuery,
  useQueryClient,
} from '@oregano/app-core';
import type { Discount } from '@oregano/contracts';
import { poisha } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Choice, Heading, LanguageButton, Screen, TextField, useLocale } from '@oregano/ui-native';
import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorState, errorKey } from './components';

/** Bangladesh is UTC+6 all year. */
const dhakaDay = (offsetDays: number): string =>
  new Date(Date.now() + 6 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

const STATUS_KEY = {
  live: 'discounts.statusLive',
  paused: 'discounts.statusPaused',
  scheduled: 'discounts.statusScheduled',
  ended: 'discounts.statusEnded',
} as const;

/** The restaurant's own discounts: percent or taka off an item, a category or the whole menu, between two dates. */
export function DiscountsScreen(props: { restaurantId: string; header: ReactNode }) {
  const { restaurantId } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = queryKeys.discounts(restaurantId);
  const list = useQuery({ queryKey: key, queryFn: () => api.discounts(restaurantId) });
  const menu = useQuery({ queryKey: queryKeys.ownerMenu(restaurantId), queryFn: () => api.ownerMenu(restaurantId) });
  const [form, setForm] = useState<DiscountForm>({
    kind: 'percent',
    value: '',
    scope: 'menu',
    menuItemId: null,
    categoryId: null,
    startDate: dhakaDay(0),
    endDate: dhakaDay(7),
  });
  const [invalid, setInvalid] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: async () => {
      const built = buildDiscountBody(form);
      if (!built.ok) {
        setInvalid(true);
        return null;
      }
      setInvalid(false);
      return api.createDiscount(restaurantId, built.body);
    },
    onSuccess: async (made) => {
      if (made) {
        setForm((f) => ({ ...f, value: '' }));
        await refresh();
      }
    },
  });
  const toggle = useMutation({
    mutationFn: (d: Discount) => api.updateDiscount(restaurantId, d.id, { isActive: !d.isActive }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDiscount(restaurantId, id),
    onSuccess: refresh,
  });

  const categories = menu.data?.categories ?? [];
  const items = categories.flatMap((c) => c.items);
  const targetName = (d: Discount): string =>
    d.scope === 'menu'
      ? t(locale, 'discounts.scopeMenu')
      : d.scope === 'item'
        ? (items.find((i) => i.id === d.menuItemId)?.nameEn ?? '')
        : (categories.find((c) => c.id === d.categoryId)?.nameEn ?? '');
  const amount = (d: Discount) => (d.kind === 'percent' ? `${d.value}%` : formatMoney(poisha(d.value)));
  const now = new Date();

  return (
    <Screen scroll>
      <Heading>{t(locale, 'discounts.title')}</Heading>
      <LanguageButton />
      {props.header}
      <Body muted>{t(locale, 'discounts.hint')}</Body>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <Body muted>{t(locale, 'discounts.empty')}</Body> : null}
      {(list.data ?? []).map((d) => {
        const status = discountStatus(d, now);
        const headline = `${amount(d)} · ${targetName(d)}`;
        const detail = `${d.startsAt.slice(0, 10)} → ${d.endsAt.slice(0, 10)} · ${t(locale, STATUS_KEY[status])}`;
        return (
          <View key={d.id} style={styles.card}>
            <Body large strong>
              {headline}
            </Body>
            <Body muted>{detail}</Body>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button
                  label={d.isActive ? t(locale, 'discounts.pause') : t(locale, 'discounts.resume')}
                  variant="secondary"
                  onPress={() => toggle.mutate(d)}
                />
              </View>
              <View style={styles.grow}>
                <Button label={t(locale, 'discounts.delete')} variant="secondary" onPress={() => remove.mutate(d.id)} />
              </View>
            </View>
          </View>
        );
      })}

      <Heading level={2}>{t(locale, 'discounts.add')}</Heading>
      <Choice
        value={form.kind}
        onChange={(kind) => setForm({ ...form, kind })}
        options={[
          { value: 'percent', label: t(locale, 'discounts.percent') },
          { value: 'amount', label: t(locale, 'discounts.amount') },
        ]}
      />
      <TextField
        label={t(locale, 'discounts.value')}
        value={form.value}
        onChangeText={(value) => setForm({ ...form, value })}
        keyboardType="number-pad"
      />
      <Choice
        value={form.scope}
        onChange={(scope) => setForm({ ...form, scope, menuItemId: null, categoryId: null })}
        options={[
          { value: 'menu', label: t(locale, 'discounts.scopeMenu') },
          { value: 'category', label: t(locale, 'discounts.scopeCategory') },
          { value: 'item', label: t(locale, 'discounts.scopeItem') },
        ]}
      />
      {form.scope === 'category' || form.scope === 'item' ? (
        <View style={styles.stack}>
          <Body muted>{t(locale, 'discounts.pickTarget')}</Body>
          {(form.scope === 'category' ? categories : items).map((target) => (
            <Button
              key={target.id}
              label={target.nameEn}
              selected={(form.scope === 'category' ? form.categoryId : form.menuItemId) === target.id}
              onPress={() =>
                setForm(
                  form.scope === 'category' ? { ...form, categoryId: target.id } : { ...form, menuItemId: target.id },
                )
              }
            />
          ))}
        </View>
      ) : null}
      <TextField
        label={t(locale, 'discounts.start')}
        value={form.startDate}
        onChangeText={(startDate) => setForm({ ...form, startDate })}
      />
      <TextField
        label={t(locale, 'discounts.end')}
        value={form.endDate}
        onChangeText={(endDate) => setForm({ ...form, endDate })}
      />
      {invalid ? (
        <View role="alert">
          <Body strong>{t(locale, 'discounts.error')}</Body>
        </View>
      ) : null}
      {[create, toggle, remove].map((m, i) =>
        m.isError ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of three mutations
          <View key={i} role="alert">
            <Body strong>{t(locale, errorKey(m.error))}</Body>
          </View>
        ) : null,
      )}
      <Button label={t(locale, 'discounts.create')} busy={create.isPending} onPress={() => create.mutate()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: layout.screenMargin / 2, paddingVertical: layout.screenMargin / 2 },
  stack: { gap: layout.screenMargin / 2 },
  row: { flexDirection: 'row', gap: layout.screenMargin / 2 },
  grow: { flex: 1 },
});
