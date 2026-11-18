import {
  buildOptionsBody,
  groupsFromItem,
  type OptionFormGroup,
  optionsChanged,
  poishaToTakaText,
  queryKeys,
  useApi,
  useMutation,
  useQueryClient,
  validateItemForm,
} from '@oregano/app-core';
import type { MenuItem } from '@oregano/contracts';
import { t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import {
  Body,
  Button,
  DocumentPicker,
  Heading,
  LanguageButton,
  Screen,
  TextField,
  useLocale,
} from '@oregano/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorKey } from '../components';

const MAX_GROUPS = 6;

/** Adds or edits one item: name, price, description, photo, and its sizes and add-ons. Owner only. */
export function ItemEditor(props: {
  restaurantId: string;
  categoryId: string;
  item: MenuItem | null;
  onDone: () => void;
}) {
  const { restaurantId, categoryId, item } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(item?.nameEn ?? '');
  const [price, setPrice] = useState(item ? poishaToTakaText(item.price) : '');
  const [description, setDescription] = useState(item?.descriptionEn ?? '');
  const [groups, setGroups] = useState<OptionFormGroup[]>(item ? groupsFromItem(item.optionGroups) : []);
  const [hasPhoto, setHasPhoto] = useState(item?.imageUrl != null);
  const [formError, setFormError] = useState<'item' | 'options' | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.ownerMenu(restaurantId) });

  const save = useMutation({
    mutationFn: async () => {
      const form = validateItemForm({ name, price, description });
      if (!form.ok) {
        setFormError('item');
        return false;
      }
      const options = buildOptionsBody(groups);
      if (!options.ok) {
        setFormError('options');
        return false;
      }
      setFormError(null);
      // If a new item was created but its options failed, saving again updates that item instead of creating a twin.
      const existingId = item?.id ?? createdId;
      let savedId: string;
      if (existingId) {
        await api.updateItem(restaurantId, existingId, form.body);
        savedId = existingId;
      } else {
        savedId = (await api.createItem(restaurantId, categoryId, form.body)).id;
        setCreatedId(savedId);
      }
      // Sending options replaces them all and gives each a new id, which breaks customers' carts: only send a change.
      if (optionsChanged(item?.optionGroups ?? [], groups)) {
        await api.setItemOptions(restaurantId, savedId, options.body);
      }
      return true;
    },
    onSuccess: async (saved) => {
      if (!saved) return;
      await refresh();
      props.onDone();
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archiveItem(restaurantId, (item as MenuItem).id),
    onSuccess: async () => {
      await refresh();
      props.onDone();
    },
  });

  const setGroup = (index: number, next: Partial<OptionFormGroup>) =>
    setGroups((all) => all.map((g, i) => (i === index ? { ...g, ...next } : g)));
  const setOption = (gi: number, oi: number, next: Partial<OptionFormGroup['options'][number]>) =>
    setGroups((all) =>
      all.map((g, i) =>
        i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...next } : o)) } : g,
      ),
    );

  return (
    <Screen scroll>
      <Heading>{item ? item.nameEn : t(locale, 'menu.addItem')}</Heading>
      <LanguageButton />
      <TextField label={t(locale, 'menu.itemName')} value={name} onChangeText={setName} />
      <TextField label={t(locale, 'menu.itemPrice')} value={price} onChangeText={setPrice} keyboardType="number-pad" />
      <TextField label={t(locale, 'menu.itemDescription')} value={description} onChangeText={setDescription} />

      {item ? (
        <View style={styles.stack}>
          <DocumentPicker
            label={t(locale, 'menu.photo')}
            uploaded={hasPhoto}
            onPick={async (file) => {
              await api.uploadItemPhoto(restaurantId, item.id, file);
              setHasPhoto(true);
              await refresh();
            }}
            describeError={(error) => t(locale, errorKey(error))}
          />
          {hasPhoto ? (
            <Button
              label={t(locale, 'menu.removePhoto')}
              variant="secondary"
              onPress={() => {
                void api.removeItemPhoto(restaurantId, item.id).then(() => {
                  setHasPhoto(false);
                  return refresh();
                });
              }}
            />
          ) : null}
        </View>
      ) : null}

      <Heading level={2}>{t(locale, 'menu.optionsTitle')}</Heading>
      <Body muted>{t(locale, 'menu.optionsHint')}</Body>
      {groups.map((group, gi) => (
        // Rows have no id of their own; they are edited in place, so their position is their identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <View key={gi} style={styles.group}>
          <Body strong>{group.kind === 'size' ? t(locale, 'menu.size') : t(locale, 'menu.addons')}</Body>
          <TextField
            label={t(locale, 'menu.groupName')}
            value={group.name}
            onChangeText={(v) => setGroup(gi, { name: v })}
          />
          {group.options.map((option, oi) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: edited in place, see above
            <View key={oi} style={styles.stack}>
              <TextField
                label={t(locale, 'menu.optionName')}
                value={option.name}
                onChangeText={(v) => setOption(gi, oi, { name: v })}
              />
              <TextField
                label={t(locale, 'menu.optionPrice')}
                value={option.price}
                onChangeText={(v) => setOption(gi, oi, { price: v })}
                keyboardType="number-pad"
              />
              <Button
                label={t(locale, 'menu.removeOption')}
                variant="secondary"
                onPress={() => setGroup(gi, { options: group.options.filter((_, j) => j !== oi) })}
              />
            </View>
          ))}
          <Button
            label={t(locale, 'menu.addOption')}
            variant="secondary"
            onPress={() => setGroup(gi, { options: [...group.options, { name: '', price: '' }] })}
          />
          <Button
            label={t(locale, 'menu.removeGroup')}
            variant="secondary"
            onPress={() => setGroups((all) => all.filter((_, i) => i !== gi))}
          />
        </View>
      ))}
      {groups.length < MAX_GROUPS ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Button
              label={t(locale, 'menu.addSize')}
              variant="secondary"
              onPress={() =>
                setGroups((all) => [
                  ...all,
                  { name: t(locale, 'menu.size'), kind: 'size', options: [{ name: '', price: '0' }] },
                ])
              }
            />
          </View>
          <View style={styles.grow}>
            <Button
              label={t(locale, 'menu.addAddons')}
              variant="secondary"
              onPress={() =>
                setGroups((all) => [
                  ...all,
                  { name: t(locale, 'menu.addons'), kind: 'addons', options: [{ name: '', price: '' }] },
                ])
              }
            />
          </View>
        </View>
      ) : null}

      {formError ? (
        <View role="alert">
          <Body strong>{t(locale, formError === 'item' ? 'menu.itemFormError' : 'menu.optionsError')}</Body>
        </View>
      ) : null}
      {save.isError ? (
        <View role="alert">
          <Body strong>{t(locale, errorKey(save.error))}</Body>
        </View>
      ) : null}
      <Button label={t(locale, 'menu.save')} busy={save.isPending} onPress={() => save.mutate()} />
      <Button label={t(locale, 'menu.cancel')} variant="secondary" onPress={props.onDone} />
      {item ? (
        <Button
          label={t(locale, 'menu.archiveItem')}
          variant="secondary"
          busy={archive.isPending}
          onPress={() => archive.mutate()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.screenMargin / 2 },
  group: { gap: layout.screenMargin / 2, paddingVertical: layout.screenMargin / 2 },
  row: { flexDirection: 'row', gap: layout.screenMargin / 2 },
  grow: { flex: 1 },
});
