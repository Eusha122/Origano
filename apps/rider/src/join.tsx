import { queryKeys, useApi, useMutation, useQuery, useQueryClient, useSession } from '@oregano/app-core';
import type { RiderApplicationView } from '@oregano/contracts';
import {
  RIDER_TYPES,
  type RiderType,
  VEHICLE_TYPES,
  type VehicleType,
  vehicleNeedsRegistration,
} from '@oregano/domain';
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

type Step = 'type' | 'zone' | 'details' | 'guarantor' | 'docs';
type RiderDocument = 'nid_front' | 'nid_back' | 'photo';

const TYPE_LABELS = {
  independent: 'join.independent',
  agency: 'join.agency',
  restaurant_staff: 'join.restaurantStaff',
} as const;
const VEHICLE_LABELS = {
  bicycle: 'vehicle.bicycle',
  motorcycle: 'vehicle.motorcycle',
  electric_bike: 'vehicle.electric_bike',
  on_foot: 'vehicle.on_foot',
} as const;
const DOCUMENTS: ReadonlyArray<{ kind: RiderDocument; label: 'doc.nidFront' | 'doc.nidBack' | 'doc.photo' }> = [
  { kind: 'nid_front', label: 'doc.nidFront' },
  { kind: 'nid_back', label: 'doc.nidBack' },
  { kind: 'photo', label: 'doc.photo' },
];

/**
 * "Ride with Oregano": the joining flow, one question per screen. Details are saved together at the end of the
 * guarantor step (the server wants the whole set), and each photo is saved the moment it is chosen.
 */
export function JoinScreen(props: { view: RiderApplicationView | null }) {
  const { view } = props;
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const queryClient = useQueryClient();

  const zones = useQuery({ queryKey: queryKeys.zones, queryFn: () => api.zones() });
  const [step, setStep] = useState<Step>(view ? 'docs' : 'type');
  const [type, setType] = useState<RiderType | null>(view?.type ?? null);
  const [agencyCode, setAgencyCode] = useState('');
  const [chosenZone, setChosenZone] = useState<string | null>(view?.zoneId ?? null);
  const [name, setName] = useState(view?.details.name ?? '');
  const [vehicle, setVehicle] = useState<VehicleType | null>(view?.details.vehicleType ?? null);
  const [registration, setRegistration] = useState(view?.details.vehicleRegistration ?? '');
  const [guarantorName, setGuarantorName] = useState(view?.details.guarantor.name ?? '');
  const [guarantorPhone, setGuarantorPhone] = useState(view?.details.guarantor.phone ?? '');
  const [relation, setRelation] = useState(view?.details.guarantor.relation ?? '');

  const onlyZone = zones.data?.length === 1 ? (zones.data[0]?.id ?? null) : null;
  const zoneId = chosenZone ?? onlyZone;
  const skipZone = zones.data?.length === 1;
  const steps: Step[] = skipZone
    ? ['type', 'details', 'guarantor', 'docs']
    : ['type', 'zone', 'details', 'guarantor', 'docs'];
  const index = Math.max(steps.indexOf(step), 0);
  const go = (offset: number) => setStep(steps[Math.min(Math.max(index + offset, 0), steps.length - 1)] ?? 'type');

  // The rider's status also lives in me, which decides what the app shows, so both are refreshed.
  const refresh = () => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.riderApplication }),
      queryClient.invalidateQueries({ queryKey: queryKeys.me, exact: true }),
    ]);
  };
  const save = useMutation({
    mutationFn: () => {
      if (!type || !zoneId || !vehicle) throw new Error('The form is not complete');
      return api.saveRiderApplication({
        type,
        zoneId,
        name,
        ...(type === 'agency' && agencyCode.trim() !== '' ? { agencyCode: agencyCode.trim().toUpperCase() } : {}),
        vehicleType: vehicle,
        vehicleRegistration: vehicleNeedsRegistration(vehicle) ? registration : null,
        guarantor: { name: guarantorName, phone: guarantorPhone, relation },
      });
    },
    onSuccess: async () => {
      await refresh();
      setStep('docs');
    },
  });
  const submit = useMutation({ mutationFn: () => api.submitRiderApplication(), onSuccess: refresh });

  const rejected = view?.status === 'rejected';
  const stored = new Set(view?.documents.map((d) => d.kind));
  const needsRegistration = vehicle !== null && vehicleNeedsRegistration(vehicle);
  const canLeaveType =
    type !== null && (type !== 'agency' || agencyCode.trim().length === 8 || view?.type === 'agency');
  const canLeaveDetails =
    name.trim().length >= 2 && vehicle !== null && (!needsRegistration || registration.trim() !== '');
  const canLeaveGuarantor =
    guarantorName.trim().length >= 2 && guarantorPhone.trim() !== '' && relation.trim().length >= 2 && zoneId !== null;

  return (
    <Screen scroll>
      <Heading>{t(locale, 'apply.rideCta')}</Heading>
      <LanguageButton />
      {rejected ? (
        <View role="alert">
          <Body large strong>
            {t(locale, 'rider.rejected', { reason: view?.rejectionReason ?? '' })}
          </Body>
        </View>
      ) : null}
      <Body muted>{t(locale, 'join.step', { n: index + 1, total: steps.length })}</Body>

      {zones.isError && step === 'zone' ? (
        <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />
      ) : null}

      {step === 'type' ? (
        <>
          <Body large>{t(locale, 'join.intro')}</Body>
          <Choice
            options={RIDER_TYPES.map((value) => ({ value, label: t(locale, TYPE_LABELS[value]) }))}
            value={type}
            onChange={setType}
          />
          {type === 'agency' ? (
            <>
              <Body muted>{t(locale, 'join.agencyHint')}</Body>
              <TextField label={t(locale, 'join.agencyCode')} value={agencyCode} onChangeText={setAgencyCode} />
            </>
          ) : null}
          {type === 'restaurant_staff' ? <Body muted>{t(locale, 'join.staffHint')}</Body> : null}
          <Button label={t(locale, 'join.next')} disabled={!canLeaveType} onPress={() => go(1)} />
        </>
      ) : null}

      {step === 'zone' ? (
        <>
          <Body large>{t(locale, 'join.zoneHint')}</Body>
          <Choice
            options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))}
            value={zoneId}
            onChange={setChosenZone}
          />
          <Button label={t(locale, 'join.next')} disabled={zoneId === null} onPress={() => go(1)} />
          <Button label={t(locale, 'join.back')} variant="secondary" onPress={() => go(-1)} />
        </>
      ) : null}

      {step === 'details' ? (
        <>
          <TextField label={t(locale, 'join.name')} value={name} onChangeText={setName} />
          <Body strong>{t(locale, 'join.vehicle')}</Body>
          <Choice
            options={VEHICLE_TYPES.map((value) => ({ value, label: t(locale, VEHICLE_LABELS[value]) }))}
            value={vehicle}
            onChange={setVehicle}
          />
          {needsRegistration ? (
            <TextField label={t(locale, 'join.registration')} value={registration} onChangeText={setRegistration} />
          ) : null}
          <Button label={t(locale, 'join.next')} disabled={!canLeaveDetails} onPress={() => go(1)} />
          <Button label={t(locale, 'join.back')} variant="secondary" onPress={() => go(-1)} />
        </>
      ) : null}

      {step === 'guarantor' ? (
        <>
          <Body muted>{t(locale, 'join.guarantorHint')}</Body>
          <TextField label={t(locale, 'join.guarantorName')} value={guarantorName} onChangeText={setGuarantorName} />
          <TextField
            label={t(locale, 'join.guarantorPhone')}
            value={guarantorPhone}
            onChangeText={setGuarantorPhone}
            keyboardType="phone-pad"
          />
          <TextField label={t(locale, 'join.guarantorRelation')} value={relation} onChangeText={setRelation} />
          {save.isError ? (
            <View role="alert">
              <Body strong>{t(locale, errorKey(save.error))}</Body>
            </View>
          ) : null}
          <Button
            label={t(locale, 'join.next')}
            disabled={!canLeaveGuarantor}
            busy={save.isPending}
            onPress={() => save.mutate()}
          />
          <Button label={t(locale, 'join.back')} variant="secondary" onPress={() => go(-1)} />
        </>
      ) : null}

      {step === 'docs' ? (
        <View style={styles.stack}>
          <Body muted>{t(locale, 'apply.photoHint')}</Body>
          {DOCUMENTS.map((d) => (
            <View key={d.kind} style={styles.stack}>
              {d.kind === 'photo' ? <Body muted>{t(locale, 'join.selfieHint')}</Body> : null}
              <DocumentPicker
                label={t(locale, d.label)}
                uploaded={stored.has(d.kind)}
                describeError={(error) => t(locale, errorKey(error))}
                onPick={async (file) => {
                  await api.uploadRiderDocument(d.kind, file);
                  await refresh();
                }}
              />
            </View>
          ))}
          <Button
            label={t(locale, rejected ? 'join.submitAgain' : 'join.submit')}
            disabled={DOCUMENTS.some((d) => !stored.has(d.kind))}
            busy={submit.isPending}
            onPress={() => submit.mutate()}
          />
          {submit.isError ? (
            <View role="alert">
              <Body strong>{t(locale, errorKey(submit.error))}</Body>
            </View>
          ) : null}
          <Button label={t(locale, 'join.editDetails')} variant="secondary" onPress={() => setStep('type')} />
        </View>
      ) : null}

      <Button label={t(locale, 'auth.signOut')} variant="secondary" onPress={() => void session.signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.screenMargin },
});
