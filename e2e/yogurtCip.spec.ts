import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 32 in the browser: the yogurt wing's CIP station. It stands as the plant opens, its label says so and stage 12's
// panel explains it in a note closed until asked for. Once tank 1 empties (2.333 h in, H125e) the station cleans it: its
// pump turns and stands while paused, the tanks' circuit's lines carry the step's fluid, the tank's sight glass streams,
// the label and the note name the tank and its step, and stage 13's row too. What each part does is the unit tests'
// (tests/scene/yogurtCip.test.ts, tests/sim/yogurt/cip.test.ts, tests/ui/machineNotes.test.ts).

type State = Record<string, number | string | boolean> | null;
const stateOf = (page: Page, id: string) => sceneCall(page, 'equipmentState', id) as Promise<State>;
const stateText = (page: Page, key: string) => page.locator(`#panel [data-state-key="${key}"] dd`);

test('the wing\'s CIP station stands as the plant opens, then cleans tank 1 once it is emptied: pump, lines, label and note', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);

  const label = page.locator('.equipment-label[data-equipment="yogurt-cip"]');
  await expect(label.locator('.equipment-name')).toHaveText('CIP station');
  await expect(label.locator('.equipment-value')).toHaveText('standing by');
  expect(await stateOf(page, 'yogurt-cip')).toMatchObject({ tanksPumpMoving: false, heatPumpMoving: false, p8PumpMoving: false, lyeTankPlateColor: '#7d5cc6' });

  await showOnRail(page, 12);
  await railButton(page, 12).click();
  const note = page.locator('[data-testid="machine-notes"][data-note="wingCip"]');
  await expect(note.locator('.notes-title')).toHaveText('The wing\'s CIP station');
  await expect(note.locator('details')).not.toHaveAttribute('open', '');
  await note.locator('summary').click();
  await expect(note.locator('.notes-heading')).toHaveText(['What it does', 'Three circuits', 'The steps', 'The return', 'What it uses', 'In the 3D view']);
  await expect(note.locator('.notes-fact[data-fact="Fermentation tanks"] dd')).toHaveText('Standing by');

  // Tank 1 empties at 2.333 h: at ×1,000 about 8 s away.
  await page.getByTestId('speed-1000').click();
  await expect.poll(async () => (await stateOf(page, 'yogurt-cip'))?.tanksPumpMoving, { timeout: 120_000 }).toBe(true);
  await page.getByTestId('speed-1').click();
  await expect(note.locator('.notes-fact[data-fact="Fermentation tanks"] dd')).toHaveText(/^Tank 1: .+ · [1-5] of 5 · .+ left$/);
  await expect(label.locator('.equipment-value')).toHaveText(/^tank 1 · (water|NaOH 1\.8%|HNO₃ 0\.8%) · \d+ °C$/);
  const pipes = await sceneCall(page, 'pipeState');
  expect(['water', 'lye', 'acid']).toContain(pipes.yogurtCleaning?.tanks);
  expect(pipes.yogurtCleaning).toMatchObject({ heat: null, p8: null });
  expect(await stateOf(page, 'ferment-tank-1')).toMatchObject({ cipSpray1Moving: true });
  expect(await stateOf(page, 'ferment-tank-2')).toMatchObject({ cipSpray1Moving: false });

  // Paused, the pump stands.
  await page.keyboard.press('Space');
  await expect(page.getByTestId('sim-clock')).toBeVisible();
  const turns = Number((await stateOf(page, 'yogurt-cip'))?.tanksPumpTurns);
  await page.waitForTimeout(1_000);
  expect(Number((await stateOf(page, 'yogurt-cip'))?.tanksPumpTurns)).toBe(turns);
  await page.keyboard.press('Space');

  // Stage 13's row names the tank's step.
  await showOnRail(page, 13);
  await railButton(page, 13).click();
  await expect(stateText(page, 'tank1')).toHaveText(/^Cleaning in place · .+, \d+ °C · [1-5] of 5$/);
});
