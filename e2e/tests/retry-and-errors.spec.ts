import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import {
  API_URL,
  APP_URLS,
  adminOrders,
  closeApps,
  customerToCheckout,
  openApp,
  orderNumber,
  PHONES,
  signInWithApi,
} from '../journey';

test.afterEach(closeApps);

const PLACE = { name: 'Place order · Tk 200', exact: true } as const;

/**
 * Lets the first place-order request reach the API, which takes the order, but drops the answer before the
 * browser sees it, as a slow 3G connection that times out would. Returns the Idempotency-Key of every request.
 */
async function loseFirstAnswer(page: Page): Promise<string[]> {
  const keys: string[] = [];
  await page.route(`${API_URL}/v1/orders`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (keys.length > 1) return route.continue();
    await route.fetch();
    await route.abort('connectionreset');
  });
  return keys;
}

/** The orders this test added, by number, newest first. */
async function ordersSince(request: APIRequestContext, adminToken: string, before: Set<string>): Promise<number[]> {
  return (await adminOrders(request, adminToken)).filter((row) => !before.has(row.id)).map((row) => row.number);
}

test('an answer lost on the way back, then leaving and re-entering checkout, still makes one order', async ({
  browser,
  request,
}) => {
  const adminToken = await signInWithApi(request, PHONES.admin);
  const before = new Set((await adminOrders(request, adminToken)).map((row) => row.id));

  const customer = await openApp(browser, APP_URLS.customer);
  await customerToCheckout(customer, request, { add: 'Cold Coffee', times: 1, cart: /^1 item · Tk 180/ });
  const keys = await loseFirstAnswer(customer);
  await customer.getByRole('button', PLACE).click();
  await expect(customer.getByText("You're offline. Try again.", { exact: true })).toBeVisible();
  await expect.poll(() => ordersSince(request, adminToken, before)).toHaveLength(1);

  // The customer leaves checkout, comes back, fills the same details and taps again.
  await customer.goBack();
  await customer.getByRole('button', { name: /^1 item · Tk 180/ }).click();
  await customer.getByRole('textbox', { name: 'Address' }).fill('Court Road');
  await customer.getByRole('textbox', { name: 'Landmark' }).fill('Behind the college gate');
  await customer.getByRole('button', PLACE).click();

  const number = await orderNumber(customer);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
  expect(await ordersSince(request, adminToken, before)).toEqual([number]);
});

test('changing the address after a lost answer says the order may be placed, and leads to it', async ({
  browser,
  request,
}) => {
  const adminToken = await signInWithApi(request, PHONES.admin);
  const before = new Set((await adminOrders(request, adminToken)).map((row) => row.id));

  const customer = await openApp(browser, APP_URLS.customer);
  await customerToCheckout(customer, request, { add: 'Cold Coffee', times: 1, cart: /^1 item · Tk 180/ });
  await loseFirstAnswer(customer);
  await customer.getByRole('button', PLACE).click();
  await expect(customer.getByText("You're offline. Try again.", { exact: true })).toBeVisible();
  await expect.poll(() => ordersSince(request, adminToken, before)).toHaveLength(1);

  await customer.getByRole('textbox', { name: 'Address' }).fill('Court Road, house 12');
  await customer.getByRole('button', PLACE).click();
  await expect(customer.getByText('This order may already be placed.', { exact: true })).toBeVisible();
  await customer.getByRole('button', { name: 'See your order', exact: true }).click();

  const number = await orderNumber(customer);
  expect(await ordersSince(request, adminToken, before)).toEqual([number]);
});

test('a refused order says why, in words the customer can act on', async ({ browser, request }) => {
  const customer = await openApp(browser, APP_URLS.customer);
  await customerToCheckout(customer, request, { add: 'Cold Coffee', times: 1, cart: /^1 item · Tk 180/ });

  const refusals = [
    ['restaurant_closed', 422, 'This restaurant is closed right now. Try again later.'],
    ['item_not_in_restaurant', 422, 'Something in your cart is no longer on the menu. Remove it and try again.'],
    ['validation_failed', 400, 'Some details are missing or wrong. Check them and try again.'],
  ] as const;
  for (const [code, status, words] of refusals) {
    // The API's refusal, without touching the shared demo data.
    await customer.route(`${API_URL}/v1/orders`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status,
            headers: {
              'access-control-allow-origin': APP_URLS.customer,
              'access-control-expose-headers': 'x-request-id',
            },
            json: { error: { code, message: 'Refused.', requestId: 'e2e-refusal' } },
          })
        : route.continue(),
    );
    await customer.getByRole('button', PLACE).click();
    await expect(customer.getByText(words, { exact: true })).toBeVisible();
    await customer.unroute(`${API_URL}/v1/orders`);
  }
});

test('the cart stops at 20 of one item', async ({ page }) => {
  await page.goto(APP_URLS.customer);
  await page.getByRole('link', { name: 'Burger Lane' }).click();
  const add = page.getByRole('button', { name: 'Add Cold Coffee', exact: true });
  for (let i = 0; i < 20; i++) await add.click();
  await expect(page.getByRole('button', { name: /^20 items · Tk 3,600/ })).toBeVisible();
  await expect(page.getByText('You can order up to 20 of one item', { exact: true })).toBeVisible();
  await add.click({ force: true });
  await expect(page.getByRole('button', { name: /^20 items · Tk 3,600/ })).toBeVisible();
});
