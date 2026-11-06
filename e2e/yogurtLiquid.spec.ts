import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { plantConfig, railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 17 in the browser, on the live sim (no ?mock): the yogurt line's liquid side, stages 11–14, from the yogurt
// silo to the P8 buffer. The panels say what the line does in words, the next-product picker changes the next shift,
// a heat set point under the CCP's 85 °C diverts within one hold and the wing cleans before it restarts, and over
// the product day a stirred batch ferments in its tank and the set batch goes warm to the buffer.
//
// On software GL a frame takes a few hundred ms on a busy machine, so nothing here waits on wall-clock time: a
// recorder in the page notes on every frame what the checks then read (as divert.spec.ts does for the UHT plant).

const { heat } = plantConfig.yogurt;

/** A state row's words in the panel (panelRows.ts), and its lamp. */
const stateRow = (page: Page, key: string) => page.locator(`#panel [data-state-key="${key}"]`);
const stateText = (page: Page, key: string) => stateRow(page, key).locator('dd');

/** Selects a stage on the rail and waits for its panel: its first state row, or for a stage without one its title. */
async function selectStage(page: Page, stage: number, withStates = true): Promise<void> {
  await showOnRail(page, stage);
  await railButton(page, stage).click();
  await expect(railButton(page, stage)).toHaveAttribute('aria-current', 'true');
  if (withStates) await expect(page.locator('#panel [data-state-key]').first()).toBeVisible();
}

/**
 * Starts noting every event-log entry that shows, once, on every frame: the log shows the newest 20, and a fast run
 * scrolls entries off between two reads.
 */
async function recordLog(page: Page): Promise<() => Promise<Entry[]>> {
  await page.evaluate(() => {
    const entries = new Map<string, Entry>();
    Object.assign(window, { seenLog: entries });
    const tick = (): void => {
      for (const li of document.querySelectorAll('#log [data-testid="event-log"] > li')) {
        const text = (li.querySelector('.log-text')?.textContent ?? '').trim();
        const match = /^PT(\d+)S$/.exec(li.querySelector('time')?.getAttribute('datetime') ?? '');
        const key = `${match?.[1]} ${text}`;
        if (match && !entries.has(key)) entries.set(key, { kind: li.getAttribute('data-kind') ?? '', text, timeS: Number(match[1]) });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => [...(window as unknown as { seenLog: Map<string, Entry> }).seenLog.values()]);
}

interface Entry {
  kind: string;
  text: string;
  timeS: number;
}

interface Frame {
  timeS: number;
  lamp: string;
  diverting: boolean;
  flagRad: number;
  mode: string;
  routeLit: boolean;
  reprocessFrac: number;
}

/**
 * Starts noting, on every frame: the divert valve, the stage 12 panel's mode in words (without the time left), the
 * lit route to the reprocess tank and the reprocess tank's fill.
 */
async function recordHeat(page: Page): Promise<() => Promise<Frame[]>> {
  await page.evaluate(() => {
    type Scene = { equipmentState(id: string): Record<string, unknown> | null; pipeState(): { yogurtDivertLit?: boolean } };
    const frames: Frame[] = [];
    Object.assign(window, { heatFrames: frames });
    const tick = (): void => {
      const scene = (window as unknown as { __scene?: Scene }).__scene;
      const valve = scene?.equipmentState('yogurt-divert-valve') ?? {};
      const words = document.querySelector('#panel [data-state-key="heatMode"] dd')?.textContent ?? '';
      const frame: Frame = {
        timeS: Number(document.querySelector('[data-testid="sim-clock"]')?.getAttribute('data-time-s')),
        lamp: String(valve.lamp ?? ''),
        diverting: valve.diverting === true,
        flagRad: Number(valve.flagRad),
        mode: words.split('·')[0].trim(),
        routeLit: scene?.pipeState().yogurtDivertLit === true,
        reprocessFrac: Number(scene?.equipmentState('reprocess-tank')?.fillFrac),
      };
      const last = frames.at(-1);
      if (!last || last.lamp !== frame.lamp || last.mode !== frame.mode || last.routeLit !== frame.routeLit || last.reprocessFrac !== frame.reprocessFrac) frames.push(frame);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => (window as unknown as { heatFrames: Frame[] }).heatFrames);
}

/** The values of `key` in order, each run of equal values once. */
const runs = <T>(items: readonly T[], read: (item: T) => string): string[] =>
  items.map(read).filter((value, i, all) => i === 0 || value !== all[i - 1]);

test('the panels of stages 11–14 read the line in words as it opens, and the next-product picker changes the next shift', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);

  // Stage 11: plain stirred this shift, strawberry from 14:00 (the product day), the picker on the next one.
  await selectStage(page, 11);
  await expect(stateText(page, 'product')).toHaveText('Plain stirred yogurt · stirred');
  await expect(stateText(page, 'nextProduct')).toHaveText('Strawberry stirred yogurt');
  const picker = page.getByTestId('next-product');
  await expect(picker.getByRole('group', { name: 'Next shift makes' }).getByRole('button')).toHaveText(['Plain stirred', 'Strawberry stirred', 'Plain set']);
  await expect(page.getByTestId('next-product-strawberryStirred')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('next-product-hint')).toContainText('day 8 · 14:00');
  await page.getByTestId('next-product-plainSet').click();
  await expect(page.getByTestId('next-product-plainSet')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('next-product-strawberryStirred')).toHaveAttribute('aria-pressed', 'false');
  await expect(stateText(page, 'nextProduct')).toHaveText('Plain set yogurt');
  await expect(page.locator('#log [data-testid="event-log"] > li', { hasText: 'Yogurt line: the next shift (day 8, 14:00) makes plain set yogurt' })).toHaveCount(1);
  // This shift's product stays as it is.
  await expect(stateText(page, 'product')).toHaveText('Plain stirred yogurt · stirred');

  // Stage 12: the heat treatment waits for an empty tank, its set point on the slider, no steam.
  await selectStage(page, 12);
  await expect(stateText(page, 'heatMode')).toHaveText('Standing · no tank or buffer room to fill');
  await expect(stateRow(page, 'heatMode').locator('.lamp')).toHaveAttribute('data-status', 'idle');
  await expect(stateText(page, 'heatCleaning')).toHaveText('None');
  await expect(stateText(page, 'steam')).toHaveText('None now');
  await expect(page.getByTestId('setpoint-yogurtHeatC-value')).toHaveText('92.0 °C');
  await expect(page.getByTestId('setpoint-yogurtHeatC')).toHaveAttribute('aria-valuetext', '92.0 °C');
  expect(await sceneCall(page, 'equipmentState', 'yogurt-divert-valve')).toMatchObject({ lamp: 'off', diverting: false });

  // Stage 13: tank 1 empties into the buffer, tank 2 waits at the end pH, tank 3 is half way through its 4 h (H125).
  await selectStage(page, 13);
  await expect(stateText(page, 'tank1')).toHaveText(/^Emptying to the buffer · \d{1,3} % · pH 4\.55$/);
  await expect(stateText(page, 'tank2')).toHaveText('Ready at pH 4.55 · cooled, waiting to empty');
  await expect(stateText(page, 'tank3')).toHaveText(/^Fermenting · pH 5\.\d\d · ready in [12] h \d\d min$/);
  await expect(page.getByTestId('setpoint-fermentTempC-value')).toHaveText('43.0 °C');
  // The emptying and the ready tank stir; the fermenting one stands still while its yogurt sets.
  await expect.poll(() => sceneCall(page, 'equipmentState', 'ferment-tank-1')).toMatchObject({ stirring: true });
  await expect.poll(() => sceneCall(page, 'equipmentState', 'ferment-tank-3')).toMatchObject({ stirring: false, spinRadPerS: 0 });
  // The pH rings on the tanks' labels: full for the tank at the end pH, about half for the one half way.
  const ring = (n: number) => page.locator(`.equipment-label[data-equipment="ferment-tank-${n}"] .equipment-ring`);
  await expect(ring(2)).toHaveAttribute('data-ring-pct', '100');
  await expect.poll(async () => Number(await ring(3).getAttribute('data-ring-pct'))).toBeGreaterThan(40);
  expect(Number(await ring(3).getAttribute('data-ring-pct'))).toBeLessThan(60);

  // Stage 14: plain stirred in the buffer, no changeover, no set mix waiting.
  await selectStage(page, 14);
  await expect(stateText(page, 'bufferProduct')).toHaveText('Plain stirred yogurt');
  await expect(stateText(page, 'changeover')).toHaveText('None');
  await expect(stateText(page, 'setWait')).toHaveText('— · stirred yogurt keeps');

  // Stage 15's rate slider (it has no state rows until phase 18): P8's draw is stubbed at it.
  await selectStage(page, 15, false);
  await expect(page.getByTestId('setpoint-p8RateCupsPerH-value')).toHaveText('21,600 cups/h');
});

test('a heat set point under 85 °C diverts within one hold: the valve flips, its route lights, the reprocess tank fills, and the wing cleans before it restarts', async ({
  page,
}) => {
  // About 4.4 sim hours at ×1,000 until a tank is free, a few sim minutes at ×100 for the divert, then 83 sim
  // minutes of clean at ×10,000: on software GL some hundreds of frames.
  test.setTimeout(420_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectStage(page, 12);
  const heatFrames = await recordHeat(page);
  const seenLog = await recordLog(page);

  // The heat treatment starts once tank 1 has emptied and been cleaned, and fills tank 1 for 100 min. ×1,000, so it is
  // still filling when the checks have seen it start (the set point must change while the line runs: a line that
  // stands diverts only with the first mix it heats afterwards).
  await page.getByTestId('speed-1000').click();
  await expect(stateText(page, 'heatMode')).toHaveText('Forward to the tanks and the buffer', { timeout: 240_000 });
  // ×100, so the 3 min divert lasts a few seconds on screen.
  await page.getByTestId('speed-100').click();
  await expect.poll(() => sceneCall(page, 'equipmentState', 'yogurt-divert-valve')).toMatchObject({ lamp: 'ok', diverting: false });
  await expect(stateText(page, 'steam')).toHaveText(/^\d{3} kg\/h · gas \d{3} kW$/);
  await expect(stateText(page, 'heatMode')).toHaveText('Forward to the tanks and the buffer');

  // The slider's Home key sends its bottom, 80 °C.
  const slider = page.getByTestId('setpoint-yogurtHeatC');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('setpoint-yogurtHeatC-value')).toHaveText('80.0 °C');

  await expect.poll(() => sceneCall(page, 'equipmentState', 'yogurt-divert-valve'), { timeout: 120_000 }).toMatchObject({ lamp: 'bad', diverting: true });
  await expect(stateText(page, 'heatMode')).toHaveText(/^Diverting to the reprocess tank · .+ left$/);
  await expect(stateRow(page, 'heatMode').locator('.lamp')).toHaveAttribute('data-status', 'bad');
  await expect(railButton(page, 12).locator('[data-status]')).toHaveAttribute('data-status', 'bad');
  await expect.poll(async () => Number((await sceneCall(page, 'equipmentState', 'yogurt-divert-valve'))?.flagRad)).toBeGreaterThan(1.5);
  await expect.poll(async () => (await sceneCall(page, 'pipeState')).yogurtDivertLit).toBe(true);
  await expect.poll(async () => Number((await sceneCall(page, 'equipmentState', 'reprocess-tank'))?.fillFrac)).toBeGreaterThan(0);

  // Back over the limit (End: 95 °C), so the line runs on once it is clean; ×10,000 through the wing's CIP.
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('setpoint-yogurtHeatC-value')).toHaveText('95.0 °C');
  await page.getByTestId('speed-10000').click();
  /** The lamp's frames from the divert: red, amber through the clean, then green again. */
  const fromDivert = (frames: Frame[]): Frame[] => frames.slice(Math.max(0, frames.findIndex((frame) => frame.lamp === 'bad')));
  const backAt = (frames: Frame[]): number => frames.findIndex((frame, i) => frame.lamp === 'ok' && frames.slice(0, i).some((before) => before.lamp === 'warn'));
  await expect
    .poll(async () => backAt(fromDivert(await heatFrames())), { message: 'forward again with a green lamp', timeout: 240_000, intervals: [1_000] })
    .toBeGreaterThan(0);
  await page.getByTestId('speed-1').click();

  const frames = await heatFrames();
  const divertAt = frames.findIndex((frame) => frame.lamp === 'bad');
  const cycle = fromDivert(frames).slice(0, backAt(fromDivert(frames)) + 1);
  // Before the divert the line stood, then ran: green while it filled a tank, off while none was free.
  expect(frames[0].lamp).toBe('off');
  expect([...new Set(frames.slice(0, divertAt).map((frame) => frame.lamp))].sort(), JSON.stringify(frames)).toEqual(['off', 'ok']);
  expect(runs(cycle, (frame) => frame.lamp), JSON.stringify(frames)).toEqual(['bad', 'warn', 'ok']);
  // The panel says the same in words, 4 times a second.
  const modes = runs(frames, (frame) => frame.mode);
  expect(modes.slice(0, 2), JSON.stringify(modes)).toEqual(['Standing', 'Forward to the tanks and the buffer']);
  const diverted = modes.indexOf('Diverting to the reprocess tank');
  expect(modes.slice(0, diverted).every((mode) => mode === 'Standing' || mode === 'Forward to the tanks and the buffer'), JSON.stringify(modes)).toBe(true);
  expect(modes.slice(diverted, diverted + 3), JSON.stringify(modes)).toEqual(['Diverting to the reprocess tank', "Cleaning (the wing's CIP)", 'Forward to the tanks and the buffer']);
  // The route to the reprocess tank glowed once, while the mix went there: never while the line stood or cleaned. The
  // pipes follow every frame and the panel 4 times a second, so at the switches they may differ for a frame.
  expect(runs(frames, (frame) => String(frame.routeLit))).toEqual(['false', 'true', 'false']);
  for (const frame of frames) if (frame.mode === 'Standing' || frame.mode.startsWith('Cleaning')) expect(frame.routeLit, JSON.stringify(frame)).toBe(false);

  // The log, in sim seconds: the divert came within one hold of the set point (the outlet's lag, then the 300 s the
  // parcel at the outlet was held); the clean started after the 180 s divert and ran the wing's 4,800 s CIP (D27).
  const log = await seenLog();
  const at = (pattern: RegExp): Entry | undefined => log.find((entry) => pattern.test(entry.text));
  const setS = at(/^Yogurt heat-treatment set point set to 80 °C$/)?.timeS ?? Number.NaN;
  const divert = at(/^Yogurt mix diverted to the reprocess tank: \d+\.\d °C at the holding cell's outlet, below 85 °C$/);
  expect(divert?.kind, JSON.stringify(log)).toBe('bad');
  const divertS = divert?.timeS ?? Number.NaN;
  expect(divertS - setS, `set at ${setS} s, divert at ${divertS} s`).toBeGreaterThanOrEqual(heat.holdS);
  expect(divertS - setS).toBeLessThanOrEqual(heat.holdS + 5 * heat.lagS);
  // The log's times are those of the sim's steps: 10 s from ×1,000 up.
  const step = plantConfig.clock.fastStepS;
  const cleanS = at(/^Yogurt heat treatment cleaning after the divert/)?.timeS ?? Number.NaN;
  expect(Math.abs(cleanS - divertS - heat.divertS), `clean from ${cleanS} s`).toBeLessThanOrEqual(step);
  const readyS = at(/^Yogurt heat treatment clean, ready to run again$/)?.timeS ?? Number.NaN;
  expect(Math.abs(readyS - cleanS - 4_800), `clean until ${readyS} s`).toBeLessThanOrEqual(step);
  // The clean pumped the reprocess tank out to rework.
  expect(Number((await sceneCall(page, 'equipmentState', 'reprocess-tank'))?.fillFrac)).toBeLessThan(0.001);
});

test('over the product day a stirred batch ferments in its tank and the set batch goes warm to the buffer, P8 never waiting', async ({ page }) => {
  // 18 sim hours at ×10,000: some seventy frames at the least, and the panel read on each.
  test.setTimeout(300_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectStage(page, 13);
  const seenLog = await recordLog(page);
  // Each tank's state word, its agitator and its pH ring, on every frame.
  await page.evaluate(() => {
    type Scene = { equipmentState(id: string): Record<string, unknown> | null };
    const seen: { timeS: number; tanks: { state: string; stirring: boolean; ringPct: number | null }[] }[] = [];
    Object.assign(window, { tankFrames: seen });
    const tick = (): void => {
      const scene = (window as unknown as { __scene?: Scene }).__scene;
      const tanks = [1, 2, 3].map((n) => {
        const words = document.querySelector(`#panel [data-state-key="tank${n}"] dd`)?.textContent ?? '';
        const ring = document.querySelector<HTMLElement>(`.equipment-label[data-equipment="ferment-tank-${n}"] .equipment-ring`);
        return {
          state: words.split('·')[0].trim().split(' ')[0],
          stirring: scene?.equipmentState(`ferment-tank-${n}`)?.stirring === true,
          ringPct: ring && !ring.hidden ? Number(ring.dataset.ringPct) : null,
        };
      });
      seen.push({ timeS: Number(document.querySelector('[data-testid="sim-clock"]')?.getAttribute('data-time-s')), tanks });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  type TankFrame = { timeS: number; tanks: { state: string; stirring: boolean; ringPct: number | null }[] };
  const tankFrames = (): Promise<TankFrame[]> => page.evaluate(() => (window as unknown as { tankFrames: TankFrame[] }).tankFrames);

  // Past midnight: through the stirred shifts, the wing's CIP and P8's SIP from 22:00 to 23:40, into the set yogurt's
  // (H125e). The clock runs on at ×10,000 between two reads, up to a few sim hours, all still in the set shift.
  const openS = plantConfig.clock.startTimeS;
  await page.getByTestId('speed-10000').click();
  await expect
    .poll(async () => (await tankFrames()).at(-1)?.timeS ?? 0, { timeout: 240_000, intervals: [1_000] })
    .toBeGreaterThan(openS + 18 * 3_600);
  await page.getByTestId('speed-1').click();

  const frames = await tankFrames();
  // A stirred batch, as the developer watches it: tank 1 empties, is cleaned, fills, ferments, waits ready and
  // empties again, in that order.
  const tank1 = runs(
    frames.filter((frame) => frame.tanks[0].state !== ''),
    (frame) => frame.tanks[0].state,
  );
  const cycle = ['Emptying', 'Cleaning', 'Empty', 'Filling', 'Fermenting', 'Ready', 'Emptying'];
  const from = tank1.indexOf('Emptying');
  expect(tank1.slice(from).filter((state) => state !== 'Empty').slice(0, 6), tank1.join(' → ')).toEqual(cycle.filter((state) => state !== 'Empty').slice(0, 6));
  // While the yogurt sets no agitator turns; a filling tank's does. The pH ring grows as it ferments.
  const fermenting = frames.flatMap((frame) => frame.tanks.filter((tank) => tank.state === 'Fermenting'));
  expect(fermenting.some((tank) => !tank.stirring), 'a fermenting tank stands still').toBe(true);
  expect(frames.some((frame) => frame.tanks.some((tank) => tank.state === 'Filling' && tank.stirring)), 'a filling tank stirs').toBe(true);
  const rings = frames
    .map((frame) => frame.tanks[0])
    .filter((tank) => tank.state === 'Fermenting' && tank.ringPct !== null)
    .map((tank) => tank.ringPct ?? 0);
  expect(Math.max(...rings) - Math.min(...rings), `tank 1's ring: ${rings.join(', ')}`).toBeGreaterThan(30);

  // The set batch: plain set yogurt from 22:00, straight to the buffer at 43 °C, its wait under the 45 min.
  await selectStage(page, 14);
  await expect(stateText(page, 'bufferProduct')).toHaveText('Plain set yogurt');
  await expect(stateText(page, 'setWait')).toHaveText(/^\d+ min( \d\d s)? of 45 min$/);
  await expect(stateText(page, 'changeover')).toHaveText('None');
  await selectStage(page, 11);
  await expect(stateText(page, 'product')).toHaveText('Plain set yogurt · sets in the cup');
  // P8 ran at its rate through both changeovers: the rinse before strawberry, the CIP and SIP before set yogurt, and
  // never "Line P8 waiting" for an empty buffer.
  const log = await seenLog();
  const texts = log.map((entry) => entry.text);
  expect(texts.filter((text) => text.startsWith('Line P8 waiting')), JSON.stringify(texts)).toEqual([]);
  expect(texts.some((text) => /^Line P8: a rinse of the buffer and the fruit line before strawberry stirred yogurt$/.test(text)), JSON.stringify(texts)).toBe(true);
  expect(texts.some((text) => /^Line P8: the wing's CIP and P8's SIP before plain set yogurt$/.test(text)), JSON.stringify(texts)).toBe(true);
});
