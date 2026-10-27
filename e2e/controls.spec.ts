import type { Page } from '@playwright/test';
import { SPEEDS, type PlantConfig, type Sim } from '../src/contracts';
import { createSim } from '../src/sim';
import { createMockSim } from '../src/sim/mock';
import { formatSimTime } from '../src/ui/format';
import { expect, test } from './fixtures';
import {
  afterHudUpdates,
  clockAndNow,
  clockTimeS,
  plantConfig,
  railButton,
  simClock,
  waitForClock,
  waitForClockToMove,
  wholePlantButton,
} from './helpers';

// The top bar drives the sim clock (phase-2 shared spec, gate G1): pause, the five speed presets, next
// event, and a scenario menu that waits for phase 5; Space and the digits 1–5 do the same from the
// keyboard. Every flow runs on the model and on the mock (?mock). The fixtures fail any test that logs
// a console error or warning on the way.

const { defaultSpeed } = plantConfig.clock;

/**
 * The first two queued events after the opening, as the page's own sim has them: the same seeded model
 * (or the mock), run headless here. On the mock they are the shift changes of day 8, 14:00 and 22:00; the
 * model's queue also holds the packs model's breakdowns and trucks (phase 4), so its first is earlier.
 */
function firstEvents(make: (config: PlantConfig) => Sim): [number, number] {
  const sim = make(plantConfig);
  const first = sim.snapshot().nextEventS;
  sim.dispatch({ type: 'pause', paused: true });
  sim.dispatch({ type: 'nextEvent' });
  sim.step(plantConfig.clock.maxFrameS);
  const second = sim.snapshot().nextEventS;
  if (first === null || second === null || sim.snapshot().timeS !== first) throw new Error('the headless sim has no two events to jump to');
  return [first, second];
}
const FIRST_EVENTS: Record<string, [number, number]> = { '/': firstEvents(createSim), '/?mock': firstEvents(createMockSim) };

/** aria-pressed of each speed button, by speed, read in one go ('missing' for a button that isn't there). */
async function speedsPressed(page: Page): Promise<Record<string, string>> {
  return page.evaluate((speeds) => {
    const pressed: Record<string, string> = {};
    for (const speed of speeds) {
      const button = document.querySelector(`#bar [data-testid="speed-${speed}"]`);
      pressed[speed] = button ? (button.getAttribute('aria-pressed') ?? 'none') : 'missing';
    }
    return pressed;
  }, SPEEDS);
}

/** What speedsPressed should read with `speed` pressed: 'true' for it and 'false' for the other four. */
const onlyPressed = (speed: number): Record<string, string> =>
  Object.fromEntries(SPEEDS.map((preset) => [preset, preset === speed ? 'true' : 'false']));

/**
 * Checks that `speed` alone is pressed, and still is after the next HUD updates. The bar shows a click at
 * once and then whatever the snapshot says, so the second look shows the command reached the sim.
 */
async function expectSpeed(page: Page, speed: number, how: string): Promise<void> {
  await expect.poll(() => speedsPressed(page), { message: `${how}: only ×${speed} pressed` }).toEqual(onlyPressed(speed));
  await afterHudUpdates(page);
  expect(await speedsPressed(page), `${how}: ×${speed} still pressed once the sim has answered`).toEqual(onlyPressed(speed));
}

/**
 * Sim seconds per real second over windowMs of real time. The bar refreshes about 4 times a second and a
 * slow software-GL frame can stretch that, so the window is long and the caller compares rates with wide
 * margins rather than expecting the exact preset.
 */
async function measuredRate(page: Page, windowMs: number): Promise<number> {
  const start = await clockAndNow(page);
  // A measuring window, not a wait for a condition: the clock's rate over it is the result.
  await page.waitForTimeout(windowMs);
  const end = await clockAndNow(page);
  return (end.timeS - start.timeS) / ((end.nowMs - start.nowMs) / 1_000);
}

/** Waits until the clock holds still for a moment: the bar has caught up with a pause. */
async function waitForSteadyClock(page: Page): Promise<number> {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const now = await clockTimeS(page);
        const steady = now === last;
        last = now;
        return steady;
      },
      { message: 'the clock stops moving', intervals: [600], timeout: 10_000 },
    )
    .toBe(true);
  return last;
}

/** The clock is frozen: it holds still, and still reads the same after a second and a half. */
async function expectFrozen(page: Page, what: string): Promise<number> {
  const pausedS = await waitForSteadyClock(page);
  // A measuring window: at the default ×10 a running clock would move about 15 s in this time, a few even on software GL.
  await page.waitForTimeout(1_500);
  expect(await clockTimeS(page), `${what}: still frozen 1.5 s later`).toBe(pausedS);
  return pausedS;
}

for (const path of ['/', '/?mock']) {
  test.describe(`the top bar (${path})`, () => {
    test('pause freezes the clock, and pressing it again lets the clock run', async ({ page }) => {
      await page.goto(path);
      const pause = page.getByTestId('pause');
      const firstS = await waitForClock(page);
      await expect(pause).toHaveAttribute('aria-pressed', 'false');
      await waitForClockToMove(page, firstS);

      await pause.click();
      await expect(pause).toHaveAttribute('aria-pressed', 'true');
      const pausedS = await expectFrozen(page, 'paused');
      await expect(pause).toHaveAttribute('aria-pressed', 'true');

      await pause.click();
      await expect(pause).toHaveAttribute('aria-pressed', 'false');
      await waitForClockToMove(page, pausedS);
    });

    test('each speed button presses its speed alone, from the default one on', async ({ page }) => {
      await page.goto(path);
      await waitForClock(page);
      await expectSpeed(page, defaultSpeed, 'at the start');
      for (const speed of [...SPEEDS].reverse()) {
        await page.getByTestId(`speed-${speed}`).click();
        await expectSpeed(page, speed, `speed-${speed} clicked`);
      }
    });

    test('the digit keys 1–5 pick ×1 to ×10,000', async ({ page }) => {
      await page.goto(path);
      await waitForClock(page);
      // From the top down, so every key changes the speed, the default ×10 included.
      for (const [index, speed] of [...SPEEDS.entries()].reverse()) {
        const key = String(index + 1);
        await page.keyboard.press(key);
        await expectSpeed(page, speed, `key ${key}`);
      }
    });

    test('Space pauses and resumes, also after a mouse click, but a button the keyboard focused takes Space', async ({ page }) => {
      await page.goto(path);
      const pause = page.getByTestId('pause');
      await waitForClock(page);

      await page.keyboard.press('Space');
      await expect(pause, 'Space pauses').toHaveAttribute('aria-pressed', 'true');
      const pausedS = await expectFrozen(page, 'paused with Space');
      await page.keyboard.press('Space');
      await expect(pause, 'Space resumes').toHaveAttribute('aria-pressed', 'false');
      await waitForClockToMove(page, pausedS);

      // A mouse click hands focus back to the page, so Space then pauses rather than pressing the button again.
      await pause.click();
      await expect(pause).toHaveAttribute('aria-pressed', 'true');
      await expect(pause, 'the click handed focus back to the page').not.toBeFocused();
      await page.keyboard.press('Space');
      await expect(pause, 'Space after a click on pause resumes').toHaveAttribute('aria-pressed', 'false');
      // Pressing ×100 again would change nothing, so here only the hand-back makes Space pause.
      await page.getByTestId('speed-100').click();
      await page.keyboard.press('Space');
      await expect(pause, 'Space after a click on ×100 pauses').toHaveAttribute('aria-pressed', 'true');

      // A rail stage clicked with the mouse keeps focus, so the arrow keys go on from it, but Space still
      // works the clock rather than selecting the stage again.
      await railButton(page, 2).click();
      await expect(railButton(page, 2)).toHaveAttribute('aria-current', 'true');
      await page.keyboard.press('Space');
      await expect(pause, 'Space after a click on a rail stage resumes').toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('ArrowDown');
      await expect(railButton(page, 3), 'ArrowDown after a click on a rail stage selects the next').toHaveAttribute('aria-current', 'true');
      // Back on stage 2 by keyboard, Space is the button's again: with the selection cleared (Escape), it selects stage 2.
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Escape');
      await expect(railButton(page, 2)).toBeFocused();
      await expect(railButton(page, 2)).not.toHaveAttribute('aria-current');
      await page.keyboard.press('Space');
      await expect(railButton(page, 2), 'Space pressed the rail button the keyboard focused').toHaveAttribute('aria-current', 'true');
      await expect(pause, 'and left the clock running').toHaveAttribute('aria-pressed', 'false');

      // "Whole plant" clicked with the mouse hands focus back to the page, like the top bar.
      await wholePlantButton(page).click();
      await expect(railButton(page, 2)).not.toHaveAttribute('aria-current');
      await page.keyboard.press('Space');
      await expect(pause, 'Space after a click on Whole plant pauses').toHaveAttribute('aria-pressed', 'true');

      // With focus on a button (here a rail button, from the keyboard), Space presses that button and leaves the clock alone.
      await railButton(page, 2).focus();
      await page.keyboard.press('Space');
      await expect(railButton(page, 2), 'Space pressed the focused rail button').toHaveAttribute('aria-current', 'true');
      await expect(pause, 'and did not resume').toHaveAttribute('aria-pressed', 'true');
    });

    test('the clock runs far faster at ×1,000 than at ×1', async ({ page }) => {
      await page.goto(path);
      await waitForClock(page);
      // expectSpeed waits until the sim has answered the click, so each window measures its own speed alone.
      await page.getByTestId('speed-1').click();
      await expectSpeed(page, 1, 'speed-1 clicked');
      const slowRate = await measuredRate(page, 4_000);
      await page.getByTestId('speed-1000').click();
      await expectSpeed(page, 1_000, 'speed-1000 clicked');
      const fastRate = await measuredRate(page, 4_000);
      // Nominal 1 and 1,000. Frames over 0.1 s are clamped (plant.json maxFrameS), which slows both alike;
      // at one frame a second ×1,000 still makes 100 sim s per real second.
      expect(slowRate, 'sim s per real s at ×1').toBeLessThanOrEqual(3);
      expect(fastRate, 'sim s per real s at ×1,000').toBeGreaterThanOrEqual(50);
      expect(fastRate, `×1,000 (${fastRate.toFixed(1)}/s) against ×1 (${slowRate.toFixed(2)}/s)`).toBeGreaterThan(20 * Math.max(slowRate, 0.25));
    });

    test('next event jumps to the first queued event from the start, and on to the next one', async ({ page }) => {
      const [FIRST_EVENT_S, SECOND_EVENT_S] = FIRST_EVENTS[path];
      if (path === '/?mock') expect([FIRST_EVENT_S, SECOND_EVENT_S], 'the mock queues the shift changes of day 8, 14:00 and 22:00').toEqual([655_200, 684_000]);
      await page.goto(path);
      const startS = await waitForClock(page);
      expect(startS, 'the plant opens before the first event').toBeLessThan(FIRST_EVENT_S);
      // Paused, so the clock shows the event time itself rather than a moment after it.
      await page.getByTestId('pause').click();
      await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');

      await expect(page.getByTestId('next-event')).toHaveAttribute('title', `Jump the clock to the next event, ${formatSimTime(FIRST_EVENT_S)}`);
      await page.getByTestId('next-event').click();
      await expect(simClock(page)).toHaveAttribute('data-time-s', String(Math.floor(FIRST_EVENT_S)));
      await expect(simClock(page)).toContainText(formatSimTime(FIRST_EVENT_S));
      await expect(page.getByTestId('pause'), 'a jump leaves the clock paused').toHaveAttribute('aria-pressed', 'true');

      // Running, a jump lands on the next event and the clock runs on from there.
      await page.getByTestId('pause').click();
      await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
      await page.getByTestId('next-event').click();
      await expect.poll(() => clockTimeS(page), { message: `the clock jumped to the next event, ${formatSimTime(SECOND_EVENT_S)}` }).toBeGreaterThanOrEqual(SECOND_EVENT_S);
      // At ×10 the clock runs on about 10 s per real second after the jump; 10 min is ample for a slow runner.
      expect(await clockTimeS(page)).toBeLessThan(SECOND_EVENT_S + 600);
      await expect(page.getByTestId('pause'), 'a jump leaves the clock running').toHaveAttribute('aria-pressed', 'false');
    });

    test('the scenario menu opens from the top bar and Escape closes it, giving focus back; on the mock every fault is unavailable', async ({ page }) => {
      await page.goto(path);
      await waitForClock(page);
      const menu = page.getByTestId('scenario-menu');
      const faults = page.locator('#scenario-menu-list [role="menuitem"][data-scenario]');
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(faults).toHaveCount(7);
      // The live model can start every fault as it opens; the mock snapshot plays none (e2e/scenarios.spec.ts).
      const disabled = await faults.evaluateAll((items) => items.map((item) => item.getAttribute('aria-disabled') === 'true'));
      expect(disabled).toEqual(Array(7).fill(path === '/?mock'));
      await page.keyboard.press('Escape');
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(faults.first()).toBeHidden();
      await expect(menu).toBeFocused();
    });
  });
}
