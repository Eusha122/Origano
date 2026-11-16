import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { API_URL, APP_URLS, adminOrders, bearer, PHONES, signInWithApi, signInWithForm } from '../journey';

/** Live updates must arrive through the realtime hint: the 15-second poll alone would miss this. */
const LIVE = { timeout: 5000 };

const contexts: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

/** One browser context per person, so each keeps its own session, as on separate phones. */
async function openApp(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

/** Customer: puts food in the cart, signs in when checkout asks, fills the address and lands on checkout. */
async function customerToCheckout(
  page: Page,
  request: APIRequestContext,
  items: { add: string; times: number; cart: RegExp },
): Promise<void> {
  await page.getByRole('link', { name: 'Burger Lane' }).click();
  const add = page.getByRole('button', { name: `Add ${items.add}`, exact: true });
  for (let i = 0; i < items.times; i++) await add.click();
  await page.getByRole('button', { name: items.cart }).click();

  // Signing in happens only at checkout, and returns there.
  await signInWithForm(page, request, PHONES.customer);
  await page.getByRole('textbox', { name: 'Address' }).fill('Court Road');
  await page.getByRole('textbox', { name: 'Landmark' }).fill('Behind the college gate');
  await expect(page.getByRole('textbox', { name: 'Phone number' })).toHaveValue('+8801711000001');
}

/** Reads the order number from the tracking screen's "Order #12" heading. */
async function orderNumber(page: Page): Promise<number> {
  const heading = page.getByRole('heading', { name: /^Order #\d+$/ });
  await expect(heading).toHaveCount(1);
  const text = (await heading.textContent()) ?? '';
  return Number(text.replace('Order #', ''));
}

test('an order goes from the customer to the rider and is delivered, live everywhere', async ({ browser, request }) => {
  // Customer places 2 × Beef Cheese Burger: Tk 760 of food plus the Tk 20 town-centre delivery fee.
  const customer = await openApp(browser, APP_URLS.customer);
  await customerToCheckout(customer, request, { add: 'Beef Cheese Burger', times: 2, cart: /^2 items · Tk 760/ });
  await customer.getByRole('button', { name: 'Place order · Tk 780', exact: true }).click();
  await expect(customer.getByText('Order placed. Waiting for the restaurant.', { exact: true })).toBeVisible();
  const number = await orderNumber(customer);

  // Restaurant accepts it with a 20-minute ready time.
  const restaurant = await openApp(browser, APP_URLS.restaurant);
  await signInWithForm(restaurant, request, PHONES.owner);
  await expect(restaurant.getByRole('button', { name: 'New 1', exact: true })).toBeVisible();
  await expect(restaurant.getByRole('heading', { name: `#${number}`, exact: true })).toBeVisible();
  await expect(restaurant.getByText('2 × Beef Cheese Burger', { exact: true })).toBeVisible();
  await restaurant.getByRole('button', { name: 'Ready in 20 min', exact: true }).click();
  await restaurant.getByRole('button', { name: 'Accept order', exact: true }).click();

  await expect(customer.getByText('Preparing your food', { exact: true })).toBeVisible(LIVE);

  // Rider goes online, sees the offer by its landmark, and claims it.
  const rider = await openApp(browser, APP_URLS.rider);
  await signInWithForm(rider, request, PHONES.rider);
  await rider.getByRole('button', { name: 'Go online', exact: true }).click();
  await expect(rider.getByText('Behind the college gate', { exact: true })).toBeVisible();
  await rider.getByRole('button', { name: 'Accept', exact: true }).click();
  const pickedUp = rider.getByRole('button', { name: 'Picked up', exact: true });
  await expect(pickedUp).toBeDisabled();

  // Restaurant marks it ready; the rider's Picked up button wakes up live.
  await restaurant.getByRole('button', { name: /^Preparing \d+$/ }).click();
  await restaurant.getByRole('button', { name: 'Mark as ready', exact: true }).click();
  await expect(customer.getByText('Ready. Your rider is collecting it.', { exact: true })).toBeVisible(LIVE);
  await expect(pickedUp).toBeEnabled(LIVE);

  await pickedUp.click();
  await expect(customer.getByText('On the way', { exact: true })).toBeVisible(LIVE);
  await expect(rider.getByText('Collect Tk 780', { exact: true })).toBeVisible();
  await rider.getByRole('button', { name: 'Delivered', exact: true }).click();

  await expect(customer.getByText('Delivered', { exact: true })).toBeVisible(LIVE);

  // Admin sees the one order, delivered.
  const admin = await openApp(browser, APP_URLS.admin);
  await signInWithForm(admin, request, PHONES.admin);
  const row = admin.getByRole('row', { name: `Order #${number}`, exact: true });
  await expect(row.getByRole('cell', { name: 'Delivered', exact: true })).toBeVisible();
  await expect(admin.getByRole('row', { name: /^Order #\d+$/ })).toHaveCount(1);
});

test('double-tapping Place order creates one order', async ({ browser, request }) => {
  const adminToken = await signInWithApi(request, PHONES.admin);
  const before = await adminOrders(request, adminToken);

  const customer = await openApp(browser, APP_URLS.customer);
  await customerToCheckout(customer, request, { add: 'Cold Coffee', times: 1, cart: /^1 items · Tk 180/ });
  await customer.getByRole('button', { name: 'Place order · Tk 200', exact: true }).dblclick();
  const number = await orderNumber(customer);

  const after = await adminOrders(request, adminToken);
  const added = after.filter((row) => !before.some((old) => old.id === row.id));
  expect(added.map((row) => row.number)).toEqual([number]);
});

test('a retried place-order request returns the same order', async ({ request }) => {
  const adminToken = await signInWithApi(request, PHONES.admin);
  const before = await adminOrders(request, adminToken);

  const token = await signInWithApi(request, PHONES.customer);
  const menu = await request.get(`${API_URL}/v1/restaurants/burger-lane`);
  expect(menu.ok()).toBe(true);
  const restaurant = (await menu.json()) as {
    id: string;
    categories: { items: { id: string; nameEn: string }[] }[];
  };
  const coffee = restaurant.categories.flatMap((c) => c.items).find((item) => item.nameEn === 'Cold Coffee');
  if (!coffee) throw new Error('The demo menu has no Cold Coffee');

  const body = {
    restaurantId: restaurant.id,
    items: [{ menuItemId: coffee.id, quantity: 1 }],
    delivery: {
      lat: 24.5965,
      lng: 88.2775,
      addressLine: 'Court Road',
      landmark: 'Behind the college gate',
      phone: PHONES.customer,
    },
  };
  const headers = { ...bearer(token), 'idempotency-key': randomUUID() };
  const first = await request.post(`${API_URL}/v1/orders`, { data: body, headers });
  const retry = await request.post(`${API_URL}/v1/orders`, { data: body, headers });
  expect(first.status()).toBe(201);
  expect(retry.status()).toBe(first.status());
  const firstOrder = (await first.json()) as { id: string };
  const retriedOrder = (await retry.json()) as { id: string };
  expect(retriedOrder.id).toBe(firstOrder.id);

  const after = await adminOrders(request, adminToken);
  const added = after.filter((row) => !before.some((old) => old.id === row.id));
  expect(added.map((row) => row.id)).toEqual([firstOrder.id]);
});
