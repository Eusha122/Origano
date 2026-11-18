import { queryKeys, useApi, useMutation, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { colors, layout } from '@oregano/ui';
import { Body, Button, Heading, LanguageButton, Screen, TextField, useLocale } from '@oregano/ui-native';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorState, errorKey } from './components';

/** The owner's page: who works here, and which delivery staff may join the rider app for this restaurant. */
export function StaffScreen(props: { restaurantId: string; header: ReactNode }) {
  const { restaurantId } = props;
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [riderPhone, setRiderPhone] = useState('');

  const staff = useQuery({ queryKey: queryKeys.staff(restaurantId), queryFn: () => api.staff(restaurantId) });
  const invites = useQuery({
    queryKey: queryKeys.riderInvites(restaurantId),
    queryFn: () => api.riderInvites(restaurantId),
  });
  const refreshStaff = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff(restaurantId) });
  const refreshInvites = () => queryClient.invalidateQueries({ queryKey: queryKeys.riderInvites(restaurantId) });

  const add = useMutation({
    mutationFn: () => api.addStaff(restaurantId, phone),
    onSuccess: () => {
      setPhone('');
      return refreshStaff();
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeStaff(restaurantId, userId),
    onSuccess: refreshStaff,
  });
  const invite = useMutation({
    mutationFn: () => api.addRiderInvite(restaurantId, riderPhone),
    onSuccess: () => {
      setRiderPhone('');
      return refreshInvites();
    },
  });
  const withdraw = useMutation({
    mutationFn: (invitePhone: string) => api.removeRiderInvite(restaurantId, invitePhone),
    onSuccess: refreshInvites,
  });

  const members = staff.data ?? [];
  const others = members.filter((m) => m.role !== 'owner');

  return (
    <Screen scroll>
      <Heading>{t(locale, 'staff.title')}</Heading>
      <LanguageButton />
      {props.header}

      {staff.isError ? <ErrorState error={staff.error} onRetry={() => void staff.refetch()} /> : null}
      {members.map((member) => (
        <View key={member.userId} style={styles.row}>
          <View style={styles.grow}>
            <Body large strong>
              {member.name ?? member.phone}
            </Body>
            {member.role === 'owner' ? (
              <Body muted>{t(locale, 'staff.owner')}</Body>
            ) : member.name ? (
              <Body muted>{member.phone}</Body>
            ) : null}
          </View>
          {member.role === 'owner' ? null : (
            <Button
              label={t(locale, 'staff.remove')}
              variant="secondary"
              busy={remove.isPending && remove.variables === member.userId}
              onPress={() => remove.mutate(member.userId)}
            />
          )}
        </View>
      ))}
      {staff.data && others.length === 0 ? (
        <Body large muted>
          {t(locale, 'staff.empty')}
        </Body>
      ) : null}
      {remove.isError ? (
        <View role="alert">
          <Body strong>{t(locale, errorKey(remove.error))}</Body>
        </View>
      ) : null}
      <TextField
        label={t(locale, 'staff.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        error={add.isError ? t(locale, errorKey(add.error)) : null}
      />
      <Button label={t(locale, 'staff.add')} busy={add.isPending} onPress={() => add.mutate()} />

      <Heading level={2}>{t(locale, 'staff.invitesTitle')}</Heading>
      <Body muted>{t(locale, 'staff.riderInviteHint')}</Body>
      {invites.isError ? <ErrorState error={invites.error} onRetry={() => void invites.refetch()} /> : null}
      {invites.data && invites.data.length === 0 ? <Body muted>{t(locale, 'staff.noInvites')}</Body> : null}
      {(invites.data ?? []).map((item) => (
        <View key={item.phone} style={styles.row}>
          <View style={styles.grow}>
            <Body large strong>
              {item.phone}
            </Body>
            {item.riderStatus ? (
              <Body muted>{t(locale, 'staff.riderStatus', { status: item.riderStatus.replace('_', ' ') })}</Body>
            ) : null}
          </View>
          <Button
            label={t(locale, 'staff.withdraw')}
            variant="secondary"
            busy={withdraw.isPending && withdraw.variables === item.phone}
            onPress={() => withdraw.mutate(item.phone)}
          />
        </View>
      ))}
      <TextField
        label={t(locale, 'staff.invitePhone')}
        value={riderPhone}
        onChangeText={setRiderPhone}
        keyboardType="phone-pad"
        error={invite.isError ? t(locale, errorKey(invite.error)) : null}
      />
      <Button label={t(locale, 'staff.invite')} busy={invite.isPending} onPress={() => invite.mutate()} />
      <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: layout.screenMargin / 2,
    padding: layout.screenMargin * 0.75,
    borderRadius: layout.buttonRadius,
    backgroundColor: colors.white,
  },
  grow: { flex: 1, gap: 2 },
});
