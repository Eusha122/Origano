import { type APIRequestContext, expect, type Page } from '@playwright/test';

/** The journey's own ports, never the dev ones, so a dev server left running can never be tested by mistake. */
export const API_URL = 'http://localhost:4100';
export const APP_URLS = {
  customer: 'http://localhost:8191',
  restaurant: 'http://localhost:8192',
  rider: 'http://localhost:8193',
  admin: 'http://localhost:8194',
} as const;

/** A dedicated database: global setup empties it, so its name must end in _test. */
export const E2E_DATABASE_URL = 'postgres://oregano:oregano@localhost:5432/oregano_e2e_test';

/** The demo users from `seedDemo`. */
export const PHONES = {
  customer: '01711000001',
  owner: '01711000002',
  rider: '01711000003',
  admin: '01711000004',
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
