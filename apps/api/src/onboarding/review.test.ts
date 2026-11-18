import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApplicationQueueItem, DocumentLink, RestaurantApplicationView } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const here = dirname(fileURLToPath(import.meta.url));
const photo = readFileSync(join(here, '..', 'media', 'fixtures', 'ok.jpg'));

const ONBOARDING = '01711000006';
const SUPPORT = '01711000007';
const ADMIN = '01711000004';
const OWNER = '01811000010';
const RIDER = '01911000010';
/** Inside the demo zone. */
const INSIDE = { lat: 24.5965, lng: 88.2775 };

function multipart(file: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----oregano-test-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('application review', () => {
  let now = new Date();
  const logs: string[] = [];
  const t = withTestApp({
    clock: () => now,
    logStream: { write: (line) => logs.push(line) },
  });

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object, headers = {}) =>
    t.app().inject({ method, url, headers: { ...t.as(token), ...headers }, ...(payload ? { payload } : {}) });
  const upload = (token: string, base: string, kind: string) => {
    const m = multipart(photo);
    return t.app().inject({
      method: 'POST',
      url: `${base}/documents/${kind}`,
      headers: { ...t.as(token), ...m.headers },
      payload: m.payload,
    });
  };

  const restaurantBody = {
    restaurantName: 'Spice Garden',
    cuisine: 'Bangladeshi',
    addressLine: 'Station Road, Chapainawabganj',
    restaurantPhone: '01811000099',
    ownerName: 'Salma Akter',
    payoutMethod: 'bkash',
    payoutAccount: '01811 000 123',
  };
  const RBASE = '/v1/onboarding/restaurant-application';

  /** An owner applies and submits, with or without a trade licence. */
  async function submittedRestaurant(phone = OWNER, withLicence = true): Promise<{ token: string; id: string }> {
    const token = await t.signIn(phone);
    const created = (await call('PUT', RBASE, token, restaurantBody)).json() as RestaurantApplicationView;
    for (const kind of ['owner_nid_front', 'owner_nid_back', ...(withLicence ? ['trade_licence'] : [])]) {
      expect((await upload(token, RBASE, kind)).statusCode).toBe(201);
    }
    const sent = await call('POST', `${RBASE}/submit`, token, { noTradeLicence: !withLicence });
    expect(sent.statusCode).toBe(200);
    return { token, id: created.id };
  }

  async function submittedRider(phone = RIDER, type = 'independent'): Promise<{ token: string; id: string }> {
    const token = await t.signIn(phone);
    const body = {
      type,
      zoneId: t.demo().zoneId,
      name: 'Jamal Hossain',
      vehicleType: 'bicycle',
      vehicleRegistration: null,
      guarantor: { name: 'Kabir Hossain', phone: '01911000555', relation: 'Brother' },
    };
    expect((await call('PUT', '/v1/onboarding/rider', token, body)).statusCode).toBe(200);
    for (const kind of ['nid_front', 'nid_back', 'photo']) await upload(token, '/v1/onboarding/rider', kind);
    expect((await call('POST', '/v1/onboarding/rider/submit', token)).statusCode).toBe(200);
    const id = (await t.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE phone = ${`+88${phone}`}`))[0]?.id;
    return { token, id: id as string };
  }

  const audits = async (action: string): Promise<number> =>
    (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE action = ${action}`))[0]?.n ??
    -1;
  const count = async (table: string): Promise<number> =>
    (await t.db.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table}`)))[0]?.n ?? -1;

  describe('the queue', () => {
    it('lists submitted applications oldest first and hides drafts unless asked', async () => {
      const first = await submittedRestaurant('01811000011');
      await submittedRider('01911000011');
      const draftToken = await t.signIn('01811000012');
      await call('PUT', RBASE, draftToken, restaurantBody);
      expect(first.id).toBeTruthy();

      const admin = await t.signIn(ONBOARDING);
      const queue = (await call('GET', '/v1/admin/applications', admin)).json() as { items: ApplicationQueueItem[] };
      expect(queue.items.map((i) => i.kind)).toEqual(['restaurant', 'rider']);
      expect(queue.items[0]).toMatchObject({ name: 'Spice Garden', status: 'under_review', riderType: null });
      expect(queue.items[1]).toMatchObject({ name: 'Jamal Hossain', riderType: 'independent' });
      expect(JSON.stringify(queue)).not.toMatch(/\+?8801[0-9]{9}/);

      const drafts = (await call('GET', '/v1/admin/applications?status=applied', admin)).json() as {
        items: ApplicationQueueItem[];
      };
      expect(drafts.items).toHaveLength(1);
      const onlyRiders = (await call('GET', '/v1/admin/applications?kind=rider', admin)).json() as {
        items: ApplicationQueueItem[];
      };
      expect(onlyRiders.items.map((i) => i.kind)).toEqual(['rider']);
    });

    it('refuses a support-only member and anyone not on the team', async () => {
      const support = await t.signIn(SUPPORT);
      expect((await call('GET', '/v1/admin/applications', support)).statusCode).toBe(403);
      const plain = await t.signIn(OWNER);
      expect((await call('GET', '/v1/admin/applications', plain)).statusCode).toBe(403);
    });
  });

  describe('document links', () => {
    async function oneDocument(): Promise<string> {
      await submittedRestaurant();
      return (await t.db.execute<{ id: string }>(sql`SELECT id FROM identity_documents LIMIT 1`))[0]?.id as string;
    }
    const link = async (token: string, id: string) => call('POST', `/v1/admin/documents/${id}/link`, token);
    const open = (token: string, link: DocumentLink) =>
      t.app().inject({ method: 'GET', url: link.url, headers: { ...t.as(token), 'x-document-ticket': link.ticket } });

    it('gives an onboarding member a link that serves the picture with locked-down headers', async () => {
      const id = await oneDocument();
      const admin = await t.signIn(ONBOARDING);
      const issued = await link(admin, id);
      expect(issued.statusCode).toBe(200);
      const ticket = issued.json() as DocumentLink;
      expect(ticket.url).toBe(`/v1/admin/documents/${id}/content`);
      expect(new Date(ticket.expiresAt).getTime() - now.getTime()).toBe(300_000);

      const res = await open(admin, ticket);
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.subarray(0, 3).toString('hex')).toBe('ffd8ff');
      expect(res.headers).toMatchObject({
        'content-type': 'image/jpeg',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'content-disposition': 'inline; filename="document.jpg"',
        'cross-origin-resource-policy': 'same-site',
        'referrer-policy': 'no-referrer',
      });
      expect(await audits('document.link_issued')).toBe(1);
      expect(await audits('document.opened')).toBe(1);
    });

    it('refuses another admin, an expired ticket, a missing ticket and a support-only member, and logs none of them as opened', async () => {
      const id = await oneDocument();
      const admin = await t.signIn(ONBOARDING);
      const ticket = (await link(admin, id)).json() as DocumentLink;

      const other = await t.signIn(ADMIN);
      expect((await open(other, ticket)).json()).toMatchObject({ error: { code: 'link_expired' } });
      expect((await open(other, ticket)).statusCode).toBe(403);
      const support = await t.signIn(SUPPORT);
      expect((await open(support, ticket)).statusCode).toBe(403);
      expect((await link(support, id)).statusCode).toBe(403);
      const plain = await t.signIn(OWNER);
      expect((await link(plain, id)).statusCode).toBe(403);
      expect((await t.app().inject({ method: 'GET', url: ticket.url, headers: t.as(admin) })).statusCode).toBe(403);
      expect((await open(admin, { ...ticket, ticket: `${ticket.ticket}x` })).statusCode).toBe(403);

      const before = now;
      now = new Date(now.getTime() + 301_000);
      expect((await open(admin, ticket)).statusCode).toBe(403);
      now = before;
      expect(await audits('document.opened')).toBe(0);
      expect(await audits('document.link_issued')).toBe(1);
    });

    it('answers 410 for a document whose content is gone, and 404 for one that never existed', async () => {
      const id = await oneDocument();
      const admin = await t.signIn(ONBOARDING);
      const ticket = (await link(admin, id)).json() as DocumentLink;
      await t.db.execute(
        sql`UPDATE identity_documents SET status = 'deleted', storage_key = NULL, sealed_key = NULL WHERE id = ${id}`,
      );
      expect((await link(admin, id)).statusCode).toBe(410);
      const res = await open(admin, ticket);
      expect(res.statusCode).toBe(410);
      expect(res.json()).toMatchObject({ error: { code: 'document_deleted' } });
      expect((await link(admin, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
      expect(await audits('document.opened')).toBe(0);
    });

    it('never writes the ticket into a log line', async () => {
      const id = await oneDocument();
      const admin = await t.signIn(ONBOARDING);
      const ticket = (await link(admin, id)).json() as DocumentLink;
      await open(admin, ticket);
      const written = logs.join('\n');
      expect(written).toContain('/content');
      expect(written).not.toContain(ticket.ticket);
      expect(written).not.toContain('ticket=');
    });
  });

  describe('approving a restaurant', () => {
    const approve = (token: string, id: string, body: object = INSIDE) =>
      call('POST', `/v1/admin/applications/restaurant/${id}/approve`, token, body);

    it('creates a closed, approved restaurant and makes the applicant its owner', async () => {
      const { token: owner, id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      const res = await approve(admin, id);
      expect(res.statusCode).toBe(200);
      const view = res.json() as RestaurantApplicationView;
      expect(view.status).toBe('approved');
      expect(view.restaurantId).toBeTruthy();

      const [restaurant] = await t.db.execute<{ status: string; is_open: boolean; slug: string; name_bn: string }>(
        sql`SELECT status, is_open, slug, name_bn FROM restaurants WHERE id = ${view.restaurantId}`,
      );
      expect(restaurant).toEqual({ status: 'approved', is_open: false, slug: 'spice-garden', name_bn: 'Spice Garden' });
      const me = (await call('GET', '/v1/me', owner)).json();
      expect(me.restaurantIds).toContain(view.restaurantId);

      const daysRows = await t.db.execute<{ days: number }>(
        sql`SELECT round(extract(epoch FROM (min(delete_after) - now())) / 86400)::int AS days FROM identity_documents`,
      );
      expect(daysRows[0]?.days).toBe(7);
      const list = (await t.app().inject({ method: 'GET', url: '/v1/restaurants' })).json() as {
        restaurants: { slug: string; isOpen: boolean }[];
      };
      expect(list.restaurants.find((r) => r.slug === 'spice-garden')).toMatchObject({ isOpen: false });
      expect(await audits('application.approved')).toBe(1);
      const outbox = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM outbox WHERE topic = 'user.access_changed'`,
      );
      expect(outbox[0]?.n).toBe(1);
    });

    it('gives a second restaurant with the same name its own slug', async () => {
      const first = await submittedRestaurant('01811000021');
      const second = await submittedRestaurant('01811000022');
      const admin = await t.signIn(ONBOARDING);
      await approve(admin, first.id);
      await approve(admin, second.id);
      const slugs = await t.db.execute<{ slug: string }>(
        sql`SELECT slug FROM restaurants WHERE slug LIKE 'spice-garden%' ORDER BY slug`,
      );
      expect(slugs.map((s) => s.slug)).toEqual(['spice-garden', 'spice-garden-2']);
    });

    it('refuses a point outside the zone and creates nothing', async () => {
      const { id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      const before = await count('restaurants');
      const res = await approve(admin, id, { lat: 23.81, lng: 90.41 });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'outside_zone' } });
      expect(await count('restaurants')).toBe(before);
      const view = (await call('GET', `/v1/admin/applications/restaurant/${id}`, admin)).json();
      expect(view.status).toBe('under_review');
    });

    it('needs the trade licence unless the reviewer waives it, and audits the waiver', async () => {
      const { id } = await submittedRestaurant(OWNER, false);
      const admin = await t.signIn(ONBOARDING);
      const refused = await approve(admin, id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ error: { code: 'application_incomplete' } });
      expect((await approve(admin, id, { ...INSIDE, waiveLicence: true })).statusCode).toBe(200);
      expect(await audits('application.licence_waived')).toBe(1);
    });

    it('approving twice changes nothing the second time', async () => {
      const { id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      const first = (await approve(admin, id)).json();
      const restaurants = await count('restaurants');
      const events = await audits('application.approved');
      const again = await approve(admin, id);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first);
      expect(await count('restaurants')).toBe(restaurants);
      expect(await audits('application.approved')).toBe(events);
    });

    it('cannot reject what is already approved', async () => {
      const { id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      await approve(admin, id);
      const res = await call('POST', `/v1/admin/applications/restaurant/${id}/reject`, admin, {
        reason: 'Changed our minds about this one',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'invalid_transition' } });
    });

    it('needs the permission, and a draft cannot be approved', async () => {
      const { id } = await submittedRestaurant();
      const support = await t.signIn(SUPPORT);
      expect((await approve(support, id)).statusCode).toBe(403);
      const draftToken = await t.signIn('01811000030');
      const draft = (await call('PUT', RBASE, draftToken, restaurantBody)).json() as RestaurantApplicationView;
      const admin = await t.signIn(ONBOARDING);
      expect((await approve(admin, draft.id)).statusCode).toBe(409);
    });
  });

  describe('rejecting', () => {
    it('shows the applicant the reason and lets them fix it and send again', async () => {
      const { token, id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      const reason = 'The ID photo is blurry. Please upload a clearer one.';
      const res = await call('POST', `/v1/admin/applications/restaurant/${id}/reject`, admin, { reason });
      expect(res.statusCode).toBe(200);
      expect((await call('GET', RBASE, token)).json()).toMatchObject({ status: 'rejected', rejectionReason: reason });
      expect(await audits('application.rejected')).toBe(1);
      expect(JSON.stringify(await t.db.execute(sql`SELECT data FROM audit_log`))).not.toContain('blurry');

      // Rejecting again is a repeat, not an error, and writes nothing.
      const again = await call('POST', `/v1/admin/applications/restaurant/${id}/reject`, admin, { reason });
      expect(again.statusCode).toBe(200);
      expect(await audits('application.rejected')).toBe(1);

      expect((await upload(token, RBASE, 'owner_nid_front')).statusCode).toBe(201);
      const sent = await call('POST', `${RBASE}/submit`, token, { noTradeLicence: false });
      expect(sent.json()).toMatchObject({ status: 'under_review', rejectionReason: null });
      // The files they kept are wanted again: they no longer wait for deletion.
      const waiting = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM identity_documents WHERE status = 'stored' AND delete_after IS NOT NULL`,
      );
      expect(waiting[0]?.n).toBe(0);
    });

    it('needs a reason of some length', async () => {
      const { id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      expect(
        (await call('POST', `/v1/admin/applications/restaurant/${id}/reject`, admin, { reason: 'no' })).statusCode,
      ).toBe(400);
    });
  });

  describe('riders', () => {
    it('approving lets the rider go online', async () => {
      const { token, id } = await submittedRider();
      const admin = await t.signIn(ONBOARDING);
      const detail = (await call('GET', `/v1/admin/applications/rider/${id}`, admin)).json();
      expect(detail).toMatchObject({ status: 'under_review', userId: id });
      const res = await call('POST', `/v1/admin/applications/rider/${id}/approve`, admin);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'approved' });
      const me = (await call('GET', '/v1/me', token)).json();
      expect(me.rider).toMatchObject({ status: 'approved' });
      const online = await call('POST', '/v1/rider/online', token, { online: true });
      expect(online.statusCode).toBe(200);
      expect(await audits('application.approved')).toBe(1);
      // A repeat does nothing.
      expect((await call('POST', `/v1/admin/applications/rider/${id}/approve`, admin)).statusCode).toBe(200);
      expect(await audits('application.approved')).toBe(1);
    });

    it('rejecting shows the reason, and a rejected rider cannot be approved without resubmitting', async () => {
      const { token, id } = await submittedRider();
      const admin = await t.signIn(ONBOARDING);
      const reason = 'The guarantor could not be reached.';
      expect((await call('POST', `/v1/admin/applications/rider/${id}/reject`, admin, { reason })).statusCode).toBe(200);
      expect((await call('GET', '/v1/onboarding/rider', token)).json()).toMatchObject({
        status: 'rejected',
        rejectionReason: reason,
      });
      expect((await call('POST', `/v1/admin/applications/rider/${id}/approve`, admin)).statusCode).toBe(409);
    });
  });

  describe('door 1: the team applies for an owner', () => {
    it('creates the application for a new phone, which that owner then sees and can complete', async () => {
      const admin = await t.signIn(ONBOARDING);
      const res = await call('POST', '/v1/admin/restaurant-applications', admin, {
        ...restaurantBody,
        ownerPhone: '01811000040',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: 'applied' });
      const [row] = await t.db.execute<{ created_by_user_id: string | null }>(
        sql`SELECT created_by_user_id FROM restaurant_applications`,
      );
      expect(row?.created_by_user_id).toBeTruthy();

      const owner = await t.signIn('01811000040');
      expect((await call('GET', RBASE, owner)).json()).toMatchObject({ status: 'applied' });
      expect((await upload(owner, RBASE, 'owner_nid_front')).statusCode).toBe(201);
      // The same phone cannot be given a second open application.
      const again = await call('POST', '/v1/admin/restaurant-applications', admin, {
        ...restaurantBody,
        ownerPhone: '01811000040',
      });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ error: { code: 'application_exists' } });
      const support = await t.signIn(SUPPORT);
      expect(
        (
          await call('POST', '/v1/admin/restaurant-applications', support, {
            ...restaurantBody,
            ownerPhone: '01811000041',
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  describe('review safeguards', () => {
    it('refuses a ticket for one document on another document\u2019s address', async () => {
      await submittedRestaurant();
      const ids = (await t.db.execute<{ id: string }>(sql`SELECT id FROM identity_documents ORDER BY id`)).map(
        (r) => r.id,
      );
      const admin = await t.signIn(ONBOARDING);
      const ticket = (await call('POST', `/v1/admin/documents/${ids[0]}/link`, admin)).json() as DocumentLink;
      const res = await t.app().inject({
        method: 'GET',
        url: `/v1/admin/documents/${ids[1]}/content`,
        headers: { ...t.as(admin), 'x-document-ticket': ticket.ticket },
      });
      expect(res.statusCode).toBe(403);
      expect(await audits('document.opened')).toBe(0);
    });

    it('turns away an upload after a decision, and one that was started before it', async () => {
      const { token, id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      await call('POST', `/v1/admin/applications/restaurant/${id}/approve`, admin, INSIDE);
      expect((await upload(token, RBASE, 'owner_nid_front')).statusCode).toBe(404);
      // The race itself: the route's early check passed, then the decision landed before the file was filed.
      const { requireApplicationOpen } = await import('./restaurant-applications');
      await expect(t.db.transaction((tx) => requireApplicationOpen(tx, id))).rejects.toMatchObject({
        code: 'application_not_editable',
      });
      const filed = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM identity_documents WHERE status = 'stored' AND review_outcome IS NULL`,
      );
      expect(filed[0]?.n).toBe(0);
    });

    it('does not let the sweep delete files whose application was resubmitted a moment ago', async () => {
      const { token, id } = await submittedRestaurant();
      const admin = await t.signIn(ONBOARDING);
      await call('POST', `/v1/admin/applications/restaurant/${id}/reject`, admin, {
        reason: 'Please send a clearer photo.',
      });
      await t.db.execute(sql`UPDATE identity_documents SET delete_after = now() - interval '1 minute'`);
      // The sweep has listed them; then the applicant resubmits.
      const { pruneDocuments, deleteDocumentContent } = await import('../media/vault');
      const { createS3Store } = await import('../media/store');
      const deps = { db: t.db, store: createS3Store(t.config.s3), keys: t.config.dataKeys };
      const sent = await call('POST', `${RBASE}/submit`, token, { noTradeLicence: false });
      expect(sent.statusCode).toBe(200);
      const [doc] = await t.db.execute<{ id: string }>(sql`SELECT id FROM identity_documents LIMIT 1`);
      await deleteDocumentContent(deps, doc?.id as string, 'decision_retention', sql`delete_after <= now()`);
      expect(await pruneDocuments(deps, new Date(), async () => false)).toBe(0);
      const left = await t.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM identity_documents WHERE status = 'stored'`,
      );
      expect(left[0]?.n).toBe(3);
    });

    it('does not treat an application waiting on the team as abandoned', async () => {
      const { id } = await submittedRestaurant();
      const { restaurantApplicationAbandoned } = await import('./restaurant-applications');
      const later = new Date(Date.now() + 90 * 86_400_000);
      expect(await restaurantApplicationAbandoned(t.db, id, later)).toBe(false);
    });

    it('does not let a team member approve their own application, or one they filed for themselves', async () => {
      const admin = await t.signIn(ONBOARDING);
      // Door 1 for the reviewer's own number.
      const own = await call('POST', '/v1/admin/restaurant-applications', admin, {
        ...restaurantBody,
        ownerPhone: ONBOARDING,
      });
      expect(own.statusCode).toBe(201);
      const { id } = own.json() as RestaurantApplicationView;
      for (const kind of ['owner_nid_front', 'owner_nid_back', 'trade_licence']) await upload(admin, RBASE, kind);
      await call('POST', `${RBASE}/submit`, admin, { noTradeLicence: false });
      const res = await call('POST', `/v1/admin/applications/restaurant/${id}/approve`, admin, INSIDE);
      expect(res.statusCode).toBe(403);
      // Filed by one reviewer for another person, approved by a different reviewer: fine.
      const other = await t.signIn(ADMIN);
      const sameFiler = await call('POST', '/v1/admin/restaurant-applications', admin, {
        ...restaurantBody,
        ownerPhone: '01811000050',
      });
      const filed = sameFiler.json() as RestaurantApplicationView;
      const owner = await t.signIn('01811000050');
      for (const kind of ['owner_nid_front', 'owner_nid_back', 'trade_licence']) await upload(owner, RBASE, kind);
      await call('POST', `${RBASE}/submit`, owner, { noTradeLicence: false });
      expect(
        (await call('POST', `/v1/admin/applications/restaurant/${filed.id}/approve`, admin, INSIDE)).statusCode,
      ).toBe(403);
      expect(
        (await call('POST', `/v1/admin/applications/restaurant/${filed.id}/approve`, other, INSIDE)).statusCode,
      ).toBe(200);
    });

    it('starts the deletion clock when a rider is approved or rejected', async () => {
      const { id } = await submittedRider();
      const admin = await t.signIn(ONBOARDING);
      await call('POST', `/v1/admin/applications/rider/${id}/approve`, admin);
      const rows = await t.db.execute<{ days: number; outcome: string }>(
        sql`SELECT round(extract(epoch FROM (delete_after - now())) / 86400)::int AS days, review_outcome AS outcome FROM identity_documents`,
      );
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r).toEqual({ days: 7, outcome: 'accepted' });
    });

    it('a rider cannot approve themselves', async () => {
      const { id } = await submittedRider(ONBOARDING);
      const admin = await t.signIn(ONBOARDING);
      expect((await call('POST', `/v1/admin/applications/rider/${id}/approve`, admin)).statusCode).toBe(403);
    });
  });
});
