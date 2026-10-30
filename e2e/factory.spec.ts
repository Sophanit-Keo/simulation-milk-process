// The Factory board (factory.html, phase 9, D19): the factory's UHT plants and filling lines, live from Let
// Report, which e2e/letReportFake.ts fakes end to end (its auth, REST and realtime socket).
import { expect } from './fixtures';
import { waitForClock } from './helpers';
import {
  ACCESS_TOKEN,
  EMAIL,
  MIN_MS,
  PUBLISHABLE_KEY,
  SESSION_KEY,
  SUPABASE_ORIGIN,
  TOPIC,
  UHT_CARDS,
  drawOf,
  lineRow,
  openSignedIn,
  running,
  signIn,
  test,
  uhtCards,
} from './letReportFake';

test('signed out, the board shows only its sign-in form, and a wrong password gets an error', async ({ page, letReport, pageProblems }) => {
  await page.goto('/factory.html');
  const form = page.getByTestId('factory-signin');
  await expect(form).toBeVisible();
  await expect(page.getByTestId('live-state')).toBeHidden();
  await expect(page.getByTestId('sign-out')).toBeHidden();
  await expect(page.locator(UHT_CARDS)).toHaveCount(0);

  // An empty form is turned back by the page itself.
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('signin-error')).toHaveText('Enter your email.');
  expect(letReport.requests, 'no request for an empty form').toEqual([]);

  await signIn(page, 'wrong password');
  await expect(page.getByTestId('signin-error')).toHaveText('Wrong email or password.');
  await expect(page.getByTestId('signin-password')).toBeFocused();
  await expect(form).toBeVisible();
  await expect(page.getByTestId('live-state')).toBeHidden();
  await expect(page.locator(UHT_CARDS)).toHaveCount(0);
  expect(
    letReport.requests.map((request) => [request.method, request.path, request.params, request.body]),
    'the sign-in alone went to Let Report',
  ).toEqual([['POST', '/auth/v1/token', { grant_type: 'password' }, { email: EMAIL, password: 'wrong password' }]]);
  expect(letReport.sockets, 'no realtime socket while signed out').toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY), 'no session kept').toBeNull();

  // Let Report's 400 is the answer under test, not a fault of the page: it (and the failed load Chromium logs
  // for it) comes off the fixture's list, which must hold nothing else.
  const tokenUrl = `${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`;
  const isWrongPassword = (problem: string): boolean => problem.includes(tokenUrl) && problem.includes('400');
  await expect.poll(() => pageProblems.filter(isWrongPassword).length, 'the 400 is seen').toBeGreaterThan(0);
  expect(pageProblems.filter((problem) => !isWrongPassword(problem)), 'other page problems').toEqual([]);
  pageProblems.splice(0, pageProblems.length);
});

test('signed in, the three UHT cards show their lines and fillers, UHT 2 drawing 5,550 of 8,000 L/h, and the board goes live', async ({
  page,
  letReport,
}) => {
  await openSignedIn(page);
  await expect(page.getByTestId('user')).toHaveText(EMAIL);
  await expect(page.getByTestId('live-state')).toHaveAttribute('data-state', 'live');
  await expect(lineRow(page, 'UHT- line 2').getByTestId('line-filler')).toHaveText('TBA/19 · 7,500 packs/h · 100 ml');
  await expect(drawOf(page, 'UHT 2')).toHaveText('Producing · 5,550 of 8,000 L/h');

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
      lines: [
        running('UHT- line 2', 'TBA/19 · 7,500 packs/h · 100 ml'),
        running('UHT-line 3', 'A3/Speed · 24,000 packs/h · 100 ml'),
        running('UHT line 4', 'A3/Speed · 24,000 packs/h · 100 ml'),
      ],
    },
    {
      testId: 'uht-UHT 3',
      draw: 'Producing · 2,400 of 4,000 L/h',
      load: '60 % load',
      overCapacityShown: false,
      lines: [running('UHT-line 7', 'A3/Speed · 24,000 packs/h · 100 ml')],
    },
  ]);
  // The SCM and Yogurt lines have no UHT and are not UHT lines: the board leaves them out altogether.
  await expect(lineRow(page, 'SCM')).toHaveCount(0);
  await expect(lineRow(page, 'Yogurt')).toHaveCount(0);
  await expect(page.getByTestId('unassigned')).toBeHidden();

  // Each read went with the session's token and asked for what the board shows.
  expect(letReport.reads('production_lines').length).toBeGreaterThan(0);
  expect(letReport.reads('factory_settings').length).toBeGreaterThan(0);
  expect(letReport.reads('reports').length).toBeGreaterThan(0);
  // One socket, joined on the board's channel with the session's token, following the three tables.
  expect(letReport.sockets).toHaveLength(1);
  const [socket] = letReport.sockets;
  const socketUrl = new URL(socket.url);
  expect([socketUrl.protocol, socketUrl.searchParams.get('apikey'), socketUrl.searchParams.get('vsn')]).toEqual(['wss:', PUBLISHABLE_KEY, '1.0.0']);
  expect(socket.join).toMatchObject({
    topic: TOPIC,
    payload: {
      access_token: ACCESS_TOKEN,
      config: {
        postgres_changes: [
          { event: '*', schema: 'public', table: 'production_lines' },
          { event: '*', schema: 'public', table: 'factory_settings' },
          { event: '*', schema: 'public', table: 'reports' },
        ],
      },
    },
  });
});

test('a change in Let Report reaches the board over the socket: UHT line 3 stops and UHT 2 falls to 3,150 L/h', async ({ page, letReport }) => {
  await openSignedIn(page);
  await expect(drawOf(page, 'UHT 2')).toHaveText('Producing · 5,550 of 8,000 L/h');
  const status = lineRow(page, 'UHT-line 3').getByTestId('line-status');
  await expect(status).toHaveText('Running');
  // Marks this document: a reload would lose the mark.
  await page.evaluate(() => {
    (window as unknown as { sameDocument: boolean }).sameDocument = true;
  });
  const readsBefore = letReport.reads('production_lines').length;

  // Someone stops UHT line 3 in Let Report; its realtime feed reports the row's change.
  const line3 = letReport.line('UHT-line 3');
  line3.status = 'stopped';
  line3.status_since = new Date().toISOString();
  line3.updated_at = line3.status_since;
  const pushedMs = Date.now();
  expect(letReport.pushChange('production_lines', { ...line3 }), 'sockets told of the change').toBe(1);

  await expect(status).toHaveText('Stopped', { timeout: 2_000 });
  await expect(drawOf(page, 'UHT 2')).toHaveText('Producing · 3,150 of 8,000 L/h', { timeout: 2_000 });
  const shownMs = Date.now() - pushedMs;
  await expect(lineRow(page, 'UHT-line 3').locator('.lamp')).toHaveAttribute('data-status', 'bad');
  await expect(lineRow(page, 'UHT-line 3')).toHaveAttribute('data-status', 'stopped');
  await expect(page.getByTestId('uht-UHT 2').getByTestId('load')).toHaveText('39 % load');
  // The others are as they were.
  await expect(lineRow(page, 'UHT line 4').getByTestId('line-status')).toHaveText('Running');
  await expect(drawOf(page, 'UHT 1')).toHaveText('Producing · 2,360 of 4,000 L/h');
  await expect(page.getByTestId('live-state')).toHaveText(/^Live · last change \d{2}:\d{2}:\d{2}$/);

  // The change brought the read, not the 15 s poll, and the page did not reload.
  const readsAfterPush = letReport.reads('production_lines').filter((request) => request.atMs >= pushedMs);
  expect(readsAfterPush.length, 'production_lines read again after the change').toBeGreaterThan(0);
  expect(readsBefore, 'one read before the change').toBe(1);
  expect(shownMs, 'shown within 2 s of the change').toBeLessThan(2_000);
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument), 'the same document').toBe(true);
  expect(letReport.sockets, 'still the one socket').toHaveLength(1);
});

test('a line in CIP shows the time left, and the clock counts down', async ({ page, letReport }) => {
  // The page's clock runs as the real one, so that the test can jump it forward.
  await page.clock.install();
  const line7 = letReport.line('UHT-line 7');
  line7.status = 'cleaning';
  line7.cip_reason = 'standard';
  line7.cip_started_at = new Date().toISOString();
  line7.cip_until = new Date(Date.now() + 70 * MIN_MS).toISOString();
  await openSignedIn(page);

  const row = lineRow(page, 'UHT-line 7');
  const status = row.getByTestId('line-status');
  // 70 minutes from when the row was written: "1 h 10 min left" in its first second, then "1 h 09 min left".
  await expect(status).toHaveText(/^CIP · 1 h (09|10) min left$/);
  await expect(row.locator('.lamp')).toHaveAttribute('data-status', 'idle');
  await expect(row).toHaveAttribute('data-status', 'cleaning');
  // Its UHT has no other line, so it is in CIP too and draws nothing.
  await expect(drawOf(page, 'UHT 3')).toHaveText('CIP');

  // Five minutes on, with no change in Let Report, the clock has counted down five minutes.
  await page.clock.fastForward('05:00');
  await expect(status).toHaveText(/^CIP · 1 h (04|05) min left$/);
});

test('a reload keeps the session; signing out returns to the form and closes the socket', async ({ page, letReport }) => {
  await openSignedIn(page);
  // The session is kept, so a reload opens the board straight away, on a new socket.
  await page.reload();
  await expect(page.locator(UHT_CARDS)).toHaveCount(3);
  await expect(page.getByTestId('live-state')).toHaveText('Live');
  await expect(page.getByTestId('factory-signin')).toBeHidden();
  expect(
    letReport.requests.filter((request) => request.path === '/auth/v1/token'),
    'the reload needs no new sign-in',
  ).toHaveLength(1);
  await expect.poll(() => letReport.sockets.filter((socket) => socket.join).length).toBe(2);
  const socket = letReport.sockets[letReport.sockets.length - 1];

  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await expect(page.getByTestId('signin-error')).toHaveText('');
  await expect(page.locator(UHT_CARDS)).toHaveCount(0);
  await expect(page.getByTestId('live-state')).toBeHidden();
  await expect(page.getByTestId('sign-out')).toBeHidden();
  await expect.poll(() => socket.closed, 'the page closed its realtime socket').toBe(true);
  await expect
    .poll(() => letReport.requests.filter((request) => request.path === '/auth/v1/logout').map((request) => request.authorization))
    .toEqual([`Bearer ${ACCESS_TOKEN}`]);
  expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY), 'the session is forgotten').toBeNull();

  // Nothing comes back by itself: no read and no socket over a window longer than the first reconnect's
  // wait (2 s), even when Let Report changes. A window, not a wait for a condition.
  const requestsAfter = letReport.requests.length;
  expect(letReport.pushChange('production_lines', { ...letReport.line('UHT-line 1') }), 'no open socket to tell').toBe(0);
  await page.waitForTimeout(2_500);
  expect(letReport.requests.slice(requestsAfter), 'requests after signing out').toEqual([]);
  expect(letReport.sockets, 'no new socket').toHaveLength(2);

  // And a reload shows the form.
  await page.reload();
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await expect(page.locator(UHT_CARDS)).toHaveCount(0);
});

test("the 3D plant's top bar links to the Factory board, which opens on its sign-in form, and back", async ({ page, letReport }) => {
  await page.goto('/');
  await waitForClock(page);
  const link = page.getByTestId('factory-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('Factory');
  await expect(link).toHaveAttribute('href', 'factory.html');
  // Next to About, on the title's row.
  expect(await link.evaluate((node) => node.previousElementSibling?.getAttribute('data-testid'))).toBe('about');

  await link.click();
  await expect(page).toHaveURL(/\/factory\.html$/);
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Factory board' })).toBeVisible();
  expect(letReport.requests, 'nothing asked of Let Report while signed out').toEqual([]);

  const back = page.getByTestId('plant-link');
  await expect(back).toHaveAttribute('href', './');
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await waitForClock(page);
});
