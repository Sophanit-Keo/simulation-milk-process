import { expect, test } from './fixtures';
import { railButton, sceneCall, showOnRail, waitForClock, waitForScene } from './helpers';

// Phase 28 in the browser: stage 12's panel explains the holding cell and stage 15's Line P8, each a note that opens
// and closes (closed, it stays closed for the session) with live readings on top; and Line P8's new parts in 3D: the
// de-nester's bar strokes, the hood's fans turn, the stack light is green while it runs. What each reads is the unit
// tests' (tests/ui/machineNotes.test.ts, tests/scene/wingMotion.test.ts).

type State = Record<string, number | string | boolean> | null;

test('the holding cell and Line P8 are explained in their panels, with live readings; P8\'s de-nester, fans and stack light work', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);

  await showOnRail(page, 12);
  await railButton(page, 12).click();
  const cell = page.locator('[data-testid="machine-notes"][data-note="holdingCell"]');
  await expect(cell.locator('.notes-title')).toHaveText('The holding cell');
  await expect(cell.locator('details')).toHaveAttribute('open', '');
  await expect(cell.locator('.notes-heading')).toHaveText(['What it is', 'Why yogurt needs it', 'The critical control point', 'At this plant']);
  await expect(cell.locator('.notes-fact[data-fact="The CCP"] dd')).toHaveText('No mix flows');
  // Once the heat treatment runs: the outlet's 92 °C, forward.
  await page.getByTestId('speed-1000').click();
  await expect(cell.locator('.notes-fact[data-fact="The CCP"]')).toHaveAttribute('data-state', 'ok', { timeout: 120_000 });
  await page.getByTestId('speed-1').click();
  await expect(cell.locator('.notes-fact[data-fact="At the outlet"] dd')).toHaveText('92.0 °C, the limit 85 °C');
  // Closed, it stays closed when the stage comes back.
  await cell.locator('summary').click();
  await expect(cell.locator('details')).not.toHaveAttribute('open', '');
  await railButton(page, 13).click();
  await railButton(page, 12).click();
  await expect(page.locator('[data-testid="machine-notes"][data-note="holdingCell"] details')).not.toHaveAttribute('open', '');

  await showOnRail(page, 15);
  await railButton(page, 15).click();
  const p8 = page.locator('[data-testid="machine-notes"][data-note="p8"]');
  await expect(p8.locator('.notes-title')).toHaveText('Line P8, the cup filler');
  await expect(p8.locator('.notes-fact[data-fact="Now"] dd')).toHaveText('Running');
  await expect(p8.locator('.notes-fact[data-fact="Speed"] dd')).toHaveText('30 cycles a min · 21,600 cups/h');
  await expect(p8.locator('.notes-text').first()).toContainText('12 lanes side by side');

  const filler = () => sceneCall(page, 'equipmentState', 'p8-filler') as Promise<State>;
  await expect.poll(async () => Number((await filler())?.denesterBarReading), { timeout: 20_000 }).toBeGreaterThan(0.5);
  await expect.poll(async () => Number((await filler())?.denesterBarReading), { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => (await filler())?.hepaFan2Moving).toBe(true);
  expect(await filler()).toMatchObject({ stackGreenColor: '#34c759', screenColor: '#4aa3ff', sealDisplayColor: '#34c759' });
});

// Phase 31 in the browser: stage 15's panel has a note for each machine of the cup filling room, closed until asked
// for, each saying what the machine does, how it works and what the 3D view shows, with live readings; the room's
// units carry name tags in 3D; and the check gates' new parts move. What each reads is the unit tests'
// (tests/ui/machineNotes.test.ts, tests/scene/cupRoom.test.ts).
test('each machine of the cup filling room is explained in stage 15\'s panel and tagged in 3D, and the check gates move', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?debug');
  await waitForClock(page);
  await waitForScene(page);
  await showOnRail(page, 15);
  await railButton(page, 15).click();
  const notes = page.locator('[data-testid="machine-notes"]');
  await expect(notes.locator('.notes-title')).toHaveText([
    'Line P8, the cup filler',
    'The de-nester and cup cleaning',
    'The piston filler',
    'The lidder, the sealing heads and the coder',
    'The checkweigher',
    'The metal detector',
    'The vision check and the reject bin',
    'The sterile air unit and the HEPA hood',
    'The CIP/SIP skid',
    'The QA bench and the seal test',
    'Cups, foils and the operator',
  ]);
  // Line P8's note is open; the room's machines open when asked, and stay open when the stage comes back.
  await expect(notes.locator('details[open]')).toHaveCount(1);
  const weigher = page.locator('[data-testid="machine-notes"][data-note="checkweigher"]');
  await weigher.locator('summary').click();
  await expect(weigher.locator('details')).toHaveAttribute('open', '');
  await expect(weigher.locator('.notes-heading')).toHaveText(['What it does', 'How it works', 'In the 3D view']);
  await expect(weigher.locator('.notes-fact[data-fact="Passes"] dd')).toHaveText('120.5–135 g');
  await expect(weigher.locator('.notes-fact[data-fact="Last cup"] dd')).toHaveText(/^1\d\d\.\d g, the target 127 g$/);
  await railButton(page, 14).click();
  await railButton(page, 15).click();
  await expect(page.locator('[data-testid="machine-notes"][data-note="checkweigher"] details')).toHaveAttribute('open', '');
  const air = page.locator('[data-testid="machine-notes"][data-note="airUnit"]');
  await air.locator('summary').click();
  await expect(air.locator('.notes-fact[data-fact="Fans"] dd')).toHaveText('Running');

  // The tags over the room's units.
  const tag = (id: string) => page.locator(`.equipment-label[data-equipment="${id}"]`);
  await expect(tag('p8-air-unit').locator('.equipment-name')).toHaveText('Sterile air unit');
  await expect(tag('p8-air-unit').locator('.equipment-value')).toHaveText(/^\+\d+\.\d Pa$/);
  await expect(tag('p8-cip-skid').locator('.equipment-value')).toHaveText('standing by');
  await expect(tag('p8-qa-bench').locator('.equipment-value')).toHaveText(/^seal test in \d/);
  await expect(tag('p8-cup-supply').locator('.equipment-value')).toHaveText(/^magazine \d+ %/);
  await expect(tag('p8-foil-supply').locator('.equipment-value')).toHaveText(/^magazine \d+ %/);

  // The gates: the weigh platform dips, the detector's field sweeps, the strobe flashes.
  const gate = (id: string) => sceneCall(page, 'equipmentState', id) as Promise<State>;
  await expect.poll(async () => (await gate('p8-checkweigher'))?.weighPlatformMoving).toBe(true);
  expect(await gate('p8-metal-detector')).toMatchObject({ fieldSweepMoving: true, fieldSweepColor: '#7cc4ff' });
  expect(await gate('p8-vision')).toMatchObject({ strobeMoving: true, monitorColor: '#4aa3ff' });
});
