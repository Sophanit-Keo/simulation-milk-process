import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectLanded, expectOverview, waitForClock, YOGURT_STAGES } from './helpers';

// Phase 20 in the browser: "Yogurt tour" beside the guided tour walks stages 11–16, 20 s at each, about 2 minutes, with
// each stage's two caption lines; Stop ends it, and starting the milk tour ends it too. The milk tour is unchanged.

const yogurtButton = (page: Page) => page.getByTestId('tour-yogurt');
const yogurtCaption = (page: Page) => page.getByTestId('tour-caption-yogurt');
const milkCaption = (page: Page) => page.getByTestId('tour-caption');

test('the yogurt tour flies to stage 11 with its caption, moves on to stage 12 after 20 s, and stops', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await waitForClock(page);
  // In the yogurt group's header (phase 21): "Tour", named "Yogurt tour".
  await expect(yogurtButton(page)).toHaveText('Tour');
  await expect(yogurtButton(page)).toHaveAccessibleName('Yogurt tour');
  await expect(page.getByTestId('rail-group-yogurt').locator('..').getByTestId('tour-yogurt')).toBeVisible();
  await expect(yogurtButton(page)).toHaveAttribute('title', /stages 11 to 16 .* about 2 minutes/);
  await yogurtButton(page).click();
  await expect(yogurtButton(page)).toHaveAttribute('aria-pressed', 'true');
  const [first, second] = YOGURT_STAGES;
  await expect(yogurtCaption(page)).toBeVisible();
  await expect(yogurtCaption(page).locator('.tour-step')).toHaveText(`Yogurt line · stage 11 (1 of 6) · ${first?.name}`);
  await expect(yogurtCaption(page).locator('.tour-line').first()).toHaveText(first?.tourCaption[0] ?? '');
  await expectLanded(page, 11);
  await expect(milkCaption(page)).toBeHidden();
  await expect(yogurtCaption(page).locator('.tour-step')).toHaveText(`Yogurt line · stage 12 (2 of 6) · ${second?.name}`, { timeout: 30_000 });
  await expectLanded(page, 12);
  await page.getByTestId('tour-stop-yogurt').click();
  await expect(yogurtCaption(page)).toBeHidden();
  await expect(yogurtButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('starting the milk tour ends the yogurt tour, and the milk tour reads as it did', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  await yogurtButton(page).click();
  await expect(yogurtCaption(page)).toBeVisible();
  await page.getByTestId('tour').click();
  await expect(yogurtCaption(page)).toBeHidden();
  await expect(yogurtButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(milkCaption(page)).toBeVisible();
  await expect(milkCaption(page).locator('.tour-step')).toHaveText(/^Stage 1 of 10 · /);
  await page.getByTestId('tour-stop').click();
  await expect(milkCaption(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expectOverview(page);
});
