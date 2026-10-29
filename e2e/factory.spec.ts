// The Factory board (factory.html, phase 9, D19): the factory's UHT plants and filling lines, live from Let
// Report. Let Report is faked end to end, so no test reaches its real Supabase: page.route answers its auth and
// REST requests, and page.routeWebSocket plays its realtime socket (Supabase Realtime's Phoenix protocol, as
// src/factory/supabase.ts speaks it). The fake holds the factory as Let Report holds it since its migration
// 0013: six UHT lines on three UHT plants, and an SCM and a Yogurt line that the board leaves out.
//
// The guards of fixtures.ts still hold. Playwright runs the last matching route first, so the fake's route,
// added after the fixtures' block of every other origin, answers Let Report's origin before that block sees
// it; a request the fake does not expect is answered with an error and listed (each test then fails on the
// list), and any other origin is still blocked and fails the test. Only the wrong password's 400, which is
// Let Report's own answer, comes off the list of page problems, in the one test that sends it.
import { readFileSync } from 'node:fs';
import type { Locator, Page, Route, WebSocketRoute } from '@playwright/test';
import { expect, test as guarded } from './fixtures';
import { waitForClock } from './helpers';

/** Let Report's project, as the board reads it (src/data/letReport.json). */
const letReportJson = JSON.parse(readFileSync(new URL('../src/data/letReport.json', import.meta.url), 'utf8')) as {
  supabaseUrl: string;
  publishableKey: string;
};
const SUPABASE_ORIGIN = new URL(letReportJson.supabaseUrl).origin;
const PUBLISHABLE_KEY = letReportJson.publishableKey;

const EMAIL = 'qa@factory.test';
const PASSWORD = 'right password';
const ACCESS_TOKEN = 'fake-access-token';
const REFRESH_TOKEN = 'fake-refresh-token';
const USER_ID = '00000000-0000-4000-8000-0000000000a1';
/** Where the board keeps the session (src/factory/supabase.ts). */
const SESSION_KEY = 'simulation-milk-process:let-report-session';
/** The board's realtime channel (src/factory/supabase.ts). */
const TOPIC = 'realtime:simulation-factory';
const MIN_MS = 60_000;
/** Every UHT card on the board, in page order. */
const UHT_CARDS = '[data-testid^="uht-"]';

/** A production_lines row as Let Report's REST API returns it (migrations 0002, 0008, 0010, 0011 and 0013). */
interface LetReportLine {
  id: string;
  name: string;
  type: string;
  product: string;
  qty: number;
  target: number;
  status: 'running' | 'stopped' | 'cleaning' | 'changeover' | 'maintenance' | 'idle';
  note: string;
  sort: number;
  status_since: string;
  updated_by_name: string;
  updated_at: string;
  created_at: string;
  lot: string;
  lot_started_at: string | null;
  cip_until: string | null;
  cip_reason: string;
  cip_started_at: string | null;
  current_lot_id: number | null;
  uht: string;
  filler: string;
  filler_packs_per_h: number | null;
  pack_ml: number | null;
}

/**
 * The factory in Let Report, in its order (`sort`): name, type, UHT, filler and its speed in packs/h. Every
 * UHT line packs 100 ml. The names are written as the factory writes them; there is no line 5.
 */
const FACTORY: readonly (readonly [string, string, string, string, number | null])[] = [
  ['UHT-line 1', 'UHT', 'UHT 1', 'TFA', 3_600],
  ['UHT- line 2', 'UHT', 'UHT 2', 'TBA/19', 7_500],
  ['SCM', 'SCM', '', '', null],
  ['UHT-line 3', 'UHT', 'UHT 2', 'A3/Speed', 24_000],
  ['UHT line 4', 'UHT', 'UHT 2', 'A3/Speed', 24_000],
  ['UHT-line 6', 'UHT', 'UHT 1', 'TBA/22', 20_000],
  ['UHT-line 7', 'UHT', 'UHT 3', 'A3/Speed', 24_000],
  ['Yogurt', 'Yogurt', '', '', null],
];

/** factory_settings.uht_units (migration 0013). */
const UHT_UNITS = [
  { name: 'UHT 1', capacityLph: 4_000 },
  { name: 'UHT 2', capacityLph: 8_000 },
  { name: 'UHT 3', capacityLph: 4_000 },
];

/** Every line of the factory, all running since an hour ago. */
function factoryLines(): LetReportLine[] {
  const hourAgo = new Date(Date.now() - 60 * MIN_MS).toISOString();
  return FACTORY.map(([name, type, uht, filler, packsPerH], index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    name,
    type,
    product: type === 'UHT' ? 'UHT milk 100 ml' : type,
    qty: 40,
    target: 100,
    status: 'running',
    note: '',
    sort: index + 1,
    status_since: hourAgo,
    updated_by_name: 'Dara',
    updated_at: hourAgo,
    created_at: '2026-01-05T08:00:00+00:00',
    lot: '',
    lot_started_at: null,
    cip_until: null,
    cip_reason: '',
    cip_started_at: null,
    current_lot_id: null,
    uht,
    filler,
    filler_packs_per_h: packsPerH,
    pack_ml: type === 'UHT' ? 100 : null,
  }));
}

/** The queries the board sends, read decoded (the client percent-encodes the commas). */
const EXPECTED_QUERIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  production_lines: { select: '*', order: 'sort.asc,created_at.asc' },
  factory_settings: { select: '*', id: 'eq.1' },
  reports: { select: 'id,loc,sev,status', status: 'neq.closed' },
};

/** One request the page sent to Let Report. */
interface SentRequest {
  method: string;
  /** The path: '/auth/v1/token', '/rest/v1/production_lines'… */
  path: string;
  params: Record<string, string>;
  authorization: string | null;
  body: unknown;
  /** Date.now() when the fake got it. */
  atMs: number;
}

/** One realtime socket the page opened. */
interface FakeSocket {
  url: string;
  route: WebSocketRoute;
  /** The page's messages, parsed. */
  received: Record<string, unknown>[];
  /** The phx_join, once the page has sent it (and the fake has answered it ok). */
  join: Record<string, unknown> | null;
  /** The page closed it. */
  closed: boolean;
}

interface FakeLetReport {
  /** Let Report's lines, the plan and the open reports: change them, then push a change. */
  lines: LetReportLine[];
  settings: Record<string, unknown>;
  reports: Record<string, unknown>[];
  /** Every request the page sent to Let Report, in order (preflights left out). */
  requests: SentRequest[];
  /** What the fake could not answer: each fails the test. */
  unexpected: string[];
  sockets: FakeSocket[];
  line(name: string): LetReportLine;
  /** The page's REST reads of a table. */
  reads(table: string): SentRequest[];
  /** A postgres_changes message for `record` on every joined socket the page has not closed. */
  pushChange(table: string, record: Record<string, unknown>): number;
}

const jsonResponse = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

/** Supabase's answer to a password sign-in. */
function sessionAnswer(): Record<string, unknown> {
  return {
    access_token: ACCESS_TOKEN,
    token_type: 'bearer',
    expires_in: 3_600,
    refresh_token: REFRESH_TOKEN,
    user: { id: USER_ID, email: EMAIL, aud: 'authenticated', role: 'authenticated' },
  };
}

/** Answers Let Report's origin for the page: auth, REST and the realtime socket. */
async function fakeLetReport(page: Page): Promise<FakeLetReport> {
  const fake: FakeLetReport = {
    lines: factoryLines(),
    settings: {
      id: 1,
      run_choices: [24, 28, 32, 36],
      run_max_hours: 36,
      cip_hours: 4,
      fill_cip_hours: 2,
      fill_every_hours: 24,
      site_name: '',
      uht_units: UHT_UNITS,
      updated_by_name: '',
      updated_at: '2026-10-01T08:00:00+00:00',
    },
    reports: [],
    requests: [],
    unexpected: [],
    sockets: [],
    line(name) {
      const found = fake.lines.find((line) => line.name === name);
      if (!found) throw new Error(`the fake Let Report has no line ${name}`);
      return found;
    },
    reads: (table) => fake.requests.filter((request) => request.path === `/rest/v1/${table}`),
    pushChange(table, record) {
      const open = fake.sockets.filter((socket) => socket.join && !socket.closed);
      for (const socket of open) {
        socket.route.send(
          JSON.stringify({
            topic: TOPIC,
            event: 'postgres_changes',
            ref: null,
            payload: {
              ids: [1],
              data: {
                schema: 'public',
                table,
                type: 'UPDATE',
                commit_timestamp: new Date().toISOString(),
                record,
                old_record: { id: record.id },
                columns: [],
                errors: null,
              },
            },
          }),
        );
      }
      return open.length;
    },
  };

  await page.route(
    (url) => url.origin === SUPABASE_ORIGIN,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      // A CORS preflight, should one reach the route: allow the board's headers.
      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
          },
        });
      }
      let body: unknown;
      try {
        body = request.postDataJSON() as unknown;
      } catch {
        body = request.postData();
      }
      const headers = request.headers();
      const sent: SentRequest = {
        method: request.method(),
        path: url.pathname,
        params: Object.fromEntries(url.searchParams),
        authorization: headers.authorization ?? null,
        body,
        atMs: Date.now(),
      };
      fake.requests.push(sent);
      const refuse = (why: string): Promise<void> => {
        fake.unexpected.push(`${sent.method} ${request.url()}: ${why}`);
        return jsonResponse(route, 400, { code: 'not_faked', message: `The fake Let Report does not answer this: ${why}` });
      };

      if (headers.apikey !== PUBLISHABLE_KEY) return refuse(`apikey ${headers.apikey}`);
      const signedIn = sent.authorization === `Bearer ${ACCESS_TOKEN}`;

      if (url.pathname === '/auth/v1/token' && sent.method === 'POST') {
        const grant = sent.params.grant_type;
        const fields = (body ?? {}) as Record<string, unknown>;
        if (grant === 'password' && fields.email === EMAIL && fields.password === PASSWORD) return jsonResponse(route, 200, sessionAnswer());
        if (grant === 'password') {
          return jsonResponse(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        if (grant === 'refresh_token' && fields.refresh_token === REFRESH_TOKEN) return jsonResponse(route, 200, sessionAnswer());
        return refuse(`grant ${grant}`);
      }
      if (url.pathname === '/auth/v1/logout' && sent.method === 'POST') {
        if (!signedIn) return refuse(`logout with ${sent.authorization}`);
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      const table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)?.[1];
      if (table !== undefined && sent.method === 'GET') {
        if (!signedIn) return refuse(`read with ${sent.authorization}`);
        const expected = EXPECTED_QUERIES[table];
        if (!expected) return refuse(`no table ${table} on the board`);
        if (JSON.stringify(sent.params) !== JSON.stringify(expected)) return refuse(`query ${JSON.stringify(sent.params)}`);
        const rows = table === 'production_lines' ? fake.lines : table === 'factory_settings' ? [fake.settings] : fake.reports;
        return jsonResponse(route, 200, rows);
      }
      return refuse('no such path in the fake');
    },
  );

  await page.routeWebSocket(
    (url) => url.origin.replace(/^ws/, 'http') === SUPABASE_ORIGIN && url.pathname === '/realtime/v1/websocket',
    (ws) => {
      const socket: FakeSocket = { url: ws.url(), route: ws, received: [], join: null, closed: false };
      fake.sockets.push(socket);
      ws.onMessage((message) => {
        const msg = JSON.parse(String(message)) as Record<string, unknown>;
        socket.received.push(msg);
        if (msg.event === 'phx_join') {
          socket.join = msg;
          ws.send(JSON.stringify({ topic: msg.topic, event: 'phx_reply', ref: msg.ref, join_ref: msg.join_ref, payload: { status: 'ok', response: {} } }));
        } else if (msg.event === 'heartbeat') {
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', ref: msg.ref, payload: { status: 'ok', response: {} } }));
        }
      });
      ws.onClose(() => {
        socket.closed = true;
      });
    },
  );
  return fake;
}

/** The guarded test, with Let Report faked; a request the fake could not answer fails it. */
const test = guarded.extend<{ letReport: FakeLetReport }>({
  letReport: async ({ page }, use) => {
    const fake = await fakeLetReport(page);
    await use(fake);
    expect(fake.unexpected, 'requests the fake Let Report could not answer').toEqual([]);
  },
});

/** Fills in the sign-in form and sends it. */
async function signIn(page: Page, password = PASSWORD): Promise<void> {
  await page.getByTestId('signin-email').fill(EMAIL);
  await page.getByTestId('signin-password').fill(password);
  await page.getByTestId('signin-submit').click();
}

/** Opens the board signed out, signs in, and waits for the three UHT cards and the live socket. */
async function openSignedIn(page: Page): Promise<void> {
  await page.goto('/factory.html');
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await signIn(page);
  await expect(page.locator(UHT_CARDS)).toHaveCount(3);
  await expect(page.getByTestId('live-state')).toHaveText('Live');
}

const lineRow = (page: Page, name: string): Locator => page.getByTestId(`line-${name}`);
const drawOf = (page: Page, uht: string): Locator => page.getByTestId(`uht-${uht}`).getByTestId('draw');

/** What a UHT card shows, read in one go. */
interface CardState {
  testId: string | null;
  draw: string;
  load: string;
  overCapacityShown: boolean;
  lines: { testId: string | null; status: string; filler: string; lamp: string | null }[];
}

/** Every UHT card on the board, in page order. */
async function uhtCards(page: Page): Promise<CardState[]> {
  return page.evaluate((selector) => {
    const text = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll(selector)].map((card) => ({
      testId: card.getAttribute('data-testid'),
      draw: text(card.querySelector('[data-testid="draw"]')),
      load: text(card.querySelector('[data-testid="load"]')),
      overCapacityShown: card.querySelector('[data-testid="over-capacity"]')?.checkVisibility() ?? false,
      lines: [...card.querySelectorAll('[data-testid^="line-"][data-status]')].map((row) => ({
        testId: row.getAttribute('data-testid'),
        status: text(row.querySelector('[data-testid="line-status"]')),
        filler: text(row.querySelector('[data-testid="line-filler"]')),
        lamp: row.querySelector('.lamp')?.getAttribute('data-status') ?? null,
      })),
    }));
  }, UHT_CARDS);
}

const running = (name: string, filler: string): CardState['lines'][number] => ({ testId: `line-${name}`, status: 'Running', filler, lamp: 'ok' });

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
