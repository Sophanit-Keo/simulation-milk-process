import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectLanded, railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 20 in the browser, on the live sim: the yogurt line's five faults start from the Scenarios menu under their own
// heading; the view goes to their stage; the banner, the panel and the 3D view show the consequence; the scenario log
// says why, and links to Let Report as a yogurt report; Reset puts the fault right. The numbers are the unit tests'
// (tests/sim/yogurt/scenarios.test.ts, H134–H138); here only what shows on screen.

const menuButton = (page: Page) => page.getByTestId('scenario-menu');
const menuItem = (page: Page, id: string) => page.locator(`#scenario-menu-list [role="menuitem"][data-scenario="${id}"]`);
const banner = (page: Page) => page.getByTestId('scenario-banner');
const stateText = (page: Page, key: string) => page.locator(`#panel [data-state-key="${key}"] dd`);

async function start(page: Page, id: string): Promise<void> {
  await menuButton(page).click();
  await expect(menuItem(page, id)).not.toHaveAttribute('aria-disabled', 'true');
  await menuItem(page, id).click();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
}

test('the menu lists the yogurt line\'s five under their heading, after the UHT line\'s', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  await menuButton(page).click();
  const menu = page.locator('#scenario-menu-list');
  await expect(menu.getByTestId('scenario-group-uht')).toHaveText('UHT line');
  await expect(menu.getByTestId('scenario-group-yogurt')).toHaveText('Yogurt line');
  const order = await menu.locator('[data-testid^="scenario-group-"], [role="menuitem"][data-scenario]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.testid ?? (node as HTMLElement).dataset.scenario),
  );
  expect(order.slice(order.indexOf('scenario-group-yogurt'))).toEqual([
    'scenario-group-yogurt',
    'yogurtSlowFermentation',
    'yogurtHeatUnderTemp',
    'yogurtSealDrift',
    'yogurtHepaLoss',
    'yogurtColdRoomExcursion',
  ]);
  // At the opening the heat treatment waits for a tank to empty: its dip cannot start yet, and says why.
  await expect(menuItem(page, 'yogurtHeatUnderTemp')).toHaveAttribute('aria-disabled', 'true');
  await expect(menuItem(page, 'yogurtHeatUnderTemp').locator('.menu-why')).toHaveText('Not now: The yogurt heat treatment is idle; the dip needs it in production');
});

test('a HEPA loss stops P8 and tints its hood; after the repair, an SIP and a swab, P8 fills again', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await start(page, 'yogurtHepaLoss');
  await expectLanded(page, 15);
  await expect(banner(page)).toContainText('HEPA overpressure loss');
  await expect(banner(page)).toContainText(/P8 stopped: cabin at \+5 Pa · repaired in/);
  await expect(stateText(page, 'p8State')).toContainText(/Stopped/i);
  await expect.poll(() => sceneCall(page, 'equipmentState', 'p8-filler')).toMatchObject({ lamp: 'bad' });
  const p8 = await sceneCall(page, 'equipmentState', 'p8-filler');
  if (p8?.hero === true) expect(p8.hoodAlarm).toBe(true);
  // The banner's report is a hygiene report on yogurt, from Line P8 (D30).
  await expect(banner(page).getByTestId('scenario-report')).toHaveAttribute('href', /#new\?cat=hygiene&sev=2&ptype=Yogurt&loc=Line\+P8&desc=From\+the\+milk\+plant\+simulation%27s\+yogurt\+line/);
  // Reset repairs the fan now: P8 is sterilized and swabbed before it fills.
  await menuButton(page).click();
  await page.getByTestId('scenario-reset').click();
  await expect(banner(page)).toContainText(/SIP and ATP swab before P8 fills again|Over: P8 fills again/);
  await page.getByTestId('speed-1000').click();
  await expect(banner(page)).toContainText('Over: P8 fills again', { timeout: 60_000 });
  await page.getByTestId('scenario-log-open').click();
  const run = page.getByTestId('scenario-log').locator('.sc-run').first();
  await expect(run.locator('h3')).toHaveText('HEPA overpressure loss');
  await expect(run.locator('.sc-meta')).toContainText('Yogurt line · ');
  await expect(run.locator('.sc-entries')).toContainText('Line P8 cleared to start');
  await expect(run.locator('.sc-entries')).toContainText('it is sterilized (SIP');
});

test('a cold-room excursion puts the room\'s pallets on QA hold: the panel, the lamp and the alarm strip go red, then QA decides', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await start(page, 'yogurtColdRoomExcursion');
  await expectLanded(page, 16);
  await expect(banner(page)).toContainText('Cold-room excursion');
  await expect(stateText(page, 'coldRoom')).toContainText('cooling down');
  await page.getByTestId('speed-1000').click();
  await expect(stateText(page, 'coldRoom')).toContainText(/\d+ pallets on QA hold/, { timeout: 90_000 });
  await expect(railButton(page, 16).locator('[data-status]')).toHaveAttribute('data-status', 'bad');
  await expect.poll(() => sceneCall(page, 'equipmentState', 'yogurt-pallets'), { timeout: 30_000 }).toMatchObject({ alarm: 'held' });
  await expect(banner(page)).toContainText(/Over: QA destroyed the held pallets/, { timeout: 120_000 });
  await page.getByTestId('speed-1').click();
  await page.getByTestId('scenario-log-open').click();
  const run = page.getByTestId('scenario-log').locator('.sc-run').first();
  await expect(run.locator('.sc-entries')).toContainText(/QA destroys the \d+ held pallets/);
  await expect(run.getByTestId('scenario-report')).toHaveAttribute('href', /cat=temperature&sev=3&ptype=Yogurt&loc=Cold\+room&hold=1/);
});

test('a slow fermentation holds the stalled tank, lights its lamp, and discards it; the seal drift holds the cups since the last pass', async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await start(page, 'yogurtSlowFermentation');
  await expectLanded(page, 13);
  await expect(banner(page)).toContainText('Slow fermentation (phage)');
  await start(page, 'yogurtSealDrift');
  await expectLanded(page, 15);
  await page.getByTestId('speed-1000').click();
  // The seal test at 08:00 fails: the cups since the last pass are held, and the heads are set back (read in the log below).
  await showOnRail(page, 13);
  await railButton(page, 13).click();
  await expect.poll(() => sceneCall(page, 'equipmentState', 'ferment-tank-3'), { timeout: 120_000 }).toMatchObject({ held: true });
  await expect(railButton(page, 13).locator('[data-status]')).toHaveAttribute('data-status', 'bad');
  await expect(banner(page)).toContainText(/Tank 3 held at pH 5\.20|Over: the tank discarded/, { timeout: 60_000 });
  await expect(banner(page)).toContainText('Over: the tank discarded and cleaned', { timeout: 120_000 });
  await page.getByTestId('speed-1').click();
  await page.getByTestId('scenario-log-open').click();
  const runs = page.getByTestId('scenario-log').locator('.sc-run');
  const phage = runs.filter({ has: page.locator('h3', { hasText: 'Slow fermentation (phage)' }) });
  await expect(phage.locator('.sc-entries')).toContainText('Fermentation tank 3 discarded');
  const seal = runs.filter({ has: page.locator('h3', { hasText: 'Seal temperature drift' }) });
  await expect(seal.locator('.sc-entries')).toContainText(/Line P8 seal test failed: 5 of 5 cups leaked/);
  await expect(seal.locator('.sc-entries')).toContainText("Line P8's seal heads set back to 200 °C");
});
