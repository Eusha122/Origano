import { moveId, optimisticUpdate, queryKeys, useApi, useMutation, useQuery, useQueryClient } from '@oregano/app-core';
import type { MenuItem, OwnerMenu } from '@oregano/contracts';
import { poisha } from '@oregano/domain';
import { formatMoney, t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import { Body, Button, Heading, LanguageButton, Screen, TextField, useLocale } from '@oregano/ui-native';
import { type ReactNode, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { ErrorState, errorKey } from '../components';
import { apiUrl } from '../config';
import { ItemEditor } from './item-editor';

type Editing = { categoryId: string; item: MenuItem | null };

/**
 * Items by category with an Available switch (any staff: one tap for "sold out today"). The owner also adds and edits
 * categories and items; the API refuses those from anyone else, and the buttons are simply not shown.
 */
export function MenuScreen(props: { restaurantId: string; isOwner: boolean; header: ReactNode }) {
  const { restaurantId, isOwner } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = queryKeys.ownerMenu(restaurantId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const menu = useQuery({ queryKey: key, queryFn: () => api.ownerMenu(restaurantId) });
  const categories = menu.data?.categories ?? [];
  const keep = (next: OwnerMenu) => queryClient.setQueryData(key, next);

  const availability = useMutation({
    mutationFn: (v: { itemId: string; isAvailable: boolean }) =>
      api.setItemAvailability(restaurantId, v.itemId, v.isAvailable),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: key });
      return {
        rollback: optimisticUpdate<OwnerMenu>(queryClient, key, (old) => ({
          categories: old.categories.map((c) => ({
            ...c,
            items: c.items.map((i) => (i.id === v.itemId ? { ...i, isAvailable: v.isAvailable } : i)),
          })),
        })),
      };
    },
    onError: (_e, _v, context) => context?.rollback(),
  });
  const addCategory = useMutation({
    mutationFn: () => api.createCategory(restaurantId, { nameEn: newCategory.trim() }),
    onSuccess: () => {
      setNewCategory('');
      return queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.deleteCategory(restaurantId, id),
    onSuccess: keep,
  });
  const reorderCategories = useMutation({
    mutationFn: (ids: string[]) => api.reorderCategories(restaurantId, ids),
    onSuccess: keep,
  });
  const reorderItems = useMutation({
    mutationFn: (v: { categoryId: string; ids: string[] }) => api.reorderItems(restaurantId, v.categoryId, v.ids),
    onSuccess: keep,
  });

  if (editing) {
    return (
      <ItemEditor
        restaurantId={restaurantId}
        categoryId={editing.categoryId}
        item={editing.item}
        onDone={() => setEditing(null)}
      />
    );
  }

  const categoryIds = categories.map((c) => c.id);
  return (
    <Screen scroll>
      <Heading>{t(locale, 'menu.title')}</Heading>
      <LanguageButton />
      {props.header}
      {!isOwner ? <Body muted>{t(locale, 'menu.ownerOnlyHint')}</Body> : null}
      {menu.isError ? <ErrorState error={menu.error} onRetry={() => void menu.refetch()} /> : null}
      {menu.data && categories.length === 0 ? (
        <Body large muted>
          {t(locale, 'menu.empty')}
        </Body>
      ) : null}

      {categories.map((category) => {
        const itemIds = category.items.map((i) => i.id);
        return (
          <View key={category.id} style={styles.section}>
            <Heading level={2}>{category.nameEn}</Heading>
            {isOwner ? (
              <View style={styles.row}>
                <View style={styles.grow}>
                  <Button
                    label={t(locale, 'menu.moveUp')}
                    variant="secondary"
                    onPress={() => reorderCategories.mutate(moveId(categoryIds, category.id, -1))}
                  />
                </View>
                <View style={styles.grow}>
                  <Button
                    label={t(locale, 'menu.moveDown')}
                    variant="secondary"
                    onPress={() => reorderCategories.mutate(moveId(categoryIds, category.id, 1))}
                  />
                </View>
                {category.items.length === 0 ? (
                  <View style={styles.grow}>
                    <Button
                      label={t(locale, 'menu.deleteCategory')}
                      variant="secondary"
                      onPress={() => deleteCategory.mutate(category.id)}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {category.items.map((item) => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemHead}>
                  {item.imageUrl ? (
                    <Image
                      source={{ uri: `${apiUrl}${item.imageUrl}` }}
                      accessibilityLabel={item.nameEn}
                      style={styles.thumb}
                    />
                  ) : null}
                  <View style={styles.grow}>
                    <Body large strong>
                      {item.nameEn}
                    </Body>
                    <Body muted>{formatMoney(poisha(item.price))}</Body>
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <Button
                      label={item.isAvailable ? t(locale, 'menu.available') : t(locale, 'menu.soldOut')}
                      selected={item.isAvailable}
                      onPress={() => availability.mutate({ itemId: item.id, isAvailable: !item.isAvailable })}
                    />
                  </View>
                  {isOwner ? (
                    <>
                      <View style={styles.grow}>
                        <Button
                          label={t(locale, 'menu.edit')}
                          variant="secondary"
                          onPress={() => setEditing({ categoryId: category.id, item })}
                        />
                      </View>
                      <View style={styles.grow}>
                        <Button
                          label={t(locale, 'menu.moveUp')}
                          variant="secondary"
                          onPress={() =>
                            reorderItems.mutate({ categoryId: category.id, ids: moveId(itemIds, item.id, -1) })
                          }
                        />
                      </View>
                      <View style={styles.grow}>
                        <Button
                          label={t(locale, 'menu.moveDown')}
                          variant="secondary"
                          onPress={() =>
                            reorderItems.mutate({ categoryId: category.id, ids: moveId(itemIds, item.id, 1) })
                          }
                        />
                      </View>
                    </>
                  ) : null}
                </View>
              </View>
            ))}
            {isOwner ? (
              <Button
                label={t(locale, 'menu.addItem')}
                variant="secondary"
                onPress={() => setEditing({ categoryId: category.id, item: null })}
              />
            ) : null}
          </View>
        );
      })}

      {isOwner ? (
        <View style={styles.section}>
          <TextField
            label={t(locale, 'menu.categoryName')}
            value={newCategory}
            onChangeText={setNewCategory}
            error={addCategory.isError ? t(locale, errorKey(addCategory.error)) : null}
          />
          <Button
            label={t(locale, 'menu.addCategory')}
            busy={addCategory.isPending}
            disabled={newCategory.trim() === ''}
            onPress={() => addCategory.mutate()}
          />
        </View>
      ) : null}

      {[availability, deleteCategory, reorderCategories, reorderItems].map((m, i) =>
        m.isError ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of four mutations
          <View key={i} role="alert">
            <Body strong>{t(locale, errorKey(m.error))}</Body>
          </View>
        ) : null,
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.screenMargin / 2, paddingVertical: layout.screenMargin / 2 },
  item: { gap: layout.screenMargin / 2 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: layout.screenMargin / 2 },
  thumb: { width: layout.minTapTarget, height: layout.minTapTarget, borderRadius: layout.buttonRadius },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.screenMargin / 2 },
  grow: { flexGrow: 1, flexBasis: layout.minTapTarget },
});
