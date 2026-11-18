import { expect, test } from '@playwright/test';

test('shows the brand promise and switches language', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: "Your town's food, in one place." })).toBeVisible();
  // No stray sample price: the home screen shows only real restaurants.
  await expect(page.getByRole('link', { name: 'Burger Lane' })).toBeVisible();
  await expect(page.getByText('Tk 280')).toHaveCount(0);

  await page.getByRole('button', { name: 'বাংলা' }).click();

  await expect(page.getByRole('heading', { name: 'শহরের সব খাবার, এক ঠিকানায়।' })).toBeVisible();
  await expect(page.getByText('৳২৮০')).toHaveCount(0);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: "Your town's food, in one place." })).toBeVisible();
});

test('language button meets the minimum tap target', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'বাংলা' });
  // The screen renders only after fonts load; boundingBox() does not wait for visibility.
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
});

test('fits a small phone without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
