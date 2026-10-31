// The Factory board's 3D floor (factory.html#3d, phase 10, D20): the factory's three UHT trains, each with its
// plant, aseptic tank and its lines' fillers, moving with the board's view of Let Report, which
// e2e/letReportFake.ts fakes end to end. The floor's state is read through its ?debug hook (window.__factory3d,
// src/factory/scene/scene.ts); what a person sees is read from its labels, which are buttons.
import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { MIN_MS, openSignedIn, test } from './letReportFake';

/** The floor's machines by place (layout.ts): the three UHTs, then each bay's fillers left to right. */
const MACHINES = ['uht:0', 'uht:1', 'uht:2', 'line:0:0', 'line:0:1', 'line:1:0', 'line:1:1', 'line:1:2', 'line:2:0'];

type FloorDebug = NonNullable<Window['__factory3d']>;
type Machine = ReturnType<FloorDebug['machines']>[number];
type Pipe = ReturnType<FloorDebug['pipes']>[number];

const machines = (page: Page): Promise<Machine[]> => page.evaluate(() => window.__factory3d?.machines() ?? []);
const pipes = (page: Page): Promise<Pipe[]> => page.evaluate(() => window.__factory3d?.pipes() ?? []);
const builds = (page: Page): Promise<number> => page.evaluate(() => window.__factory3d?.builds() ?? 0);

async function machine(page: Page, id: string): Promise<Machine> {
  const found = (await machines(page)).find((one) => one.id === id);
  if (!found) throw new Error(`no machine ${id} on the floor`);
  return found;
}

async function pipe(page: Page, id: string): Promise<Pipe> {
  const found = (await pipes(page)).find((one) => one.id === id);
  if (!found) throw new Error(`no pipe ${id} on the floor`);
  return found;
}

const viewport = (page: Page): Locator => page.getByTestId('factory-3d');
const uhtLabel = (page: Page, name: string): Locator => page.getByTestId(`scene-uht-${name}`);
const lineLabel = (page: Page, name: string): Locator => page.getByTestId(`scene-line-${name}`);

/** Waits for the floor to be built with the factory's nine machines. */
async function waitForFloor(page: Page): Promise<void> {
  await expect.poll(async () => (await machines(page)).map((one) => one.id), { timeout: 30_000 }).toEqual(MACHINES);
}

/** Signed in, on the 3D view, its floor built and the camera still. */
async function open3d(page: Page): Promise<void> {
  await openSignedIn(page, '?debug#3d');
  await expect(viewport(page)).toBeVisible();
  await waitForFloor(page);
  await expectStill(page);
}

async function expectStill(page: Page): Promise<void> {
  await expect(viewport(page)).not.toHaveAttribute('data-flying', 'true', { timeout: 5_000 });
}

/** Whether a machine's moving parts move: its reel's angle, a third of a second apart. */
async function reelMoves(page: Page, id: string): Promise<boolean> {
  const before = (await machine(page, id)).reelRad;
  await page.waitForTimeout(350);
  return (await machine(page, id)).reelRad !== before;
}

test('the 3D view loads three.js only when opened, and shows the three trains with their six lines running', async ({ page, letReport }) => {
  void letReport;
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await openSignedIn(page, '?debug');
  await expect(page.getByTestId('view-board')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewport(page)).toBeHidden();
  await expect(page.getByTestId('locate-uht').first()).toBeHidden();
  const isFloor = (path: string): boolean => path.includes('/src/factory/scene/') || /three/i.test(path);
  expect(requested.filter(isFloor), 'nothing of the floor or of three.js before the 3D view opens').toEqual([]);

  await page.getByTestId('view-3d').click();
  await expect(page).toHaveURL(/\/factory\.html\?debug#3d$/);
  await expect(page.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewport(page)).toBeVisible();
  await waitForFloor(page);
  expect(requested.some((path) => path.includes('/src/factory/scene/scene.ts')), 'the floor loaded on the switch').toBe(true);

  // Each train's label says what its card says; each line's, its filler and status.
  await expect(uhtLabel(page, 'UHT 1')).toHaveAttribute('aria-label', 'UHT 1: Producing · 2,360 of 4,000 L/h');
  await expect(uhtLabel(page, 'UHT 2')).toHaveAttribute('aria-label', 'UHT 2: Producing · 5,550 of 8,000 L/h');
  await expect(uhtLabel(page, 'UHT 3')).toHaveAttribute('aria-label', 'UHT 3: Producing · 2,400 of 4,000 L/h');
  const lines: [string, string][] = [
    ['UHT-line 1', 'TFA · 3,600 packs/h · 100 ml'],
    ['UHT-line 6', 'TBA/22 · 20,000 packs/h · 100 ml'],
    ['UHT- line 2', 'TBA/19 · 7,500 packs/h · 100 ml'],
    ['UHT-line 3', 'A3/Speed · 24,000 packs/h · 100 ml'],
    ['UHT line 4', 'A3/Speed · 24,000 packs/h · 100 ml'],
    ['UHT-line 7', 'A3/Speed · 24,000 packs/h · 100 ml'],
  ];
  for (const [name, filler] of lines) {
    await expect(lineLabel(page, name)).toHaveAttribute('aria-label', `${name}, ${filler}: Running`);
    await expect(lineLabel(page, name)).toHaveAttribute('data-status', 'ok');
  }
  // The SCM and Yogurt lines are not on the floor, as they are not on the board.
  await expect(lineLabel(page, 'SCM')).toHaveCount(0);
  await expect(page.locator('[data-testid^="scene-bay-"]')).toHaveText(['UHT 1 · 4,000 L/h', 'UHT 2 · 8,000 L/h', 'UHT 3 · 4,000 L/h']);

  // Every line runs: its belt full and moving at its speed, its pipe flowing at its draw; the hero filler stands in.
  const floor = await machines(page);
  expect(floor.filter((one) => one.kind === 'line').map((one) => [one.name, one.belt, one.tokens])).toEqual(
    lines.map(([name]) => [name, 'moving', 14]),
  );
  expect((await machine(page, 'line:1:1')).beltMps).toBeCloseTo(1 / 3, 6);
  expect(floor.filter((one) => one.kind === 'uht').every((one) => one.lamp === 'ok' && one.glowing)).toBe(true);
  expect(await pipe(page, 'uht:1')).toMatchObject({ flowLph: 5_550, cleaning: false });
  expect(await pipe(page, 'line:0:0')).toMatchObject({ flowLph: 360, cleaning: false });
  await expect.poll(async () => (await machines(page)).filter((one) => one.hero).length, 'the hero filler loaded for every line').toBe(6);
  expect(await reelMoves(page, 'line:1:1'), 'a running filler moves').toBe(true);
  await expect(page.getByTestId('locate-uht').first()).toBeVisible();
});

test('a change in Let Report stops UHT line 3 on the floor without building it again: red lamp, packs standing, UHT 2 at 3,150 L/h', async ({
  page,
  letReport,
}) => {
  await open3d(page);
  const built = await builds(page);
  expect(built).toBe(1);

  const line3 = letReport.line('UHT-line 3');
  line3.status = 'stopped';
  line3.status_since = new Date().toISOString();
  line3.updated_at = line3.status_since;
  expect(letReport.pushChange('production_lines', { ...line3 })).toBe(1);

  await expect(lineLabel(page, 'UHT-line 3')).toHaveAttribute('data-status', 'bad', { timeout: 2_000 });
  await expect(lineLabel(page, 'UHT-line 3')).toHaveAttribute('aria-label', 'UHT-line 3, A3/Speed · 24,000 packs/h · 100 ml: Stopped');
  await expect(uhtLabel(page, 'UHT 2')).toHaveAttribute('aria-label', 'UHT 2: Producing · 3,150 of 8,000 L/h', { timeout: 2_000 });
  expect(await machine(page, 'line:1:1')).toMatchObject({ lamp: 'bad', belt: 'still', beltMps: 0, tokens: 14 });
  expect(await pipe(page, 'line:1:1')).toMatchObject({ flowLph: 0, stripeMps: 0 });
  expect((await pipe(page, 'uht:1')).flowLph).toBe(3_150);
  expect(await reelMoves(page, 'line:1:1'), 'the stopped filler stands still').toBe(false);
  expect(await reelMoves(page, 'line:1:2'), 'its neighbour runs on').toBe(true);
  // The board's card says the same, and the floor was not built again for a change of status.
  await expect(page.getByTestId('uht-UHT 2').getByTestId('draw')).toHaveText('Producing · 3,150 of 8,000 L/h');
  expect(await builds(page)).toBe(built);
});

test("a line in CIP has an empty belt and the cleaning colour in its pipe, and its train's pipes too once all its lines clean", async ({
  page,
  letReport,
}) => {
  const line7 = letReport.line('UHT-line 7');
  line7.status = 'cleaning';
  line7.cip_started_at = new Date().toISOString();
  line7.cip_until = new Date(Date.now() + 70 * MIN_MS).toISOString();
  await open3d(page);

  await expect(lineLabel(page, 'UHT-line 7')).toHaveAttribute('aria-label', /^UHT-line 7, A3\/Speed · 24,000 packs\/h · 100 ml: CIP · 1 h (09|10) min left$/);
  await expect(lineLabel(page, 'UHT-line 7')).toHaveAttribute('data-status', 'idle');
  await expect(uhtLabel(page, 'UHT 3')).toHaveAttribute('aria-label', 'UHT 3: CIP');
  expect(await machine(page, 'line:2:0')).toMatchObject({ lamp: 'idle', belt: 'empty', tokens: 0 });
  expect(await machine(page, 'uht:2')).toMatchObject({ lamp: 'idle', glowing: false });
  const drop = await pipe(page, 'line:2:0');
  const train = await pipe(page, 'uht:2');
  const producing = await pipe(page, 'uht:1');
  expect([drop.cleaning, train.cleaning, producing.cleaning]).toEqual([true, true, false]);
  expect(drop.color).toBe(train.color);
  expect(drop.color).not.toBe(producing.color);
  // The cleaning fluid circulates.
  await expect.poll(async () => (await pipe(page, 'line:2:0')).phaseM).not.toBe(drop.phaseM);
});

test('picking: a label flies to its filler and marks its row, "Show in 3D" does the reverse, a click on a machine picks it, Esc goes back', async ({
  page,
  letReport,
}) => {
  void letReport;
  await open3d(page);

  await lineLabel(page, 'UHT- line 2').click();
  await expect(viewport(page)).toHaveAttribute('data-focus', 'line:1:0');
  await expect(page.getByTestId('line-UHT- line 2')).toHaveAttribute('data-selected', 'true');
  await expect(lineLabel(page, 'UHT- line 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-selected]')).toHaveCount(1);

  await page.getByTestId('uht-UHT 3').getByTestId('locate-uht').click();
  await expect(viewport(page)).toHaveAttribute('data-focus', 'uht:2');
  await expect(page.getByTestId('uht-UHT 3')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-selected]')).toHaveCount(1);
  await expect(uhtLabel(page, 'UHT 3')).toHaveAttribute('aria-pressed', 'true');
  await expect(lineLabel(page, 'UHT- line 2')).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Escape');
  await expect(viewport(page)).not.toHaveAttribute('data-focus');
  await expectStill(page);
  await expect(page.locator('[data-selected]')).toHaveCount(0);

  // From the whole floor, a click on UHT line 6's filler itself (not its label) picks it.
  const point = await page.evaluate(() => window.__factory3d?.screenPoint('line:0:1') ?? null);
  expect(point, 'UHT line 6 shows somewhere a click would pick it').not.toBeNull();
  if (point) await page.mouse.click(point.x, point.y);
  await expect(viewport(page)).toHaveAttribute('data-focus', 'line:0:1');
  await expect(page.getByTestId('line-UHT-line 6')).toHaveAttribute('data-selected', 'true');
  await expectStill(page);

  // The labels are buttons: the keyboard reaches and picks them too.
  await lineLabel(page, 'UHT-line 7').focus();
  await page.keyboard.press('Enter');
  await expect(viewport(page)).toHaveAttribute('data-focus', 'line:2:0');
  await expect(page.getByTestId('line-UHT-line 7')).toHaveAttribute('data-selected', 'true');

  await page.getByTestId('scene-overview').click();
  await expect(viewport(page)).not.toHaveAttribute('data-focus');
  await expect(page.locator('[data-selected]')).toHaveCount(0);
});

test('#3d opens the 3D view after a reload; Board shows the cards alone and keeps the floor; signing out takes it away', async ({ page, letReport }) => {
  void letReport;
  await open3d(page);
  await page.reload();
  await expect(viewport(page)).toBeVisible();
  await waitForFloor(page);

  await page.getByTestId('view-board').click();
  await expect(page).toHaveURL(/\/factory\.html\?debug$/);
  await expect(viewport(page)).toBeHidden();
  await expect(page.getByTestId('locate-uht').first()).toBeHidden();
  await expect(page.getByTestId('uht-UHT 2')).toBeVisible();

  // Back to 3D: the same floor, not a second one.
  await page.getByTestId('view-3d').click();
  await expect(viewport(page)).toBeVisible();
  expect(await builds(page)).toBe(1);
  await expect(viewport(page).locator('canvas')).toHaveCount(1);

  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await expect(viewport(page).locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => window.__factory3d === undefined), 'the debug hook went with the floor').toBe(true);
});

for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test(`the 3D view keeps the page to one screen at ${size.width} × ${size.height}: only the column of cards scrolls (phase 11)`, async ({
    page,
    letReport,
  }) => {
    void letReport;
    await page.setViewportSize(size);
    await openSignedIn(page, '?debug');
    await page.getByTestId('view-3d').click();
    await waitForFloor(page);
    // The screen-reader-only separators once stretched the page past the column's scroll box (phase 11 qa).
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight), 'the page is one screen high').toBe(size.height);
  });
}
