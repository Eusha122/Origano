import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  API_URL,
  APP_URLS,
  bearer,
  closeApps,
  DOCUMENT_FIXTURE,
  openApp,
  PHONES,
  signInWithApi,
  signInWithForm,
} from '../journey';

// This file runs last on purpose: its order stays in the admin's list, and the other journeys count orders and zones.
test.afterEach(closeApps);

/** Zones cannot be deleted, so the zone this file draws is switched off: riders and customers see only active zones. */
test.afterEach(async ({ request }) => {
  const token = await signInWithApi(request, PHONES.admin);
  const zones = (await (await request.get(`${API_URL}/v1/admin/zones`, { headers: bearer(token) })).json()) as {
    zones: { id: string; slug: string; isActive: boolean }[];
  };
  for (const zone of zones.zones.filter((z) => z.slug === 'rajshahi' && z.isActive)) {
    await request.patch(`${API_URL}/v1/admin/zones/${zone.id}`, { headers: bearer(token), data: { isActive: false } });
  }
});

// This is the first journey to open the restaurant app, so a cold start pays for its first bundle.
test.describe.configure({ timeout: 240_000 });

type PublicItem = {
  id: string;
  nameEn: string;
  price: number;
  originalPrice: number | null;
  isAvailable: boolean;
  imageUrl: string | null;
  optionGroups: { nameEn: string; required: boolean; options: { id: string; nameEn: string; priceDelta: number }[] }[];
};

const DELIVERY = {
  lat: 24.5965,
  lng: 88.2775,
  addressLine: 'Court Road',
  landmark: 'Behind the college gate',
  phone: PHONES.customer,
};

test('an owner runs the menu, a customer orders with options and a discount, and the kitchen sees it', async ({
  browser,
  request,
}) => {
  const publicMenu = async (): Promise<{ id: string; items: PublicItem[] }[]> => {
    const res = await request.get(`${API_URL}/v1/restaurants/burger-lane`);
    expect(res.ok()).toBe(true);
    return ((await res.json()) as { categories: { id: string; items: PublicItem[] }[] }).categories;
  };
  const findItem = async (name: string): Promise<PublicItem | undefined> =>
    (await publicMenu()).flatMap((c) => c.items).find((i) => i.nameEn === name);
  const ownerToken = await signInWithApi(request, PHONES.owner);
  const restaurantId = (
    (await (await request.get(`${API_URL}/v1/me`, { headers: bearer(ownerToken) })).json()) as {
      restaurantIds: string[];
    }
  ).restaurantIds[0] as string;
  const coffee = (await findItem('Cold Coffee')) as PublicItem;

  let orderId: string | null = null;
  const restaurant = await openApp(browser, APP_URLS.restaurant);
  await signInWithForm(restaurant, request, PHONES.owner);
  try {
    // The owner opens the Menu tab and marks Cold Coffee sold out with one tap.
    await restaurant.getByRole('button', { name: 'Menu', exact: true }).click();
    const coffeeRow = restaurant
      .getByText('Cold Coffee', { exact: true })
      .locator('xpath=ancestor::div[.//*[@role="button"]][1]');
    await coffeeRow.getByRole('button', { name: 'Available', exact: true }).click();
    await expect(coffeeRow.getByRole('button', { name: 'Sold out today', exact: true })).toBeVisible();
    await expect.poll(async () => (await findItem('Cold Coffee'))?.isAvailable).toBe(false);

    // The owner adds an item with a required size and an add-on.
    await restaurant.getByRole('button', { name: 'Add item', exact: true }).first().click();
    await restaurant.getByRole('textbox', { name: 'Name', exact: true }).fill('Smash Burger');
    await restaurant.getByRole('textbox', { name: 'Price (Tk)', exact: true }).fill('250');
    await restaurant.getByRole('button', { name: 'Add sizes', exact: true }).click();
    await restaurant.getByRole('textbox', { name: 'Choice', exact: true }).fill('Large');
    await restaurant.getByRole('textbox', { name: 'Extra price (Tk)', exact: true }).fill('30');
    await restaurant.getByRole('button', { name: 'Add add-ons', exact: true }).click();
    await restaurant.getByRole('textbox', { name: 'Choice', exact: true }).nth(1).fill('Cheese');
    await restaurant.getByRole('textbox', { name: 'Extra price (Tk)', exact: true }).nth(1).fill('20');
    await restaurant.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(restaurant.getByText('Smash Burger', { exact: true })).toBeVisible();

    const smash = (await findItem('Smash Burger')) as PublicItem;
    expect(smash.price).toBe(25000);
    expect(smash.optionGroups.map((g) => [g.nameEn, g.required])).toEqual([
      ['Size', true],
      ['Add-ons', false],
    ]);

    // A photo is public content: it comes back as two WebP sizes from the API.
    const photo = await request.put(`${API_URL}/v1/restaurants/${restaurantId}/items/${smash.id}/photo`, {
      headers: bearer(ownerToken),
      multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: readFileSync(DOCUMENT_FIXTURE) } },
    });
    expect(photo.status()).toBe(200);
    const imageUrl = ((await photo.json()) as { imageUrl: string }).imageUrl;
    const served = await request.get(`${API_URL}${imageUrl}`);
    expect(served.headers()['content-type']).toBe('image/webp');

    // A 10% discount on that item, made from the Discounts tab.
    await restaurant.getByRole('button', { name: 'Discounts', exact: true }).click();
    await restaurant.getByRole('textbox', { name: 'Amount', exact: true }).fill('10');
    await restaurant.getByRole('button', { name: 'One item', exact: true }).click();
    await restaurant.getByRole('button', { name: 'Smash Burger', exact: true }).click();
    await restaurant.getByRole('button', { name: 'Create discount', exact: true }).click();
    await expect(restaurant.getByText('10% · Smash Burger', { exact: true })).toBeVisible();
    await expect.poll(async () => (await findItem('Smash Burger'))?.originalPrice).toBe(25000);
    expect((await findItem('Smash Burger'))?.price).toBe(22500);

    // The hours screen loads and saves.
    await restaurant.getByRole('button', { name: 'Hours', exact: true }).click();
    await restaurant.getByRole('button', { name: 'Save hours', exact: true }).click();
    await expect(restaurant.getByText('Opening hours saved.', { exact: true })).toBeVisible();

    // A customer finds the dish by search and orders it with the size, the add-on and a note for the kitchen.
    const found = await request.get(`${API_URL}/v1/search?q=smash`);
    expect(
      ((await found.json()) as { dishes: { item: { nameEn: string } }[] }).dishes.map((d) => d.item.nameEn),
    ).toContain('Smash Burger');
    const customerToken = await signInWithApi(request, PHONES.customer);
    const optionIds = smash.optionGroups.flatMap((g) => g.options).map((o) => o.id);
    const placed = await request.post(`${API_URL}/v1/orders`, {
      headers: { ...bearer(customerToken), 'idempotency-key': 'catalog-journey-0001' },
      data: {
        restaurantId,
        items: [{ menuItemId: smash.id, quantity: 1, optionIds, note: 'Less spicy' }],
        delivery: DELIVERY,
      },
    });
    expect(placed.status()).toBe(201);
    orderId = ((await placed.json()) as { id: string }).id;
    const order = (await placed.json()) as {
      items: { unitPrice: number; discount: number; note: string }[];
      subtotal: number;
    };
    // Tk 250 + Tk 30 + Tk 20 = Tk 300, less 10% = Tk 270.
    expect(order.items[0]).toMatchObject({ unitPrice: 27000, discount: 3000, note: 'Less spicy' });
    expect(order.subtotal).toBe(27000);

    // The kitchen sees the line with its options and the note.
    await restaurant.getByRole('button', { name: 'Orders', exact: true }).click();
    await expect(restaurant.getByText('1 × Smash Burger', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(restaurant.getByText('Large, Cheese', { exact: true })).toBeVisible();
    await expect(restaurant.getByText('Less spicy', { exact: true })).toBeVisible();

    // Sold out stays sold out for customers: Cold Coffee cannot be ordered.
    const refused = await request.post(`${API_URL}/v1/orders`, {
      headers: { ...bearer(customerToken), 'idempotency-key': 'catalog-journey-0002' },
      data: { restaurantId, items: [{ menuItemId: coffee.id, quantity: 1 }], delivery: DELIVERY },
    });
    expect(refused.status()).toBe(422);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('item_unavailable');
  } finally {
    // The other journeys expect one new order and an orderable Cold Coffee: leave nothing of this one behind.
    if (orderId) {
      const token = await signInWithApi(request, PHONES.customer);
      await request.post(`${API_URL}/v1/orders/${orderId}/cancel`, { headers: bearer(token) });
    }
    await request.put(`${API_URL}/v1/restaurants/${restaurantId}/items/${coffee.id}/availability`, {
      headers: bearer(ownerToken),
      data: { isAvailable: true },
    });
  }
});

test('the superadmin draws a zone, and a fee change reaches customers at once', async ({ browser, request }) => {
  const adminToken = await signInWithApi(request, PHONES.admin);
  const listAt = async (lat: number, lng: number) =>
    (await (await request.get(`${API_URL}/v1/restaurants?lat=${lat}&lng=${lng}`)).json()) as {
      zone: { slug: string } | null;
      restaurants: { deliveryFee: number | null }[];
    };

  // A second zone, away from the town: customers inside it are in that zone.
  const created = await request.post(`${API_URL}/v1/admin/zones`, {
    headers: bearer(adminToken),
    data: {
      slug: 'rajshahi',
      nameEn: 'Rajshahi',
      nameBn: 'Rajshahi',
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [88.55, 24.3],
            [88.65, 24.3],
            [88.65, 24.4],
            [88.55, 24.4],
            [88.55, 24.3],
          ],
        ],
      },
      feePerKm: 1200,
      minFee: 2500,
      roadFactor: 1.4,
    },
  });
  expect(created.status()).toBe(201);
  expect((await listAt(24.35, 88.6)).zone?.slug).toBe('rajshahi');
  // An outline that crosses an existing zone is refused.
  const overlapping = await request.post(`${API_URL}/v1/admin/zones`, {
    headers: bearer(adminToken),
    data: {
      slug: 'overlap',
      nameEn: 'Overlap',
      nameBn: 'Overlap',
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [88.3, 24.6],
            [88.4, 24.6],
            [88.4, 24.7],
            [88.3, 24.7],
            [88.3, 24.6],
          ],
        ],
      },
      feePerKm: 1000,
      minFee: 2000,
      roadFactor: 1.3,
    },
  });
  expect(overlapping.status()).toBe(400);

  // The town zone's minimum fee, changed from the admin screen, shows up in the customers' list straight away.
  const admin = await openApp(browser, APP_URLS.admin, PHONES.admin);
  const townZoneId = (
    (await (await request.get(`${API_URL}/v1/admin/zones`, { headers: bearer(adminToken) })).json()) as {
      zones: { id: string; slug: string }[];
    }
  ).zones.find((z) => z.slug === 'chapainawabganj')?.id as string;
  try {
    await admin.getByRole('button', { name: 'Zones', exact: true }).click();
    await expect(admin.getByRole('application', { name: /Zone map/ })).toBeVisible();
    await admin.getByRole('button', { name: 'Chapainawabganj', exact: true }).click();
    await admin.getByRole('textbox', { name: 'Minimum delivery fee (Tk)', exact: true }).fill('30');
    await admin.getByRole('button', { name: 'Save zone', exact: true }).click();
    await expect(admin.getByText('Saved.', { exact: true })).toBeVisible();
    expect((await listAt(24.5965, 88.2775)).restaurants[0]?.deliveryFee).toBe(3000);
  } finally {
    await request.patch(`${API_URL}/v1/admin/zones/${townZoneId}`, {
      headers: bearer(adminToken),
      data: { minFee: 2000 },
    });
  }
  expect((await listAt(24.5965, 88.2775)).restaurants[0]?.deliveryFee).toBe(2000);
});
