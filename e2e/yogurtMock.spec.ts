import type { Page } from '@playwright/test';
import type { StageInfo } from '../src/contracts';
import { expect, test } from './fixtures';
import { afterHudUpdates, formatted, railButton, railState, selectionState, STAGES, STATIC_VALUES, waitForClock, YOGURT_STAGES } from './helpers';

// Phase 15 (D25): stages 11–16, the yogurt line, are on the rail and in the panel only behind ?yogurt until the wing
// is built in phase 16; ?mock&yogurt fills their panels from the mock snapshot, and the live sim shows them standing.
// They have no camera stop yet, so a pick leaves the camera where it is.

/** Selects a yogurt stage on the rail and checks its panel: name, zone, description and one row per value. */
async function expectYogurtPanel(page: Page, stage: StageInfo, lamp: 'ok' | 'idle', staticValues = false): Promise<void> {
  await railButton(page, stage.id).click();
  await expect(async () => {
    const shown = await selectionState(page);
    expect(shown.current, `rail-stage-${stage.id} alone is current`).toEqual([{ stage: String(stage.id), value: 'true' }]);
    expect(shown.title, 'panel-title').toBe(stage.name);
    expect(shown.description, 'panel-description').toBe(stage.description);
    expect(shown.focusStage, 'no camera stop until phase 16').toBeNull();
    expect(shown.flying, 'the camera does not fly').toBeNull();
    expect(shown.rows.map((row) => row.key), 'data-value-key rows').toEqual(stage.values.map((value) => value.key));
    for (const [index, value] of stage.values.entries()) {
      const { text } = shown.rows[index];
      expect(text, `row ${value.key} shows its label`).toContain(value.label);
      expect(text, `row ${value.key} shows a number`).toMatch(/\d/);
      if (value.unit) expect(text, `row ${value.key} shows its unit`).toContain(value.unit);
      if (staticValues) {
        const number = formatted(STATIC_VALUES[stage.id].values[value.key] * (value.scale ?? 1), value.decimals);
        expect(text, `row ${value.key}`).toBe(value.unit ? `${value.label} ${number} ${value.unit}` : `${value.label} ${number}`);
      }
    }
    const rail = await railState(page);
    expect(rail.find((button) => button.stage === String(stage.id))?.lamps, `stage ${stage.id} lamp`).toEqual([lamp]);
  }, `stage ${stage.id} (${stage.shortName}) is shown`).toPass({ timeout: 20_000 });
}

test('without ?yogurt the rail keeps the UHT line\'s ten stages', async ({ page }) => {
  await page.goto('/?mock');
  await waitForClock(page);
  const rail = await railState(page);
  expect(rail.map((button) => button.stage)).toEqual(STAGES.map((stage) => String(stage.id)));
});

test('?mock&yogurt shows panels 11–16 filled from the mock snapshot', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?mock&yogurt');
  await waitForClock(page);
  const rail = await railState(page);
  expect(rail.map((button) => button.stage)).toEqual([...STAGES, ...YOGURT_STAGES].map((stage) => String(stage.id)));
  await afterHudUpdates(page);
  for (const stage of YOGURT_STAGES) {
    await test.step(`stage ${stage.id}`, () => expectYogurtPanel(page, stage, 'ok'));
  }
  // The mock's tanks are at different pH: one half way through, one at the end pH and one just filled.
  await railButton(page, 13).click();
  const tankPh = async () =>
    (await selectionState(page)).rows.filter((row) => /^tank\dPh$/.test(row.key)).map((row) => Number(/(\d+\.\d+)$/.exec(row.text)?.[1]));
  await expect(async () => {
    const ph = await tankPh();
    expect(new Set(ph).size, `tank pH ${ph.join(', ')}`).toBe(3);
  }).toPass({ timeout: 20_000 });
});

test('?yogurt on the live sim shows stages 11–16 standing, with plant.json\'s recipe', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?yogurt');
  await waitForClock(page);
  for (const stage of YOGURT_STAGES) {
    await test.step(`stage ${stage.id}`, () => expectYogurtPanel(page, stage, 'idle', true));
  }
});
