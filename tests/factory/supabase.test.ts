// The Factory board's Let Report client (src/factory/supabase.ts, D19): it signs in, keeps and refreshes the
// session, reads the three tables as Let Report reads them, and follows their changes over the realtime socket.
// Let Report is faked: a fetch that records each request and answers from a table of routes, and a WebSocket
// class whose sockets the test opens, feeds and drops. The socket's waits run on fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError, createFactoryClient } from '../../src/factory/supabase';
import type { ClientOptions, FactoryClient, LineRow, LiveState, ReportRow, Session, WatchedTable } from '../../src/factory/types';

const SUPABASE_URL = 'https://project.supabase.co';
const KEY = 'sb_publishable_test';
const SESSION_KEY = 'simulation-milk-process:let-report-session';
const TOPIC = 'realtime:simulation-factory';
const USER = { id: 'user-1', email: 'qa@factory.test' };

// ───── A fake Let Report: fetch ─────

/** A request as the fake fetch saw it. */
interface Sent {
  url: string;
  /** "POST /auth/v1/token?grant_type=password", "GET /rest/v1/reports": the route it took. */
  route: string;
  method: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

interface Reply {
  status?: number;
  body?: unknown;
}

/** An answer, a rejected fetch (an Error: offline), or a function of the request giving either. */
type Route = Reply | Error | ((request: Sent) => Reply | Error | Promise<Reply | Error>);

function fakeFetch(routes: Record<string, Route>) {
  const sent: Sent[] = [];
  /** What `this` each call had: the page's fetch throws "Illegal invocation" when it is not the page. */
  const thisValues: unknown[] = [];
  const impl = async function (this: unknown, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    thisValues.push(this);
    const url = new URL(String(input));
    const grant = url.searchParams.get('grant_type');
    const method = init.method ?? 'GET';
    const request: Sent = {
      url: String(input),
      route: `${method} ${url.pathname}${grant ? `?grant_type=${grant}` : ''}`,
      method,
      query: Object.fromEntries(url.searchParams),
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    };
    sent.push(request);
    const route = routes[request.route] ?? { status: 599, body: { message: `Not faked: ${request.route}` } };
    const answer = typeof route === 'function' ? await route(request) : route;
    if (answer instanceof Error) throw answer;
    const status = answer.status ?? 200;
    // Only what the client reads of a Response.
    return { ok: status >= 200 && status < 300, status, text: async () => (answer.body === undefined ? '' : JSON.stringify(answer.body)) } as Response;
  };
  return { fetch: impl as typeof fetch, sent, thisValues };
}

const tokenAnswer = (token: string, extra: Record<string, unknown> = {}) => ({
  access_token: token,
  token_type: 'bearer',
  expires_in: 3_600,
  expires_at: 2_000_000_000,
  refresh_token: `refresh-${token}`,
  user: { ...USER, role: 'authenticated' },
  ...extra,
});

const LINES: LineRow[] = [
  { id: 'l2', name: 'UHT line 2', type: 'UHT', product: 'UHT milk 1 L', qty: 0, target: 0, status: 'running', sort: 2, uht: 'UHT 2', filler: 'TBA/19', filler_packs_per_h: 7_500, pack_ml: 100 },
  { id: 'l3', name: 'UHT line 3', type: 'UHT', product: 'UHT milk 1 L', qty: 0, target: 0, status: 'cleaning', sort: 3, cip_until: '2026-10-29T10:00:00Z' },
];
const SETTINGS = { id: 1, site_name: 'Factory', uht_units: [{ name: 'UHT 2', capacityLph: 8_000 }] };
const REPORTS: ReportRow[] = [{ id: 'r1', loc: 'UHT line 3', sev: 2, status: 'open' }];

/** Let Report with the three tables filled in, and these routes over them. */
const letReport = (routes: Record<string, Route> = {}) =>
  fakeFetch({
    'GET /rest/v1/production_lines': { body: LINES },
    'GET /rest/v1/factory_settings': { body: [SETTINGS] },
    'GET /rest/v1/reports': { body: REPORTS },
    ...routes,
  });

// ───── The session's storage ─────

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** A session that expires `expiresInS` from now, as the client keeps it. */
const session = (token: string, expiresInS = 3_600): Session => ({
  accessToken: token,
  refreshToken: `refresh-${token}`,
  expiresAtS: Math.floor(Date.now() / 1000) + expiresInS,
  userId: USER.id,
  email: USER.email,
});

/** A storage holding this session, as a page left signed in last time. */
function storageWith(stored: Session | null) {
  const storage = memoryStorage();
  if (stored) storage.setItem(SESSION_KEY, JSON.stringify(stored));
  return storage;
}

const options = (extra: Partial<ClientOptions>): ClientOptions => ({ supabaseUrl: SUPABASE_URL, publishableKey: KEY, storage: null, ...extra });

/** Waits for the fake fetch's answers, which settle on promises, not timers. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('signs in with a password as Let Report does, keeps the session in storage and tells the listeners', async () => {
    const { fetch, sent } = fakeFetch({ 'POST /auth/v1/token?grant_type=password': { body: tokenAnswer('token-1') } });
    const storage = memoryStorage();
    const client = createFactoryClient(options({ fetch, storage }));
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));

    const signedIn = await client.signIn('qa@factory.test', 'secret');

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].headers).toEqual({ apikey: KEY, 'Content-Type': 'application/json' });
    expect(sent[0].body).toEqual({ email: 'qa@factory.test', password: 'secret' });
    const expected: Session = { accessToken: 'token-1', refreshToken: 'refresh-token-1', expiresAtS: 2_000_000_000, userId: 'user-1', email: 'qa@factory.test' };
    expect(signedIn).toEqual(expected);
    expect(client.session()).toEqual(expected);
    expect(heard).toEqual([expected]);
    expect(JSON.parse(storage.getItem(SESSION_KEY) ?? 'null')).toEqual(expected);
  });

  it('takes the expiry from expires_in when the answer gives no expires_at', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 29, 8, 0, 0, 400), toFake: ['Date'] });
    const { fetch } = fakeFetch({ 'POST /auth/v1/token?grant_type=password': { body: tokenAnswer('token-1', { expires_at: undefined, expires_in: 1_800 }) } });
    const client = createFactoryClient(options({ fetch }));
    const signedIn = await client.signIn('qa@factory.test', 'secret');
    expect(signedIn.expiresAtS).toBe(Date.UTC(2026, 9, 29, 8, 0, 0) / 1000 + 1_800);
  });

  it('turns a refused sign-in into a ClientError with Let Report’s message and code, and stays signed out', async () => {
    const refused = { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
    const { fetch } = fakeFetch({ 'POST /auth/v1/token?grant_type=password': refused });
    const client = createFactoryClient(options({ fetch }));
    const heard = vi.fn();
    client.onSession(heard);
    const error = await client.signIn('qa@factory.test', 'wrong').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({ message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' });
    expect(client.session()).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it('reads back the session a page left in storage, and ignores one it cannot read', () => {
    const stored = session('token-1');
    expect(createFactoryClient(options({ storage: storageWith(stored) })).session()).toEqual(stored);
    const broken = memoryStorage();
    broken.setItem(SESSION_KEY, '{"accessToken": 42');
    expect(createFactoryClient(options({ storage: broken })).session()).toBeNull();
    broken.setItem(SESSION_KEY, JSON.stringify({ access_token: 'token-1' }));
    expect(createFactoryClient(options({ storage: broken })).session()).toBeNull();
  });
});

describe('signing out', () => {
  it('signs out at Let Report with the token, forgets the session and tells the listeners', async () => {
    const { fetch, sent } = fakeFetch({ 'POST /auth/v1/logout': { status: 204 } });
    const storage = storageWith(session('token-1'));
    const client = createFactoryClient(options({ fetch, storage }));
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));
    await client.signOut();
    expect(sent.map((r) => [r.route, r.headers.Authorization])).toEqual([['POST /auth/v1/logout', 'Bearer token-1']]);
    expect(sent[0].headers.apikey).toBe(KEY);
    expect(client.session()).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(heard).toEqual([null]);
  });

  it('forgets the session even when Let Report cannot be reached', async () => {
    const { fetch } = fakeFetch({ 'POST /auth/v1/logout': new TypeError('Failed to fetch') });
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));
    await expect(client.signOut()).resolves.toBeUndefined();
    expect(client.session()).toBeNull();
  });

  it('asks nothing and tells no one when nobody is signed in', async () => {
    const { fetch, sent } = fakeFetch({});
    const client = createFactoryClient(options({ fetch }));
    const heard = vi.fn();
    client.onSession(heard);
    await client.signOut();
    expect(sent).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const { fetch } = fakeFetch({ 'POST /auth/v1/logout': { status: 204 } });
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));
    const heard = vi.fn();
    const off = client.onSession(heard);
    off();
    await client.signOut();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('loading the factory', () => {
  it('reads the lines, the plan and the open reports in three signed-in GETs, as Let Report reads them', async () => {
    const { fetch, sent } = letReport();
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));

    const data = await client.load();

    expect(data).toEqual({ lines: LINES, settings: SETTINGS, reports: REPORTS });
    expect(sent.map((r) => [r.route, r.query])).toEqual([
      ['GET /rest/v1/production_lines', { select: '*', order: 'sort.asc,created_at.asc' }],
      ['GET /rest/v1/factory_settings', { select: '*', id: 'eq.1' }],
      ['GET /rest/v1/reports', { select: 'id,loc,sev,status', status: 'neq.closed' }],
    ]);
    // Every column of a line, so a database without the newest columns still answers.
    expect(sent[0].url.startsWith(`${SUPABASE_URL}/rest/v1/production_lines?select=*&order=`)).toBe(true);
    for (const request of sent) {
      expect(request.headers).toEqual({ apikey: KEY, Authorization: 'Bearer token-1' });
      expect(request.body).toBeUndefined();
    }
  });

  it('sends the three at once, not one after another', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fetch, sent } = letReport({ 'GET /rest/v1/production_lines': async () => (await gate, { body: LINES }) });
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));
    const loading = client.load();
    await settle();
    expect(sent).toHaveLength(3);
    release();
    await expect(loading).resolves.toMatchObject({ lines: LINES });
  });

  it('reads no plan when the settings row is missing, or the database has no factory_settings table yet', async () => {
    for (const reply of [{ body: [] }, { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } }]) {
      const { fetch } = letReport({ 'GET /rest/v1/factory_settings': reply });
      const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));
      await expect(client.load()).resolves.toEqual({ lines: LINES, settings: null, reports: REPORTS });
    }
  });

  it('asks nothing before anyone signs in', async () => {
    const { fetch, sent } = letReport();
    const client = createFactoryClient(options({ fetch }));
    await expect(client.load()).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    expect(sent).toEqual([]);
  });

  it('turns a fetch that fails (offline) into a ClientError with status 0, and keeps the session', async () => {
    const offline = new TypeError('Failed to fetch');
    const { fetch } = letReport({ 'GET /rest/v1/production_lines': offline, 'GET /rest/v1/factory_settings': offline, 'GET /rest/v1/reports': offline });
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));
    const error = await client.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 0, code: 'offline', message: 'No connection. Check your internet and try again.' });
    expect(client.session()).not.toBeNull();
  });

  it('signs out on a 401: the session is gone from memory and storage, and the listeners hear it once', async () => {
    const expired = { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } };
    const { fetch } = letReport({ 'GET /rest/v1/production_lines': expired, 'GET /rest/v1/factory_settings': expired, 'GET /rest/v1/reports': expired });
    const storage = storageWith(session('token-1'));
    const client = createFactoryClient(options({ fetch, storage }));
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));
    const error = await client.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({ status: 401, code: 'PGRST301', message: 'JWT expired' });
    expect(client.session()).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(heard).toEqual([null]);
  });

  it('keeps the session on a server error, with the status and Let Report’s message', async () => {
    const { fetch } = letReport({ 'GET /rest/v1/reports': { status: 503, body: { message: 'Service unavailable' } } });
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1')) }));
    await expect(client.load()).rejects.toMatchObject({ status: 503, message: 'Service unavailable', code: '' });
    expect(client.session()).not.toBeNull();
  });
});

describe('refreshing the session', () => {
  it('refreshes a token about to expire once, before reading, even with two loads at once', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fetch, sent } = letReport({ 'POST /auth/v1/token?grant_type=refresh_token': async () => (await gate, { body: tokenAnswer('token-2') }) });
    const storage = storageWith(session('token-1', 30));
    const client = createFactoryClient(options({ fetch, storage }));
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));

    const loads = Promise.all([client.load(), client.load()]);
    await settle();
    // Only the refresh is out: no read goes with the old token.
    expect(sent.map((r) => r.route)).toEqual(['POST /auth/v1/token?grant_type=refresh_token']);
    expect(sent[0].headers).toEqual({ apikey: KEY, 'Content-Type': 'application/json' });
    expect(sent[0].body).toEqual({ refresh_token: 'refresh-token-1' });

    release();
    const [first, second] = await loads;
    expect(first).toEqual({ lines: LINES, settings: SETTINGS, reports: REPORTS });
    expect(second).toEqual(first);
    const reads = sent.slice(1);
    expect(reads).toHaveLength(6);
    for (const request of reads) expect(request.headers.Authorization).toBe('Bearer token-2');
    expect(sent.filter((r) => r.route.includes('refresh_token'))).toHaveLength(1);
    expect(client.session()?.accessToken).toBe('token-2');
    expect(JSON.parse(storage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({ accessToken: 'token-2', refreshToken: 'refresh-token-2' });
    expect(heard.map((s) => s?.accessToken)).toEqual(['token-2']);
  });

  it('does not bring a session back when someone signs out while its refresh is out', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fetch } = letReport({
      'POST /auth/v1/token?grant_type=refresh_token': async () => (await gate, { body: tokenAnswer('token-2') }),
      'POST /auth/v1/logout': { status: 204 },
    });
    const storage = storageWith(session('token-1', 30));
    const client = createFactoryClient(options({ fetch, storage }));
    const loading = client.load().catch((e: unknown) => e);
    await settle();
    await client.signOut();
    release();
    await expect(loading).resolves.toMatchObject({ status: 401, code: 'signed_out' });
    expect(client.session()).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });

  it('leaves a token with more than a minute left alone', async () => {
    const { fetch, sent } = letReport();
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1', 90)) }));
    await client.load();
    expect(sent.map((r) => r.route).filter((route) => route.includes('auth'))).toEqual([]);
  });

  it('signs out when Let Report refuses the refresh (400), and the load fails', async () => {
    const refused = { status: 400, body: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } };
    const { fetch, sent } = letReport({ 'POST /auth/v1/token?grant_type=refresh_token': refused });
    const storage = storageWith(session('token-1', 10));
    const client = createFactoryClient(options({ fetch, storage }));
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));
    await expect(client.load()).rejects.toMatchObject({ status: 400, code: 'refresh_token_not_found' });
    expect(client.session()).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(heard).toEqual([null]);
    expect(sent.filter((r) => r.route.startsWith('GET'))).toEqual([]);
  });

  it('keeps the session when the refresh cannot reach Let Report, and tries again next time', async () => {
    let offline = true;
    const { fetch, sent } = letReport({
      'POST /auth/v1/token?grant_type=refresh_token': () => (offline ? new TypeError('Failed to fetch') : { body: tokenAnswer('token-2') }),
    });
    const client = createFactoryClient(options({ fetch, storage: storageWith(session('token-1', 10)) }));
    await expect(client.load()).rejects.toMatchObject({ status: 0 });
    expect(client.session()?.accessToken).toBe('token-1');
    offline = false;
    await client.load();
    expect(client.session()?.accessToken).toBe('token-2');
    expect(sent.filter((r) => r.route.includes('refresh_token'))).toHaveLength(2);
  });
});

describe('the storage', () => {
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };

  it('still signs in, reads and signs out when every storage call throws', async () => {
    const { fetch } = letReport({ 'POST /auth/v1/token?grant_type=password': { body: tokenAnswer('token-1') }, 'POST /auth/v1/logout': { status: 204 } });
    const client = createFactoryClient(options({ fetch, storage: throwing }));
    expect(client.session()).toBeNull();
    await client.signIn('qa@factory.test', 'secret');
    expect(client.session()?.accessToken).toBe('token-1');
    await expect(client.load()).resolves.toMatchObject({ lines: LINES });
    await client.signOut();
    expect(client.session()).toBeNull();
  });

  it('keeps the session in memory only with storage null', async () => {
    const page = memoryStorage();
    vi.stubGlobal('localStorage', page);
    const { fetch } = fakeFetch({ 'POST /auth/v1/token?grant_type=password': { body: tokenAnswer('token-1') } });
    const client = createFactoryClient(options({ fetch, storage: null }));
    await client.signIn('qa@factory.test', 'secret');
    expect(page.items.size).toBe(0);
  });

  it('uses localStorage by default, and still works when even looking at localStorage throws', async () => {
    const page = memoryStorage();
    vi.stubGlobal('localStorage', page);
    const { fetch } = fakeFetch({ 'POST /auth/v1/token?grant_type=password': { body: tokenAnswer('token-1') } });
    await createFactoryClient({ supabaseUrl: SUPABASE_URL, publishableKey: KEY, fetch }).signIn('qa@factory.test', 'secret');
    expect(JSON.parse(page.items.get(SESSION_KEY) ?? 'null')).toMatchObject({ accessToken: 'token-1' });

    vi.unstubAllGlobals();
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      const client = createFactoryClient({ supabaseUrl: SUPABASE_URL, publishableKey: KEY, fetch });
      expect(client.session()).toBeNull();
      await client.signIn('qa@factory.test', 'secret');
      expect(client.session()?.accessToken).toBe('token-1');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('the page’s own fetch and WebSocket', () => {
  it('touches no browser global when the module is imported', async () => {
    const names = ['fetch', 'WebSocket', 'localStorage'] as const;
    const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    const touched: string[] = [];
    for (const name of names) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name);
          return undefined;
        },
      });
    }
    try {
      vi.resetModules();
      const module = await import('../../src/factory/supabase');
      expect(typeof module.createFactoryClient).toBe('function');
      expect(touched).toEqual([]);
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    }
  });

  it('calls the page’s fetch on the page, and a given fetch on nothing (either would throw on another object)', async () => {
    const page = letReport();
    vi.stubGlobal('fetch', page.fetch);
    await createFactoryClient({ supabaseUrl: SUPABASE_URL, publishableKey: KEY, storage: storageWith(session('token-1')) }).load();
    expect(page.sent).toHaveLength(3);
    expect(page.thisValues.every((value) => value === globalThis)).toBe(true);

    const given = letReport();
    await createFactoryClient(options({ fetch: given.fetch, storage: storageWith(session('token-1')) })).load();
    expect(given.thisValues).toEqual([undefined, undefined, undefined]);
  });
});

// ───── A fake Let Report: the realtime socket ─────

interface PhxMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
  join_ref: string | null;
}

function fakeSockets() {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    url: string;
    readyState = 0;
    readonly sent: PhxMessage[] = [];
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(data: string): void {
      if (this.readyState !== 1) throw new Error('Sent on a socket that is not open');
      this.sent.push(JSON.parse(data) as PhxMessage);
    }

    close(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({});
    }

    /** The server takes the connection. */
    accept(): void {
      this.readyState = 1;
      this.onopen?.({});
    }

    /** A message from the server. */
    receive(message: unknown): void {
      this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
    }

    /** The connection drops. */
    drop(): void {
      this.readyState = 3;
      this.onerror?.({});
      this.onclose?.({});
    }

    get join(): PhxMessage | undefined {
      return this.sent.find((message) => message.event === 'phx_join');
    }

    get closed(): boolean {
      return this.readyState === 3;
    }

    /** Answers the join: 'ok', or the error Realtime gives for a token it will not take. */
    answerJoin(status = 'ok'): void {
      const join = this.join;
      if (!join) throw new Error('No join to answer');
      this.receive({ topic: TOPIC, event: 'phx_reply', ref: join.ref, join_ref: join.ref, payload: { status, response: status === 'ok' ? {} : { reason: 'Invalid token' } } });
    }
  }
  return { sockets, WebSocket: FakeSocket as unknown as typeof WebSocket };
}

const change = (table: string) => ({
  topic: TOPIC,
  event: 'postgres_changes',
  ref: null,
  payload: { ids: [7], data: { schema: 'public', table, type: 'UPDATE', commit_timestamp: '2026-10-29T08:00:00Z', record: { id: 'l3', status: 'stopped' } } },
});

/** A signed-in client on a fake Let Report, subscribed, with what it reported. */
function subscribed(extra: Partial<ClientOptions> = {}, stored: Session | null = session('token-1')) {
  const live = fakeSockets();
  const rest = letReport({
    'POST /auth/v1/token?grant_type=password': { body: tokenAnswer('token-9', { user: { id: 'user-9', email: 'other@factory.test' } }) },
    'POST /auth/v1/token?grant_type=refresh_token': { body: tokenAnswer('token-2') },
    'POST /auth/v1/logout': { status: 204 },
  });
  const client: FactoryClient = createFactoryClient(options({ fetch: rest.fetch, WebSocket: live.WebSocket, storage: storageWith(stored), ...extra }));
  const states: LiveState[] = [];
  const changes: WatchedTable[] = [];
  const stop = client.subscribe({ onChange: (table) => changes.push(table), onState: (state) => states.push(state) });
  return { client, sockets: live.sockets, states, changes, stop, sent: rest.sent };
}

describe('following Let Report’s changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('joins the channel with the session’s token on the three tables, and is live once the join is answered', () => {
    const { sockets, states, stop } = subscribed();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://project.supabase.co/realtime/v1/websocket?apikey=sb_publishable_test&vsn=1.0.0');
    expect(states).toEqual(['connecting']);

    sockets[0].accept();
    expect(sockets[0].sent).toEqual([
      {
        topic: TOPIC,
        event: 'phx_join',
        ref: '1',
        join_ref: '1',
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { enabled: false, key: '' },
            postgres_changes: [
              { event: '*', schema: 'public', table: 'production_lines' },
              { event: '*', schema: 'public', table: 'factory_settings' },
              { event: '*', schema: 'public', table: 'reports' },
            ],
            private: false,
          },
          access_token: 'token-1',
        },
      },
    ]);
    expect(states).toEqual(['connecting']);
    sockets[0].answerJoin();
    expect(states).toEqual(['connecting', 'live']);
    stop();
  });

  it('calls onChange with the table of each change, and ignores other tables, other replies and noise', () => {
    const { sockets, states, changes, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin();
    sockets[0].receive(change('production_lines'));
    sockets[0].receive(change('reports'));
    sockets[0].receive(change('factory_settings'));
    sockets[0].receive(change('messages'));
    sockets[0].receive({ topic: 'phoenix', event: 'phx_reply', ref: '2', payload: { status: 'ok', response: {} } });
    sockets[0].receive({ topic: TOPIC, event: 'presence_state', ref: null, payload: {} });
    sockets[0].receive('not json');
    expect(changes).toEqual(['production_lines', 'reports', 'factory_settings']);
    expect(states).toEqual(['connecting', 'live']);
    stop();
  });

  it('beats every 25 s while the socket is open', () => {
    const { sockets, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin();
    vi.advanceTimersByTime(24_999);
    expect(sockets[0].sent.map((m) => m.event)).toEqual(['phx_join']);
    vi.advanceTimersByTime(1);
    expect(sockets[0].sent[1]).toEqual({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '2', join_ref: null });
    vi.advanceTimersByTime(50_000);
    expect(sockets[0].sent.filter((m) => m.event === 'heartbeat')).toHaveLength(3);
    stop();
  });

  it('reconnects after a close, waiting longer after each failed try, and joins again with the current token', () => {
    const { sockets, states, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin();
    sockets[0].drop();
    expect(states).toEqual(['connecting', 'live', 'connecting']);

    // 2 s, then 4 s while the tries keep failing.
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].drop();
    vi.advanceTimersByTime(3_999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    // No heartbeat from a socket that is gone.
    vi.advanceTimersByTime(25_000);
    expect(sockets[0].sent.map((m) => m.event)).toEqual(['phx_join']);

    sockets[2].accept();
    expect(sockets[2].join?.payload.access_token).toBe('token-1');
    sockets[2].answerJoin();
    expect(states).toEqual(['connecting', 'live', 'connecting', 'live']);

    // Joined again, the wait starts over at 2 s.
    sockets[2].drop();
    vi.advanceTimersByTime(2_000);
    expect(sockets).toHaveLength(4);
    stop();
  });

  it('waits 30 s at most between tries', () => {
    const { sockets, stop } = subscribed();
    for (let tries = 0; tries < 8; tries += 1) {
      sockets[sockets.length - 1].drop();
      vi.advanceTimersByTime(30_000);
    }
    expect(sockets).toHaveLength(9);
    sockets[sockets.length - 1].drop();
    vi.advanceTimersByTime(29_999);
    expect(sockets).toHaveLength(9);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(10);
    stop();
  });

  it('closes and tries again when the channel refuses the join or fails', () => {
    const { sockets, states, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin('error');
    expect(sockets[0].closed).toBe(true);
    expect(states).toEqual(['connecting']);
    vi.advanceTimersByTime(2_000);
    expect(sockets).toHaveLength(2);
    sockets[1].accept();
    sockets[1].answerJoin();
    sockets[1].receive({ topic: TOPIC, event: 'phx_error', ref: null, payload: {} });
    expect(sockets[1].closed).toBe(true);
    expect(states).toEqual(['connecting', 'live', 'connecting']);
    vi.advanceTimersByTime(2_000);
    expect(sockets).toHaveLength(3);
    stop();
  });

  it('hands a renewed token to the channel, as Let Report’s socket does', async () => {
    const { client, sockets, stop } = subscribed({}, session('token-1', 30));
    sockets[0].accept();
    sockets[0].answerJoin();
    await client.load();
    expect(client.session()?.accessToken).toBe('token-2');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent.at(-1)).toEqual({ topic: TOPIC, event: 'access_token', payload: { access_token: 'token-2' }, ref: '2', join_ref: '1' });
    stop();
  });

  it('opens no socket without a session, and opens one once someone signs in', async () => {
    const { client, sockets, states, stop } = subscribed({}, null);
    expect(sockets).toEqual([]);
    expect(states).toEqual(['offline']);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toEqual([]);
    await client.signIn('other@factory.test', 'secret');
    expect(sockets).toHaveLength(1);
    expect(states).toEqual(['offline', 'connecting']);
    sockets[0].accept();
    expect(sockets[0].join?.payload.access_token).toBe('token-9');
    stop();
  });

  it('closes the socket on sign-out and on a 401, and comes back on the next sign-in', async () => {
    const { client, sockets, states, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin();
    await client.signOut();
    expect(sockets[0].closed).toBe(true);
    expect(states).toEqual(['connecting', 'live', 'offline']);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    await client.signIn('other@factory.test', 'secret');
    expect(sockets).toHaveLength(2);
    expect(states.at(-1)).toBe('connecting');
    stop();

    const expired = { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } };
    const live = fakeSockets();
    const rest = letReport({ 'GET /rest/v1/production_lines': expired });
    const other = createFactoryClient(options({ fetch: rest.fetch, WebSocket: live.WebSocket, storage: storageWith(session('token-1')) }));
    const otherStates: LiveState[] = [];
    other.subscribe({ onChange: () => {}, onState: (state) => otherStates.push(state) });
    live.sockets[0].accept();
    live.sockets[0].answerJoin();
    await expect(other.load()).rejects.toMatchObject({ status: 401 });
    expect(live.sockets[0].closed).toBe(true);
    expect(otherStates).toEqual(['connecting', 'live', 'offline']);
  });

  it('joins afresh when someone else signs in over the session', async () => {
    const { client, sockets, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin();
    await client.signIn('other@factory.test', 'secret');
    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(2);
    sockets[1].accept();
    expect(sockets[1].join?.payload.access_token).toBe('token-9');
    stop();
  });

  it('stops everything when stopped: reports offline, closes the socket, and neither beats nor reconnects', () => {
    const { sockets, states, changes, stop } = subscribed();
    sockets[0].accept();
    sockets[0].answerJoin();
    stop();
    expect(states).toEqual(['connecting', 'live', 'offline']);
    expect(sockets[0].closed).toBe(true);
    sockets[0].receive(change('production_lines'));
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent.map((m) => m.event)).toEqual(['phx_join']);
    expect(changes).toEqual([]);
    stop();
    expect(states).toEqual(['connecting', 'live', 'offline']);
  });

  it('stops a reconnect that is waiting', () => {
    const { sockets, states, stop } = subscribed();
    sockets[0].drop();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(states).toEqual(['connecting', 'offline']);
  });

  it('takes the page’s WebSocket by default, and stays offline without one', () => {
    const live = fakeSockets();
    vi.stubGlobal('WebSocket', live.WebSocket);
    const client = createFactoryClient(options({ fetch: letReport().fetch, storage: storageWith(session('token-1')) }));
    const states: LiveState[] = [];
    const stop = client.subscribe({ onChange: () => {}, onState: (state) => states.push(state) });
    expect(live.sockets).toHaveLength(1);
    stop();

    vi.stubGlobal('WebSocket', undefined);
    const without: LiveState[] = [];
    client.subscribe({ onChange: () => {}, onState: (state) => without.push(state) })();
    expect(without).toEqual(['offline']);
  });
});
