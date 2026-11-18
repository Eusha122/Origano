import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  API_URL,
  APP_URLS,
  bearer,
  closeApps,
  coldCoffeeOrder,
  openApp,
  PHONES,
  signInWithApi,
  signInWithForm,
} from '../journey';

test.afterEach(closeApps);

test('a ready order with no rider yet says it is waiting for one; the rider reads it in a rider voice', async ({
  browser,
  request,
}) => {
  // Placed, accepted and marked ready through the API, before any rider has claimed it.
  const customerToken = await signInWithApi(request, PHONES.customer);
  const placed = await request.post(`${API_URL}/v1/orders`, {
    data: await coldCoffeeOrder(request),
    headers: { ...bearer(customerToken), 'idempotency-key': randomUUID() },
  });
  expect(placed.status()).toBe(201);
  const orderId = ((await placed.json()) as { id: string }).id;
  const owner = bearer(await signInWithApi(request, PHONES.owner));
  const accepted = await request.post(`${API_URL}/v1/restaurant/orders/${orderId}/accept`, {
    data: { readyInMinutes: 20 },
    headers: owner,
  });
  expect(accepted.ok()).toBe(true);
  expect((await request.post(`${API_URL}/v1/restaurant/orders/${orderId}/ready`, { headers: owner })).ok()).toBe(true);

  const customer = await openApp(browser, `${APP_URLS.customer}/orders/${orderId}`, PHONES.customer);
  await expect(customer.getByText('Ready. Waiting for a rider.', { exact: true })).toBeVisible();

  const riderToken = await signInWithApi(request, PHONES.secondRider);
  const riderHeaders = bearer(riderToken);
  expect(
    (await request.post(`${API_URL}/v1/rider/online`, { data: { online: true }, headers: riderHeaders })).ok(),
  ).toBe(true);
  const claimed = await request.post(`${API_URL}/v1/rider/orders/${orderId}/claim`, { headers: riderHeaders });
  expect(claimed.ok()).toBe(true);
  await expect(customer.getByText('Ready. Your rider is collecting it.', { exact: true })).toBeVisible();

  const rider = await openApp(browser, APP_URLS.rider, PHONES.secondRider);
  await expect(rider.getByText('Ready. Collect it from the restaurant.', { exact: true })).toBeVisible();
  await expect(rider.getByText('Ready. Your rider is collecting it.', { exact: true })).toHaveCount(0);
  await rider.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(rider.getByText('তৈরি। রেস্টুরেন্ট থেকে নিয়ে নিন।', { exact: true })).toBeVisible();
});

for (const app of [
  { name: 'restaurant', url: APP_URLS.restaurant, phone: PHONES.owner, title: 'Orders' },
  { name: 'rider', url: APP_URLS.rider, phone: PHONES.rider, title: 'Deliveries' },
] as const) {
  test(`the ${app.name} app switches to Bangla before and after signing in`, async ({ browser, request }) => {
    const page = await openApp(browser, app.url);
    await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
    await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('button', { name: 'বাংলা', exact: true })).toBeVisible();

    await signInWithForm(page, request, app.phone);
    await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
    await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
    // Headings and buttons stay English in Bangla mode.
    await expect(page.getByRole('heading', { name: app.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
  });
}
