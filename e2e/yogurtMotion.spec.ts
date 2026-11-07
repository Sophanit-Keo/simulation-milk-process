import { expect, test } from './fixtures';
import { railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 23 in the browser, on the live sim: the yogurt machines' moving parts turn with the line (the mixer's rotor as
// it mixes, the cold room's evaporator fans while its cooling works), stand still while the sim is paused, and the
// fans stop in a cold-room excursion. What each part does is the unit tests' (tests/scene/wingMotion.test.ts).

const turns = async (page: Parameters<typeof sceneCall>[0], id: string, key: string): Promise<number> => Number((await sceneCall(page, 'equipmentState', id))?.[key] ?? NaN);

test('the mixer\'s rotor and the cold room\'s fans turn, stand still while paused, and the fans stop when the cooling fails', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  const first = await turns(page, 'high-shear-mixer', 'rotor1Turns');
  await expect.poll(() => turns(page, 'high-shear-mixer', 'rotor1Turns')).toBeGreaterThan(first);
  await expect.poll(() => sceneCall(page, 'equipmentState', 'cold-room')).toMatchObject({ fan1Moving: true, fan2Moving: true, fan3Moving: true });

  await page.keyboard.press('Space');
  await expect(page.getByTestId('sim-clock')).toBeVisible();
  const paused = await turns(page, 'high-shear-mixer', 'rotor1Turns');
  await page.waitForTimeout(1_000);
  expect(await turns(page, 'high-shear-mixer', 'rotor1Turns')).toBe(paused);
  await page.keyboard.press('Space');

  await page.getByTestId('scenario-menu').click();
  await page.locator('#scenario-menu-list [data-scenario="yogurtColdRoomExcursion"]').click();
  await expect.poll(() => sceneCall(page, 'equipmentState', 'cold-room')).toMatchObject({ fan1Moving: false, fan2Moving: false, fan3Moving: false });
  const stopped = await turns(page, 'cold-room', 'fan1Turns');
  await page.waitForTimeout(1_000);
  expect(await turns(page, 'cold-room', 'fan1Turns')).toBe(stopped);
});

// Phase 25 in the browser: the process hall's valve matrix opens the emptying tank's outlet, the buffer's outlet valve
// stands open while P8 runs, and once the heat treatment runs the homogenizer's gauge reads its 180 bar, the steam
// valve's stem lifts and the CCP recorder's pen writes 92 °C. The panel reads the hot-water set and the valve matrix.
// Phase 26: a fermenting tank's jacket valve opens to warm water, and the homogenizer's screen lights once it runs.
type State = Record<string, number | string | boolean> | null;
const stateOf = (page: Parameters<typeof sceneCall>[0], id: string) => sceneCall(page, 'equipmentState', id) as Promise<State>;

test('the valve matrix, the gauges, the steam valve and the CCP recorder follow the process hall', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  // At the opening tank 1 empties to the buffer through its open outlet valve, and P8 draws on the buffer.
  await expect.poll(() => stateOf(page, 'ferment-tank-1')).toMatchObject({ outletValveLift: 1, outletValveColor: '#34c759', inletValveLift: 0 });
  await expect.poll(() => stateOf(page, 'p8-buffer')).toMatchObject({ outletValveLift: 1, outletValveColor: '#34c759' });
  // Phase 26: tank 3 ferments, so its jacket takes warm water; the heat treatment stands, so the homogenizer's screen is dark.
  await expect.poll(() => stateOf(page, 'ferment-tank-3')).toMatchObject({ jacketValveLift: 1, jacketValveColor: '#ea8027' });
  expect((await stateOf(page, 'yogurt-homogenizer'))?.screenColor).toBe('#1d2328');
  await showOnRail(page, 13);
  await railButton(page, 13).click();
  const flow = page.getByTestId('process-flow');
  await expect(flow.locator('.flow-step[data-step="valveMatrix"] .flow-reading')).toHaveText(/tank 1 emptying/);

  // At ×1,000 until the heat treatment runs, then at ×1 the needles and the stem settle where they read.
  await page.getByTestId('speed-1000').click();
  await expect.poll(async () => (await stateOf(page, 'yogurt-homogenizer'))?.stage1GaugeReading, { timeout: 120_000 }).toBe(180);
  await page.getByTestId('speed-1').click();
  await expect.poll(async () => (await stateOf(page, 'yogurt-homogenizer'))?.stage1GaugeLift, { timeout: 30_000 }).toBe(0.72);
  await expect.poll(async () => Number((await stateOf(page, 'yogurt-phe'))?.steamValveLift), { timeout: 30_000 }).toBeGreaterThan(0.4);
  await expect.poll(async () => (await stateOf(page, 'holding-cell'))?.recorderPenReading).toBe(92);
  expect((await stateOf(page, 'holding-cell'))?.recorderPenColor).toBe('#2b5fa8');
  expect(await stateOf(page, 'yogurt-homogenizer')).toMatchObject({ screenColor: '#4aa3ff', runLampColor: '#34c759' });
  await showOnRail(page, 12);
  await railButton(page, 12).click();
  await expect(flow.locator('.flow-step[data-step="hotWater"] .flow-reading')).toHaveText(/^\d+ kg\/h of steam into the circuit$/);
});
