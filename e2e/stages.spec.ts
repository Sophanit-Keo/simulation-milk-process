import type { Page } from '@playwright/test';
import type { StageInfo } from '../src/contracts';
import { expect, test } from './fixtures';
import {
  NO_STAGE_TITLE,
  STAGES,
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

/** Selecting a stage and flying there takes a few seconds per stage on software GL: a run of five gets more time. */
const FIVE_STAGE_TIMEOUT_MS = 240_000;

/** Two halves of the line, so a run of stage selections stays well inside one test's time. */
const HALVES = [STAGES.slice(0, 5), STAGES.slice(5)];

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
        // The static plant runs every stage at its set point: every lamp green once the HUD has drawn.
        expect(button.lamps, `rail-stage-${stage.id} has one lamp, green`).toEqual(['ok']);
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

  test('with ?mock: lamps show a valid status, and the rail selects stages the same way', async ({ page }) => {
    await page.goto('/?mock');
    await waitForClock(page);
    await expect(async () => {
      const rail = await railState(page);
      expect(rail).toHaveLength(STAGES.length);
      for (const button of rail) expect(button.lamps, `${button.testId} lamp`).toEqual([expect.stringMatching(/^(ok|warn|bad|idle)$/)]);
    }).toPass({ timeout: 10_000 });
    for (const id of [4, 9]) {
      await railButton(page, id).click();
      await expectSelected(page, STAGES[id - 1]);
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
});
