import { queryKeys, useApi, useMutation, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import type { RestaurantApplicationView } from '@oregano/contracts';
import { t } from '@oregano/i18n';
import { layout } from '@oregano/ui';
import {
  Body,
  Button,
  Choice,
  DocumentPicker,
  Heading,
  LanguageButton,
  Screen,
  TextField,
  useLocale,
} from '@oregano/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorState, errorKey } from './components';

type DocumentKind = 'owner_nid_front' | 'owner_nid_back' | 'trade_licence';
const DOCUMENTS: ReadonlyArray<{
  kind: DocumentKind;
  label: 'doc.ownerNidFront' | 'doc.ownerNidBack' | 'doc.tradeLicence';
}> = [
  { kind: 'owner_nid_front', label: 'doc.ownerNidFront' },
  { kind: 'owner_nid_back', label: 'doc.ownerNidBack' },
  { kind: 'trade_licence', label: 'doc.tradeLicence' },
];
const PAYOUTS = [
  { value: 'bkash', label: 'payout.bkash' },
  { value: 'nagad', label: 'payout.nagad' },
  { value: 'bank', label: 'payout.bank' },
] as const;
type Payout = (typeof PAYOUTS)[number]['value'];

/**
 * "Partner with Oregano": what a signed-in person without a restaurant sees. It follows their application:
 * nothing yet, a draft to complete, waiting for the team, or turned down with a reason.
 */
export function ApplyScreen() {
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const application = useQuery({
    queryKey: queryKeys.restaurantApplication,
    queryFn: () => api.restaurantApplication(),
  });
  const [started, setStarted] = useState(false);

  const signOut = (
    <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
  );
  const header = (
    <>
      <Heading>{t(locale, 'apply.partnerCta')}</Heading>
      <LanguageButton />
    </>
  );

  if (application.isError) {
    return (
      <Screen scroll>
        {header}
        <ErrorState error={application.error} onRetry={() => void application.refetch()} />
        {signOut}
      </Screen>
    );
  }
  if (application.isPending) return <Screen>{header}</Screen>;

  const view = application.data;
  if (view === null && !started) {
    return (
      <Screen scroll>
        {header}
        <Body large>{t(locale, 'apply.intro')}</Body>
        <Button label={t(locale, 'apply.start')} onPress={() => setStarted(true)} />
        {signOut}
      </Screen>
    );
  }
  if (view?.status === 'under_review') {
    return (
      <Screen scroll>
        {header}
        <Body large>{t(locale, 'apply.underReview')}</Body>
        {signOut}
      </Screen>
    );
  }
  if (view?.status === 'approved') {
    return (
      <Screen scroll>
        {header}
        <Body large>{t(locale, 'apply.approved')}</Body>
        {signOut}
      </Screen>
    );
  }
  return (
    <Screen scroll>
      {header}
      <ApplicationForm view={view} />
      {signOut}
    </Screen>
  );
}

/** The details, the three photos and the Submit button. */
function ApplicationForm(props: { view: RestaurantApplicationView | null }) {
  const { view } = props;
  const { locale } = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(view?.details.restaurantName ?? '');
  const [cuisine, setCuisine] = useState(view?.details.cuisine ?? '');
  const [address, setAddress] = useState(view?.details.addressLine ?? '');
  const [phone, setPhone] = useState(view?.details.restaurantPhone ?? '');
  const [owner, setOwner] = useState(view?.details.ownerName ?? '');
  const [payout, setPayout] = useState<Payout | null>(view?.details.payoutMethod ?? 'bkash');
  const [account, setAccount] = useState('');
  const [noLicence, setNoLicence] = useState(view?.noTradeLicence ?? false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.restaurantApplication });
  const save = useMutation({
    mutationFn: () =>
      api.saveRestaurantApplication({
        restaurantName: name,
        cuisine,
        addressLine: address,
        restaurantPhone: phone.trim() === '' ? null : phone,
        ownerName: owner,
        payoutMethod: payout ?? 'bkash',
        payoutAccount: account,
      }),
    onSuccess: refresh,
  });
  const submit = useMutation({
    mutationFn: () => api.submitRestaurantApplication(noLicence),
    onSuccess: refresh,
  });

  const stored = new Set(view?.documents.map((d) => d.kind));
  const needed = DOCUMENTS.filter((d) => d.kind !== 'trade_licence' || !noLicence);
  const stillMissing = needed.filter((d) => !stored.has(d.kind));
  const rejected = view?.status === 'rejected';

  return (
    <>
      {rejected ? (
        <View role="alert">
          <Body large strong>
            {t(locale, 'apply.rejected', { reason: view?.rejectionReason ?? '' })}
          </Body>
        </View>
      ) : (
        <Body large>{t(locale, 'apply.intro')}</Body>
      )}
      <TextField label={t(locale, 'apply.restaurantName')} value={name} onChangeText={setName} />
      <TextField label={t(locale, 'apply.cuisine')} value={cuisine} onChangeText={setCuisine} />
      <TextField label={t(locale, 'apply.address')} value={address} onChangeText={setAddress} />
      <TextField
        label={t(locale, 'apply.restaurantPhone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <TextField label={t(locale, 'apply.ownerName')} value={owner} onChangeText={setOwner} />
      <Body strong>{t(locale, 'apply.payoutMethod')}</Body>
      <Choice
        options={PAYOUTS.map((p) => ({ value: p.value, label: t(locale, p.label) }))}
        value={payout}
        onChange={setPayout}
      />
      {view ? <Body muted>{t(locale, 'apply.payoutKept', { last4: view.details.payoutAccountLast4 })}</Body> : null}
      <TextField
        label={t(locale, 'apply.payoutAccount')}
        value={account}
        onChangeText={setAccount}
        keyboardType="phone-pad"
        error={save.isError ? t(locale, errorKey(save.error)) : null}
      />
      <Button label={t(locale, 'apply.save')} busy={save.isPending} onPress={() => save.mutate()} />
      {save.isSuccess ? (
        <View role="status">
          <Body muted>{t(locale, 'apply.saved')}</Body>
        </View>
      ) : null}

      {view ? (
        <View style={styles.documents}>
          <Body muted>{t(locale, 'apply.photoHint')}</Body>
          {DOCUMENTS.filter((d) => d.kind !== 'trade_licence' || !noLicence).map((d) => (
            <DocumentPicker
              key={d.kind}
              label={t(locale, d.label)}
              uploaded={stored.has(d.kind)}
              describeError={(error) => t(locale, errorKey(error))}
              onPick={async (file) => {
                await api.uploadRestaurantDocument(d.kind, file);
                await refresh();
              }}
            />
          ))}
          <Body muted>{t(locale, 'apply.noLicenceHint')}</Body>
          <Button label={t(locale, 'apply.noLicence')} selected={noLicence} onPress={() => setNoLicence(!noLicence)} />
          <Button
            label={t(locale, rejected ? 'apply.submitAgain' : 'apply.submit')}
            disabled={stillMissing.length > 0}
            busy={submit.isPending}
            onPress={() => submit.mutate()}
          />
          {submit.isError ? (
            <View role="alert">
              <Body strong>{t(locale, errorKey(submit.error))}</Body>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  documents: { gap: layout.screenMargin },
});
