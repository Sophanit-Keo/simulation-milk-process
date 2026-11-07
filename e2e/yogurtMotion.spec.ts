import { expect, test } from './fixtures';
import { sceneCall, waitForClock, waitForScene } from './helpers';

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
