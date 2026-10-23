import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STAGES, plantConfig, railButton, sceneCall, waitForClock, waitForScene } from './helpers';

// The phase 3 exit criterion in the browser, on the live sim (no ?mock): setting the UHT temperature
// below the divert limit diverts within one step, the divert valve's lamp turns red and the reject tank
// fills, the stage 4 panel and the event log say so; then the plant flushes and cleans (amber),
// re-sterilizes (amber) and goes back to production (green), 113 sim minutes later (H36).
//
// On software GL a frame takes a few hundred ms on a busy machine, so nothing here waits on wall-clock
// time: a recorder in the page notes every change of the valve lamp and the panel's mode text on every
// frame, and the checks read what it saw.

const STAGE_4 = STAGES.find((stage) => stage.id === 4);

interface Seen {
  lamp: string;
  mode: string;
  timeS: number;
}

/** Starts noting, on every frame, each change of the valve lamp or of the stage 4 panel's UHT mode (its words, without the time left). */
async function recordModes(page: Page): Promise<() => Promise<Seen[]>> {
  await page.evaluate(() => {
    type Scene = { equipmentState(id: string): Record<string, unknown> | null };
    const seen: { lamp: string; mode: string; timeS: number }[] = [];
    (window as unknown as { divertSeen: typeof seen }).divertSeen = seen;
    const tick = (): void => {
      const scene = (window as unknown as { __scene?: Scene }).__scene;
      const lamp = String(scene?.equipmentState('divert-valve')?.lamp ?? '');
      const words = document.querySelector('#panel [data-state-key="uhtMode"] dd')?.textContent ?? '';
      const mode = words.split('·')[0].trim();
      const timeS = Number(document.querySelector('[data-testid="sim-clock"]')?.getAttribute('data-time-s'));
      const last = seen.at(-1);
      if (!last || last.lamp !== lamp || last.mode !== mode) seen.push({ lamp, mode, timeS });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => (window as unknown as { divertSeen: Seen[] }).divertSeen);
}

/** Sim seconds of the newest log entry whose text matches, from its <time datetime="PT…S">, or NaN. */
async function logTimeS(page: Page, pattern: RegExp): Promise<number> {
  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('#log [data-testid="event-log"] > li')].map((li) => ({
      kind: li.getAttribute('data-kind'),
      text: (li.querySelector('.log-text')?.textContent ?? '').trim(),
      dateTime: li.querySelector('time')?.getAttribute('datetime') ?? '',
    })),
  );
  const entry = entries.find((item) => pattern.test(item.text));
  const match = entry ? /^PT(\d+)S$/.exec(entry.dateTime) : null;
  return match ? Number(match[1]) : Number.NaN;
}

const valveState = (page: Page) => sceneCall(page, 'equipmentState', 'divert-valve');
const rejectFillFrac = async (page: Page): Promise<number> => Number((await sceneCall(page, 'equipmentState', 'reject-tank'))?.fillFrac);
const modeRow = (page: Page) => page.locator('#panel [data-state-key="uhtMode"]');

test('a UHT set point under the divert limit diverts within one step: red lamp, reject tank filling, then clean, sterilize, production', async ({
  page,
}) => {
  // Most of it is 113 sim minutes at ×1,000: 68 frames at the least, each a few hundred ms on software GL.
  test.setTimeout(300_000);
  if (!STAGE_4) throw new Error('stages.json has no stage 4');
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await railButton(page, 4).click();
  await expect(page.getByTestId('panel-title')).toHaveText(STAGE_4.name);

  // In production: the lamp is green, the valve sends the milk forward, the reject tank is empty.
  await expect.poll(() => valveState(page)).toMatchObject({ lamp: 'ok', diverting: false });
  await expect(modeRow(page).locator('dd')).toHaveText('Production');
  expect(await rejectFillFrac(page)).toBe(0);
  const seen = await recordModes(page);

  // 140.0 °C less one Page Down (2 °C) is 138.0 °C: under the 139.22 °C limit at 4 s by more than the ±0.3 °C noise.
  const slider = page.getByTestId('setpoint-uhtSetpointC');
  await slider.focus();
  await page.keyboard.press('PageDown');
  await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText('138.0 °C');

  // The lamp turns red and the valve flips to the reject tank.
  await expect.poll(() => valveState(page), { timeout: 15_000 }).toMatchObject({ lamp: 'bad', diverting: true });
  // ×1 from here, so the 3 min divert lasts at least 3 min of real time while the checks below read it.
  await page.getByTestId('speed-1').click();
  // Within one step: the sim logged the divert no later than one 1 s step (×10) after the set point.
  await expect.poll(() => logTimeS(page, /diverting to the reject tank/)).toBeGreaterThan(0);
  // The sim logs the number as sent: 138, not 138.0.
  const setS = await logTimeS(page, /^UHT set point set to 138 °C$/);
  const divertS = await logTimeS(page, /diverting to the reject tank/);
  expect(divertS - setS, `set point logged at ${setS} s, divert at ${divertS} s`).toBeGreaterThanOrEqual(0);
  expect(divertS - setS).toBeLessThanOrEqual(plantConfig.clock.baseStepS);
  const divertEntry = page.locator('#log [data-testid="event-log"] > li', { hasText: 'diverting to the reject tank' }).first();
  await expect(divertEntry).toHaveAttribute('data-kind', 'bad');
  // 138.0 °C is under the limit, so the set point itself diverts, whatever the noise does (D4, H88).
  await expect(divertEntry.locator('.log-text')).toHaveText(
    /^UHT set point 138\.0 °C gives B\* 0\.\d\d, below 1: diverting to the reject tank$/,
  );

  // The stage 4 panel shows the divert, with a red lamp, and the reject tank fills.
  await expect(modeRow(page).locator('dd')).toHaveText(/^Diverting to reject · .+ left$/);
  await expect(modeRow(page).locator('.lamp')).toHaveAttribute('data-status', 'bad');
  const firstFrac = await rejectFillFrac(page);
  await expect.poll(() => rejectFillFrac(page), { message: 'the reject tank fills' }).toBeGreaterThan(firstFrac);
  expect(firstFrac).toBeGreaterThan(0);

  // Back to 140.0 °C (the divert runs its 3 min regardless), so production stays up once the plant is sterile.
  await slider.focus();
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText('140.0 °C');

  // ×1,000 through the 3 min divert, the 80 min CIP and the 30 min of sterilizing.
  await page.getByTestId('speed-1000').click();
  await expect
    .poll(async () => (await seen()).at(-1), { message: 'back in production with a green lamp', timeout: 240_000, intervals: [1_000] })
    .toMatchObject({ lamp: 'ok', mode: 'Production' });

  const changes = await seen();
  const order = (key: 'lamp' | 'mode') => changes.map((item) => item[key]).filter((value, i, all) => i === 0 || value !== all[i - 1]);
  expect(order('lamp'), JSON.stringify(changes)).toEqual(['ok', 'bad', 'warn', 'ok']);
  expect(order('mode'), JSON.stringify(changes)).toEqual(['Production', 'Diverting to reject', 'Cleaning (CIP)', 'Re-sterilizing', 'Production']);
  // About 113 sim minutes from the divert to production (H36). The clock on screen redraws 4 times a second
  // of real time, up to a few hundred sim seconds behind at ×1,000, so this is a ±10 min band; the unit tests
  // check the exact 6,780 s.
  const backS = changes.at(-1)?.timeS ?? Number.NaN;
  expect(Math.abs(backS - divertS - 6_780), `back in production ${backS - divertS} s after the divert`).toBeLessThan(600);
  // The CIP pumped the reject tank out, and the log has the whole sequence.
  expect(await rejectFillFrac(page)).toBeLessThan(0.001);
  for (const pattern of [/^Full CIP started after the divert/, /^CIP done: sterilizing/, /^UHT plant sterile: back in production$/]) {
    expect(await logTimeS(page, pattern), String(pattern)).toBeGreaterThan(divertS);
  }
});
