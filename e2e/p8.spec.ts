import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { frameMs, railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 18 in the browser, on the live sim (no ?mock): Line P8 fills, seals and checks its cups (stage 15). The panel
// says what it does in words and shows the batch's fill weights; at ×1 the carrier indexes every 2 s, the stations
// stroke and the cups de-nest, fill, take their foil and leave for the gates; a cup the checks reject is kicked into
// the bin; and the frames keep their pace with the line's 1,400-odd cup instances.
//
// On software GL a frame takes a few hundred ms on a busy machine, so nothing waits on wall-clock time: a recorder in
// the page notes the machine's and the cups' state on every frame, and the checks read what it saw.

const stateText = (page: Page, key: string) => page.locator(`#panel [data-state-key="${key}"] dd`);

async function selectP8(page: Page): Promise<void> {
  await showOnRail(page, 15);
  await railButton(page, 15).click();
  await expect(railButton(page, 15)).toHaveAttribute('aria-current', 'true');
  await expect(stateText(page, 'p8State')).toBeVisible();
}

interface Seen {
  cycles: number;
  pistonDownM: number;
  sealDownM: number;
  uvOn: boolean;
  cups: number;
  filled: number;
  lids: number;
  kicks: number;
}

/** Starts noting, on every frame, P8's machine and its cups as the ?debug hook reports them. */
async function recordP8(page: Page): Promise<() => Promise<Seen[]>> {
  await page.evaluate(() => {
    type Scene = { equipmentState(id: string): Record<string, unknown> | null };
    const seen: Seen[] = [];
    Object.assign(window, { p8Seen: seen });
    const tick = (): void => {
      const scene = (window as unknown as { __scene?: Scene }).__scene;
      const filler = scene?.equipmentState('p8-filler') ?? {};
      const cups = scene?.equipmentState('p8-cups') ?? {};
      seen.push({
        cycles: Number(filler.cycles),
        pistonDownM: Number(filler.pistonDownM),
        sealDownM: Number(filler.sealDownM),
        uvOn: filler.uvOn === true,
        cups: Number(cups.cups),
        filled: Number(cups.filled),
        lids: Number(cups.lids),
        kicks: Number(cups.kicks),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => (window as unknown as { p8Seen: Seen[] }).p8Seen);
}

test('the stage 15 panel reads Line P8 in words: running its first batch, every check in its limits, and the batch\'s fill weights', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await selectP8(page);
  await expect(stateText(page, 'p8State')).toHaveText('Running · 30 cycles a minute');
  await expect(stateText(page, 'p8Batch')).toHaveText('P8-008-1 · plain stirred yogurt · best before day 36');
  await expect(stateText(page, 'p8Fill')).toHaveText(/^1[23]\d\.\d g · passes 120\.5–135 g$/);
  await expect(stateText(page, 'p8Rejects')).toHaveText(/^Fill 0 · metal \d · vision \d+ · seal hold 0$/);
  await expect(stateText(page, 'p8Seal')).toHaveText('200 °C · 1.0 s · 5.0 bar · in its window');
  await expect(stateText(page, 'p8Hepa')).toHaveText(/^\+2\d\.\d Pa · stops under \+15 Pa$/);
  await expect(stateText(page, 'p8Hygiene')).toHaveText('SIP passed day 7 · 23:40 · ATP 4.0 RLU');
  await expect(stateText(page, 'p8SealTest')).toHaveText(/^In [12] h \d\d min · 0 passed, 0 failed$/);
  await expect(stateText(page, 'p8Magazines')).toHaveText(/^Cups \d{1,3} % · foils \d{1,3} %$/);
  for (const key of ['p8State', 'p8Batch', 'p8Seal', 'p8Hepa', 'p8Hygiene']) {
    await expect(page.locator(`#panel [data-state-key="${key}"] .lamp`), key).toHaveAttribute('data-status', 'ok');
  }
  // The histogram of the batch's fills, with its numbers in words for a screen reader.
  const histogram = page.getByTestId('fill-histogram');
  await expect(histogram).toBeVisible();
  await expect(page.getByTestId('fill-histogram-summary')).toHaveText(/^P8-008-1: [\d,]+ cups, mean 12[67]\.\d g, none outside 120\.5–135 g$/);
  await expect(histogram.locator('[role="img"]')).toHaveAttribute('aria-label', /^Fill weights of the current batch: P8-008-1: /);
  expect(await histogram.locator('.fill-hist-bar').count()).toBe(32);
  // The rate slider: its End key sends 25,200 cups/h, 35 cycles a minute.
  const slider = page.getByTestId('setpoint-p8RateCupsPerH');
  await expect(page.getByTestId('setpoint-p8RateCupsPerH-value')).toHaveText('21,600 cups/h');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('setpoint-p8RateCupsPerH-value')).toHaveText('25,200 cups/h');
  await expect(stateText(page, 'p8State')).toHaveText('Running · 35 cycles a minute');
});

test('at ×1 the carrier indexes every 2 s: the cups de-nest, fill, take their foil and leave, and the frames keep their pace', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectP8(page);
  await page.getByTestId('speed-1').click();
  const seen = await recordP8(page);
  // Six sim seconds: three cycles. The recorder counts frames, not wall-clock time.
  await expect
    .poll(async () => {
      const frames = await seen();
      return frames.length > 1 ? (frames.at(-1)?.cycles ?? 0) - (frames[0]?.cycles ?? 0) : 0;
    }, { message: 'three cycles at ×1', timeout: 120_000, intervals: [500] })
    .toBeGreaterThanOrEqual(3);
  const frames = await seen();
  const last = frames.at(-1) as Seen;
  // The line holds its cups: 92 rows of 12 on the carrier, the de-nester's row, and four abreast past P8.
  expect(last.cups).toBeGreaterThan(1_400);
  // Lidded: the 32 carrier rows past the foil pick and every cup past P8, about 720.
  expect(last.lids).toBeGreaterThan(700);
  expect(last.filled).toBeGreaterThan(100);
  // Each cycle the pistons and the sealing heads stroke down and up, under a lit UV tunnel.
  expect(frames.some((frame) => frame.pistonDownM > 0.1), 'the pistons stroke down').toBe(true);
  expect(frames.some((frame) => frame.pistonDownM === 0), 'and back up').toBe(true);
  expect(frames.some((frame) => frame.sealDownM > 0.08), 'the sealing heads press').toBe(true);
  expect(frames.every((frame) => frame.uvOn), 'the UV tunnel glows while P8 runs').toBe(true);
  expect(await sceneCall(page, 'equipmentState', 'p8-filler')).toMatchObject({ running: true, lamp: 'ok' });
  // The cups' label shows the code the coder prints.
  await expect(page.locator('.equipment-label[data-equipment="p8-cups"] .equipment-value')).toHaveText('P8-008-1 · best before day 36');
  // The cups cost no frame time to speak of: the stage stop keeps a few frames a second even on software GL.
  expect(await frameMs(page, 10)).toBeLessThan(1_000);
});

test('a cup the checks reject is kicked off the belt into the bin', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectP8(page);
  const seen = await recordP8(page);
  // The vision check rejects 1 cup in 20,000 (H129): at ×1,000 about one every 3.3 s of real time.
  await page.getByTestId('speed-1000').click();
  await expect
    .poll(async () => (await seen()).at(-1)?.kicks ?? 0, { message: 'a reject kicked into the bin', timeout: 150_000, intervals: [1_000] })
    .toBeGreaterThan(0);
  // The panel counts it: a metal or a vision reject, no fill or seal-hold ones.
  const words = (await stateText(page, 'p8Rejects').textContent()) ?? '';
  const [, metal, vision] = /^Fill 0 · metal (\d+) · vision (\d+) · seal hold 0$/.exec(words) ?? [];
  expect(Number(metal) + Number(vision), words).toBeGreaterThan(0);
});
