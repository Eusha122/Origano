import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RestaurantApplicationView } from '@oregano/contracts';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';
import { pruneRestaurantApplicationDetails, restaurantApplicationAbandoned } from './restaurant-applications';

const here = dirname(fileURLToPath(import.meta.url));
const photo = readFileSync(join(here, '..', 'media', 'fixtures', 'ok.jpg'));

const BODY = {
  restaurantName: 'Spice Garden',
  cuisine: 'Bangladeshi',
  addressLine: 'Station Road, Chapainawabganj',
  restaurantPhone: '01811000099',
  ownerName: 'Salma Akter',
  payoutMethod: 'bkash',
  payoutAccount: '01811 000 123',
};
const APPLICANT = '01811000001';
const BASE = '/v1/onboarding/restaurant-application';

function multipart(file: Buffer, filename = 'photo.jpg'): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----oregano-test-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('restaurant applications (applicant side)', () => {
  const t = withTestApp();

  const put = async (token: string, body: object = BODY) =>
    t.app().inject({ method: 'PUT', url: BASE, headers: t.as(token), payload: body });
  const get = async (token: string) => t.app().inject({ method: 'GET', url: BASE, headers: t.as(token) });
  const upload = async (token: string, kind: string, file = photo) => {
    const m = multipart(file);
    return t.app().inject({
      method: 'POST',
      url: `${BASE}/documents/${kind}`,
      headers: { ...t.as(token), ...m.headers },
      payload: m.payload,
    });
  };
  const submit = async (token: string, noTradeLicence = false) =>
    t.app().inject({ method: 'POST', url: `${BASE}/submit`, headers: t.as(token), payload: { noTradeLicence } });

  it('needs a signed-in user', async () => {
    expect((await t.app().inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
  });

  it('creates an application that starts as applied and lists what is missing', async () => {
    const token = await t.signIn(APPLICANT);
    expect((await get(token)).statusCode).toBe(404);
    const created = await put(token);
    expect(created.statusCode).toBe(200);
    const view = (await get(token)).json() as RestaurantApplicationView;
    expect(view.status).toBe('applied');
    expect(view.missing).toEqual(['owner_nid_front', 'owner_nid_back', 'trade_licence']);
    expect(view.details).toMatchObject({ restaurantName: 'Spice Garden', payoutAccountLast4: '0123' });
    expect(view.rejectionReason).toBeNull();
  });

  it('seals the payout number and never returns it', async () => {
    const token = await t.signIn(APPLICANT);
    const response = await put(token);
    const [row] = await t.db.execute<{ payout_account_sealed: string; payout_account_last4: string }>(
      sql`SELECT payout_account_sealed, payout_account_last4 FROM restaurant_applications`,
    );
    expect(row?.payout_account_sealed).not.toContain('000123');
    expect(row?.payout_account_sealed.startsWith('v1.')).toBe(true);
    expect(row?.payout_account_last4).toBe('0123');
    expect(response.body).not.toContain('000123');
    expect((await get(token)).body).not.toMatch(/01811 ?000 ?123/);
  });

  it('rejects bad details with validation_failed', async () => {
    const token = await t.signIn(APPLICANT);
    expect((await put(token, { ...BODY, payoutAccount: 'abc' })).json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
    expect((await put(token, { ...BODY, restaurantPhone: '12345' })).statusCode).toBe(400);
  });

  it('can be edited while applied, and audits its creation', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    await put(token, { ...BODY, restaurantName: 'Spice Garden Two' });
    const view = (await get(token)).json() as RestaurantApplicationView;
    expect(view.details.restaurantName).toBe('Spice Garden Two');
    const audits = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'application.created'`,
    );
    expect(audits[0]?.n).toBe(1);
  });

  it('refuses to submit while documents are missing', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    await upload(token, 'owner_nid_front');
    const response = await submit(token);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'application_incomplete' } });
  });

  it('goes under review once complete, and then cannot be edited', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    for (const kind of ['owner_nid_front', 'owner_nid_back', 'trade_licence']) {
      expect((await upload(token, kind)).statusCode).toBe(201);
    }
    const submitted = await submit(token);
    expect(submitted.statusCode).toBe(200);
    expect((submitted.json() as RestaurantApplicationView).status).toBe('under_review');

    expect((await put(token)).json()).toMatchObject({ error: { code: 'application_not_editable' } });
    expect((await upload(token, 'owner_nid_front')).statusCode).toBe(409);
    // Sending again changes nothing and is not an error.
    const again = await submit(token);
    expect(again.statusCode).toBe(200);
    expect((again.json() as RestaurantApplicationView).status).toBe('under_review');
    const audits = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'application.submitted'`,
    );
    expect(audits[0]?.n).toBe(1);
  });

  it('needs only the two ID photos when there is no trade licence', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    await upload(token, 'owner_nid_front');
    await upload(token, 'owner_nid_back');
    const response = await submit(token, true);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'under_review', noTradeLicence: true });
  });

  it('only accepts the document kinds a restaurant owner has', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    expect((await upload(token, 'nid_front')).json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect((await upload(token, 'nonsense')).statusCode).toBe(400);
  });

  it('refuses an upload before there is an application', async () => {
    const token = await t.signIn(APPLICANT);
    expect((await upload(token, 'owner_nid_front')).statusCode).toBe(404);
  });

  it('turns away a file that is not an image, and one that is too large', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    const fake = await upload(token, 'owner_nid_front', Buffer.from('%PDF-1.4 not an image'));
    expect(fake.statusCode).toBe(400);
    expect(fake.json()).toMatchObject({ error: { code: 'unsupported_document' } });
    const big = await upload(
      token,
      'owner_nid_front',
      Buffer.concat([photo.subarray(0, 4), Buffer.alloc(9 * 1024 * 1024)]),
    );
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: { code: 'document_too_large' } });
  });

  it('keeps every applicant to their own application: there is no route that names an id', async () => {
    const first = await t.signIn(APPLICANT);
    await put(first);
    await upload(first, 'owner_nid_front');
    const second = await t.signIn('01811000002');
    expect((await get(second)).statusCode).toBe(404);
    expect((await upload(second, 'owner_nid_back')).statusCode).toBe(404);
    const id = (await t.db.execute<{ id: string }>(sql`SELECT id FROM restaurant_applications`))[0]?.id;
    for (const url of [`${BASE}/${id}`, `/v1/onboarding/restaurant-applications/${id}`]) {
      expect((await t.app().inject({ method: 'GET', url, headers: t.as(second) })).statusCode).toBe(404);
    }
    // Their own application is separate and untouched.
    await put(second, { ...BODY, restaurantName: 'Other Place' });
    expect(((await get(first)).json() as RestaurantApplicationView).details.restaurantName).toBe('Spice Garden');
  });

  it('lets a rejected applicant fix the details and send again', async () => {
    const token = await t.signIn(APPLICANT);
    await put(token);
    for (const kind of ['owner_nid_front', 'owner_nid_back', 'trade_licence']) await upload(token, kind);
    await submit(token);
    await t.db.execute(
      sql`UPDATE restaurant_applications SET status = 'rejected', rejection_reason = 'Photo is blurry'`,
    );
    const view = (await get(token)).json() as RestaurantApplicationView;
    expect(view).toMatchObject({ status: 'rejected', rejectionReason: 'Photo is blurry' });
    expect((await put(token, { ...BODY, ownerName: 'Salma A. Akter' })).statusCode).toBe(200);
    expect((await upload(token, 'owner_nid_front')).statusCode).toBe(201);
    const resubmitted = await submit(token);
    expect(resubmitted.json()).toMatchObject({ status: 'under_review', rejectionReason: null });
  });
});

describe('restaurant status in the catalog and ordering', () => {
  const t = withTestApp();

  it('hides a suspended restaurant and refuses its orders', async () => {
    const list = async () =>
      ((await t.app().inject({ method: 'GET', url: '/v1/restaurants' })).json() as { restaurants: { slug: string }[] })
        .restaurants;
    expect((await list()).map((r) => r.slug)).toContain('burger-lane');
    await t.db.execute(sql`UPDATE restaurants SET status = 'suspended' WHERE slug = 'burger-lane'`);
    expect((await list()).map((r) => r.slug)).not.toContain('burger-lane');
    expect((await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' })).statusCode).toBe(404);
  });

  it('gives restaurant_closed when a customer orders from a suspended restaurant', async () => {
    const demo = t.demo();
    const token = await t.signIn('01711000001');
    await t.db.execute(sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${demo.restaurantId}`);
    const response = await t.app().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...t.as(token), 'idempotency-key': 'suspended-order-0001' },
      payload: {
        restaurantId: demo.restaurantId,
        items: [{ menuItemId: demo.menuItemIds.coldCoffee, quantity: 1, price: 1 }],
        delivery: { lat: 24.5965, lng: 88.2775, addressLine: 'Court Road', landmark: 'Gate', phone: '01711000001' },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'restaurant_closed' } });
  });
});

describe('abandoned applications', () => {
  const t = withTestApp();

  it('counts an idle, unapproved application as abandoned and clears its payout number', async () => {
    const token = await t.signIn('01811000003');
    await t.app().inject({ method: 'PUT', url: BASE, headers: t.as(token), payload: BODY });
    const id = (await t.db.execute<{ id: string }>(sql`SELECT id FROM restaurant_applications`))[0]?.id as string;
    const now = new Date();
    expect(await restaurantApplicationAbandoned(t.db, id, now)).toBe(false);
    expect(await pruneRestaurantApplicationDetails(t.db, now)).toBe(0);
    const later = new Date(now.getTime() + 31 * 86_400_000);
    expect(await restaurantApplicationAbandoned(t.db, id, later)).toBe(true);
    expect(await pruneRestaurantApplicationDetails(t.db, later)).toBe(1);
    const [row] = await t.db.execute<{ payout_account_sealed: string | null }>(
      sql`SELECT payout_account_sealed FROM restaurant_applications`,
    );
    expect(row?.payout_account_sealed).toBeNull();
    // An approved application keeps its payout details however idle it is.
    await t.db.execute(sql`UPDATE restaurant_applications SET status = 'approved', payout_account_sealed = 'v1.x'`);
    expect(await restaurantApplicationAbandoned(t.db, id, later)).toBe(false);
    expect(await pruneRestaurantApplicationDetails(t.db, later)).toBe(0);
  });
});
