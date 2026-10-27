import { expect, test } from './fixtures';
import { clockTimeS, waitForClock, waitForClockToMove } from './helpers';

/** How long the frame loop runs before a page is judged error-free, so errors thrown per frame show up. */
const SETTLE_MS = 1_500;
/** The machines that load a hero model (src/scene/equipment/heroes.ts). */
const HERO_MACHINES = ['separator', 'homogenizer', 'filler-a', 'filler-b', 'palletizer'];

// The fixtures fail every test on a console error or warning, a page error, a failed request or a
// third-party request; these tests also look for them explicitly, once the page has run a while.

test('the page loads with a 3D canvas, no errors and no third-party requests', async ({ page, thirdPartyRequests, pageProblems }) => {
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await waitForClock(page);
  // A window for errors thrown per frame to show up, not a wait for a condition.
  await page.waitForTimeout(SETTLE_MS);
  // First, so a blocked request fails with its URL rather than as the failed request it also causes.
  expect(thirdPartyRequests, 'requests to another origin').toEqual([]);
  expect(pageProblems).toEqual([]);
});

test('the sim clock ticks', async ({ page }) => {
  await page.goto('/');
  const firstS = await waitForClock(page);
  expect(await waitForClockToMove(page, firstS), 'data-time-s increases').toBeGreaterThan(firstS);
  expect(await clockTimeS(page)).toBeGreaterThan(firstS);
});

test('the mock snapshot (/?mock) loads with no errors and no third-party requests', async ({ page, thirdPartyRequests, pageProblems }) => {
  await page.goto('/?mock');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await waitForClock(page);
  await page.waitForTimeout(SETTLE_MS);
  expect(thirdPartyRequests, 'requests to another origin').toEqual([]);
  expect(pageProblems).toEqual([]);
});

test('the four hero models load in place of their grey boxes with no errors; with ?greybox none loads', async ({ page, pageProblems }) => {
  const heroFiles = (urls: string[]) => [...new Set(urls.filter((url) => url.includes('/models/hero/')).map((url) => url.split('/').pop()))].sort();
  const loaded: string[] = [];
  page.on('response', (response) => {
    if (response.ok()) loaded.push(response.url());
  });
  await page.goto('/?greybox');
  await waitForClock(page);
  await page.waitForTimeout(SETTLE_MS);
  expect(heroFiles(loaded), 'hero models loaded with ?greybox').toEqual([]);

  loaded.length = 0;
  await page.goto('/');
  await waitForClock(page);
  await expect.poll(() => heroFiles(loaded)).toEqual(['aseptic-filler.glb', 'homogenizer.glb', 'palletizer.glb', 'separator.glb']);
  // Each machine swaps its model in, meshopt-decoded.
  await page.goto('/?debug');
  await waitForClock(page);
  await expect
    .poll(() => page.evaluate((ids) => ids.map((id) => window.__scene?.equipmentState(id)?.hero === true), HERO_MACHINES))
    .toEqual(HERO_MACHINES.map(() => true));
  await page.waitForTimeout(SETTLE_MS);
  expect(pageProblems).toEqual([]);
});
