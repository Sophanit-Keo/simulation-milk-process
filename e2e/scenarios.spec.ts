import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectLanded, expectOverview, railButton, STAGES, waitForClock } from './helpers';

// Phase 5 in the browser: the fault scenarios start from the top bar's menu, the banner over the 3D view
// and the scenario log say what happened and why, and Reset puts the fault right; the mock snapshot plays
// none; the guided tour walks the stages with a caption each and stops on Stop, on Escape or on a click.
// Each scenario's numbers are the unit tests' (tests/sim/scenarios.test.ts, H104–H110); here only what
// shows on screen.

/** The menu's entries, in order, as src/data/scenarios.json lists them. */
const MENU = (JSON.parse(readFileSync(new URL('../src/data/scenarios.json', import.meta.url), 'utf8')) as { scenarios: { name: string }[] }).scenarios.map(
  (item) => item.name,
);
const STAGE_1 = STAGES[0];
const STAGE_2 = STAGES[1];

const menuButton = (page: Page) => page.getByTestId('scenario-menu');
const menuItems = (page: Page) => page.locator('#scenario-menu-list [role="menuitem"][data-scenario]');
const banner = (page: Page) => page.getByTestId('scenario-banner');
const caption = (page: Page) => page.getByTestId('tour-caption');
const tourButton = (page: Page) => page.getByTestId('tour');

/** The event log's entries, newest first: their text and their title (the why). */
const eventLog = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#log [data-testid="event-log"] > li')].map((li) => ({
      text: (li.querySelector('.log-text')?.textContent ?? '').trim(),
      why: li.getAttribute('title') ?? li.querySelector('[title]')?.getAttribute('title') ?? '',
    })),
  );

test('a filler breakdown starts from the menu: the view goes to stage 7, the banner and the log say what and why, Reset puts it right', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);

  await menuButton(page).click();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menuItems(page).locator('strong')).toHaveText(MENU);
  await expect(page.getByTestId('scenario-reset'), 'nothing to reset yet').toHaveAttribute('aria-disabled', 'true');

  await menuItems(page).filter({ hasText: 'Filler breakdown' }).click();
  await expect(menuButton(page), 'the menu closes').toHaveAttribute('aria-expanded', 'false');
  await expectLanded(page, 7);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Filler breakdown');
  await expect(banner(page)).toContainText(/Filler A (under repair|re-sterilizing)/);
  await expect(page.locator('#panel [data-state-key="fillerA"]')).toContainText('Broken down · repair');
  await expect.poll(async () => (await eventLog(page)).find((entry) => /^Filler A broke down/.test(entry.text))?.why ?? '').toMatch(/jammed sealing jaw/);

  // The scenario log: the run, when it started, and each step with its why.
  await page.getByTestId('scenario-log-open').click();
  const dialog = page.getByTestId('scenario-log');
  await expect(dialog).toBeVisible();
  const run = dialog.locator('.sc-run').first();
  await expect(run.locator('h3')).toHaveText('Filler breakdown');
  await expect(run.locator('.sc-meta')).toContainText(/Started day \d+ · \d\d:\d\d · acting now/);
  await expect(run.locator('.sc-entries > li').first().locator('.sc-what')).toContainText('Filler A broke down');
  await expect(run.locator('.sc-entries > li').first().locator('.sc-why')).toContainText('jammed sealing jaw');
  await page.getByTestId('scenario-log-close').click();
  await expect(dialog).toBeHidden();

  // While it acts the same scenario can still start on the other filler; Reset ends the repair now.
  await menuButton(page).click();
  await expect(page.getByTestId('scenario-reset')).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('scenario-reset').click();
  await expect(banner(page)).toContainText(/Filler A re-sterilizing|Over: filler A running/);
  await expect(page.locator('#panel [data-state-key="fillerA"]')).toContainText(/Re-sterilizing|Running/);
  await page.getByTestId('scenario-log-open').click();
  await expect(run.locator('.sc-entries')).toContainText('sterilized');
  await page.getByTestId('scenario-log-close').click();
});

test('the mock snapshot plays no scenario: every entry says why not, and the log says none has run', async ({ page }) => {
  await page.goto('/?mock');
  await waitForClock(page);
  await menuButton(page).click();
  await expect(menuItems(page)).toHaveCount(MENU.length);
  for (const item of await menuItems(page).all()) {
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item.locator('.menu-why')).toHaveText('Not now: The mock snapshot plays no fault scenarios');
  }
  // Opening the menu focuses its first entry that can do something: here the log. Down from the last entry
  // wraps to the first fault, and Enter on it, as a keyboard user would press it, starts nothing.
  await expect(page.getByTestId('scenario-log-menu')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItems(page).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner(page), 'a disabled entry starts nothing').toBeHidden();
  await expect(menuButton(page), 'and leaves the menu open').toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('scenario-log-menu').click();
  await expect(page.getByTestId('scenario-log')).toContainText('No scenario has run yet');
  await page.getByTestId('scenario-log-close').click();
});

test('the guided tour walks the stages with their two-line captions and stops on Stop, Escape or a rail click', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);

  await tourButton(page).click();
  await expect(tourButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(caption(page)).toBeVisible();
  await expect(caption(page).locator('.tour-step')).toHaveText(`Stage 1 of ${STAGES.length} · ${STAGE_1.name}`);
  await expect(caption(page).locator('.tour-line')).toHaveText([...STAGE_1.tourCaption]);
  await expectLanded(page, 1);
  // 18 s at each stop (TOUR_STOP_S), on real time.
  await expect(caption(page).locator('.tour-step')).toHaveText(`Stage 2 of ${STAGES.length} · ${STAGE_2.name}`, { timeout: 30_000 });
  await expectLanded(page, 2);
  await page.getByTestId('tour-stop').click();
  await expect(caption(page)).toBeHidden();
  await expect(tourButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#viewport'), 'Stop leaves the view where it is').toHaveAttribute('data-focus-stage', '2');

  await tourButton(page).click();
  await expect(caption(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(caption(page)).toBeHidden();
  await expectOverview(page);

  await tourButton(page).click();
  await expect(caption(page)).toBeVisible();
  await railButton(page, 9).click();
  await expect(caption(page)).toBeHidden();
  await expectLanded(page, 9);
});
