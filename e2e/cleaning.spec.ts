import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectLanded, sceneCall, waitForClock, waitForScene } from './helpers';

// Phase 7 in the browser, on the live sim: after the UHT temperature drop the full CIP walks its six steps
// (H112). The UHT circuit's pipes take each fluid's colour, the CIP station lights the lamp of the fluid
// it pumps, the stage 4 panel names the step and the legend shows the fluids, the one circulating marked;
// then the plant re-sterilizes and all of it goes back to milk. The step times are the unit tests'
// (tests/sim/cleaning.test.ts); here only the order of what shows on screen.
//
// As in divert.spec.ts, nothing waits on wall-clock time: a recorder in the page notes, on every frame,
// each change of what the pipes carry, the lit lamp, the panel's step and the legend.

interface Seen {
  pipes: string | null;
  lamp: string;
  step: string;
  legend: string | null;
}

/** Starts noting each change of the pipes' fluid, the station's lamp, the panel's cleaning step (its name alone) and the legend's marked fluid. */
async function recordCleaning(page: Page): Promise<() => Promise<Seen[]>> {
  await page.evaluate(() => {
    type Scene = { pipeState(): { cleaning: string | null }; equipmentState(id: string): Record<string, unknown> | null };
    const seen: Seen[] = [];
    (window as unknown as { cleaningSeen: Seen[] }).cleaningSeen = seen;
    const tick = (): void => {
      const scene = (window as unknown as { __scene?: Scene }).__scene;
      const words = document.querySelector('#panel [data-state-key="cleaning"] dd')?.textContent ?? '';
      const group = document.querySelector<HTMLElement>('[data-testid="legend-cleaning"]');
      const now: Seen = {
        pipes: scene?.pipeState().cleaning ?? null,
        lamp: String(scene?.equipmentState('cip-station')?.lit ?? ''),
        step: words.split(/[,·]/)[0].trim(),
        legend: group && !group.hidden ? (group.querySelector<HTMLElement>('.legend-fluid.active')?.dataset.fluid ?? '') : null,
      };
      const last = seen.at(-1);
      if (!last || (Object.keys(now) as (keyof Seen)[]).some((key) => last[key] !== now[key])) seen.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => (window as unknown as { cleaningSeen: Seen[] }).cleaningSeen);
}

/** The values one key took, each run of equal values once. */
const runs = <K extends keyof Seen>(seen: readonly Seen[], key: K): Seen[K][] =>
  seen.map((each) => each[key]).filter((value, i, all) => i === 0 || value !== all[i - 1]);

test('the CIP after a UHT temperature drop: the pipes, the CIP station, the panel and the legend follow each step, then milk again', async ({ page }) => {
  // The 3 min divert, the 80 min CIP and the 30 min of sterilizing at ×100: about 70 s of real time.
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);

  expect(await sceneCall(page, 'equipmentIds')).toContain('cip-station');
  expect(await sceneCall(page, 'equipmentState', 'cip-station')).toEqual({ lit: 'none' });
  expect((await sceneCall(page, 'pipeState')).cleaning).toBeNull();
  await expect(page.getByTestId('legend-cleaning')).toBeHidden();
  const seen = await recordCleaning(page);

  await page.getByTestId('scenario-menu').click();
  await page.locator('#scenario-menu-list [data-scenario="uhtTempDrop"]').click();
  await expectLanded(page, 4);
  const stepRow = page.locator('#panel [data-state-key="cleaning"]');
  await expect(stepRow.locator('dd')).toHaveText('None');

  // ×100: every step (5 min at the shortest) lasts several frames even on software GL.
  await page.getByTestId('speed-100').click();
  await expect(stepRow.locator('dd'), 'the lye step, with its temperature and place in the programme').toHaveText(
    /^Lye \(NaOH\), 75 °C · 2 of 6 · .+ left$/,
    { timeout: 60_000 },
  );
  await expect(stepRow.locator('.lamp')).toHaveAttribute('data-status', 'warn');
  await expect(page.locator('.overlay-legend')).toHaveAttribute('aria-label', /Cleaning, lye now/);

  await expect
    .poll(async () => runs(await seen(), 'pipes'), { message: 'back to milk after the acid and the last rinses', timeout: 180_000, intervals: [1_000] })
    .toEqual([null, 'water', 'lye', 'water', 'acid', 'water', null]);
  await expect(page.locator('#panel [data-state-key="uhtMode"] dd')).toHaveText(/^Re-sterilizing/);

  const changes = await seen();
  const detail = JSON.stringify(changes);
  // Before the view lands on stage 4 the panel has no step row.
  expect(runs(changes.filter((each) => each.step !== ''), 'step'), detail).toEqual(['None', 'Pre-rinse', 'Lye (NaOH)', 'Rinse', 'Acid (HNO₃)', 'Post-rinse', 'Gradual cooling', 'None']);
  expect(runs(changes, 'lamp'), detail).toEqual(['none', 'water', 'lye', 'water', 'acid', 'water', 'none']);
  expect(runs(changes, 'legend'), detail).toEqual([null, 'water', 'lye', 'water', 'acid', 'water', null]);
  // The station's lamp and the pipes draw from the same snapshot, so they agree on every frame (the HUD's
  // panel and legend redraw 4 times a second, so they may trail by a frame).
  for (const each of changes) expect(each.lamp, detail).toBe(each.pipes ?? 'none');
  await expect(page.getByTestId('legend-cleaning')).toBeHidden();
  await expect(page.locator('.overlay-legend')).not.toHaveAttribute('aria-label', /Cleaning/);
});
