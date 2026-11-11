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

// Phase 29 in the browser: the pallets are carried. A stacker goes to its pick, takes a pallet, carries it through a
// rapid door that rolls up for it and comes home; a reefer drives in, backs to its door, stands docked under a raised
// roller door and a red lamp while it fills by the sim's count, closes up and drives off. What each move does, and
// that it keeps clear of the walls, is the unit tests' (tests/scene/stackers.test.ts, reeferTruck.test.ts).
test('a stacker carries the pallets through its rapid doors, and a reefer docks under a raised door and a red lamp, fills and leaves', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await selectColdChain(page);
  await expect
    .poll(() => sceneCall(page, 'equipmentState', 'yogurt-pallets'))
    .toMatchObject({ stacker1Job: 'parked', stacker2Job: 'parked', stackerTrips: 0, doorsOpen: 0, reefers: 0, reeferPhases: 'away,away,away', dockLamps: 'green,green,green', dockDoorsUp: 0 });
  // On every frame: the stackers' jobs, the doors, the reefer's phases, and what must hold in each.
  await page.evaluate(() => {
    type Scene = { equipmentState(id: string): Record<string, unknown> | null };
    const seen = { jobs: new Set<string>(), phases: new Set<string>(), maxDoors: 0, dockDoorUp: false, maxLoaded: 0, wrong: [] as string[], trips: 0, reefers: 0 };
    Object.assign(window, { dispatchSeen: seen });
    const tick = (): void => {
      const state = (window as unknown as { __scene?: Scene }).__scene?.equipmentState('yogurt-pallets');
      if (state) {
        for (const n of [1, 2]) {
          const job = String(state[`stacker${n}Job`]);
          seen.jobs.add(job);
          // A pallet on the forks only between pick and drop, and the beacon dark on a parked truck.
          if (state[`stacker${n}Carrying`] !== (job === 'pick' || job === 'toDrop' || job === 'drop')) seen.wrong.push(`stacker-${n} carrying in ${job}`);
          if (job === 'parked' && state[`stacker${n}Beacon`]) seen.wrong.push(`stacker-${n}'s beacon lit while parked`);
        }
        seen.maxDoors = Math.max(seen.maxDoors, Number(state.doorsOpen));
        const phases = String(state.reeferPhases).split(',');
        const lamps = String(state.dockLamps).split(',');
        const loaded = String(state.reeferLoaded).split(',');
        phases.forEach((phase, door) => {
          seen.phases.add(phase);
          // Red while a reefer stands docked at the door, green otherwise.
          if ((lamps[door] === 'red') !== (phase === 'docked')) seen.wrong.push(`door ${door + 1}'s lamp ${lamps[door]} while ${phase}`);
          if (phase === 'away' && loaded[door] !== '-') seen.wrong.push(`door ${door + 1} shows a load with no reefer`);
          if (loaded[door] !== '-') seen.maxLoaded = Math.max(seen.maxLoaded, Number(loaded[door]));
        });
        if (phases.includes('docked') && Number(state.dockDoorsUp) >= 1) seen.dockDoorUp = true;
        seen.trips = Number(state.stackerTrips);
        seen.reefers = Number(state.reefers);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  type Seen = { jobs: string[]; phases: string[]; maxDoors: number; dockDoorUp: boolean; maxLoaded: number; wrong: string[]; trips: number; reefers: number };
  const seen = (): Promise<Seen> =>
    page.evaluate(() => {
      const raw = (window as unknown as { dispatchSeen: Omit<Seen, 'jobs' | 'phases'> & { jobs: Set<string>; phases: Set<string> } }).dispatchSeen;
      return { ...raw, jobs: [...raw.jobs], phases: [...raw.phases], wrong: raw.wrong.slice(0, 5) };
    });
  // At ×1,000 to 07:45, when the day's first reefer is called; then at ×100, where its 20 minutes of loading leave
  // the dock's door time to rise (at ×1,000 the reefer closes up as soon as it has docked, to be gone in time).
  await page.getByTestId('speed-1000').click();
  await expect(stateText(page, 'reefers')).toHaveText(/backing to door/, { timeout: 180_000 });
  await page.getByTestId('speed-100').click();
  await expect
    .poll(async () => {
      const now = await seen();
      return now.phases.includes('leaving') && now.trips >= 1;
    }, { timeout: 360_000, intervals: [1_000] })
    .toBe(true);
  await page.getByTestId('speed-10').click();
  await expect.poll(async () => (await seen()).reefers, { timeout: 60_000 }).toBe(0);
  const result = await seen();
  expect(result.wrong).toEqual([]);
  expect(result.jobs).toEqual(expect.arrayContaining(['parked', 'toPick', 'pick', 'toDrop', 'drop', 'home']));
  expect(result.maxDoors).toBeGreaterThanOrEqual(1);
  expect(result.phases).toEqual(expect.arrayContaining(['away', 'docked', 'leaving']));
  expect(result.dockDoorUp).toBe(true);
  expect(result.maxLoaded).toBe(26);
  await expect.poll(() => sceneCall(page, 'equipmentState', 'yogurt-pallets')).toMatchObject({ reeferPhases: 'away,away,away', dockLamps: 'green,green,green', dockDoorsUp: 0 });
  await expect(stateText(page, 'reefers')).toHaveText(/[1-9]\d* shipped$/);
});
