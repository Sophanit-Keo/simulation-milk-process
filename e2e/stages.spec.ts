import type { Page } from '@playwright/test';
import type { StageInfo } from '../src/contracts';
import { expect, test } from './fixtures';
import {
  NO_STAGE_TITLE,
  STAGES,
  STATIC_VALUES,
  afterHudUpdates,
  clockTimeS,
  expectLanded,
  expectOverview,
  expectSelected,
  flyBudgetMs,
  railButton,
  railState,
  recordFlying,
  sceneCall,
  selectionState,
  steadyStagePoint,
  viewport,
  waitForClock,
  waitForClockToMove,
  waitForScene,
  wholePlantButton,
} from './helpers';

// Stage selection (phase-2 shared spec, gate G1): a rail click and a 3D click both select a stage through
// the view bus; the rail marks it, the panel shows its text and live values, and the camera flies there.
// The "Whole plant" button and Escape go back to the overview.

/**
 * Overview draw calls the e2e run tolerates. The budget is about 350 (tests/perf/baseline.md); the slack
 * keeps this a guard against a lost InstancedMesh or a per-machine material, not a fight over a few calls.
 */
const OVERVIEW_DRAW_CALL_CEILING = 400;

/**
 * Every Must item of the G1 checklist that is a machine, and the Should and Could items built at G1
 * (plan/agent-plan/g1-checklist.md, "Layout review"). The scene may add more; none of these may go missing.
 */
const G1_EQUIPMENT_IDS = [
  'silo-a', 'silo-b', 'separator', 'standardization-skid', 'mixing-tank',
  'balance-tank', 'plate-heat-exchanger', 'deaerator', 'homogenizer', 'steam-injector', 'holding-tube',
  'divert-valve', 'reject-tank', 'flash-vessel', 'tubular-cooler', 'boiler-house',
  'aseptic-tank',
  'filler-a', 'filler-b', 'pack-conveyors', 'accumulation-table',
  'tray-shrink-tunnel', 'tray-conveyor', 'palletizer', 'stretch-wrapper', 'pallet-conveyor',
  'quarantine', 'qa-lab',
  'racks', 'docks', 'forklift-1', 'forklift-2', 'truck',
];

/**
 * How long the mock may take to divert at ×1,000. With plant.json's seed its first divert comes about 2.9 sim
 * hours in: about 105 frames of at most 100 s each, under 30 s even at a few frames a second.
 */
const DIVERT_WAIT_MS = 90_000;

/** Selecting a stage and flying there takes a few seconds per stage on software GL: a run of five gets more time. */
const FIVE_STAGE_TIMEOUT_MS = 240_000;

/** Two halves of the line, so a run of stage selections stays well inside one test's time. */
const HALVES = [STAGES.slice(0, 5), STAGES.slice(5)];

/**
 * Next-event jumps (a shift each) the mock gets to change a stage's status from the one it had at the pause
 * and leave a stage amber or red. With plant.json's seed it needs two: the first shift turns every stage
 * green, the second turns one red.
 */
const MAX_JUMPS = 6;

/** Each stage's status as the rail and the 3D view show it, and the panel's status chip. */
interface StageLamps {
  /** By stage id: the rail lamp's data-status and aria-label, and the data-status of each of the stage's machine labels. */
  stages: Record<number, { rail: string | null; railText: string | null; labels: (string | null)[] }>;
  /** The chip's lamp status and its text; null while the panel shows no stage. */
  chip: { status: string | null; text: string } | null;
}

/** Every status lamp of the stages, read in one go. */
async function stageLamps(page: Page): Promise<StageLamps> {
  return page.evaluate((ids) => {
    const stages: StageLamps['stages'] = {};
    for (const id of ids) {
      const lamp = document.querySelector(`#rail [data-testid="rail-stage-${id}"] [data-status]`);
      stages[id] = {
        rail: lamp?.getAttribute('data-status') ?? null,
        railText: lamp?.getAttribute('aria-label') ?? null,
        labels: [...document.querySelectorAll(`.equipment-label[data-stage="${id}"]`)].map((label) => label.getAttribute('data-status')),
      };
    }
    const chip = document.querySelector('#panel .chip');
    return {
      stages,
      chip: chip?.checkVisibility()
        ? { status: chip.querySelector('.lamp')?.getAttribute('data-status') ?? null, text: (chip.textContent ?? '').trim() }
        : null,
    };
  }, STAGES.map((stage) => stage.id));
}

/** The first stage that shows amber or red, on its rail lamp or on a machine label. */
function flaggedStage({ stages }: StageLamps): number | undefined {
  return STAGES.find(({ id }) => [stages[id].rail, ...stages[id].labels].some((status) => status === 'warn' || status === 'bad'))?.id;
}

/** Every stage's status as its rail lamp shows it, in stage order, e.g. "ok ok ok warn ok warn ok ok ok ok". */
const railStatuses = ({ stages }: StageLamps): string => STAGES.map(({ id }) => stages[id].rail).join(' ');

/**
 * Waits until the rail and the machine labels in the 3D view, which read the snapshot each on their own,
 * agree on every stage's status; returns the lamps as they agreed.
 */
async function expectLampsAgree(page: Page): Promise<StageLamps> {
  const seen: { lamps: StageLamps | null } = { lamps: null };
  await expect(async () => {
    const lamps = await stageLamps(page);
    seen.lamps = lamps;
    for (const stage of STAGES) {
      const { rail, labels } = lamps.stages[stage.id];
      expect(labels.length, `stage ${stage.id} has machine labels`).toBeGreaterThan(0);
      expect(new Set(labels).size, `the machine labels of stage ${stage.id} agree: ${labels.join(', ')}`).toBe(1);
      expect(rail, `rail-stage-${stage.id} lamp shows the status its machine labels show`).toBe(labels[0]);
    }
  }).toPass({ timeout: 10_000 });
  if (!seen.lamps) throw new Error('unreachable: the check above read the lamps');
  return seen.lamps;
}

/** Drags the view with the right button: an OrbitControls pan, which no click handler takes for a pick. */
async function panView(page: Page, dxPx: number, dyPx: number): Promise<void> {
  const box = await viewport(page).boundingBox();
  if (!box) throw new Error('#viewport has no layout box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await page.mouse.up({ button: 'right' });
}

/** Screen points of the stages from the view as it is now, once it holds still. */
async function stagePoints(page: Page, stages: readonly StageInfo[]): Promise<Map<number, { x: number; y: number }>> {
  const points = new Map<number, { x: number; y: number }>();
  for (const stage of stages) points.set(stage.id, await steadyStagePoint(page, stage.id));
  return points;
}

/**
 * The camera is back where it was: a stage's point on screen lies where it lay then, to a few pixels.
 * Compares the page with itself, so no test depends on exact camera positions.
 */
function expectSamePoint(
  now: { x: number; y: number },
  before: { x: number; y: number } | undefined,
  what: string,
  when = 'at the overview',
): void {
  if (!before) throw new Error(`no earlier point for ${what}`);
  expect(Math.hypot(now.x - before.x, now.y - before.y), `${what} lies where it lay ${when}`).toBeLessThan(3);
}

test.describe('the stage rail', () => {
  test('lists the 10 stages in order as buttons with their short names and a status lamp, none selected yet', async ({ page }) => {
    await page.goto('/');
    await waitForClock(page);
    await expect(async () => {
      const rail = await railState(page);
      expect(rail.map((button) => button.testId)).toEqual(STAGES.map((stage) => `rail-stage-${stage.id}`));
      expect(rail.map((button) => button.stage)).toEqual(STAGES.map((stage) => String(stage.id)));
      for (const [index, button] of rail.entries()) {
        const stage = STAGES[index];
        expect(button.tag, `rail-stage-${stage.id} is a <button>`).toBe('BUTTON');
        expect(button.text, `rail-stage-${stage.id} shows its short name`).toContain(stage.shortName);
        // The plant opens running every stage at its set point: every lamp green once the HUD has drawn, but
        // stage 9's, amber while batches are on hold, which they are from the opening on (D11).
        const opening = STATIC_VALUES[stage.id].status;
        expect(opening, `stage ${stage.id} opens green, or stage 9 amber`).toBe(stage.id === 9 ? 'warn' : 'ok');
        expect(button.lamps, `rail-stage-${stage.id} has one lamp, ${opening}`).toEqual([opening]);
        expect(button.current, `rail-stage-${stage.id} is not current`).toBeNull();
      }
    }).toPass({ timeout: 10_000 });
    const shown = await selectionState(page);
    expect(shown.title).toBe(NO_STAGE_TITLE);
    expect(shown.howToShown, 'the how-to shows before the first selection').toBe(true);
    expect(shown.focusStage, 'no data-focus-stage before the first selection').toBeNull();
    await expect(wholePlantButton(page)).toHaveAttribute('title', 'Back to the whole plant (Esc)');
  });

  for (const half of HALVES) {
    const ids = half.map((stage) => stage.id).join(', ');
    test(`each rail button selects its stage (${ids}): rail mark, panel text and values, and the camera lands there`, async ({ page }) => {
      test.setTimeout(FIVE_STAGE_TIMEOUT_MS);
      await page.goto('/');
      await waitForClock(page);
      // From the stage before the first one where there is one, so every step moves the mark, the panel and the camera on.
      const before = STAGES[half[0].id - 2];
      if (before) {
        await railButton(page, before.id).click();
        await expectLanded(page, before.id);
      }
      for (const stage of half) {
        await test.step(`rail-stage-${stage.id}, ${stage.shortName}`, async () => {
          await railButton(page, stage.id).click();
          await expectSelected(page, stage, { staticValues: true });
        });
      }
    });
  }

  test('quick clicks that cut flights short end on the last stage clicked', async ({ page }) => {
    await page.goto('/');
    await waitForClock(page);
    for (const id of [1, 5, 9, 3]) await railButton(page, id).click();
    await expectSelected(page, STAGES[2], { staticValues: true });
  });

  test('arrow keys, Home and End move focus and selection along the rail', async ({ page }) => {
    await page.goto('/');
    await waitForClock(page);
    // Focus alone selects nothing; the keys then move focus and selection together.
    await railButton(page, 3).focus();
    expect((await selectionState(page)).current, 'focus alone selects nothing').toEqual([]);
    const steps: [key: string, stage: number][] = [
      ['ArrowDown', 4],
      ['ArrowRight', 5],
      ['End', 10],
      ['ArrowUp', 9],
      ['ArrowLeft', 8],
      ['Home', 1],
    ];
    for (const [key, stage] of steps) {
      await page.keyboard.press(key);
      await expect(railButton(page, stage), `${key} focuses rail-stage-${stage}`).toBeFocused();
      await expect(railButton(page, stage), `${key} selects stage ${stage}`).toHaveAttribute('aria-current', 'true');
    }
    // The selection the keys made is a full one: the panel follows and the camera lands.
    await expectSelected(page, STAGES[0], { staticValues: true });
    // Up from the first stays on the first.
    await page.keyboard.press('ArrowUp');
    await expect(railButton(page, 1)).toBeFocused();
    expect((await selectionState(page)).current).toEqual([{ stage: '1', value: 'true' }]);
  });

  test('selecting the selected stage again flies the camera back to it', async ({ page }) => {
    await page.goto('/?debug');
    await waitForScene(page);
    const stage = STAGES[3];
    await railButton(page, stage.id).click();
    await expectSelected(page, stage);
    const landed = await steadyStagePoint(page, stage.id);

    // Move the camera away, so flying back is visible on screen as well as in data-flying.
    await panView(page, 220, 90);
    const moved = await steadyStagePoint(page, stage.id);
    expect(Math.hypot(moved.x - landed.x, moved.y - landed.y), 'the pan moved the view').toBeGreaterThan(40);

    const flyingSeen = await recordFlying(page);
    const budgetMs = await flyBudgetMs(page);
    await railButton(page, stage.id).click();
    await expect.poll(flyingSeen, { message: 'data-flying turned "true"', timeout: budgetMs }).toContain('true');
    await expectSelected(page, stage);
    expectSamePoint(await steadyStagePoint(page, stage.id), landed, `stage ${stage.id}`, 'when the camera first landed there');
  });

  test('with ?mock: each rail lamp shows its stage status from the snapshot, as the 3D labels and the panel chip do', async ({ page }) => {
    await page.goto('/?mock');
    await waitForClock(page);
    // Paused, the snapshot holds still, so everything that reads it must show the same statuses.
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await afterHudUpdates(page);
    const atPause = await expectLampsAgree(page);

    // The mock turns stages amber or red now and then. Jump shift by shift until some stage's status has
    // changed since the pause, so a lamp that stops following the snapshot is caught, and a stage is amber
    // or red, so the lamps are compared on something other than green. The rail and the 3D labels must
    // agree after every jump.
    let lamps = atPause;
    let flagged = flaggedStage(lamps);
    for (let jump = 1; flagged === undefined || railStatuses(lamps) === railStatuses(atPause); jump++) {
      if (jump > MAX_JUMPS) {
        throw new Error(`in ${MAX_JUMPS} jumps, no stage changed status from the pause's (${railStatuses(atPause)}) and left one amber or red`);
      }
      const fromS = await clockTimeS(page);
      await page.getByTestId('next-event').click();
      await waitForClockToMove(page, fromS);
      await afterHudUpdates(page);
      lamps = await expectLampsAgree(page);
      flagged = flaggedStage(lamps);
    }

    // Selected, a stage's status chip in the panel says what its rail lamp says: the amber or red stage,
    // then one with another status, so the chip follows the selection.
    const { stages } = lamps;
    const other = STAGES.find((stage) => stages[stage.id].rail !== stages[flagged].rail);
    for (const id of other ? [flagged, other.id] : [flagged]) {
      await railButton(page, id).click();
      await expectSelected(page, STAGES[id - 1]);
      await expect(async () => {
        const shown = await stageLamps(page);
        const { rail, railText } = shown.stages[id];
        expect(shown.chip, `the panel's status chip for stage ${id}`).toEqual({ status: rail, text: railText });
      }).toPass({ timeout: 10_000 });
    }
  });
});

test.describe('a 3D click', () => {
  for (const half of HALVES) {
    const ids = half.map((stage) => stage.id).join(', ');
    test(`on a machine from the overview selects its stage as the rail does (${ids})`, async ({ page }) => {
      test.setTimeout(FIVE_STAGE_TIMEOUT_MS);
      await page.goto('/?debug');
      await waitForScene(page);
      await waitForClock(page);
      expect(await sceneCall(page, 'focusStage'), 'nothing focused at the overview').toBeNull();
      const box = await viewport(page).boundingBox();
      if (!box) throw new Error('#viewport has no layout box');
      // Every stage shows from the overview (shared spec), so each has a point a click can use.
      const overview = await stagePoints(page, half);
      for (const [stage, point] of overview) {
        const inside = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
        expect(inside, `stage ${stage} at (${point.x}, ${point.y}) lies in the 3D view`).toBe(true);
      }

      for (const [index, stage] of half.entries()) {
        await test.step(`click on stage ${stage.id}, ${stage.shortName}`, async () => {
          if (index > 0) {
            // Back to the overview with the "Whole plant" button, so each click starts from the same view.
            await wholePlantButton(page).click();
            await expectOverview(page);
          }
          const point = await steadyStagePoint(page, stage.id, 'it shows from the overview');
          expectSamePoint(point, overview.get(stage.id), `stage ${stage.id}`);
          await page.mouse.click(point.x, point.y);
          await expectSelected(page, stage, { staticValues: true });
          expect(await sceneCall(page, 'focusStage')).toBe(stage.id);
        });
      }
    });
  }
});

test.describe('the whole plant', () => {
  test('"Whole plant" and Escape clear the selection and fly the camera home', async ({ page }) => {
    await page.goto('/?debug');
    await waitForScene(page);
    await waitForClock(page);
    // Where stage 6 shows at the overview: the camera is home when it shows there again.
    const home = await steadyStagePoint(page, 6);

    for (const [stage, how] of [
      [4, 'the "Whole plant" button'],
      [8, 'Escape'],
    ] as const) {
      await test.step(`stage ${stage}, then back with ${how}`, async () => {
        await railButton(page, stage).click();
        await expectSelected(page, STAGES[stage - 1]);
        const flyingSeen = await recordFlying(page);
        // Escape with focus still on the rail button just clicked: only text fields keep Escape for themselves.
        if (how === 'Escape') await page.keyboard.press('Escape');
        else await wholePlantButton(page).click();
        await expectOverview(page);
        expect(await flyingSeen(), 'data-flying while the camera flew home').toContain('true');
        expect(await sceneCall(page, 'focusStage'), 'focusStage() at the overview').toBeNull();
        expectSamePoint(await steadyStagePoint(page, 6, 'it shows from the overview, so the camera is home'), home, 'stage 6');
      });
    }
  });

  test('a stage selected after going back selects as before', async ({ page }) => {
    await page.goto('/');
    await waitForClock(page);
    await railButton(page, 2).click();
    await expectLanded(page, 2);
    await page.keyboard.press('Escape');
    await expectOverview(page);
    await railButton(page, 2).click();
    await expectSelected(page, STAGES[1], { staticValues: true });
  });
});

test.describe('the ?debug scene hook', () => {
  test('is not set without ?debug', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#viewport canvas')).toBeVisible();
    await waitForClock(page);
    expect(await page.evaluate(() => (window as unknown as { __scene?: unknown }).__scene)).toBeUndefined();
  });

  test('reports the G1 equipment, renderer counts within budget and fps, and follows the focused stage', async ({ page }) => {
    await page.goto('/?debug');
    await waitForScene(page);

    const ids = await sceneCall(page, 'equipmentIds');
    expect(new Set(ids).size, 'equipment ids are unique').toBe(ids.length);
    for (const id of ids) expect(id, 'equipment ids are kebab-case').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(ids, 'every machine of the G1 layout review').toEqual(expect.arrayContaining(G1_EQUIPMENT_IDS));

    // Every model and texture in, so the counts are the settled scene's; and fps() averages the last
    // second, so give it a full second of frames.
    await page.waitForLoadState('networkidle');
    await expect.poll(() => sceneCall(page, 'fps'), { message: 'fps() after a second of frames', timeout: 10_000 }).toBeGreaterThan(0);
    expect(Number.isFinite(await sceneCall(page, 'fps'))).toBe(true);
    const drawCalls = await sceneCall(page, 'drawCalls');
    const triangles = await sceneCall(page, 'triangles');
    expect(drawCalls, 'draw calls at the overview').toBeGreaterThan(0);
    expect(drawCalls, `draw calls at the overview (budget about 350)`).toBeLessThanOrEqual(OVERVIEW_DRAW_CALL_CEILING);
    expect(triangles, 'triangles at the overview').toBeGreaterThan(0);
    for (const stage of [0, 11]) expect(await sceneCall(page, 'stageScreenPoint', stage), `stageScreenPoint(${stage})`).toBeNull();

    expect(await sceneCall(page, 'focusStage')).toBeNull();
    await railButton(page, 6).click();
    await expectLanded(page, 6);
    expect(await sceneCall(page, 'focusStage')).toBe(6);
  });

  test('with ?mock: a divert flips the divert valve, turns its lamp red and lights the route to the reject tank', async ({ page }) => {
    await page.goto('/?mock&debug');
    await waitForScene(page);
    await waitForClock(page);
    // The mock's own diverts come about once every 40 sim hours, so drive one: a UHT set point of 138 °C,
    // under the 139.22 °C limit, diverts on the next frame (End is 150 °C, each Page Down 2 °C).
    await railButton(page, 4).click();
    const slider = page.getByTestId('setpoint-uhtSetpointC');
    await slider.focus();
    await page.keyboard.press('End');
    for (let press = 0; press < 6; press++) await page.keyboard.press('PageDown');
    await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText('138.0 °C');
    // Pause in the frame that first shows the divert, from inside the page: a round trip from the test
    // could take longer than a frame does.
    await page.waitForFunction(
      () => {
        const scene = (window as unknown as { __scene: { equipmentState(id: string): { diverting?: boolean } | null } }).__scene;
        if (scene.equipmentState('divert-valve')?.diverting !== true) return false;
        document.querySelector<HTMLButtonElement>('[data-testid="pause"]')?.click();
        return true;
      },
      undefined,
      { polling: 'raf', timeout: DIVERT_WAIT_MS },
    );
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');

    // Paused in the divert: the snapshot holds still, and the valve settles on the reject tank's outlet.
    const valve = await sceneCall(page, 'equipmentState', 'divert-valve');
    expect(valve, 'the divert valve while the mock diverts').toMatchObject({ diverting: true, lamp: 'bad' });
    expect((await sceneCall(page, 'pipeState')).divertLit, 'the divert route is lit').toBe(true);
    await expect
      .poll(async () => (await sceneCall(page, 'equipmentState', 'divert-valve'))?.flagRad, { message: 'the valve flag turns to the reject tank' })
      .toBeCloseTo(-Math.PI / 2, 2);
  });
});
