import { errorMessageKey, useApi, useMutation, useQuery, useQueryClient } from '@oregano/app-core';
import type {
  ApplicationQueueItem,
  DocumentSummary,
  RestaurantApplicationView,
  RiderApplicationDetail,
} from '@oregano/contracts';
import { t } from '@oregano/i18n';
import { useState } from 'react';
import { ConfirmButton, reasonProblem } from './Confirm';
import { DocumentViewer } from './DocumentViewer';

/** Where the dev town centre is; the reviewer moves the pin by typing the real coordinates. */
const TOWN_CENTRE = { lat: '24.5965', lng: '88.2775' };

const DOC_NAMES: Record<string, string> = {
  nid_front: 'ID card, front',
  nid_back: 'ID card, back',
  photo: 'Rider photo',
  trade_licence: 'Trade licence',
  owner_nid_front: 'Owner ID card, front',
  owner_nid_back: 'Owner ID card, back',
};

function Field(props: { label: string; value: string | null | undefined }) {
  return (
    <div className="field">
      <dt>{props.label}</dt>
      <dd>{props.value && props.value !== '' ? props.value : '—'}</dd>
    </div>
  );
}

/** One application: its details, its documents (each opened through an audited link), and the decision. */
export function ApplicationDetail(props: { item: ApplicationQueueItem; onBack: () => void }) {
  const { item } = props;
  const api = useApi();
  const queryClient = useQueryClient();
  const detailKey = ['admin', 'application', item.kind, item.id];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: async (): Promise<{ restaurant?: RestaurantApplicationView; rider?: RiderApplicationDetail }> =>
      item.kind === 'restaurant'
        ? { restaurant: await api.restaurantApplicationDetail(item.id) }
        : { rider: await api.riderApplicationDetail(item.id) },
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const [lat, setLat] = useState(TOWN_CENTRE.lat);
  const [lng, setLng] = useState(TOWN_CENTRE.lng);
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState('');

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: detailKey }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] }),
    ]);
  const approve = useMutation({
    mutationFn: (): Promise<unknown> =>
      item.kind === 'restaurant'
        ? api.approveRestaurantApplication(item.id, { lat: Number(lat), lng: Number(lng), waiveLicence: waive })
        : api.approveRiderApplication(item.id),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: (): Promise<unknown> =>
      item.kind === 'restaurant'
        ? api.rejectRestaurantApplication(item.id, reason.trim())
        : api.rejectRiderApplication(item.id, reason.trim()),
    onSuccess: refresh,
  });

  const restaurant = detail.data?.restaurant;
  const rider = detail.data?.rider;
  const view = restaurant ?? rider;
  const documents: DocumentSummary[] = view?.documents ?? [];
  const decidable = view?.status === 'under_review';
  const coordinatesOk = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== '' && lng !== '';
  const failure = approve.error ?? reject.error;

  return (
    <>
      <button type="button" className="secondary" onClick={props.onBack}>
        {t('en', 'admin.back')}
      </button>
      <h1>{item.name || 'Application'}</h1>
      {detail.isError ? <p role="alert">{t('en', errorMessageKey(detail.error))}</p> : null}
      {view ? (
        <>
          <p>
            <strong>Status:</strong> {view.status.replace('_', ' ')}
            {view.rejectionReason ? ` — ${view.rejectionReason}` : ''}
          </p>
          <dl className="card details">
            {restaurant ? (
              <>
                <Field label="Restaurant" value={restaurant.details.restaurantName} />
                <Field label="Cuisine" value={restaurant.details.cuisine} />
                <Field label="Address" value={restaurant.details.addressLine} />
                <Field label="Owner" value={restaurant.details.ownerName} />
                <Field
                  label="Payout"
                  value={`${restaurant.details.payoutMethod}, ending ${restaurant.details.payoutAccountLast4}`}
                />
                <Field label="Trade licence" value={restaurant.noTradeLicence ? 'Applicant has none' : 'Provided'} />
              </>
            ) : null}
            {rider ? (
              <>
                <Field label="Name" value={rider.details.name} />
                <Field label="Type" value={rider.type.replace('_', ' ')} />
                <Field label="Agency" value={rider.agencyName} />
                <Field label="Restaurant" value={rider.restaurantName} />
                <Field label="Vehicle" value={rider.details.vehicleType.replace('_', ' ')} />
                <Field label="Registration" value={rider.details.vehicleRegistration} />
                <Field
                  label="Guarantor"
                  value={`${rider.details.guarantor.name}, ${rider.details.guarantor.relation}, ${rider.details.guarantor.phone}`}
                />
              </>
            ) : null}
          </dl>

          <h2>Documents</h2>
          {documents.length === 0 ? <p className="muted">No documents.</p> : null}
          <ul className="documents">
            {documents.map((doc) => (
              <li key={doc.id}>
                <span>{DOC_NAMES[doc.kind] ?? doc.kind}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setViewing(viewing === doc.id ? null : doc.id)}
                >
                  {viewing === doc.id ? t('en', 'admin.closeDocument') : t('en', 'admin.viewDocument')}
                </button>
              </li>
            ))}
          </ul>
          {viewing ? <DocumentViewer key={viewing} documentId={viewing} onClose={() => setViewing(null)} /> : null}
          {view.missing.length > 0 && decidable ? (
            <p role="alert">Missing: {view.missing.map((k) => DOC_NAMES[k] ?? k).join(', ')}</p>
          ) : null}

          {decidable ? (
            <section className="card decision">
              <h2>Decision</h2>
              {restaurant ? (
                <>
                  <div className="row">
                    <label>
                      {t('en', 'admin.latitude')}
                      <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
                    </label>
                    <label>
                      {t('en', 'admin.longitude')}
                      <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
                    </label>
                  </div>
                  {restaurant.noTradeLicence ? (
                    <label className="check">
                      <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
                      {t('en', 'admin.waiveLicence')}
                    </label>
                  ) : null}
                </>
              ) : null}
              <ConfirmButton
                label={t('en', 'admin.approve')}
                busy={approve.isPending}
                disabled={restaurant ? !coordinatesOk : false}
                onConfirm={() => approve.mutate()}
              />
              <label>
                {t('en', 'admin.reason')}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
              </label>
              <p className="muted">{t('en', 'admin.reasonHint')}</p>
              <ConfirmButton
                label={t('en', 'admin.reject')}
                secondary
                busy={reject.isPending}
                disabled={reasonProblem(reason)}
                onConfirm={() => reject.mutate()}
              />
              {failure ? <p role="alert">{t('en', errorMessageKey(failure))}</p> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
