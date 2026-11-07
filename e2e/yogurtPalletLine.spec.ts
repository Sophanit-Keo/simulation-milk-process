import { expect, test } from './fixtures';
import { railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 24 in the browser, on the live sim: the yogurt wing's gantry palletizer lays trays on the pallet while P8 fills;
// a closed pallet rides to the stretch wrapper, turns while its film grows and is cut, and rides on to the staging row;
// stage 16's process flow reads the palletizer's layer and trays and the wrapper's last pallet. The numbers are the unit
// tests' (tests/scene/palletLine.test.ts); here what the page shows.

type State = Record<string, number | string | boolean> | null;
const palletizer = (page: Parameters<typeof sceneCall>[0]) => sceneCall(page, 'equipmentState', 'yogurt-palletizer') as Promise<State>;
const wrapper = (page: Parameters<typeof sceneCall>[0]) => sceneCall(page, 'equipmentState', 'yogurt-wrapper') as Promise<State>;

test('the gantry lays trays, a closed pallet is wrapped and rides on, and the panel reads both machines', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await showOnRail(page, 16);
  await railButton(page, 16).click();
  // The models stand in for the grey boxes, and the gantry works: it carries trays and lays them.
  await expect.poll(async () => (await palletizer(page))?.hero, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await wrapper(page))?.hero).toBe(true);
  await expect.poll(async () => (await palletizer(page))?.carrying, { timeout: 30_000 }).toBe(true);
  const laid = Number((await palletizer(page))?.laid);
  await expect.poll(async () => Number((await palletizer(page))?.laid), { timeout: 60_000 }).toBeGreaterThan(laid);

  // The panel: the palletizer's layer and trays, the wrapper's last pallet.
  const flow = page.getByTestId('process-flow');
  await expect(flow.locator('.flow-step[data-step="palletizer"] .flow-reading')).toHaveText(/^layer \d+ of 15 · \d+ of 120 trays$/);
  await expect(flow.locator('.flow-step[data-step="wrapper"] .flow-reading')).toHaveText(/^last: pallet \d+ of P8-\d{3}-\d, \d+ trays · closed .+ ago$/);

  // Until the open pallet closes, then at ×10 its wrap: the turntable turns, the web runs, the film grows.
  await page.getByTestId('speed-100').click();
  await expect.poll(async () => Number((await palletizer(page))?.closed), { timeout: 120_000 }).toBeGreaterThan(0);
  await page.getByTestId('speed-10').click();
  await expect.poll(async () => (await wrapper(page))?.riderPhase, { timeout: 60_000 }).toBe('wrapping');
  await expect.poll(async () => (await wrapper(page))?.web, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => Number((await wrapper(page))?.filmFrac), { timeout: 60_000 }).toBeGreaterThan(0.9);
  await expect.poll(async () => Number((await wrapper(page))?.turnRad)).toBeGreaterThan(Math.PI);
  // The film is cut, and the wrapped pallet rides on and leaves the line.
  await expect.poll(async () => (await wrapper(page))?.riderPhase, { timeout: 90_000 }).toBe('toStaging');
  expect((await wrapper(page))?.shell).toBe(true);
  expect((await wrapper(page))?.web).toBe(false);
  await expect.poll(async () => (await wrapper(page))?.riderPhase, { timeout: 60_000 }).toBe('none');
});
