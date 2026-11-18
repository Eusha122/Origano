import { errorMessageKey, useApi, useQuery } from '@oregano/app-core';
import type { ApplicationQueueItem } from '@oregano/contracts';
import { ACCOUNT_STATUSES } from '@oregano/domain';
import { t } from '@oregano/i18n';
import { useState } from 'react';
import { ApplicationDetail } from './ApplicationDetail';

type Kind = 'all' | 'restaurant' | 'rider';

const submitted = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The review queue, oldest first, and the detail of whichever application is open. */
export function Applications() {
  const api = useApi();
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState<string>('under_review');
  const [open, setOpen] = useState<ApplicationQueueItem | null>(null);

  const queue = useQuery({
    queryKey: ['admin', 'applications', kind, status],
    queryFn: () => api.adminApplications({ ...(kind === 'all' ? {} : { kind }), status }),
    refetchInterval: 30_000,
  });

  if (open) return <ApplicationDetail item={open} onBack={() => setOpen(null)} />;

  return (
    <>
      <h1>Applications</h1>
      <div className="row filters">
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="all">All</option>
            <option value="restaurant">Restaurants</option>
            <option value="rider">Riders</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {ACCOUNT_STATUSES.filter((s) => s !== 'suspended').map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      {queue.isError ? <p role="alert">{t('en', errorMessageKey(queue.error))}</p> : null}
      {queue.data && queue.data.length === 0 ? <p className="muted">{t('en', 'admin.noApplications')}</p> : null}
      {queue.data && queue.data.length > 0 ? (
        <table>
          <thead>
            <tr>
              {['Name', 'Type', 'Status', 'Submitted', ''].map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queue.data.map((item) => (
              <tr key={`${item.kind}-${item.id}`}>
                <td>{item.name}</td>
                <td>
                  {item.kind === 'restaurant' ? 'Restaurant' : `Rider (${(item.riderType ?? '').replace('_', ' ')})`}
                </td>
                <td>{item.status.replace('_', ' ')}</td>
                <td>{submitted(item.submittedAt)}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => setOpen(item)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
