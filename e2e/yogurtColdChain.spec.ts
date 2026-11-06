import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 19 in the browser, on the live sim (no ?mock): the yogurt cold chain, stage 16. The panel reads the rooms, the
// next release and the reefers in words, with the yogurt batches beside them; the 3D view fills the rooms; and from the
// opening the line runs from silo to reefer for both routes: the opening shift's stirred batch and the night's set batch
// both leave by reefer, every pallet inside its 48 h.
//
// On software GL a frame takes a few hundred ms, so nothing waits on wall-clock time: a recorder in the page notes on
// every frame what the checks then read.

const stateText = (page: Page, key: string) => page.locator(`#panel [data-state-key="${key}"] dd`);

async function selectColdChain(page: Page): Promise<void> {
  await showOnRail(page, 16);
  await railButton(page, 16).click();
  await expect(railButton(page, 16)).toHaveAttribute('aria-current', 'true');
  await expect(stateText(page, 'coldRoom')).toBeVisible();
}

test('the stage 16 panel reads the cold chain as it opens, with its yogurt batches, and the 3D view fills the rooms', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectColdChain(page);
  await expect(stateText(page, 'warmRoom')).toHaveText(/^\d+ of 36 pallets · pH 4\.\d\d to \d\.\d\d, out at 4\.60$/);
  await expect(stateText(page, 'chiller')).toHaveText(/^\d+ of 32 pallets · air −?-?2 °C · warmest core \d+\.\d °C$/);
  await expect(stateText(page, 'coldRoom')).toHaveText(/^1\d\d of 360 positions · 3\.0 °C$/);
  await expect(stateText(page, 'release')).toHaveText(/^In .+ · \d+ pallets? released, waiting for a reefer$/);
  await expect(stateText(page, 'reefers')).toHaveText(/ shipped$/);
  await expect(stateText(page, 'trays')).toHaveText(/ trays? packed · /);
  // The yogurt batches in the chain, oldest first: the last two days' and, once its pallets close, the opening shift's.
  const batches = page.getByTestId('yogurt-batch-list').locator('.yogurt-batch');
  await expect(batches.first()).toHaveAttribute('data-batch', /^P8-006-\d$/);
  await expect(page.getByTestId('yogurt-batch-list').locator('.yogurt-batch[data-batch="P8-007-3"]')).toContainText('plain set yogurt');
  // The 3D view: the warm room's pallets one by one, the chiller and the cold room by their share, both rooms lit.
  await expect.poll(() => sceneCall(page, 'equipmentState', 'yogurt-pallets')).toMatchObject({ warmGlow: true, frostGlow: true });
  const tokens = await sceneCall(page, 'equipmentState', 'yogurt-pallets');
  expect(Number(tokens?.warm)).toBeGreaterThan(20);
  expect(Number(tokens?.cold)).toBeGreaterThan(30);
});

test('from silo to reefer for both routes: the opening shift\'s stirred batch and the night\'s set batch leave by reefer inside 48 h', async ({ page }) => {
  // Nearly three sim days at ×10,000: a few hundred frames on software GL.
  test.setTimeout(420_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectColdChain(page);
  // On every frame: the reefers at the dock, the batches in the chain, and the shipped count, from the panel and the hook.
  await page.evaluate(() => {
    type Scene = { equipmentState(id: string): Record<string, unknown> | null };
    const seen = { states: new Set<string>(), batches: new Set<string>(), maxReefers: 0, last: { timeS: 0, shipped: '', batches: [] as string[] } };
    Object.assign(window, { chainSeen: seen });
    const tick = (): void => {
      const reefers = document.querySelector('#panel [data-state-key="reefers"] dd')?.textContent ?? '';
      if (/backing to door/.test(reefers)) seen.states.add('arriving');
      if (/loading at door/.test(reefers)) seen.states.add('loading');
      const batches = [...document.querySelectorAll('[data-testid="yogurt-batch-list"] .yogurt-batch')].map((item) => item.getAttribute('data-batch') ?? '');
      for (const batch of batches) seen.batches.add(batch);
      const scene = (window as unknown as { __scene?: Scene }).__scene;
      seen.maxReefers = Math.max(seen.maxReefers, Number(scene?.equipmentState('yogurt-pallets')?.reefers ?? 0));
      seen.last = { timeS: Number(document.querySelector('[data-testid="sim-clock"]')?.getAttribute('data-time-s')), shipped: reefers, batches };
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  type Seen = { states: string[]; batches: string[]; maxReefers: number; last: { timeS: number; shipped: string; batches: string[] } };
  const seen = (): Promise<Seen> =>
    page.evaluate(() => {
      const raw = (window as unknown as { chainSeen: { states: Set<string>; batches: Set<string>; maxReefers: number; last: Seen['last'] } }).chainSeen;
      return { states: [...raw.states], batches: [...raw.batches], maxReefers: raw.maxReefers, last: raw.last };
    });
  const openS = Number(await page.getByTestId('sim-clock').getAttribute('data-time-s'));
  await page.getByTestId('speed-10000').click();
  // Day 11 at 00:00: the night's set batch of day 8 (23:40 to 06:00) has set, chilled by about 12:15 on day 9, held its
  // 24 h and gone; a pallet holds at most about 34.5 h in the cold room (H133).
  await expect
    .poll(async () => (await seen()).last.timeS - openS, { timeout: 360_000, intervals: [1_000] })
    .toBeGreaterThan(66 * 3_600);
  await page.getByTestId('speed-1').click();
  const result = await seen();
  // Reefers backed up and loaded at the dock, and the 3D view drew them there.
  expect(result.states.sort()).toEqual(['arriving', 'loading']);
  expect(result.maxReefers).toBeGreaterThan(0);
  // Both live batches of day 8's stirred and set shifts came into the chain and left it.
  expect(result.batches).toEqual(expect.arrayContaining(['P8-008-1', 'P8-008-3']));
  expect(result.last.batches).not.toContain('P8-008-1');
  expect(result.last.batches).not.toContain('P8-008-3');
  const shipped = Number(/(\d+) shipped$/.exec(result.last.shipped)?.[1]);
  // About 6.4 a day (H133): fifteen or more in nearly three days.
  expect(shipped, result.last.shipped).toBeGreaterThanOrEqual(15);
  // No pallet held past its 48 h: the cold room would have logged it.
  await expect(page.locator('#log [data-testid="event-log"] > li', { hasText: 'has held over 48 h' })).toHaveCount(0);
});
