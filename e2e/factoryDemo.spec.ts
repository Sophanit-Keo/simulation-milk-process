// The Factory board's demo (factory.html?demo, phase 11, D21): a made-up day at the factory, on the board and its
// 3D floor, for anyone without a Let Report account. It needs no fake, and nothing may reach Let Report: the
// fixtures block and list every request to another origin, this file blocks and lists every socket to one, and
// nothing may be stored.
//
// The demo's script runs on the page's clock (demoData.ts, from the demo's first reading of Date.now). The page's
// clock is set before the page loads (page.clock.setFixedTime): Date.now stands at T0 while the timers and frames
// run on in real time, so the demo begins at T0 exactly, and each later setFixedTime moves its script on to an
// exact time. The demo's client looks for its next change every second and the page redraws every second
// (DEMO_TICK_MS, main.ts), so each change shows within a second or two.
//
// On the floor the script moves on with the board alone in view (moveTo), and the floor is then shown again to be
// read (show3d). Playwright's clock runs the page's timers and its animation frames on one queue of its own; with
// the floor's frames drawn in software GL that queue falls behind, and a page's 300 ms timer then takes 1.5 to 12 s
// of real time (measured on this machine). On the board alone the floor's frame loop stops and the timers keep
// time, and the floor still takes every view the board draws (main.ts draws it on each reload and each second).
import type { Locator, Page } from '@playwright/test';
import { expect, test as guarded } from './fixtures';
import { SESSION_KEY, UHT_CARDS, cipBarWidth, drawOf, lineRow, lineStory, running, uhtCards } from './letReportFake';

const MIN_MS = 60_000;
/** Where the demo begins in every test: the page's clock stands here as the page loads. */
const T0_MS = Date.UTC(2026, 10, 2, 8, 0, 0);

/** The guarded test, with every socket to another origin blocked and listed: there must be none. */
const test = guarded.extend<{ foreignSockets: string[] }>({
  foreignSockets: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL');
      // Vite's own socket (hot reload) is the app's; any other is blocked, never connected.
      const appHost = new URL(baseURL).host;
      const urls: string[] = [];
      await page.routeWebSocket(
        (url) => url.host !== appHost,
        (ws) => {
          urls.push(ws.url());
          void ws.close({ code: 1008, reason: 'blocked by the test' });
        },
      );
      await use(urls);
      expect(urls, 'sockets to another origin').toEqual([]);
    },
    { auto: true },
  ],
});

/** The floor's machines by place (layout.ts): the three UHTs, then each bay's fillers left to right. */
const MACHINES = ['uht:0', 'uht:1', 'uht:2', 'line:0:0', 'line:0:1', 'line:1:0', 'line:1:1', 'line:1:2', 'line:2:0'];
/** UHT-line 3's filler, and UHT-line 7's. */
const LINE_3 = 'line:1:1';
const LINE_7 = 'line:2:0';

type FloorDebug = NonNullable<Window['__factory3d']>;
type Machine = ReturnType<FloorDebug['machines']>[number];

const machines = (page: Page): Promise<Machine[]> => page.evaluate(() => window.__factory3d?.machines() ?? []);
const builds = (page: Page): Promise<number> => page.evaluate(() => window.__factory3d?.builds() ?? 0);

async function machine(page: Page, id: string): Promise<Machine> {
  const found = (await machines(page)).find((one) => one.id === id);
  if (!found) throw new Error(`no machine ${id} on the floor`);
  return found;
}

/** Each filler's trouble marker (the severity it shows, or null) and CIP ring (the share drawn, or null), by place. */
async function markers(page: Page): Promise<[string, number | null | undefined, number | null | undefined][]> {
  return (await machines(page)).filter((one) => one.kind === 'line').map((one) => [one.id, one.trouble, one.cipRing]);
}

const viewport = (page: Page): Locator => page.getByTestId('factory-3d');
const uhtLabel = (page: Page, name: string): Locator => page.getByTestId(`scene-uht-${name}`);
const lineLabel = (page: Page, name: string): Locator => page.getByTestId(`scene-line-${name}`);

/** The page's clock at `minutes` into the demo's script. */
const at = (minutes: number): number => T0_MS + minutes * MIN_MS;

/**
 * Moves the demo's script on to `minutes` from its start, with the board alone in view (see the top of the file),
 * and waits until the board has read the demo's rows at that minute. The CIP's share and the clocks are worked out
 * afresh each second from the last rows, so they move on before the rows are read again; UHT-line 1 runs all
 * through the script, so its output (40, and one more each minute) says which minute's rows the board has.
 */
async function moveTo(page: Page, minutes: number): Promise<void> {
  const board = page.getByTestId('view-board');
  if ((await board.getAttribute('aria-pressed')) !== 'true') {
    await board.click();
    await expect(viewport(page)).toBeHidden();
  }
  await page.clock.setFixedTime(at(minutes));
  await expect(lineRow(page, 'UHT-line 1').getByTestId('line-output'), `the rows at ${minutes}:00`).toHaveText(`Output ${40 + minutes} of 100`);
}

/** Shows the floor again, the same floor, to read it once the board has shown the script's change. */
async function show3d(page: Page): Promise<void> {
  await page.getByTestId('view-3d').click();
  await expect(viewport(page)).toBeVisible();
}

/** Opens the demo at 0:00 of its script: factory.html?demo, then `rest` ('&debug#3d' for the floor with its hook). */
async function openDemo(page: Page, rest = ''): Promise<void> {
  await page.clock.setFixedTime(T0_MS);
  await page.goto(`/factory.html?demo${rest}`);
  await expect(page.locator(UHT_CARDS)).toHaveCount(3);
  await expect(page.getByTestId('live-state')).toHaveText('Live');
}

/** Waits for the floor to be built with the factory's nine machines, and for the hero filler on all six lines. */
async function waitForFloor(page: Page): Promise<void> {
  await expect(viewport(page)).toBeVisible();
  await expect.poll(async () => (await machines(page)).map((one) => one.id), { timeout: 30_000 }).toEqual(MACHINES);
  await expect
    .poll(async () => (await machines(page)).filter((one) => one.hero).length, { message: 'the hero filler loaded for every line', timeout: 30_000 })
    .toBe(6);
}

/** What the page has stored: the demo stores nothing. */
const stored = (page: Page): Promise<{ local: string[]; session: string[] }> =>
  page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));

const NOTHING_STORED = { local: [], session: [] };

const FILLER_A3 = 'A3/Speed · 24,000 packs/h · 100 ml';

test('"Try the demo" on the sign-in form opens the demo with no account: its banner, "Demo" and "Leave demo", the factory running, and nothing sent or stored', async ({
  page,
  thirdPartyRequests,
}) => {
  await page.clock.setFixedTime(T0_MS);
  await page.goto('/factory.html');
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  const tryDemo = page.getByTestId('try-demo');
  await expect(tryDemo).toHaveText('Try the demo');
  await expect(tryDemo).toHaveAttribute('href', 'factory.html?demo');
  await expect(page.getByTestId('factory-signin').locator('.fb-try-demo')).toHaveText('No Let Report account? Try the demo');

  await tryDemo.click();
  await expect(page).toHaveURL(/\/factory\.html\?demo$/);
  // Signed in as the demo at once: no form, no email, no password.
  await expect(page.locator(UHT_CARDS)).toHaveCount(3);
  await expect(page.getByTestId('factory-signin')).toBeHidden();
  await expect(page).toHaveTitle('Demo · Factory board · UHT milk plant');
  const banner = page.getByTestId('demo-banner');
  await expect(banner).toBeVisible();
  await expect(banner.locator('.fb-demo-text')).toHaveText(
    "Demo: a made-up day at the factory, not Let Report's data. Lines stop, clean and change over on their own.",
  );
  const leave = banner.getByTestId('leave-demo');
  await expect(leave).toHaveText('Leave the demo');
  await expect(leave).toHaveAttribute('href', 'factory.html');
  await expect(page.getByTestId('user')).toHaveText('Demo');
  await expect(page.getByTestId('sign-out')).toHaveText('Leave demo');
  await expect(page.getByTestId('live-state')).toHaveText('Live');
  await expect(page.getByTestId('live-state')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('site-name')).toHaveText('Demo factory');
  await expect(page.getByTestId('summary')).toHaveText('6 of 6 lines running · 10,310 of 16,000 L/h');
  await expect(drawOf(page, 'UHT 2')).toHaveText('Producing · 5,550 of 8,000 L/h');

  // The real factory's layout (D19), every line running at 0:00 of the script.
  expect(await uhtCards(page)).toEqual([
    {
      testId: 'uht-UHT 1',
      draw: 'Producing · 2,360 of 4,000 L/h',
      load: '59 % load',
      overCapacityShown: false,
      lines: [running('UHT-line 1', 'TFA · 3,600 packs/h · 100 ml'), running('UHT-line 6', 'TBA/22 · 20,000 packs/h · 100 ml')],
    },
    {
      testId: 'uht-UHT 2',
      draw: 'Producing · 5,550 of 8,000 L/h',
      load: '69 % load',
      overCapacityShown: false,
      lines: [running('UHT- line 2', 'TBA/19 · 7,500 packs/h · 100 ml'), running('UHT-line 3', FILLER_A3), running('UHT line 4', FILLER_A3)],
    },
    {
      testId: 'uht-UHT 3',
      draw: 'Producing · 2,400 of 4,000 L/h',
      load: '60 % load',
      overCapacityShown: false,
      lines: [running('UHT-line 7', FILLER_A3)],
    },
  ]);
  await expect(lineRow(page, 'SCM')).toHaveCount(0);
  await expect(lineRow(page, 'Yogurt')).toHaveCount(0);
  // Each line has run since two hours before the script began, on a lot started earlier in the shift.
  const line3 = lineRow(page, 'UHT-line 3');
  expect(await lineStory(line3)).toEqual({ status: 'Running', story: 'for 2 h 00 min · by Shift lead', note: '', cip: '', troubles: '' });
  await expect(line3.getByTestId('line-product')).toHaveText('UHT milk 100 ml · lot DEMO-05');
  await expect(line3.getByTestId('line-lot-clock')).toHaveText('running for 1 h 20 min');
  await expect(line3.getByTestId('line-output')).toHaveText('Output 40 of 100');
  await expect(page.getByTestId('line-story')).toHaveText(Array(6).fill('for 2 h 00 min · by Shift lead'));

  // A minute on, each running line's output has counted up by one, as a change the demo's client reported.
  await moveTo(page, 1);
  await expect(line3.getByTestId('line-output')).toHaveText('Output 41 of 100');
  await expect(page.getByTestId('live-state')).toHaveText(/^Live · last change \d{2}:\d{2}:\d{2}$/);

  expect(thirdPartyRequests, 'requests to Let Report or any other origin').toEqual([]);
  expect(await stored(page), 'nothing stored').toEqual(NOTHING_STORED);
  expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY), 'no session kept').toBeNull();
});

test('factory.html?demo#3d opens the demo straight on its floor, signed in as the demo, with nothing sent or stored', async ({
  page,
  thirdPartyRequests,
}) => {
  await openDemo(page, '#3d');
  await expect(page.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewport(page)).toBeVisible();
  await expect(viewport(page).locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('factory-signin')).toBeHidden();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('user')).toHaveText('Demo');
  // The way out keeps the 3D view.
  await expect(page.getByTestId('leave-demo')).toHaveAttribute('href', 'factory.html#3d');
  // The floor's labels say what the cards say.
  await expect(uhtLabel(page, 'UHT 2')).toHaveAttribute('aria-label', 'UHT 2: Producing · 5,550 of 8,000 L/h');
  await expect(lineLabel(page, 'UHT-line 3')).toHaveAttribute('aria-label', `UHT-line 3, ${FILLER_A3}: Running`);
  await expect(page.locator('[data-testid^="scene-line-"]')).toHaveCount(6);
  expect(await page.evaluate(() => window.__factory3d === undefined), 'no debug hook without ?debug').toBe(true);

  expect(thirdPartyRequests, 'requests to Let Report or any other origin').toEqual([]);
  expect(await stored(page), 'nothing stored').toEqual(NOTHING_STORED);
});

test('factory.html?demo#3d: at 2:00 UHT-line 3 stops on the board and the floor, with its trouble marker; its label then says for how long; the trouble waits for verification and closes', async ({
  page,
  thirdPartyRequests,
}) => {
  test.setTimeout(180_000);
  await openDemo(page, '&debug#3d');
  await expect(page.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await waitForFloor(page);
  const row = lineRow(page, 'UHT-line 3');
  const label = lineLabel(page, 'UHT-line 3');
  await expect(label).toHaveAttribute('aria-label', `UHT-line 3, ${FILLER_A3}: Running`);
  await expect(uhtLabel(page, 'UHT 2')).toHaveAttribute('aria-label', 'UHT 2: Producing · 5,550 of 8,000 L/h');
  expect(await machine(page, LINE_3)).toMatchObject({ lamp: 'ok', belt: 'moving', trouble: null, cipRing: null });
  expect(await markers(page), 'no marker and no ring at 0:00').toEqual(MACHINES.slice(3).map((id) => [id, null, null]));
  const built = await builds(page);

  // 2:00: the operator stops it, with a note, and a high trouble opens at it.
  await moveTo(page, 2);
  await expect(row.getByTestId('line-status')).toHaveText('Stopped');
  expect(await lineStory(row)).toEqual({
    status: 'Stopped',
    story: 'for 0 s · by Operator',
    note: 'Note: Jaws not sealing',
    cip: '',
    troubles: '1 open trouble · high',
  });
  await expect(row.getByTestId('line-note')).toHaveText('Jaws not sealing');
  await expect(row.getByTestId('line-troubles')).toHaveAttribute('data-sev', '2');
  await expect(row).toHaveAttribute('data-status', 'stopped');
  await expect(drawOf(page, 'UHT 2')).toHaveText('Producing · 3,150 of 8,000 L/h');
  // On the floor: its label, its marker in the trouble's severity, its packs standing; UHT 2 draws less.
  await show3d(page);
  const stoppedWords = `UHT-line 3, ${FILLER_A3}: Stopped, 1 open trouble · high`;
  await expect(label).toBeVisible();
  await expect(label).toHaveAttribute('aria-label', stoppedWords);
  await expect(label).toHaveAttribute('data-status', 'bad');
  await expect(label).toHaveAttribute('title', `${stoppedWords}\nNote: Jaws not sealing\nChanged by Operator`);
  await expect(uhtLabel(page, 'UHT 2')).toHaveAttribute('aria-label', 'UHT 2: Producing · 3,150 of 8,000 L/h');
  expect(await machine(page, LINE_3)).toMatchObject({ lamp: 'bad', belt: 'still', beltMps: 0, trouble: 2, cipRing: null });
  expect(await markers(page), 'a marker over UHT-line 3 alone').toEqual(MACHINES.slice(3).map((id) => [id, id === LINE_3 ? 2 : null, null]));

  // A minute on, its label says how long it has stood, as its row does.
  await moveTo(page, 3);
  await expect(row.getByTestId('line-story')).toHaveText('for 1 min 00 s · by Operator');
  await expect(row.getByTestId('line-status')).toHaveText('Stopped');
  await show3d(page);
  await expect(label).toHaveAttribute('aria-label', `UHT-line 3, ${FILLER_A3}: Stopped · 1 min 00 s, 1 open trouble · high`);

  // 6:00: it runs again; its trouble waits for verification, still open, so the marker stays.
  await moveTo(page, 6);
  await expect(row.getByTestId('line-status')).toHaveText('Running');
  expect(await lineStory(row)).toEqual({ status: 'Running', story: 'for 0 s · by Operator', note: '', cip: '', troubles: '1 open trouble · high' });
  await expect(drawOf(page, 'UHT 2')).toHaveText('Producing · 5,550 of 8,000 L/h');
  await show3d(page);
  await expect(label).toHaveAttribute('aria-label', `UHT-line 3, ${FILLER_A3}: Running, 1 open trouble · high`);
  expect(await machine(page, LINE_3)).toMatchObject({ lamp: 'ok', belt: 'moving', trouble: 2 });

  // 10:00: the trouble closes, and its marker goes.
  await moveTo(page, 10);
  await expect(row.getByTestId('line-troubles')).toBeHidden();
  await show3d(page);
  await expect(label).toHaveAttribute('aria-label', `UHT-line 3, ${FILLER_A3}: Running`);
  expect((await machine(page, LINE_3)).trouble).toBeNull();
  // A change of status never builds the floor again.
  expect(await builds(page)).toBe(built);

  expect(thirdPartyRequests, 'requests to Let Report or any other origin').toEqual([]);
  expect(await stored(page), 'nothing stored').toEqual(NOTHING_STORED);
});

test("from 4:00 UHT-line 7 cleans for 12 minutes: its row shows the CIP's reason and share, its ring on the floor fills, UHT 3 is in CIP", async ({
  page,
  thirdPartyRequests,
}) => {
  test.setTimeout(180_000);
  await openDemo(page, '&debug#3d');
  await waitForFloor(page);
  const row = lineRow(page, 'UHT-line 7');
  const label = lineLabel(page, 'UHT-line 7');
  const ring = async (): Promise<number | null | undefined> => (await machine(page, LINE_7)).cipRing;
  expect(await ring()).toBeNull();

  // 4:00: a standard CIP until 16:00.
  await moveTo(page, 4);
  await expect(row.getByTestId('line-status')).toHaveText('CIP · 12 min left');
  expect(await lineStory(row)).toEqual({ status: 'CIP · 12 min left', story: 'for 0 s · by Operator', note: '', cip: 'Standard CIP · 0 % done', troubles: '' });
  await expect(row).toHaveAttribute('data-status', 'cleaning');
  await expect(drawOf(page, 'UHT 3')).toHaveText('CIP');
  await expect(page.getByTestId('uht-UHT 3')).toHaveAttribute('data-state', 'cip');
  await show3d(page);
  await expect(label).toHaveAttribute('aria-label', `UHT-line 7, ${FILLER_A3}: CIP · 12 min left`);
  await expect(label).toHaveAttribute('data-status', 'idle');
  await expect(uhtLabel(page, 'UHT 3')).toHaveAttribute('aria-label', 'UHT 3: CIP');
  // The ring shows, empty; the filler's belt empties, its pipe and its train's carry the cleaning fluid.
  expect(await machine(page, LINE_7)).toMatchObject({ lamp: 'idle', belt: 'empty', trouble: null, cipRing: 0 });
  const cleaning = await page.evaluate(() => (window.__factory3d?.pipes() ?? []).filter((pipe) => pipe.cleaning).map((pipe) => pipe.id).sort());
  expect(cleaning).toEqual(['header:2', 'line:2:0', 'uht:2']);

  // 7:00: a quarter done.
  await moveTo(page, 7);
  await expect(row.getByTestId('line-cip')).toHaveText('Standard CIP · 25 % done');
  await expect(row.getByTestId('line-status')).toHaveText('CIP · 9 min 00 s left');
  await expect(row.getByTestId('line-story')).toHaveText('for 3 min 00 s · by Operator');
  expect(await cipBarWidth(row)).toBe('25%');
  await show3d(page);
  await expect(label).toHaveAttribute('aria-label', `UHT-line 7, ${FILLER_A3}: CIP · 9 min 00 s left`);
  expect(await ring()).toBe(0.25);

  // 10:00: half done.
  await moveTo(page, 10);
  await expect(row.getByTestId('line-cip')).toHaveText('Standard CIP · 50 % done');
  await expect(row.getByTestId('line-status')).toHaveText('CIP · 6 min 00 s left');
  expect(await cipBarWidth(row)).toBe('50%');
  await expect(drawOf(page, 'UHT 3')).toHaveText('CIP');
  await show3d(page);
  expect(await ring()).toBe(0.5);
  expect(await markers(page), 'the ring round UHT-line 7 alone').toEqual(MACHINES.slice(3).map((id) => [id, null, id === LINE_7 ? 0.5 : null]));

  // 16:00: it runs again, on a new lot, and the ring goes.
  await moveTo(page, 16);
  await expect(row.getByTestId('line-status')).toHaveText('Running');
  expect(await lineStory(row)).toEqual({ status: 'Running', story: 'for 0 s · by QA', note: '', cip: '', troubles: '' });
  await expect(row.getByTestId('line-product')).toHaveText('UHT milk 100 ml · lot DEMO-10');
  await expect(drawOf(page, 'UHT 3')).toHaveText('Producing · 2,400 of 4,000 L/h');
  await show3d(page);
  await expect(label).toHaveAttribute('aria-label', `UHT-line 7, ${FILLER_A3}: Running`);
  expect(await ring()).toBeNull();
  expect(await machine(page, LINE_7)).toMatchObject({ lamp: 'ok', belt: 'moving' });

  expect(thirdPartyRequests, 'requests to Let Report or any other origin').toEqual([]);
  expect(await stored(page), 'nothing stored').toEqual(NOTHING_STORED);
});

test('"Leave the demo" and "Leave demo" return to the sign-in form at factory.html, in the same view, and "Try the demo" goes back in', async ({
  page,
  thirdPartyRequests,
}) => {
  test.setTimeout(180_000);
  // From the board: the banner's link.
  await openDemo(page);
  const leave = page.getByTestId('leave-demo');
  await expect(leave).toHaveAttribute('href', 'factory.html');
  await leave.click();
  await expect(page).toHaveURL(/\/factory\.html$/);
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await expect(page).toHaveTitle('Factory board · UHT milk plant');
  await expect(page.locator(UHT_CARDS)).toHaveCount(0);
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(page.getByTestId('sign-out')).toBeHidden();
  await expect(page.getByTestId('live-state')).toBeHidden();

  // From the floor: "Leave demo" in the header keeps the 3D view (and ?debug).
  await openDemo(page, '&debug#3d');
  await waitForFloor(page);
  await expect(page.getByTestId('leave-demo')).toHaveAttribute('href', 'factory.html?debug#3d');
  const leaveDemo = page.getByTestId('sign-out');
  await expect(leaveDemo).toHaveText('Leave demo');
  await leaveDemo.click();
  await expect(page).toHaveURL(/\/factory\.html\?debug#3d$/);
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await expect(page.locator(UHT_CARDS)).toHaveCount(0);
  await expect(viewport(page).locator('canvas')).toHaveCount(0);
  // Signed out, the page loads no floor; "Try the demo" opens the demo in the 3D view again.
  const tryDemo = page.getByTestId('try-demo');
  await expect(tryDemo).toHaveAttribute('href', 'factory.html?demo&debug#3d');
  await tryDemo.click();
  await expect(page).toHaveURL(/\/factory\.html\?demo&debug#3d$/);
  await expect(page.locator(UHT_CARDS)).toHaveCount(3);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await waitForFloor(page);

  expect(thirdPartyRequests, 'requests to Let Report or any other origin').toEqual([]);
  expect(await stored(page), 'nothing stored').toEqual(NOTHING_STORED);
});
