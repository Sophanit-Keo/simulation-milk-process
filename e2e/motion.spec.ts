import type { Page } from '@playwright/test';
import { rackSlots } from '../src/scene/equipment/packs/layout';
import { expect, test } from './fixtures';
import { afterHudUpdates, clockTimeS, expectLanded, railButton, waitForClock, waitForClockToMove, waitForScene } from './helpers';

// Phase 12 in the browser (D22): the end of the line moves as the real machines do, read from the scene's
// ?debug state (the phase-12 card, "Debug state"). The palletizer picks a tray and stacks it; the stretch
// wrapper winds film round each pallet, one on the turntable at a time; forklift-1 puts released stock away;
// a truck drives in, opens its doors, backs in and docks, with its roller door up and its lamp red, while
// forklift-2 fetches a pallet, then the truck leaves and the forklift parks; and paused, all of it holds still.
// The fixtures fail any test that logs a console error or warning or has a request fail on the way.
//
// Software GL draws a few frames a second here, and main.ts counts no frame as longer than plant.json's
// maxFrameS (0.1 s), so the motion runs slower than real time: each test records every frame's state in the
// page (a missed frame would hide a short step) and picks a speed that gets through its moves quickly. Every
// move plays in full at every speed except the trucks' (which play faster or skip to fit the sim's time).

type DebugState = Readonly<Record<string, number | string | boolean>>;

/** One frame's states of the machines a test watches. */
interface Sample {
  nowMs: number;
  states: Readonly<Record<string, DebugState | null>>;
}

interface Recording {
  /** Every frame's sample so far, in order. */
  readonly samples: Sample[];
  /** Fetches the frames recorded in the page since the last call. */
  update(): Promise<void>;
}

/** Recordings running in the page, each under its own key (window.motionRecords), so several can run at once. */
type RecordStore = Record<number, { samples: unknown[]; stopped: boolean }>;

/** Starts recording `ids`' debug states on every frame, from inside the page, until `stop()`. */
async function record(page: Page, ids: readonly string[]): Promise<Recording & { stop(): Promise<void> }> {
  const key = await page.evaluate((list) => {
    const holder = window as unknown as { motionRecords?: RecordStore; motionRecordKeys?: number };
    const records = (holder.motionRecords ??= {});
    const id = (holder.motionRecordKeys = (holder.motionRecordKeys ?? 0) + 1);
    const store = { samples: [] as unknown[], stopped: false };
    records[id] = store;
    const tick = (nowMs: number): void => {
      if (store.stopped) return;
      const scene = window.__scene;
      if (scene) {
        const states: Record<string, unknown> = {};
        for (const each of list) states[each] = scene.equipmentState(each);
        store.samples.push({ nowMs, states });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return id;
  }, ids);
  const samples: Sample[] = [];
  const fetch = (stop: boolean): Promise<Sample[]> =>
    page.evaluate(
      ([id, stopNow]) => {
        const store = (window as unknown as { motionRecords: RecordStore }).motionRecords[id];
        if (!store) throw new Error(`no recording ${id}`);
        const out = store.samples;
        store.samples = [];
        if (stopNow) store.stopped = true;
        return out;
      },
      [key, stop] as const,
    ) as Promise<Sample[]>;
  return {
    samples,
    async update() {
      samples.push(...(await fetch(false)));
    },
    async stop() {
      samples.push(...(await fetch(true)));
    },
  };
}

/** Waits until `done` holds for the frames recorded so far. */
async function waitFor(recording: Recording, what: string, done: (samples: readonly Sample[]) => boolean, timeoutMs: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await recording.update();
        return done(recording.samples);
      },
      { message: what, timeout: timeoutMs, intervals: [250] },
    )
    .toBe(true);
}

/** A machine's state in a sample; a test fails if the machine reports none. */
function state(sample: Sample, id: string): DebugState {
  const found = sample.states[id];
  if (!found) throw new Error(`${id} reports no debug state`);
  return found;
}

const num = (sample: Sample, id: string, key: string): number => Number(state(sample, id)[key]);
const text = (sample: Sample, id: string, key: string): string => String(state(sample, id)[key]);
/** The first door's entry of a comma-separated per-door key (truck phases, loaded; dock lamps). */
const door1 = (sample: Sample, id: string, key: string): string => text(sample, id, key).split(',')[0] ?? '';

/** A sequence with its repeats run together: the steps a machine went through, in order. */
function steps<T>(values: readonly T[]): T[] {
  const out: T[] = [];
  for (const value of values) if (out.at(-1) !== value) out.push(value);
  return out;
}

/** Where `wanted` first stands as a run of consecutive entries in `sequence`, or -1. */
function runIndex<T>(sequence: readonly T[], wanted: readonly T[]): number {
  for (let i = 0; i + wanted.length <= sequence.length; i++) if (wanted.every((value, k) => sequence[i + k] === value)) return i;
  return -1;
}

const containsRun = <T>(sequence: readonly T[], wanted: readonly T[]): boolean => runIndex(sequence, wanted) >= 0;

/** The index of the sample where each step of `values` begins. */
function stepStarts<T>(values: readonly T[]): number[] {
  const out: number[] = [];
  values.forEach((value, i) => {
    if (i === 0 || values[i - 1] !== value) out.push(i);
  });
  return out;
}

/** The smallest turn from one heading to another, in radians. */
function turnBetween(fromRad: number, toRad: number): number {
  const d = (((toRad - fromRad) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(d);
}

async function setSpeed(page: Page, speed: number): Promise<void> {
  await page.getByTestId(`speed-${speed}`).click();
  await expect(page.getByTestId(`speed-${speed}`)).toHaveAttribute('aria-pressed', 'true');
}

async function setPaused(page: Page, paused: boolean): Promise<void> {
  const button = page.getByTestId('pause');
  if ((await button.getAttribute('aria-pressed')) !== String(paused)) await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(paused));
}

/** Jumps the paused clock to the next event with the Next event button; returns the clock after the jump. */
async function jumpToNextEvent(page: Page): Promise<number> {
  const fromS = await clockTimeS(page);
  await page.getByTestId('next-event').click();
  return waitForClockToMove(page, fromS);
}

/** Opens the live plant with ?debug and flies to `stage` (its camera draws fewer parts than the overview, so frames come faster). */
async function openStage(page: Page, stage: number): Promise<void> {
  await page.goto('/?debug');
  await waitForScene(page);
  await waitForClock(page);
  await railButton(page, stage).click();
  await expectLanded(page, stage);
}

/**
 * Paused, the plant holds still: once the pause has taken effect, the states of `ids` stay what they were over a
 * second of frames. Then it resumes, and `moving` (id and key) moves on again, so the check was made on parts that move.
 */
async function expectHeldWhilePaused(page: Page, ids: readonly string[], moving: readonly [id: string, key: string][]): Promise<void> {
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
  await afterHudUpdates(page);
  const clockS = await clockTimeS(page);
  const held = await record(page, ids);
  await page.waitForTimeout(1_000);
  await held.stop();
  expect(held.samples.length, 'frames drawn over a second while paused').toBeGreaterThanOrEqual(2);
  const [first] = held.samples;
  if (!first) throw new Error('no frame recorded while paused');
  for (const [index, sample] of held.samples.entries()) {
    expect(sample.states, `frame ${index} of a second paused shows what the first did`).toEqual(first.states);
  }
  expect(await clockTimeS(page), 'the sim clock while paused').toBe(clockS);

  await setPaused(page, false);
  const resumed = await record(page, ids);
  await waitFor(
    resumed,
    `${moving.map(([id, key]) => `${id}.${key}`).join(', ')} move on once resumed`,
    (samples) => samples.some((sample) => moving.every(([id, key]) => sample.states[id]?.[key] !== first.states[id]?.[key])),
    20_000,
  );
  await resumed.stop();
}

/** Nothing jumps from one frame to the next: a forklift's heading turns smoothly (no flips) and it never leaps across the floor. */
function expectSmoothForklift(samples: readonly Sample[], id: string): void {
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1] as Sample;
    const now = samples[i] as Sample;
    // At most 0.3 motion s a frame (0.1 s × motionRate 3): 0.15 rad turning, 0.66 m driving.
    const turnRad = turnBetween(num(before, id, 'headingRad'), num(now, id, 'headingRad'));
    expect(turnRad, `${id} turns ${turnRad.toFixed(3)} rad in one frame (${i})`).toBeLessThan(0.5);
    const stepM = Math.hypot(num(now, id, 'xM') - num(before, id, 'xM'), num(now, id, 'zM') - num(before, id, 'zM'));
    expect(stepM, `${id} moves ${stepM.toFixed(3)} m in one frame (${i})`).toBeLessThan(1.0);
  }
}

/** Forklift jobs in which it may have a pallet on its forks: from the grab in the pick to the drop. */
const CARRYING_JOBS = new Set(['pick', 'toDrop', 'drop']);

/** Checks a forklift carried a pallet only between pick and drop, lifted off the floor, and kept its beacon dark while parked. */
function expectForkliftCarried(samples: readonly Sample[], id: string): void {
  const carried = samples.filter((sample) => state(sample, id).carrying === true);
  expect(carried.length, `${id} carries a pallet`).toBeGreaterThan(0);
  expect(carried.some((sample) => num(sample, id, 'liftM') > 0), `${id} lifts the pallet it carries`).toBe(true);
  for (const sample of carried) expect(CARRYING_JOBS.has(text(sample, id, 'job')), `${id} carries in job ${text(sample, id, 'job')}`).toBe(true);
  for (const sample of samples.filter((each) => text(each, id, 'job') === 'parked')) {
    expect(state(sample, id).beacon, `${id}'s beacon while parked`).toBe(false);
    expect(state(sample, id).carrying, `${id} carries nothing while parked`).toBe(false);
  }
  expect(samples.some((sample) => state(sample, id).beacon === true), `${id}'s beacon shines while it works`).toBe(true);
  for (const sample of samples) expect(num(sample, id, 'liftM'), `${id}'s forks`).toBeGreaterThanOrEqual(0);
  expectSmoothForklift(samples, id);
}

/** Trays on a full pallet (plant.json's traysPerPallet, 7 layers of 12). */
const TRAYS_PER_PALLET = 84;

/**
 * The stack on the palletizer is the sim's own count (the fuller lane's, stackFrac × 84), and for a moment one more
 * when the arm sets a tray down before the sim counts it (phase-12 card): never more, so a pallet that closes leaves a
 * fresh, empty pallet under the place point.
 */
function expectStackIsTheSims(samples: readonly Sample[]): void {
  for (const [i, sample] of samples.entries()) {
    const simTrays = Math.round(num(sample, 'palletizer', 'stackFrac') * TRAYS_PER_PALLET);
    const shown = num(sample, 'palletizer', 'traysShown');
    expect(shown, `trays shown on the pallet in frame ${i}, with the sim at ${simTrays}`).toBeLessThanOrEqual(simTrays + 1);
    expect(shown, `trays shown on the pallet in frame ${i}`).toBeGreaterThanOrEqual(simTrays);
  }
}

/** The arm's steps (phase-12 card): idle parks over the pick point; it picks again from there. */
const ARM_NEXT: Readonly<Record<string, readonly string[]>> = {
  idle: ['pick'],
  toPick: ['pick', 'idle'],
  pick: ['toPlace', 'idle'],
  toPlace: ['place'],
  place: ['toPick'],
};

test.describe('stage 8', () => {
  test('the palletizer picks a tray off the belt, carries it over and sets it on its place in the stack', async ({ page, pageProblems }) => {
    await openStage(page, 8);
    // ×10 (the plant's opening speed): one pick and place in about 6.2 motion s, 4 s of frame time.
    await setSpeed(page, 10);
    const run = await record(page, ['palletizer']);
    // A whole cycle, seen from its start: from the swing back to the belt through the next swing back.
    const CYCLE = ['toPick', 'pick', 'toPlace', 'place', 'toPick'];
    await waitFor(
      run,
      'the arm goes through toPick, pick, toPlace, place and back to toPick',
      (samples) => containsRun(steps(samples.map((sample) => text(sample, 'palletizer', 'phase'))), CYCLE),
      60_000,
    );
    const { samples } = run;
    const phases = samples.map((sample) => text(sample, 'palletizer', 'phase'));

    // In order, one step after another.
    const order = steps(phases);
    for (let i = 1; i < order.length; i++) {
      expect(ARM_NEXT[order[i - 1] as string], `the arm goes from ${order[i - 1]} to ${order[i]}`).toContain(order[i]);
    }
    for (const sample of samples) {
      const arm = state(sample, 'palletizer');
      const phase = String(arm.phase);
      // The arm swings with the gripper up; the tray rides in the closed clamps all the way to the pallet.
      if (phase === 'toPlace') {
        expect(arm, 'swinging to the pallet: a tray in the closed clamps, gripper up').toMatchObject({ carrying: true, liftM: 0 });
        expect(Number(arm.clampM), 'the clamps close on the tray').toBeGreaterThan(0);
        expect(Number(arm.targetSlot), 'the tray has a place on the pallet').toBeGreaterThanOrEqual(0);
      }
      if (phase === 'toPick' || phase === 'idle') {
        expect(arm, 'swinging back to the belt: empty, clamps open, gripper up').toMatchObject({ carrying: false, liftM: 0, clampM: 0, targetSlot: -1 });
      }
      // (To rounding: the clamps' last step open leaves a few 1e-17 m.)
      if (arm.carrying !== true) expect(Number(arm.clampM), 'the clamps close only with a tray in the gripper').toBeLessThan(1e-9);
      expect(Number(arm.layers), 'layers of 12').toBe(Math.ceil(Number(arm.traysShown) / 12));
    }
    expectStackIsTheSims(samples);
    // The gripper drops to the belt and to the stack.
    for (const phase of ['pick', 'place']) {
      const lifts = samples.filter((sample) => text(sample, 'palletizer', 'phase') === phase).map((sample) => num(sample, 'palletizer', 'liftM'));
      expect(Math.max(...lifts), `the gripper goes down in ${phase}`).toBeGreaterThan(0.1);
    }
    // The pick closes the clamps on a tray: empty as it comes down, carrying as it goes up, until the place opens them.
    const starts = stepStarts(phases);
    const at = runIndex(steps(phases), CYCLE);
    const pickStart = starts[at + 1] as number;
    const placeEnd = starts[at + 4] as number;
    const cycle = samples.slice(pickStart, placeEnd);
    const carrying = cycle.map((sample) => state(sample, 'palletizer').carrying === true);
    expect(steps(carrying), 'carrying from the pick to the place, and only then').toEqual([false, true, false]);
    // The tray set down joins the stack: its place is filled once the clamps open.
    const lastCarried = cycle.filter((sample) => state(sample, 'palletizer').carrying === true).at(-1);
    if (!lastCarried) throw new Error('unreachable: the cycle carried');
    const target = num(lastCarried, 'palletizer', 'targetSlot');
    const afterPlace = samples[placeEnd] as Sample;
    expect(num(afterPlace, 'palletizer', 'traysShown'), `trays on the pallet once tray ${target} is set down`).toBeGreaterThanOrEqual(target + 1);
    // And the stack grows with the sim's trays (a tray every 2.9 sim s), but for a pallet that closes and rides off.
    const trays = steps(samples.map((sample) => num(sample, 'palletizer', 'traysShown')));
    const rises = trays.filter((count, i) => i > 0 && count > (trays[i - 1] as number)).length;
    expect(rises, `traysShown rises: ${trays.join(' ')}`).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < trays.length; i++) {
      if ((trays[i] as number) < (trays[i - 1] as number)) expect(trays[i], 'a fresh pallet after one closes').toBeLessThan(12);
    }
    expect(pageProblems).toEqual([]);
  });

  test('the stretch wrapper winds film round each pallet from 0 to 1, one pallet on the turntable at a time; paused, stage 8 holds still', async ({ page, pageProblems }) => {
    await openStage(page, 8);
    // ×1,000: a pallet closes every few frames, far faster than the 21 motion s wrap (84 frames at motionRate 2.5),
    // so pallets queue before the wrapper, as many as the rollers hold.
    await setSpeed(page, 1_000);
    const ids = ['stretch-wrapper', 'pallet-conveyor', 'palletizer'];
    const run = await record(page, ids);
    /** Runs of frames with a pallet on the turntable being wrapped, each closed by a frame without. */
    const wraps = (samples: readonly Sample[]): Sample[][] => {
      const found: Sample[][] = [];
      let current: Sample[] | null = null;
      for (const sample of samples) {
        if (state(sample, 'stretch-wrapper').wrapping === true) (current ??= []).push(sample);
        else if (current) {
          found.push(current);
          current = null;
        }
      }
      return found;
    };
    /** A wrap seen from its start: its first frame's film just begun. */
    const whole = (samples: readonly Sample[]): Sample[][] => wraps(samples).filter((wrap) => num(wrap[0] as Sample, 'stretch-wrapper', 'filmFrac') < 0.1);
    await waitFor(
      run,
      'a whole wrap, and a pallet waiting before the wrapper',
      (samples) => whole(samples).length >= 1 && samples.some((sample) => num(sample, 'pallet-conveyor', 'queued') >= 1),
      90_000,
    );
    const { samples } = run;

    for (const [i, sample] of samples.entries()) {
      expect(num(sample, 'pallet-conveyor', 'onTurntable'), 'pallets on the turntable').toBeLessThanOrEqual(1);
      expect(state(sample, 'pallet-conveyor').wrapping, 'the conveyor and the wrapper agree on a wrap').toBe(state(sample, 'stretch-wrapper').wrapping);
      const wrapper = state(sample, 'stretch-wrapper');
      // With no pallet on the turntable it stands at rest with no film; but in the frame a wrap ends, the wrapper
      // (posed before the pallets move, where the pallet's clock will stand) still shows the cut.
      const justWrapped = i > 0 && state(samples[i - 1] as Sample, 'stretch-wrapper').wrapping === true && wrapper.phase === 'cut';
      if (wrapper.wrapping !== true && !justWrapped) {
        expect(wrapper, 'no pallet on the turntable: at rest, no film').toMatchObject({ phase: 'idle', filmFrac: 0, carriageM: 0, turnRad: 0 });
      }
    }
    for (const wrap of whole(samples)) {
      const film = wrap.map((sample) => num(sample, 'stretch-wrapper', 'filmFrac'));
      for (let i = 1; i < film.length; i++) expect(film[i], 'the film only rises during a wrap').toBeGreaterThanOrEqual((film[i - 1] as number) - 1e-9);
      expect(film.at(-1), 'the film is whole by the end of the wrap').toBeCloseTo(1, 6);
      // The wrapper is posed before the pallets move in a frame, so it shows the pallet's arrival a frame late: idle in the wrap's first frame.
      const wrapSteps = steps(wrap.map((sample) => text(sample, 'stretch-wrapper', 'phase')));
      expect(wrapSteps.slice(wrapSteps[0] === 'idle' ? 1 : 0), 'base wraps, up, top wraps, down, cut').toEqual(['base', 'up', 'top', 'down', 'cut']);
      const carriage = wrap.map((sample) => num(sample, 'stretch-wrapper', 'carriageM'));
      expect(Math.max(...carriage), 'the carriage climbs to the top wraps, 0.88 m').toBeCloseTo(0.88, 2);
      expect(carriage.at(-1), 'and comes down again').toBe(0);
      expect(new Set(wrap.map((sample) => num(sample, 'stretch-wrapper', 'turnRad'))).size, 'the turntable turns').toBeGreaterThan(wrap.length / 2);
    }

    await test.step('paused mid-wrap, with the arm swinging, stage 8 holds still', async () => {
      // Pause in the frame that shows it, from inside the page.
      await page.waitForFunction(
        () => {
          const scene = window.__scene;
          const wrapper = scene?.equipmentState('stretch-wrapper');
          const arm = scene?.equipmentState('palletizer');
          if (!(wrapper?.wrapping === true && (wrapper.phase === 'up' || wrapper.phase === 'top') && (arm?.phase === 'toPick' || arm?.phase === 'toPlace'))) return false;
          document.querySelector<HTMLButtonElement>('[data-testid="pause"]')?.click();
          return true;
        },
        undefined,
        { polling: 'raf', timeout: 60_000 },
      );
      await expectHeldWhilePaused(page, ids, [
        ['stretch-wrapper', 'turnRad'],
        ['palletizer', 'armRad'],
      ]);
    });
    // Pallets close every few frames at ×1,000, often while the arm sets a tray down: the stack still shows the sim's trays.
    expectStackIsTheSims(samples);
    expect(pageProblems).toEqual([]);
  });
});

/**
 * The warehouse's moves take a minute or two of frames on software GL (a frame is about 0.25 s here and plays at
 * most 0.3 motion s): the stage 10 tests get more than the config's two minutes, as the five-stage walks do.
 */
const STAGE_10_TIMEOUT_MS = 180_000;

test.describe('stage 10', () => {
  test('forklift-1 puts released stock away: it picks a pallet at the quarantine, lifts it and carries it to the racks; paused, it holds still', async ({ page, pageProblems }) => {
    test.setTimeout(STAGE_10_TIMEOUT_MS);
    await openStage(page, 10);
    const ids = ['forklift-1', 'forklift-2', 'racks', 'truck', 'docks', 'palletizer', 'stretch-wrapper'];
    const run = await record(page, ids);
    // The first release is batch 12's, on day 8 at 14:00 (H50): the stock rises and forklift-1 has pallets to put away.
    // ×10,000 to about 12:40 (a frame is up to 1,000 sim s), paused from inside the page, then event by event to it.
    const releaseS = 7 * 86_400 + 14 * 3_600;
    await setSpeed(page, 10_000);
    await page.waitForFunction(
      (untilS) => {
        const nowS = Number(document.querySelector('[data-testid="sim-clock"]')?.getAttribute('data-time-s'));
        if (!(nowS >= untilS)) return false;
        document.querySelector<HTMLButtonElement>('[data-testid="pause"]')?.click();
        return true;
      },
      releaseS - 80 * 60,
      { polling: 'raf', timeout: 60_000 },
    );
    await setPaused(page, true);
    /** Frames recorded before the jump that reached the release. */
    let beforeRelease = run.samples.length;
    for (let jump = 0; (await clockTimeS(page)) < releaseS; jump++) {
      if (jump >= 10) throw new Error(`10 jumps did not reach the first release at ${releaseS} s`);
      await run.update();
      beforeRelease = run.samples.length;
      await jumpToNextEvent(page);
    }
    await run.update();
    expect(
      run.samples.slice(0, beforeRelease).every((sample) => text(sample, 'forklift-1', 'job') === 'parked'),
      'forklift-1 stays parked until the release',
    ).toBe(true);
    // On at ×10,000: the trip plays at motionRate 3.
    await setPaused(page, false);
    await waitFor(
      run,
      'forklift-1 picks a pallet, lifts it and drives off with it',
      (samples) => samples.some((sample) => text(sample, 'forklift-1', 'job') === 'toDrop' && state(sample, 'forklift-1').carrying === true && num(sample, 'forklift-1', 'liftM') > 0),
      60_000,
    );
    await test.step('paused while forklift-1 drives with its pallet, the plant holds still', async () => {
      await page.waitForFunction(
        () => {
          const forklift = window.__scene?.equipmentState('forklift-1');
          if (!(forklift?.job === 'toDrop' && forklift.carrying === true)) return false;
          document.querySelector<HTMLButtonElement>('[data-testid="pause"]')?.click();
          return true;
        },
        undefined,
        { polling: 'raf', timeout: 30_000 },
      );
      await expectHeldWhilePaused(page, ids, [['palletizer', 'armRad']]);
    });
    await waitFor(
      run,
      'forklift-1 sets the pallet down in the racks',
      (samples) => containsRun(steps(samples.map((sample) => text(sample, 'forklift-1', 'job'))), ['pick', 'toDrop', 'drop']) &&
        state(samples.at(-1) as Sample, 'forklift-1').carrying === false,
      90_000,
    );
    const { samples } = run;
    expect(steps(samples.map((sample) => text(sample, 'forklift-1', 'job'))).slice(0, 4), 'parked, then pick, carry and drop').toEqual(['parked', 'pick', 'toDrop', 'drop']);
    const released = samples.slice(beforeRelease);
    expectForkliftCarried(released, 'forklift-1');
    // Into the racks at its place's level (the floor, or a beam at 1.61 or 3.21 m): the pallet is set down there.
    const drop = released.filter((sample) => text(sample, 'forklift-1', 'job') === 'drop');
    const setDown = drop.find((sample) => state(sample, 'forklift-1').carrying === false);
    if (!setDown) throw new Error('forklift-1 never set its pallet down in the drop');
    const place = rackSlots()[num(setDown, 'forklift-1', 'place')];
    if (!place) throw new Error(`forklift-1 dropped at no rack place (${text(setDown, 'forklift-1', 'place')})`);
    expect(num(setDown, 'forklift-1', 'liftM'), `the forks as the pallet is set down on its place, ${place.yM.toFixed(2)} m up`).toBeGreaterThanOrEqual(place.yM - 0.02);
    expect(num(setDown, 'forklift-1', 'liftM')).toBeLessThanOrEqual(place.yM + 0.07);

    // Phase 14 (D24): the mast tilts back 8° for the trip with the pallet and stands level to set it down; the rear
    // wheels steer; the blue spot leads while it drives, and is off while it stands to set down; the label says so.
    const deg = Math.PI / 180;
    for (const sample of released) {
      expect(num(sample, 'forklift-1', 'tiltRad')).toBeGreaterThanOrEqual(-8 * deg - 1e-9);
      expect(num(sample, 'forklift-1', 'tiltRad')).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(num(sample, 'forklift-1', 'steerRad'))).toBeLessThanOrEqual(85 * deg + 1e-9);
    }
    const tiltedBack = released.filter((sample) => text(sample, 'forklift-1', 'job') === 'toDrop' && state(sample, 'forklift-1').carrying === true && num(sample, 'forklift-1', 'tiltRad') <= -7 * deg);
    expect(tiltedBack.length, 'tilted back on the trip with the pallet').toBeGreaterThan(0);
    expect(num(setDown, 'forklift-1', 'tiltRad'), 'level as it sets the pallet down').toBe(0);
    expect(Math.max(...released.map((sample) => Math.abs(num(sample, 'forklift-1', 'steerRad')))), 'the rear wheels turn nearly crosswise in its turns').toBeGreaterThan(1);
    expect(released.some((sample) => state(sample, 'forklift-1').blueSpot === true), 'a blue spot while it drives').toBe(true);
    expect(state(setDown, 'forklift-1').blueSpot, 'no blue spot while it stands to set down').toBe(false);
    await expect(page.locator('.equipment-label[data-equipment="forklift-1"] .equipment-value')).toHaveText(/^(parked|to the pallet|picking up|to the racks|putting away|back to its spot)( · forks \d+\.\d m)?$/);
    expect(pageProblems).toEqual([]);
  });

  test('a truck drives in, opens its doors, backs in articulated and docks, roller door up and lamp red; forklift-2 fetches a pallet; the truck leaves and the forklift parks', async ({ page, pageProblems }) => {
    test.setTimeout(STAGE_10_TIMEOUT_MS);
    await openStage(page, 10);
    const ids = ['truck', 'docks', 'forklift-2'];
    await setPaused(page, true);
    const run = await record(page, ids);
    // The first truck comes at 07:40 on day 8 (D3), to door 1: the next event from the opening.
    await jumpToNextEvent(page);
    // ×100 while it drives in (its moves play a little faster to fit the sim's time), ×10 from its doors on.
    await setSpeed(page, 100);
    await setPaused(page, false);
    await page.waitForFunction(
      () => {
        const phase = String(window.__scene?.equipmentState('truck')?.phases ?? '').split(',')[0];
        if (phase !== 'opening' && phase !== 'reversing' && phase !== 'docked') return false;
        document.querySelector<HTMLButtonElement>('[data-testid="speed-10"]')?.click();
        return true;
      },
      undefined,
      { polling: 'raf', timeout: 60_000 },
    );
    await expect(page.getByTestId('speed-10')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(
      run,
      'the truck is docked at door 1, roller door up, lamp red, and forklift-2 sets off',
      (samples) =>
        samples.some((sample) => door1(sample, 'truck', 'phases') === 'docked' && num(sample, 'docks', 'doorsUp') >= 1 && door1(sample, 'docks', 'lamps') === 'red') &&
        samples.some((sample) => text(sample, 'forklift-2', 'job') !== 'parked'),
      90_000,
    );
    // ×10,000: the sim sends the truck away within a frame; forklift-2 takes its pallet back (no trip fits now) and parks.
    await setSpeed(page, 10_000);
    await waitFor(
      run,
      'the truck has left door 1 and forklift-2 has carried a pallet and parked again',
      (samples) => {
        const doorSteps = steps(samples.map((sample) => door1(sample, 'truck', 'phases')));
        const jobs = steps(samples.map((sample) => text(sample, 'forklift-2', 'job')));
        return containsRun(doorSteps, ['leaving', 'away']) && jobs.length > 2 && jobs.at(-1) === 'parked' && samples.some((sample) => state(sample, 'forklift-2').carrying === true);
      },
      90_000,
    );
    const { samples } = run;
    const doorSteps = steps(samples.map((sample) => door1(sample, 'truck', 'phases')));
    const firstVisit = doorSteps.slice(0, doorSteps.indexOf('away', 1) + 1);
    expect(firstVisit, "door 1's truck").toEqual(['away', 'arriving', 'opening', 'reversing', 'docked', 'closing', 'leaving', 'away']);
    const visitEnd = samples.findIndex((sample, i) => i > 0 && door1(sample, 'truck', 'phases') === 'away' && samples.slice(0, i).some((each) => door1(each, 'truck', 'phases') === 'leaving'));
    const visit = samples.slice(0, visitEnd + 1);
    for (const [i, sample] of visit.entries()) {
      const phase = door1(sample, 'truck', 'phases');
      expect(num(sample, 'truck', 'maxTractorRad'), 'the tractor turns no more than 0.6 rad off the trailer').toBeLessThanOrEqual(0.6 + 1e-9);
      if (phase === 'reversing' || phase === 'docked') expect(num(sample, 'truck', 'doorsOpen'), `rear doors open while ${phase}`).toBeGreaterThanOrEqual(1);
      if (phase === 'arriving' || phase === 'leaving') expect(num(sample, 'truck', 'doorsOpen'), `rear doors shut while ${phase}`).toBe(0);
      // The lamp follows the docked truck (a frame late at most: the docks read the trucks' bays).
      const docked = phase === 'docked' || door1(visit[i - 1] ?? sample, 'truck', 'phases') === 'docked';
      if (door1(sample, 'docks', 'lamps') === 'red') expect(docked, `the lamp is red only while the truck is docked (frame ${i}, ${phase})`).toBe(true);
      if (phase === 'docked') {
        const loaded = Number(door1(sample, 'truck', 'loaded'));
        expect(loaded, 'pallets in the trailer while docked').toBeGreaterThanOrEqual(0);
        expect(loaded).toBeLessThanOrEqual(22);
      }
      if (phase === 'leaving') expect(door1(sample, 'truck', 'loaded'), 'a full load drives away').toBe('22');
    }
    expect(Math.max(...visit.map((sample) => num(sample, 'truck', 'maxTractorRad'))), 'articulated while it backs in').toBeGreaterThan(0.3);
    const dockedSamples = visit.filter((sample) => door1(sample, 'truck', 'phases') === 'docked');
    const loadedWhileDocked = dockedSamples.map((sample) => Number(door1(sample, 'truck', 'loaded')));
    for (let i = 1; i < loadedWhileDocked.length; i++) expect(loadedWhileDocked[i], 'the trailer fills, never empties').toBeGreaterThanOrEqual(loadedWhileDocked[i - 1] as number);
    expect(Math.max(...loadedWhileDocked), 'pallets in the trailer while it loads').toBeGreaterThan(0);
    // Driving away: its lamp green again (from the frame after it pulled out) and, by the time it has gone, every roller door down.
    const leaving = visit.filter((sample) => door1(sample, 'truck', 'phases') === 'leaving');
    for (const sample of leaving.slice(1)) expect(door1(sample, 'docks', 'lamps'), 'door 1 lamp once the truck pulls out').toBe('green');
    expect(num(leaving.at(-1) as Sample, 'docks', 'doorsUp'), 'roller doors up once the truck has driven off').toBe(0);

    expectForkliftCarried(samples, 'forklift-2');
    const last = samples.at(-1) as Sample;
    const first = samples[0] as Sample;
    expect(state(last, 'forklift-2'), 'forklift-2 parked again, forks down, beacon dark').toMatchObject({ job: 'parked', carrying: false, liftM: 0, beacon: false });
    expect(num(last, 'forklift-2', 'xM'), 'at its spot').toBeCloseTo(num(first, 'forklift-2', 'xM'), 2);
    expect(num(last, 'forklift-2', 'zM'), 'at its spot').toBeCloseTo(num(first, 'forklift-2', 'zM'), 2);
    expect(pageProblems).toEqual([]);
  });
});
