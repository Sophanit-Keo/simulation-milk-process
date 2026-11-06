import type { Page } from '@playwright/test';
import { STAGE_VIEWS } from '../src/scene/layout';
import { expect, test } from './fixtures';
import {
  ALL_STAGES,
  OPENING_STATUS,
  expectOverview,
  expectSelected,
  railButton,
  sceneCall,
  showOnRail,
  steadyStagePoint,
  waitForClock,
  waitForScene,
  wholePlantButton,
  YOGURT_STAGES,
} from './helpers';

// The yogurt wing in grey boxes (phase 16, gate Y1): stages 11–16 on the rail under "Yogurt P8", each selectable
// from the rail and by a click in the 3D view, the camera at its stop, the panel filled from the mock (phase 15) or
// from the live line (phase 17, stages 11–14; P8 stubbed and the cold chain standing until phases 18–19), and the
// KPI strip showing the yogurt group while one of them is selected.

/** Six stages, each a fly and a panel on software GL. */
const WING_TIMEOUT_MS = 240_000;

/** The camera's target and position, from the ?debug hook. */
async function cameraPose(page: Page): Promise<{ targetM: number[]; positionM: number[] }> {
  return page.evaluate(() => {
    const scene = (window as unknown as { __scene: { cameraTarget(): number[]; cameraPosition(): number[] } }).__scene;
    return { targetM: scene.cameraTarget(), positionM: scene.cameraPosition() };
  });
}

/** Which KPI group the strip shows. */
const shownKpiLine = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.querySelector('#kpis [data-shown="true"]')?.getAttribute('data-line') ?? null);

test('each yogurt stage selects from the rail: the camera at its stop, the panel from the mock, the yogurt KPIs', async ({ page }) => {
  test.setTimeout(WING_TIMEOUT_MS);
  await page.goto('/?mock&debug');
  await waitForScene(page);
  await waitForClock(page);
  expect(await shownKpiLine(page), 'the milk KPIs at the opening').toBe('uht');
  for (const stage of YOGURT_STAGES) {
    await test.step(`rail-stage-${stage.id}, ${stage.shortName}`, async () => {
      await showOnRail(page, stage.id);
      await railButton(page, stage.id).click();
      await expectSelected(page, stage);
      const { targetM } = await cameraPose(page);
      const focus = STAGE_VIEWS[stage.id].focusM;
      expect(Math.hypot(targetM[0] - focus[0], targetM[1] - focus[1], targetM[2] - focus[2]), `stage ${stage.id}: the camera looks at its stop`).toBeLessThan(0.05);
      expect(await shownKpiLine(page), `stage ${stage.id}: the yogurt KPIs`).toBe('yogurt');
    });
  }
  // The mock's yogurt cards show numbers, not dashes.
  const cards = await page.$$eval('#kpis [data-line="yogurt"] [data-kpi-value]', (nodes) => nodes.map((node) => node.textContent ?? ''));
  expect(cards).toHaveLength(4);
  for (const text of cards) expect(text).toMatch(/\d/);
  // A milk stage brings the milk's KPIs back, and so does the whole plant.
  await showOnRail(page, 4);
  await railButton(page, 4).click();
  await expect.poll(() => shownKpiLine(page)).toBe('uht');
  await showOnRail(page, 12);
  await railButton(page, 12).click();
  await expect.poll(() => shownKpiLine(page)).toBe('yogurt');
  await wholePlantButton(page).click();
  await expectOverview(page);
  expect(await shownKpiLine(page)).toBe('uht');
});

test('each yogurt stage selects by a click on its machines from the overview', async ({ page }) => {
  test.setTimeout(WING_TIMEOUT_MS);
  await page.goto('/?mock&debug');
  await waitForScene(page);
  await waitForClock(page);
  for (const [index, stage] of YOGURT_STAGES.entries()) {
    await test.step(`click on stage ${stage.id}, ${stage.shortName}`, async () => {
      if (index > 0) {
        await wholePlantButton(page).click();
        await expectOverview(page);
      }
      const point = await steadyStagePoint(page, stage.id, 'it shows from the overview');
      await page.mouse.click(point.x, point.y);
      await expectSelected(page, stage);
      expect(await sceneCall(page, 'focusStage')).toBe(stage.id);
    });
  }
});

test('on the live sim the yogurt line runs from the opening: each stage\'s values and lamp, green but for the heat treatment', async ({ page }) => {
  test.setTimeout(WING_TIMEOUT_MS);
  await page.goto('/');
  await waitForClock(page);
  for (const stage of YOGURT_STAGES) {
    await test.step(`rail-stage-${stage.id}`, async () => {
      await showOnRail(page, stage.id);
      await railButton(page, stage.id).click();
      await expectSelected(page, stage);
      await expect(railButton(page, stage.id).locator('[data-status]')).toHaveAttribute('data-status', OPENING_STATUS[stage.id]);
    });
  }
});

/** How far the rail's content runs past its box; 0 when it shows everything without scrolling. */
const railOverflowPx = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const rail = document.querySelector('#rail') as HTMLElement;
    return rail.scrollHeight - rail.clientHeight;
  });

test('at 1280 × 720 the rail\'s groups fold as an accordion, so it never scrolls; a 3D click opens the stage\'s group', async ({ page }) => {
  test.setTimeout(WING_TIMEOUT_MS);
  await page.goto('/?mock&debug');
  await waitForScene(page);
  await waitForClock(page);
  const uht = page.getByTestId('rail-group-uht');
  const yogurt = page.getByTestId('rail-group-yogurt');
  // No room for both lines' stages: the milk's open, the yogurt line's folded, nothing to scroll.
  await expect(uht).toHaveAttribute('aria-expanded', 'true');
  await expect(yogurt).toHaveAttribute('aria-expanded', 'false');
  await expect(railButton(page, 11)).toBeHidden();
  expect(await railOverflowPx(page)).toBeLessThanOrEqual(0);
  // End goes to the last stage shown: the milk's last.
  await railButton(page, 9).focus();
  await page.keyboard.press('End');
  await expect(railButton(page, 10)).toBeFocused();
  await expect(railButton(page, 10)).toHaveAttribute('aria-current', 'true');
  // Opening the yogurt group folds the milk's.
  await yogurt.click();
  await expect(yogurt).toHaveAttribute('aria-expanded', 'true');
  await expect(uht).toHaveAttribute('aria-expanded', 'false');
  await expect(railButton(page, 1)).toBeHidden();
  expect(await railOverflowPx(page)).toBeLessThanOrEqual(0);
  // And the other way.
  await uht.click();
  await expect(uht).toHaveAttribute('aria-expanded', 'true');
  await expect(yogurt).toHaveAttribute('aria-expanded', 'false');
  // A stage of the folded yogurt group picked in the 3D view: its group opens, so its mark shows, and the milk's folds.
  await wholePlantButton(page).click();
  await expectOverview(page);
  const point = await steadyStagePoint(page, 15, 'it shows from the overview');
  await page.mouse.click(point.x, point.y);
  await expectSelected(page, ALL_STAGES[14]);
  await expect(yogurt).toHaveAttribute('aria-expanded', 'true');
  await expect(uht).toHaveAttribute('aria-expanded', 'false');
  await expect(railButton(page, 15)).toBeVisible();
  expect(await railOverflowPx(page)).toBeLessThanOrEqual(0);
});

test('at 1440 × 900 the rail shows both lines\' stages without scrolling, and a header folds its group', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock');
  await waitForClock(page);
  for (const id of ['rail-group-uht', 'rail-group-yogurt']) await expect(page.getByTestId(id)).toHaveAttribute('aria-expanded', 'true');
  for (const stage of ALL_STAGES) await expect(railButton(page, stage.id)).toBeVisible();
  expect(await railOverflowPx(page)).toBeLessThanOrEqual(0);
  await page.getByTestId('rail-group-uht').click();
  await expect(railButton(page, 1)).toBeHidden();
  await expect(railButton(page, 11)).toBeVisible();
});
