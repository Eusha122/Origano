import { type APIRequestContext, type Browser, type BrowserContext, expect, type Page } from '@playwright/test';

/** The journey's own ports, never the dev ones, so a dev server left running can never be tested by mistake. */
export const API_URL = 'http://localhost:4100';
export const APP_URLS = {
  customer: 'http://localhost:8191',
  restaurant: 'http://localhost:8192',
  rider: 'http://localhost:8193',
  admin: 'http://localhost:8194',
} as const;

/** A dedicated database: global setup empties it, so its name must end in _test. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://oregano:oregano@localhost:5432/oregano_e2e_test';

/** Redis for the e2e servers; override with E2E_REDIS_URL when the services are not on localhost. */
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379';

/** The demo users from `seedDemo`. */
export const PHONES = {
  customer: '01711000001',
  owner: '01711000002',
  rider: '01711000003',
  admin: '01711000004',
  secondRider: '01711000005',
} as const;

/** The code the API "sent" to a phone, read from the development-only peek route. */
export async function otpCode(request: APIRequestContext, phone: string): Promise<string> {
  const response = await request.get(`${API_URL}/v1/dev/otp/${encodeURIComponent(phone)}`);
  expect(response.ok(), `no code was sent to ${phone}`).toBe(true);
  const body = (await response.json()) as { code: string };
  return body.code;
}

/** Signs in through an app's phone and code form (the same names in every app). */
export async function signInWithForm(page: Page, request: APIRequestContext, phone: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Phone number' }).fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  const codeField = page.getByRole('textbox', { name: '6-digit code' });
  await expect(codeField).toBeVisible();
  await codeField.fill(await otpCode(request, phone));
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in through the API and returns the session token. */
export async function signInWithApi(request: APIRequestContext, phone: string): Promise<string> {
  const requested = await request.post(`${API_URL}/v1/auth/otp/request`, { data: { phone } });
  expect(requested.ok()).toBe(true);
  const verified = await request.post(`${API_URL}/v1/auth/otp/verify`, {
    data: { phone, code: await otpCode(request, phone) },
  });
  expect(verified.ok()).toBe(true);
  return ((await verified.json()) as { token: string }).token;
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

type AdminRow = { id: string; number: number; status: string };

/** Every order the admin list shows (the last 24 hours). */
export async function adminOrders(request: APIRequestContext, token: string): Promise<AdminRow[]> {
  const response = await request.get(`${API_URL}/v1/admin/orders`, { headers: bearer(token) });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { orders: AdminRow[] }).orders;
}

/** Customer: puts food in the cart, signs in when checkout asks, fills the address and lands on checkout. */
export async function customerToCheckout(
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
export async function orderNumber(page: Page): Promise<number> {
  const heading = page.getByRole('heading', { name: /^Order #\d+$/ });
  await expect(heading).toHaveCount(1);
  const text = (await heading.textContent()) ?? '';
  return Number(text.replace('Order #', ''));
}

const contexts: BrowserContext[] = [];

/** One browser context per person, so each keeps its own session, as on separate phones. */
export async function openApp(browser: Browser, url: string, signedInAs?: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  // A session token from signInWithApi, placed where the apps keep it, before any page script runs.
  if (signedInAs) await context.addInitScript((token) => localStorage.setItem('oregano.session', token), signedInAs);
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

/** Closes every context openApp made; call after each test. */
export async function closeApps(): Promise<void> {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
}

/** A place-order body for one Cold Coffee from Burger Lane, delivered to the town centre. */
export async function coldCoffeeOrder(request: APIRequestContext) {
  const menu = await request.get(`${API_URL}/v1/restaurants/burger-lane`);
  expect(menu.ok()).toBe(true);
  const restaurant = (await menu.json()) as {
    id: string;
    categories: { items: { id: string; nameEn: string }[] }[];
  };
  const coffee = restaurant.categories.flatMap((c) => c.items).find((item) => item.nameEn === 'Cold Coffee');
  if (!coffee) throw new Error('The demo menu has no Cold Coffee');
  return {
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
}
