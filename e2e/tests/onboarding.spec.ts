import { expect, type Page, test } from '@playwright/test';
import { APP_URLS, closeApps, openApp, PHONES, signInWithForm, uploadDocument } from '../journey';

/** A reviewer: the demo admin, signed in the way a real browser is. */
const openAdmin = (browser: Parameters<typeof openApp>[0]) => openApp(browser, APP_URLS.admin, PHONES.admin);

/** The zone's own coordinates: the town centre. */
const TOWN_CENTRE = { lat: '24.5965', lng: '88.2775' };

test.afterEach(closeApps);

async function openQueueItem(admin: Page, name: string): Promise<void> {
  await admin.getByRole('button', { name: 'Applications', exact: true }).click();
  await admin
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
}

/** Asks the confirmation question and answers yes. */
async function confirm(admin: Page, decision: string): Promise<void> {
  await admin.getByRole('button', { name: decision, exact: true }).click();
  await admin.getByRole('button', { name: 'Yes, confirm', exact: true }).click();
}

async function joinAsRider(rider: Page, name: string): Promise<void> {
  await rider.getByRole('button', { name: 'Independent rider', exact: true }).click();
  await rider.getByRole('button', { name: 'Next', exact: true }).click();
  await rider.getByRole('textbox', { name: 'Your name' }).fill(name);
  await rider.getByRole('button', { name: 'Bicycle', exact: true }).click();
  await rider.getByRole('button', { name: 'Next', exact: true }).click();
  await rider.getByRole('textbox', { name: 'Guarantor name' }).fill('Kabir Hossain');
  await rider.getByRole('textbox', { name: 'Guarantor phone number' }).fill('01733000999');
  await rider.getByRole('textbox', { name: 'Relation to you' }).fill('Brother');
  await rider.getByRole('button', { name: 'Next', exact: true }).click();
  for (const label of ['ID card, front', 'ID card, back', 'Your photo']) await uploadDocument(rider, label);
}

test('a restaurant goes from application to approved, and appears closed to customers', async ({
  browser,
  request,
}) => {
  const PHONE = '01722000001';
  const owner = await openApp(browser, APP_URLS.restaurant);
  await signInWithForm(owner, request, PHONE);
  await owner.getByRole('button', { name: 'Start application', exact: true }).click();
  await owner.getByRole('textbox', { name: 'Restaurant name' }).fill('Spice Garden');
  await owner.getByRole('textbox', { name: 'Cuisine' }).fill('Bangladeshi');
  await owner.getByRole('textbox', { name: 'Address' }).fill('Station Road, Chapainawabganj');
  await owner.getByRole('textbox', { name: 'Owner name' }).fill('Salma Akter');
  await owner.getByRole('textbox', { name: 'Payout account number' }).fill('01722 000 123');
  await owner.getByRole('button', { name: 'Save details', exact: true }).click();
  for (const label of ['Owner ID card, front', 'Owner ID card, back', 'Trade licence']) {
    await uploadDocument(owner, label);
  }
  await owner.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(owner.getByText('We are checking your details. This usually takes one to two days.')).toBeVisible();

  // The team opens the application, looks at a document, and approves.
  const admin = await openAdmin(browser);
  await openQueueItem(admin, 'Spice Garden');
  await admin
    .getByRole('listitem')
    .filter({ hasText: 'Owner ID card, front' })
    .getByRole('button', { name: 'View', exact: true })
    .click();
  const picture = admin.getByRole('img', { name: 'Identity document' });
  await expect(picture).toBeVisible();
  expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(await picture.getAttribute('src')).toMatch(/^blob:/);

  await admin.getByLabel('Latitude').fill(TOWN_CENTRE.lat);
  await admin.getByLabel('Longitude').fill(TOWN_CENTRE.lng);
  await confirm(admin, 'Approve');
  await expect(admin.getByText('Status: approved')).toBeVisible();

  // The owner's app moves on by itself, without a reload: the server tells it who they are now.
  // The customer app lists the new restaurant as closed.
  await expect(owner.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  const customer = await openApp(browser, APP_URLS.customer);
  const card = customer.getByRole('link', { name: 'Spice Garden' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Closed now')).toBeVisible();
});

test('a rider goes from application to approved and can go online', async ({ browser, request }) => {
  const PHONE = '01733000001';
  const rider = await openApp(browser, APP_URLS.rider);
  await signInWithForm(rider, request, PHONE);
  await joinAsRider(rider, 'Jamal Hossain');
  await rider.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(rider.getByText('We are checking your details. This usually takes one to two days.')).toBeVisible();

  const admin = await openAdmin(browser);
  await openQueueItem(admin, 'Jamal Hossain');
  await confirm(admin, 'Approve');
  await expect(admin.getByText('Status: approved')).toBeVisible();

  await rider.getByRole('button', { name: 'Go online', exact: true }).click();
  await expect(rider.getByRole('button', { name: 'Go offline', exact: true })).toBeVisible();
});

test('a rejected rider sees the reason, replaces a document, and is in the queue again', async ({
  browser,
  request,
}) => {
  const PHONE = '01733000002';
  const rider = await openApp(browser, APP_URLS.rider);
  await signInWithForm(rider, request, PHONE);
  await joinAsRider(rider, 'Rafiq Mia');
  await rider.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(rider.getByText('We are checking your details.', { exact: false })).toBeVisible();

  const admin = await openAdmin(browser);
  await openQueueItem(admin, 'Rafiq Mia');
  const reason = 'The ID photo is blurry. Please upload a clearer one.';
  await admin.getByLabel('Reason').fill(reason);
  await confirm(admin, 'Reject');
  await expect(admin.getByText('Status: rejected')).toBeVisible();

  await expect(rider.getByText(`We could not approve your application: ${reason}`)).toBeVisible();
  // Replace one document, then send it again.
  await uploadDocument(rider, 'ID card, front');
  await rider.getByRole('button', { name: 'Submit again', exact: true }).click();
  await expect(rider.getByText('We are checking your details.', { exact: false })).toBeVisible();

  await admin.getByRole('button', { name: 'Back to the queue', exact: true }).click();
  await expect(admin.getByRole('row', { name: /Rafiq Mia/ })).toBeVisible();
});
