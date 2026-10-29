// Let Report, faked for the Factory board's browser tests (factory.html: the board, phase 9, D19, and its 3D
// floor, phase 10, D20), so no test reaches its real Supabase: page.route answers its auth and REST requests, and
// page.routeWebSocket plays its realtime socket (Supabase Realtime's Phoenix protocol, as src/factory/supabase.ts
// speaks it). The fake holds the factory as Let Report holds it since its migration
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

/** Let Report's project, as the board reads it (src/data/letReport.json). */
export const letReportJson = JSON.parse(readFileSync(new URL('../src/data/letReport.json', import.meta.url), 'utf8')) as {
  supabaseUrl: string;
  publishableKey: string;
};
export const SUPABASE_ORIGIN = new URL(letReportJson.supabaseUrl).origin;
export const PUBLISHABLE_KEY = letReportJson.publishableKey;

export const EMAIL = 'qa@factory.test';
export const PASSWORD = 'right password';
export const ACCESS_TOKEN = 'fake-access-token';
export const REFRESH_TOKEN = 'fake-refresh-token';
export const USER_ID = '00000000-0000-4000-8000-0000000000a1';
/** Where the board keeps the session (src/factory/supabase.ts). */
export const SESSION_KEY = 'simulation-milk-process:let-report-session';
/** The board's realtime channel (src/factory/supabase.ts). */
export const TOPIC = 'realtime:simulation-factory';
export const MIN_MS = 60_000;
/** Every UHT card on the board, in page order. */
export const UHT_CARDS = '[data-testid^="uht-"]';

/** A production_lines row as Let Report's REST API returns it (migrations 0002, 0008, 0010, 0011 and 0013). */
export interface LetReportLine {
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
export const FACTORY: readonly (readonly [string, string, string, string, number | null])[] = [
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
export const UHT_UNITS = [
  { name: 'UHT 1', capacityLph: 4_000 },
  { name: 'UHT 2', capacityLph: 8_000 },
  { name: 'UHT 3', capacityLph: 4_000 },
];

/** Every line of the factory, all running since an hour ago. */
export function factoryLines(): LetReportLine[] {
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
export const EXPECTED_QUERIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  production_lines: { select: '*', order: 'sort.asc,created_at.asc' },
  factory_settings: { select: '*', id: 'eq.1' },
  reports: { select: 'id,loc,sev,status', status: 'neq.closed' },
};

/** One request the page sent to Let Report. */
export interface SentRequest {
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
export interface FakeSocket {
  url: string;
  route: WebSocketRoute;
  /** The page's messages, parsed. */
  received: Record<string, unknown>[];
  /** The phx_join, once the page has sent it (and the fake has answered it ok). */
  join: Record<string, unknown> | null;
  /** The page closed it. */
  closed: boolean;
}

export interface FakeLetReport {
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

export const jsonResponse = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

/** Supabase's answer to a password sign-in. */
export function sessionAnswer(): Record<string, unknown> {
  return {
    access_token: ACCESS_TOKEN,
    token_type: 'bearer',
    expires_in: 3_600,
    refresh_token: REFRESH_TOKEN,
    user: { id: USER_ID, email: EMAIL, aud: 'authenticated', role: 'authenticated' },
  };
}

/** Answers Let Report's origin for the page: auth, REST and the realtime socket. */
export async function fakeLetReport(page: Page): Promise<FakeLetReport> {
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
export const test = guarded.extend<{ letReport: FakeLetReport }>({
  letReport: async ({ page }, use) => {
    const fake = await fakeLetReport(page);
    await use(fake);
    expect(fake.unexpected, 'requests the fake Let Report could not answer').toEqual([]);
  },
});

/** Fills in the sign-in form and sends it. */
export async function signIn(page: Page, password = PASSWORD): Promise<void> {
  await page.getByTestId('signin-email').fill(EMAIL);
  await page.getByTestId('signin-password').fill(password);
  await page.getByTestId('signin-submit').click();
}

/**
 * Opens the board signed out, signs in, and waits for the three UHT cards and the live socket. `address` is
 * what follows factory.html: '?debug#3d' opens the 3D view with its debug hook.
 */
export async function openSignedIn(page: Page, address = ''): Promise<void> {
  await page.goto(`/factory.html${address}`);
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  await signIn(page);
  await expect(page.locator(UHT_CARDS)).toHaveCount(3);
  await expect(page.getByTestId('live-state')).toHaveText('Live');
}

export const lineRow = (page: Page, name: string): Locator => page.getByTestId(`line-${name}`);
export const drawOf = (page: Page, uht: string): Locator => page.getByTestId(`uht-${uht}`).getByTestId('draw');

/** What a UHT card shows, read in one go. */
export interface CardState {
  testId: string | null;
  draw: string;
  load: string;
  overCapacityShown: boolean;
  lines: { testId: string | null; status: string; filler: string; lamp: string | null }[];
}

/** Every UHT card on the board, in page order. */
export async function uhtCards(page: Page): Promise<CardState[]> {
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

export const running = (name: string, filler: string): CardState['lines'][number] => ({ testId: `line-${name}`, status: 'Running', filler, lamp: 'ok' });
