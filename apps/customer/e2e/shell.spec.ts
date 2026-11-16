import { expect, test } from '@playwright/test';

test('shows the brand promise and switches language', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: "Your town's food, in one place." })).toBeVisible();
  await expect(page.getByText('Tk 280')).toBeVisible();

  await page.getByRole('button', { name: 'বাংলা' }).click();

  await expect(page.getByRole('heading', { name: 'শহরের সব খাবার, এক ঠিকানায়।' })).toBeVisible();
  await expect(page.getByText('৳২৮০')).toBeVisible();

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Tk 280')).toBeVisible();
});

test('language button meets the minimum tap target', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByRole('button', { name: 'বাংলা' }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
});

test('fits a small phone without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
