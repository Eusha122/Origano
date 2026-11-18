import {
  ApiError,
  addVertex,
  errorMessageKey,
  fromPolygon,
  type LngLat,
  moveVertex,
  poishaToTakaText,
  takaToPoisha,
  toPolygon,
  undoVertex,
  useApi,
  useMutation,
  useQuery,
  useQueryClient,
} from '@oregano/app-core';
import type { AdminZone, ZoneBody } from '@oregano/contracts';
import { t } from '@oregano/i18n';
import { useState } from 'react';
import { ZoneMap } from './ZoneMap';

type Form = {
  slug: string;
  nameEn: string;
  nameBn: string;
  feePerKm: string;
  minFee: string;
  roadFactor: string;
  isActive: boolean;
};

const EMPTY: Form = {
  slug: '',
  nameEn: '',
  nameBn: '',
  feePerKm: '10',
  minFee: '20',
  roadFactor: '1.3',
  isActive: true,
};
const toForm = (z: AdminZone): Form => ({
  slug: z.slug,
  nameEn: z.nameEn,
  nameBn: z.nameBn,
  feePerKm: poishaToTakaText(z.feePerKm),
  minFee: poishaToTakaText(z.minFee),
  roadFactor: String(z.roadFactor),
  isActive: z.isActive,
});

/** Delivery areas: draw the outline on the map and set the fees. Superadmin only. */
export function Zones() {
  const api = useApi();
  const queryClient = useQueryClient();
  const zones = useQuery({ queryKey: ['admin', 'zones'], queryFn: () => api.adminZones() });
  // 'new' while drawing a zone that does not exist yet, otherwise the id of the zone being edited.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [vertices, setVertices] = useState<LngLat[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = (zone: AdminZone | null) => {
    setProblem(null);
    if (zone) {
      setEditing(zone.id);
      setForm(toForm(zone));
      setVertices(fromPolygon(zone.boundary));
    } else {
      setEditing('new');
      setForm(EMPTY);
      setVertices([]);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const boundary = toPolygon(vertices);
      const feePerKm = takaToPoisha(form.feePerKm);
      const minFee = takaToPoisha(form.minFee);
      const roadFactor = Number(form.roadFactor);
      if (!boundary || feePerKm === null || minFee === null || !Number.isFinite(roadFactor)) {
        throw new Error('Click at least 3 corners on the map, and check the fees and road factor.');
      }
      const fields = { nameEn: form.nameEn.trim(), nameBn: form.nameBn.trim(), boundary, feePerKm, minFee, roadFactor };
      if (editing === 'new') return api.createZone({ ...fields, slug: form.slug.trim() } satisfies ZoneBody);
      return api.updateZone(editing as string, { ...fields, isActive: form.isActive });
    },
    onSuccess: async (zone) => {
      setProblem(null);
      setEditing(zone.id);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'zones'] });
    },
    onError: (error) => {
      // The API explains what is wrong with an outline or a fee in plain words; show that.
      setProblem(
        error instanceof ApiError && error.code === 'invalid_zone'
          ? error.message
          : error instanceof ApiError
            ? t('en', errorMessageKey(error))
            : (error as Error).message,
      );
    },
  });

  const field = (key: keyof Omit<Form, 'isActive'>, label: string, disabled = false) => (
    <label>
      {label}
      <input value={form[key]} disabled={disabled} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <>
      <h1>Zones</h1>
      <p className="muted">
        A zone is where Oregano delivers. Click the map to add corners, drag a corner to move it. Zones cannot overlap.
      </p>
      {zones.isError ? <p role="alert">{t('en', errorMessageKey(zones.error))}</p> : null}
      <div className="row">
        {(zones.data ?? []).map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={zone.id === editing ? '' : 'secondary'}
            onClick={() => choose(zone)}
          >
            {zone.nameEn}
            {zone.isActive ? '' : ' (off)'}
          </button>
        ))}
        <button type="button" className={editing === 'new' ? '' : 'secondary'} onClick={() => choose(null)}>
          New zone
        </button>
      </div>

      <ZoneMap
        zones={zones.data ?? []}
        editingId={editing === 'new' ? null : editing}
        vertices={vertices}
        onAdd={(p) => editing && setVertices((v) => addVertex(v, p))}
        onMove={(i, p) => setVertices((v) => moveVertex(v, i, p))}
      />

      {editing ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {field('slug', 'Short name (letters, numbers, dashes)', editing !== 'new')}
          {field('nameEn', 'Name')}
          {field('nameBn', 'Name in Bangla')}
          {field('feePerKm', 'Delivery fee per km (Tk)')}
          {field('minFee', 'Minimum delivery fee (Tk)')}
          {field('roadFactor', 'Road factor (1.0 to 3.0)')}
          {editing !== 'new' ? (
            <label className="check">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Delivering in this zone
            </label>
          ) : null}
          <p className="muted">{vertices.length} corners</p>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setVertices((v) => undoVertex(v))}>
              Undo last corner
            </button>
            <button type="button" className="secondary" onClick={() => setVertices([])}>
              Clear corners
            </button>
            <button type="submit" disabled={save.isPending}>
              Save zone
            </button>
          </div>
          {problem ? <p role="alert">{problem}</p> : null}
          {save.isSuccess ? <p role="status">Saved.</p> : null}
        </form>
      ) : null}
    </>
  );
}
