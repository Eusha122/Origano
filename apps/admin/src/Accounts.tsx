import { errorMessageKey, useApi, useMutation, useQuery, useQueryClient } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { useState } from 'react';
import { ConfirmButton, reasonProblem } from './Confirm';

type Standing = 'approved' | 'suspended';

/**
 * Suspend (with a reason someone will read later) or reinstate. Both ask for confirmation, and the API records
 * who did it. `onSuspend` and `onReinstate` return the promise of the call.
 */
function StandingActions(props: {
  status: Standing;
  onSuspend: (reason: string) => Promise<unknown>;
  onReinstate: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const suspend = useMutation({ mutationFn: () => props.onSuspend(reason.trim()), onSuccess: () => setReason('') });
  const reinstate = useMutation({ mutationFn: () => props.onReinstate() });
  const failure = suspend.error ?? reinstate.error;
  return (
    <div className="actions">
      {props.status === 'approved' ? (
        <>
          <input
            aria-label={t('en', 'admin.reason')}
            placeholder={t('en', 'admin.reason')}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <ConfirmButton
            label={t('en', 'admin.suspend')}
            secondary
            busy={suspend.isPending}
            disabled={reasonProblem(reason)}
            onConfirm={() => suspend.mutate()}
          />
        </>
      ) : (
        <ConfirmButton
          label={t('en', 'admin.reinstate')}
          busy={reinstate.isPending}
          onConfirm={() => reinstate.mutate()}
        />
      )}
      {failure ? <p role="alert">{t('en', errorMessageKey(failure))}</p> : null}
    </div>
  );
}

function Loading(props: { error: unknown; empty: boolean; loaded: boolean }) {
  if (props.error) return <p role="alert">{t('en', errorMessageKey(props.error))}</p>;
  if (props.loaded && props.empty) return <p className="muted">{t('en', 'admin.noAccounts')}</p>;
  return null;
}

export function Riders() {
  const api = useApi();
  const queryClient = useQueryClient();
  const riders = useQuery({ queryKey: ['admin', 'riders'], queryFn: () => api.adminRiders() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'riders'] });
  return (
    <>
      <h1>Riders</h1>
      <Loading error={riders.error} empty={riders.data?.length === 0} loaded={riders.isSuccess} />
      <table>
        <thead>
          <tr>
            {['Name', 'Type', 'Agency', 'Status', ''].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(riders.data ?? []).map((rider) => (
            <tr key={rider.userId}>
              <td>{rider.name}</td>
              <td>{rider.type.replace('_', ' ')}</td>
              <td>{rider.agencyName ?? '—'}</td>
              <td>{rider.status}</td>
              <td>
                <StandingActions
                  status={rider.status === 'suspended' ? 'suspended' : 'approved'}
                  onSuspend={async (reason) => {
                    await api.suspendRider(rider.userId, reason);
                    await refresh();
                  }}
                  onReinstate={async () => {
                    await api.reinstateRider(rider.userId);
                    await refresh();
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Restaurants() {
  const api = useApi();
  const queryClient = useQueryClient();
  const restaurants = useQuery({ queryKey: ['admin', 'restaurants'], queryFn: () => api.adminRestaurants() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'restaurants'] });
  return (
    <>
      <h1>Restaurants</h1>
      <Loading error={restaurants.error} empty={restaurants.data?.length === 0} loaded={restaurants.isSuccess} />
      <table>
        <thead>
          <tr>
            {['Name', 'Open now', 'Status', ''].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(restaurants.data ?? []).map((restaurant) => (
            <tr key={restaurant.id}>
              <td>{restaurant.name}</td>
              <td>{restaurant.isOpen ? 'Yes' : 'No'}</td>
              <td>{restaurant.status}</td>
              <td>
                <StandingActions
                  status={restaurant.status}
                  onSuspend={async (reason) => {
                    await api.suspendRestaurant(restaurant.id, reason);
                    await refresh();
                  }}
                  onReinstate={async () => {
                    await api.reinstateRestaurant(restaurant.id);
                    await refresh();
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function CopyCode(props: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <code>{props.code}</code>{' '}
      <button
        type="button"
        className="secondary"
        onClick={() => {
          void navigator.clipboard
            .writeText(props.code)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {t('en', 'admin.copyCode')}
      </button>
      {copied ? <span role="status"> {t('en', 'admin.codeCopied')}</span> : null}
    </>
  );
}

export function Agencies() {
  const api = useApi();
  const queryClient = useQueryClient();
  const agencies = useQuery({ queryKey: ['admin', 'agencies'], queryFn: () => api.agencies() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'agencies'] });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const create = useMutation({
    mutationFn: () => api.createAgency({ name, contactPhone: phone }),
    onSuccess: async () => {
      setName('');
      setPhone('');
      await refresh();
    },
  });
  return (
    <>
      <h1>Agencies</h1>
      <form
        className="card form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label>
          {t('en', 'admin.agencyName')}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('en', 'admin.agencyPhone')}
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        {create.isError ? <p role="alert">{t('en', errorMessageKey(create.error))}</p> : null}
        <button type="submit" disabled={create.isPending || name.trim().length < 2}>
          {t('en', 'admin.createAgency')}
        </button>
      </form>
      <Loading error={agencies.error} empty={agencies.data?.length === 0} loaded={agencies.isSuccess} />
      <table>
        <thead>
          <tr>
            {['Name', 'Code', 'Riders', 'Status', ''].map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(agencies.data ?? []).map((agency) => (
            <tr key={agency.id}>
              <td>{agency.name}</td>
              <td>
                <CopyCode code={agency.code} />
              </td>
              <td>{agency.riderCount}</td>
              <td>{agency.status}</td>
              <td>
                <StandingActions
                  status={agency.status}
                  onSuspend={async (reason) => {
                    await api.suspendAgency(agency.id, reason);
                    await refresh();
                  }}
                  onReinstate={async () => {
                    await api.reinstateAgency(agency.id);
                    await refresh();
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
