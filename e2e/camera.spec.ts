import type { Page } from '@playwright/test';
import { OVERVIEW, STAGE_VIEWS } from '../src/scene/layout';
import { expect, test } from './fixtures';
import { expectLanded, expectOverview, railButton, steadyStagePoint, waitForClock, waitForScene, wholePlantButton } from './helpers';

// Where the camera goes (phase-2 shared spec, gate G1). stages.spec.ts checks that a selection lands the
// camera; this checks where it lands: on the stage's stop in src/scene/layout.ts (STAGE_VIEWS), looking
// at focusM from focusM + cameraOffsetM, whether the rail or a 3D click chose the stage, and back on the
// overview after "Whole plant". Read through the ?debug hook's cameraTarget() and cameraPosition().

/** The orbit controls re-derive the camera's position each frame, which may round it a little. */
const TOLERANCE_M = 0.01;

type Vector = readonly [number, number, number];

async function cameraPose(page: Page): Promise<{ targetM: Vector; positionM: Vector }> {
  return page.evaluate(() => {
    const scene = (window as unknown as { __scene?: { cameraTarget(): Vector; cameraPosition(): Vector } }).__scene;
    if (!scene) throw new Error('window.__scene is not set: open the page with ?debug');
    return { targetM: scene.cameraTarget(), positionM: scene.cameraPosition() };
  });
}

const minus = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const plus = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const length = (v: Vector): number => Math.hypot(...v);
const unit = (v: Vector): Vector => {
  const l = length(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const show = (v: Vector): string => `(${v.map((x) => x.toFixed(2)).join(', ')})`;

/** The camera has landed on the stage's stop. */
async function expectAtStop(page: Page, stage: keyof typeof STAGE_VIEWS): Promise<void> {
  await expectLanded(page, stage);
  const { focusM, cameraOffsetM } = STAGE_VIEWS[stage];
  const { targetM, positionM } = await cameraPose(page);
  const stopM = plus(focusM, cameraOffsetM);
  expect(length(minus(targetM, focusM)), `stage ${stage}: the camera looks at ${show(focusM)}, not ${show(targetM)}`).toBeLessThan(TOLERANCE_M);
  expect(length(minus(positionM, stopM)), `stage ${stage}: the camera stands at ${show(stopM)}, not ${show(positionM)}`).toBeLessThan(TOLERANCE_M);
}

/**
 * The camera is on the overview: it looks at the overview's target from along its direction. Its distance
 * fits the window's width, so it is not checked here.
 */
async function expectAtOverview(page: Page, when: string): Promise<void> {
  const { targetM, positionM } = await cameraPose(page);
  const direction = unit(OVERVIEW.direction);
  const seenFrom = unit(minus(positionM, targetM));
  expect(length(minus(targetM, OVERVIEW.targetM)), `${when}: the camera looks at ${show(OVERVIEW.targetM)}, not ${show(targetM)}`).toBeLessThan(TOLERANCE_M);
  expect(length(minus(seenFrom, direction)), `${when}: the camera looks from ${show(direction)}, not ${show(seenFrom)}`).toBeLessThan(1e-3);
}

test('the camera lands on the stop of the stage the rail or a 3D click selects, and on the overview after "Whole plant"', async ({ page }) => {
  await page.goto('/?debug');
  await waitForScene(page);
  await waitForClock(page);
  await expectAtOverview(page, 'at load');

  // Both ends of the stop table, by rail.
  for (const stage of [1, 10] as const) {
    await test.step(`rail-stage-${stage}`, async () => {
      await railButton(page, stage).click();
      await expectAtStop(page, stage);
    });
  }

  await test.step('"Whole plant"', async () => {
    await wholePlantButton(page).click();
    await expectOverview(page);
    await expectAtOverview(page, 'after "Whole plant"');
  });

  await test.step('a 3D click on stage 6', async () => {
    const point = await steadyStagePoint(page, 6, 'it shows from the overview');
    await page.mouse.click(point.x, point.y);
    await expectAtStop(page, 6);
  });
});
