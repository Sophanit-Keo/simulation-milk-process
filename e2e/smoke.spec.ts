import { expect, test, type Page } from '@playwright/test';

/** How long the frame loop runs before a page is judged error-free, so errors thrown per frame show up. */
const SETTLE_MS = 1_500;

/** Starts collecting console errors and uncaught page errors; read the array at the end of the test. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

/** The top-bar clock's sim time, or NaN while it is missing or not a number. */
async function clockTimeS(page: Page): Promise<number> {
  const value = await page.locator('[data-testid="sim-clock"]').getAttribute('data-time-s', { timeout: 1_000 }).catch(() => null);
  return value === null || value.trim() === '' ? Number.NaN : Number(value);
}

test('the page loads with a 3D canvas and no errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  expect(errors).toEqual([]);
});

test('the sim clock ticks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="sim-clock"]')).toBeAttached();
  await expect.poll(() => clockTimeS(page), { message: 'data-time-s is a number' }).toBeGreaterThanOrEqual(0);
  const firstS = await clockTimeS(page);
  await expect
    .poll(() => clockTimeS(page), { message: 'data-time-s increases', timeout: 3_000 })
    .toBeGreaterThan(firstS);
});

test('the mock snapshot (/?mock) loads with no errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?mock');
  await expect(page.locator('#app')).toBeAttached();
  await page.waitForTimeout(SETTLE_MS);
  expect(errors).toEqual([]);
});
