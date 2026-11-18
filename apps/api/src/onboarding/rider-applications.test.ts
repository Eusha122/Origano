import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RiderApplicationView } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';
import { pruneRiderApplicationDetails, riderApplicationAbandoned } from './rider-applications';

const here = dirname(fileURLToPath(import.meta.url));
const photo = readFileSync(join(here, '..', 'media', 'fixtures', 'ok.jpg'));
const RIDER = '01911000001';
const BASE = '/v1/onboarding/rider';

function multipart(file: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----oregano-test-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('rider applications (applicant side)', () => {
  const t = withTestApp();

  const body = (overrides: Record<string, unknown> = {}) => ({
    type: 'independent',
    zoneId: t.demo().zoneId,
    name: 'Jamal Hossain',
    vehicleType: 'motorcycle',
    vehicleRegistration: 'RAJ-METRO-HA-12-3456',
    guarantor: { name: 'Kabir Hossain', phone: '01911000555', relation: 'Brother' },
    ...overrides,
  });
  const put = (token: string, payload: object) =>
    t.app().inject({ method: 'PUT', url: BASE, headers: t.as(token), payload });
  const get = (token: string) => t.app().inject({ method: 'GET', url: BASE, headers: t.as(token) });
  const upload = (token: string, kind: string) => {
    const m = multipart(photo);
    return t.app().inject({
      method: 'POST',
      url: `${BASE}/documents/${kind}`,
      headers: { ...t.as(token), ...m.headers },
      payload: m.payload,
    });
  };
  const submit = (token: string) => t.app().inject({ method: 'POST', url: `${BASE}/submit`, headers: t.as(token) });
  const uploadAll = async (token: string) => {
    for (const kind of ['nid_front', 'nid_back', 'photo']) expect((await upload(token, kind)).statusCode).toBe(201);
  };
  const agency = async (status = 'approved', code = 'ABCD2345') =>
    t.db.execute(
      sql`INSERT INTO agencies (name, contact_phone, code, status) VALUES ('Swift Riders', '+8801911999999', ${code}, ${status})`,
    );

  it('needs a signed-in user', async () => {
    expect((await t.app().inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
  });

  it('lists the active zones without signing in', async () => {
    const res = await t.app().inject({ method: 'GET', url: '/v1/zones' });
    expect(res.statusCode).toBe(200);
    expect(res.json().zones).toEqual([{ id: t.demo().zoneId, name: 'Chapainawabganj' }]);
  });

  it('takes an independent rider from details to under review, and keeps them off the road until approved', async () => {
    const token = await t.signIn(RIDER);
    expect((await get(token)).statusCode).toBe(404);
    const created = await put(token, body());
    expect(created.statusCode).toBe(200);
    const view = (await get(token)).json() as RiderApplicationView;
    expect(view).toMatchObject({ status: 'applied', type: 'independent', missing: ['nid_front', 'nid_back', 'photo'] });
    expect(view.details.guarantor.phone).toBe('+8801911000555');
    const name = await t.db.execute<{ name: string }>(sql`SELECT name FROM users WHERE phone = '+8801911000001'`);
    expect(name[0]?.name).toBe('Jamal Hossain');

    await uploadAll(token);
    const submitted = await submit(token);
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ status: 'under_review' });

    const me = (await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) })).json();
    expect(me.rider).toMatchObject({ status: 'under_review', type: 'independent' });
    expect(me.roles).not.toContain('rider');
    const online = await t.app().inject({
      method: 'POST',
      url: '/v1/rider/online',
      headers: t.as(token),
      payload: { online: true },
    });
    expect(online.statusCode).toBe(403);
  });

  it('needs a registration number for a motorcycle but not a bicycle', async () => {
    const token = await t.signIn(RIDER);
    const bad = await put(token, body({ vehicleRegistration: null }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect((await put(token, body({ vehicleType: 'bicycle', vehicleRegistration: null }))).statusCode).toBe(200);
  });

  it('binds an agency by its code, and refuses a wrong or suspended one', async () => {
    const token = await t.signIn(RIDER);
    await agency();
    await agency('suspended', 'SUSP2345');
    for (const code of ['WRONG234', 'SUSP2345']) {
      const res = await put(token, body({ type: 'agency', agencyCode: code }));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'agency_code_invalid' } });
    }
    const ok = await put(token, body({ type: 'agency', agencyCode: 'abcd2345' }));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ type: 'agency', agencyName: 'Swift Riders' });
    // The code is needed only when it is first given; later edits keep the agency.
    const again = await put(token, body({ type: 'agency', name: 'Jamal H. Hossain' }));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ agencyName: 'Swift Riders' });
  });

  it('lets a restaurant bring its own rider only when the owner invited the phone', async () => {
    const token = await t.signIn(RIDER);
    const missing = await put(token, body({ type: 'restaurant_staff' }));
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({ error: { code: 'rider_invite_missing' } });
    await t.db.execute(
      sql`INSERT INTO rider_invites (restaurant_id, phone, invited_by) VALUES (${t.demo().restaurantId}, '+8801911000001', ${t.demo().ownerId})`,
    );
    const ok = await put(token, body({ type: 'restaurant_staff' }));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ type: 'restaurant_staff', restaurantName: 'Burger Lane' });
  });

  it('refuses a guarantor who has the rider’s own number', async () => {
    const token = await t.signIn(RIDER);
    const res = await put(token, body({ guarantor: { name: 'Same Person', phone: '01911000001', relation: 'Self' } }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('refuses to submit with a document missing', async () => {
    const token = await t.signIn(RIDER);
    await put(token, body());
    await upload(token, 'nid_front');
    const res = await submit(token);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'application_incomplete' } });
  });

  it('only accepts the document kinds a rider has', async () => {
    const token = await t.signIn(RIDER);
    await put(token, body());
    expect((await upload(token, 'trade_licence')).statusCode).toBe(400);
  });

  it('cannot be edited while under review, and a repeat submit is not an error', async () => {
    const token = await t.signIn(RIDER);
    await put(token, body());
    await uploadAll(token);
    await submit(token);
    expect((await put(token, body())).json()).toMatchObject({ error: { code: 'application_not_editable' } });
    expect((await upload(token, 'photo')).statusCode).toBe(409);
    expect((await submit(token)).json()).toMatchObject({ status: 'under_review' });
  });

  it('refuses a change of type once approved, and an approved rider is untouched by a bad request', async () => {
    const token = await t.signIn(RIDER);
    await put(token, body());
    await t.db.execute(sql`UPDATE riders SET status = 'approved'`);
    const res = await put(token, body({ vehicleType: 'bicycle', vehicleRegistration: null }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'application_not_editable' } });
  });

  it('lets a rejected rider fix things and send again', async () => {
    const token = await t.signIn(RIDER);
    await put(token, body());
    await uploadAll(token);
    await submit(token);
    await t.db.execute(sql`UPDATE riders SET status = 'rejected', rejection_reason = 'Photo is blurry'`);
    expect((await get(token)).json()).toMatchObject({ status: 'rejected', rejectionReason: 'Photo is blurry' });
    expect((await put(token, body({ name: 'Jamal H. Hossain' }))).statusCode).toBe(200);
    expect((await upload(token, 'photo')).statusCode).toBe(201);
    expect((await submit(token)).json()).toMatchObject({ status: 'under_review', rejectionReason: null });
  });

  it('does not touch the demo riders: they stay approved and can still go online', async () => {
    const token = await t.signIn('01711000003');
    const res = await t.app().inject({
      method: 'POST',
      url: '/v1/rider/online',
      headers: t.as(token),
      payload: { online: true },
    });
    expect(res.statusCode).toBe(200);
    const me = (await t.app().inject({ method: 'GET', url: '/v1/me', headers: t.as(token) })).json();
    expect(me.rider).toMatchObject({ status: 'approved', type: 'independent' });
  });

  it('clears the guarantor and vehicle of an idle rider after 30 days, and files are then abandoned', async () => {
    const token = await t.signIn(RIDER);
    await put(token, body());
    const user = (await t.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE phone = '+8801911000001'`))[0]
      ?.id as string;
    const now = new Date();
    const later = new Date(now.getTime() + 31 * 86_400_000);
    expect(await riderApplicationAbandoned(t.db, user, now)).toBe(false);
    expect(await pruneRiderApplicationDetails(t.db, now)).toBe(0);
    expect(await riderApplicationAbandoned(t.db, user, later)).toBe(true);
    expect(await pruneRiderApplicationDetails(t.db, later)).toBe(1);
    const [row] = await t.db.execute<{ guarantor_name: string | null; vehicle_registration: string | null }>(
      sql`SELECT guarantor_name, vehicle_registration FROM riders WHERE user_id = ${user}`,
    );
    expect(row).toEqual({ guarantor_name: null, vehicle_registration: null });
    // An approved rider is never abandoned, however idle.
    await t.db.execute(sql`UPDATE riders SET status = 'approved' WHERE user_id = ${user}`);
    expect(await riderApplicationAbandoned(t.db, user, later)).toBe(false);
  });
});
