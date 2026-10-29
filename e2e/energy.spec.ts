import { expect, test } from './fixtures';
import { expectLanded, railButton, sceneCall, waitForClock, waitForScene } from './helpers';

// Phase 8 in the browser, on the live sim: the boiler house reads the steam it raises and its chimney's plume
// follows the gas; the stage 4 panel lists the steam, the gas and the energy since opening, stage 2 the
// regeneration (H116). Then the UHT temperature drop: while the plant re-sterilizes, the injector heats the
// hot water, so the steam and the gas run on with no milk made (H117, H118), and the energy per tonne of raw
// milk has more than tripled by the time production resumes. The exact numbers are the unit tests'
// (tests/sim/energy.test.ts); here what shows on screen.

/** The number in a panel row's value, e.g. 86.6 from "86.6 kWh/t". */
const numberIn = (text: string | null): number => Number((text ?? '').replace(/,/g, '').match(/[\d.]+/)?.[0] ?? Number.NaN);

test('the boiler house and the stage 2 and 4 panels show the steam and the energy; re-sterilizing after a divert burns gas for no milk', async ({ page }) => {
  // The 3 min divert, the 80 min CIP and the 30 min of sterilizing at ×100: about 70 s of real time.
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);

  // Production at the defaults: 1,652 kg/h of steam, 1,280 kW of gas, the plume at 1,280 ÷ 2,200 of full.
  const boilerLabel = page.locator('.equipment-label[data-equipment="boiler-house"] .equipment-value');
  await expect(boilerLabel).toHaveText('1,652 kg/h');
  await expect
    .poll(async () => Number((await sceneCall(page, 'equipmentState', 'boiler-house'))?.plumeFrac), { message: 'the plume at production gas' })
    .toBeCloseTo(1_280.49 / 2_200, 3);

  await railButton(page, 2).click();
  await expectLanded(page, 2);
  await expect(page.locator('#panel [data-value-key="regenerationPct"]')).toHaveText('Regeneration 56.6 %');

  await railButton(page, 4).click();
  await expectLanded(page, 4);
  const steamRow = page.locator('#panel [data-value-key="steamKgPerH"] dd');
  const gasRow = page.locator('#panel [data-value-key="gasKw"] dd');
  const energyRow = page.locator('#panel [data-derived-key="energyPerT"]');
  await expect(steamRow).toHaveText('1,652 kg/h');
  await expect(gasRow).toHaveText('1,280 kW');
  // Only production since the plant opened, so the energy per tonne is H116's.
  await expect(energyRow).toHaveText('Energy since opening 86.6 kWh/t');

  await page.getByTestId('scenario-menu').click();
  await page.locator('#scenario-menu-list [data-scenario="uhtTempDrop"]').click();
  await expectLanded(page, 4);
  await page.getByTestId('speed-100').click();

  const mode = page.locator('#panel [data-state-key="uhtMode"] dd');
  await expect(mode).toHaveText(/^Re-sterilizing/, { timeout: 120_000 });
  // Once the preheater is back at 80 °C, the hot water takes 2,085 kg/h from 76 °C to 125 °C (H117).
  await expect(steamRow).toHaveText('2,085 kg/h', { timeout: 30_000 });
  await expect(gasRow).toHaveText('1,616 kW');
  await expect(boilerLabel).toHaveText('2,085 kg/h');
  expect(Number((await sceneCall(page, 'equipmentState', 'boiler-house'))?.plumeFrac)).toBeCloseTo(1_615.73 / 2_200, 2);
  // The injector puffs while it heats the water, as it does for milk.
  expect(Number((await sceneCall(page, 'equipmentState', 'steam-injector'))?.steamFrac)).toBe(1);
  // No milk flows, so stage 2 recovers no heat.
  await railButton(page, 2).click();
  await expectLanded(page, 2);
  await expect(page.locator('#panel [data-value-key="regenerationPct"]')).toHaveText('Regeneration 0.0 %');

  await railButton(page, 4).click();
  await expectLanded(page, 4);
  await expect(mode).toHaveText('Production', { timeout: 60_000 });
  await expect(steamRow).toHaveText('1,652 kg/h');
  // 113 min of steam with almost no raw milk drawn: about 278 kWh/t when production resumes, from 86.6.
  await expect.poll(async () => numberIn(await energyRow.locator('dd').textContent()), { message: 'the energy per tonne after the outage' }).toBeGreaterThan(200);
});
