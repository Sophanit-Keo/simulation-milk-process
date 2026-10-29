// Phase 9: the Factory board's Let Report client (D19). It signs in as Let Report signs in, keeps the session,
// reads the lines, the plan and the open reports over Supabase's REST API, and follows their changes over the
// realtime socket. It matches Let Report's own client (let-report/web/src/api/supabase.js and realtime.js)
// request for request, and it only reads: the board never writes to Let Report.
//
// fetch, WebSocket and the storage come in through the options, so the tests stand in for them. Without them
// the client takes the browser's own, looked up only when it needs them and never at import time. The project's
// address and its publishable key are public by design (Let Report's own page carries them); the database's
// row-level security protects the data, so only a person who signs in reads anything.
import {
  WATCHED_TABLES,
  type ClientErrorLike,
  type ClientOptions,
  type CreateFactoryClient,
  type FactoryClient,
  type FactoryData,
  type LineRow,
  type LiveState,
  type ReportRow,
  type Session,
  type SettingsRow,
  type WatchedTable,
} from './types';

/** Where the session is kept between visits (Let Report keeps its own under 'let-report:session'). */
const SESSION_KEY = 'simulation-milk-process:let-report-session';
/** A token that expires within this is refreshed before the next request, as Let Report does. */
const REFRESH_MARGIN_S = 60;
/** The token's life when a sign-in answer gives no expiry: Supabase's default. */
const DEFAULT_TOKEN_LIFE_S = 3_600;
/** The board's realtime channel (Let Report's own is 'realtime:let-report'). */
const REALTIME_TOPIC = 'realtime:simulation-factory';
/** The socket's heartbeat, as Let Report sends it: Phoenix drops a socket that stays silent. */
const HEARTBEAT_MS = 25_000;
/** Reconnecting waits 2, 4, 8 and 16 s, then 30 s at most, between tries, as Let Report's socket does. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const RETRY_MAX_DOUBLINGS = 5;
/** WebSocket.OPEN, written out so that a stand-in socket class needs no constants. */
const SOCKET_OPEN = 1;

type SessionStore = NonNullable<ClientOptions['storage']>;
type SessionListener = (session: Session | null) => void;

/** A failed request: the server's message, its HTTP status (0 when offline) and its error code ('' with none). */
export class ClientError extends Error implements ClientErrorLike {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
    this.code = code;
  }
}

const nowS = (): number => Date.now() / 1000;

/** A field of a JSON object; undefined for anything that is not an object. */
function field(data: unknown, name: string): unknown {
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>)[name] : undefined;
}

/** The first of the fields that holds some text. */
function firstText(data: unknown, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = field(data, name);
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** A query string as Let Report's db.select builds one: each name and value URI-encoded, in the order given. */
function query(params: Readonly<Record<string, string>>): string {
  return Object.entries(params)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** A REST answer's rows; none when it is not a list. */
function rows<Row>(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function isWatched(table: unknown): table is WatchedTable {
  return typeof table === 'string' && (WATCHED_TABLES as readonly string[]).includes(table);
}

function isSession(value: unknown): value is Session {
  return (
    typeof field(value, 'accessToken') === 'string' &&
    typeof field(value, 'refreshToken') === 'string' &&
    typeof field(value, 'expiresAtS') === 'number' &&
    typeof field(value, 'userId') === 'string' &&
    typeof field(value, 'email') === 'string'
  );
}

/**
 * The session in Supabase's token answer, which gives the expiry as `expires_at` (Unix seconds) or only as
 * `expires_in` (seconds from now). A refresh's answer that leaves out the user keeps the one signed in before.
 */
function toSession(data: unknown, before: Session | null): Session {
  const accessToken = field(data, 'access_token');
  const refreshToken = field(data, 'refresh_token');
  if (typeof accessToken !== 'string' || accessToken === '' || typeof refreshToken !== 'string') {
    throw new ClientError('Let Report answered without a session.', 502, 'no_session');
  }
  const expiresAt = field(data, 'expires_at');
  const expiresIn = field(data, 'expires_in');
  const lifeS = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_LIFE_S;
  const user = field(data, 'user');
  const userId = field(user, 'id');
  const email = field(user, 'email');
  return {
    accessToken,
    refreshToken,
    expiresAtS: typeof expiresAt === 'number' && expiresAt > 0 ? expiresAt : Math.floor(nowS()) + lifeS,
    userId: typeof userId === 'string' ? userId : (before?.userId ?? ''),
    email: typeof email === 'string' ? email : (before?.email ?? ''),
  };
}

/** The browser's localStorage when the page may use it; null when it is missing or blocked. */
function defaultStorage(): SessionStore | null {
  try {
    const storage = (globalThis as { localStorage?: SessionStore }).localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    // With site data blocked, even looking at localStorage throws.
    return null;
  }
}

function readStoredSession(storage: SessionStore | null): Session | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(SESSION_KEY);
    const stored: unknown = text ? JSON.parse(text) : null;
    return isSession(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredSession(storage: SessionStore | null, session: Session | null): void {
  if (!storage) return;
  try {
    if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
    else storage.removeItem(SESSION_KEY);
  } catch {
    // Private mode or a full store: the session lives in memory until the page closes.
  }
}

/** The page's own fetch, bound to the page (a loose `window.fetch` throws "Illegal invocation"); null without one. */
function defaultFetch(): typeof fetch | null {
  try {
    const pageFetch = globalThis.fetch;
    return typeof pageFetch === 'function' ? (input, init) => pageFetch.call(globalThis, input, init) : null;
  } catch {
    return null;
  }
}

function defaultWebSocket(): typeof WebSocket | null {
  try {
    const PageWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    return typeof PageWebSocket === 'function' ? PageWebSocket : null;
  } catch {
    return null;
  }
}

/** A database before Let Report's factory_settings table answers 404 for it: the board then reads no plan. */
function noPlanWithoutTable(error: unknown): null {
  if (error instanceof ClientError && error.status === 404) return null;
  throw error;
}

interface SendOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Send the session's token (Let Report's `auth`); the sign-in and the refresh go with the key alone. */
  auth?: boolean;
}

export const createFactoryClient: CreateFactoryClient = (options) => {
  const baseUrl = options.supabaseUrl.replace(/\/$/, '');
  const apiKey = options.publishableKey;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const listeners = new Set<SessionListener>();
  let current = readStoredSession(storage);
  let refreshing: Promise<void> | null = null;

  /** Keeps the new session (or none), in storage too, and tells the listeners when it changed. */
  function setSession(next: Session | null): void {
    const changed = next !== current;
    current = next;
    writeStoredSession(storage, next);
    if (changed) for (const listener of [...listeners]) listener(next);
  }

  /** One request to Let Report's Supabase, as Let Report's raw() makes it; the answer's JSON, or a ClientError. */
  async function send(path: string, { method = 'GET', body, auth = true }: SendOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { apikey: apiKey };
    if (auth && current) headers.Authorization = `Bearer ${current.accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let status: number;
    let ok: boolean;
    let text: string;
    try {
      // Taken out of the options first: called as options.fetch(), the page's fetch would throw.
      const fetchImpl = options.fetch ?? defaultFetch();
      if (!fetchImpl) throw new TypeError('No fetch');
      const response = await fetchImpl(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      status = response.status;
      ok = response.ok;
      text = await response.text();
    } catch {
      throw new ClientError('No connection. Check your internet and try again.', 0, 'offline');
    }
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!ok) {
      const message = firstText(data, ['msg', 'message', 'error_description', 'error']) ?? `Request failed (${status})`;
      // Supabase's auth gives `code` as the HTTP status and its own code as `error_code`; PostgREST's `code` is text.
      throw new ClientError(message, status, firstText(data, ['code', 'error_code', 'error']) ?? '');
    }
    return data;
  }

  /** Refreshes the session when its token expires within a minute, one refresh at a time; a 400 or 401 signs out. */
  async function ensureFresh(): Promise<void> {
    const before = current;
    if (!before || before.expiresAtS - REFRESH_MARGIN_S > nowS()) return;
    refreshing ??= send('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: before.refreshToken }, auth: false })
      .then((data) => {
        // A sign-out (or a new sign-in) while the refresh was out wins over its answer.
        if (current === before) setSession(toSession(data, before));
      })
      .catch((error: unknown) => {
        if (current === before && error instanceof ClientError && (error.status === 400 || error.status === 401)) setSession(null);
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    await refreshing;
  }

  /** A signed-in read, as Let Report's request(): fresh token first; a 401 means the session is gone. */
  async function read(path: string): Promise<unknown> {
    await ensureFresh();
    const used = current;
    // Row-level security shows nothing to a reader who is not signed in, so the board does not ask.
    if (!used) throw new ClientError('Sign in to Let Report to see the factory.', 401, 'signed_out');
    try {
      return await send(path);
    } catch (error) {
      if (error instanceof ClientError && error.status === 401 && current === used) setSession(null);
      throw error;
    }
  }

  function onSession(listener: SessionListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Follows the watched tables over Supabase Realtime's Phoenix socket (protocol 1.0.0, JSON), as Let Report's
   * connectRealtime() does: join the channel with the session's token, beat every 25 s, reconnect with a growing
   * wait after a close, and hand a renewed token to the channel. It opens no socket without a session: it waits
   * for one, and closes the socket when the session ends.
   */
  function subscribe({ onChange, onState }: { onChange(table: WatchedTable): void; onState(state: LiveState): void }): () => void {
    const PageWebSocket = options.WebSocket ?? defaultWebSocket();
    const url = `${baseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
    let socket: WebSocket | null = null;
    let socketUserId = '';
    let ref = 0;
    let joinRef: string | null = null;
    let beat: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let stopped = false;
    let state: LiveState | null = null;

    const report = (next: LiveState): void => {
      if (next === state) return;
      state = next;
      onState(next);
    };

    const push = (topic: string, event: string, payload: unknown, withJoin = true): void => {
      if (!socket || socket.readyState !== SOCKET_OPEN) return;
      ref += 1;
      socket.send(JSON.stringify({ topic, event, payload, ref: String(ref), join_ref: withJoin ? joinRef : null }));
    };

    /** Drops the socket without the reconnect its close would start, and stops the heartbeat and any retry. */
    function dropSocket(): void {
      clearInterval(beat);
      clearTimeout(retry);
      retry = undefined;
      joinRef = null;
      const old = socket;
      socket = null;
      if (!old) return;
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      try {
        old.close();
      } catch {
        // Already closed.
      }
    }

    function scheduleRetry(): void {
      if (stopped || !current) return;
      clearTimeout(retry);
      tries += 1;
      const waitMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(tries, RETRY_MAX_DOUBLINGS));
      retry = setTimeout(() => {
        retry = undefined;
        open();
      }, waitMs);
    }

    function open(): void {
      const session = current;
      if (stopped || !session || !PageWebSocket || socket) return;
      report('connecting');
      let opened: WebSocket;
      try {
        opened = new PageWebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }
      socket = opened;
      socketUserId = session.userId;
      opened.onopen = () => {
        ref += 1;
        joinRef = String(ref);
        const config = {
          broadcast: { ack: false, self: false },
          presence: { enabled: false, key: '' },
          postgres_changes: WATCHED_TABLES.map((table) => ({ event: '*', schema: 'public', table })),
          private: false,
        };
        const accessToken = current?.accessToken ?? session.accessToken;
        opened.send(JSON.stringify({ topic: REALTIME_TOPIC, event: 'phx_join', ref: joinRef, join_ref: joinRef, payload: { config, access_token: accessToken } }));
        clearInterval(beat);
        beat = setInterval(() => push('phoenix', 'heartbeat', {}, false), HEARTBEAT_MS);
      };
      opened.onmessage = (message: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const event = field(msg, 'event');
        const payload = field(msg, 'payload');
        if (event === 'phx_reply' && joinRef !== null && field(msg, 'ref') === joinRef) {
          if (field(payload, 'status') === 'ok') {
            tries = 0;
            report('live');
          } else {
            // The channel refused the join (an expired token, say): close, and the retry joins afresh.
            opened.close();
          }
        } else if (event === 'postgres_changes') {
          const table = field(field(payload, 'data'), 'table');
          if (isWatched(table)) onChange(table);
        } else if (event === 'phx_error' || event === 'phx_close') {
          opened.close();
        }
      };
      opened.onclose = () => {
        if (socket !== opened) return;
        socket = null;
        joinRef = null;
        clearInterval(beat);
        report('connecting');
        scheduleRetry();
      };
      opened.onerror = () => {
        // A close follows, and it reconnects.
      };
    }

    const offSession = onSession((session) => {
      if (stopped) return;
      if (!session) {
        // Signed out (or the session ran out): no socket until someone signs in again.
        dropSocket();
        tries = 0;
        report('offline');
      } else if (socket && session.userId !== socketUserId) {
        // Someone else signed in: join as them.
        dropSocket();
        tries = 0;
        open();
      } else if (socket) {
        // The token was renewed: the channel takes the new one, as Let Report's socket hands it over.
        push(REALTIME_TOPIC, 'access_token', { access_token: session.accessToken });
      } else if (retry === undefined) {
        open();
      }
    });

    if (current && PageWebSocket) open();
    else report('offline');

    return () => {
      if (stopped) return;
      stopped = true;
      offSession();
      dropSocket();
      report('offline');
    };
  }

  const client: FactoryClient = {
    session: () => current,

    async signIn(email, password) {
      const data = await send('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
      const session = toSession(data, null);
      setSession(session);
      return session;
    },

    async signOut() {
      if (current) {
        try {
          await send('/auth/v1/logout', { method: 'POST' });
        } catch {
          // Already signed out there, or offline: the board forgets the session all the same.
        }
      }
      setSession(null);
    },

    onSession,

    async load(): Promise<FactoryData> {
      // select=* rather than a column list, so that a database without the newest columns still answers.
      const [lines, settings, reports] = await Promise.all([
        read(`/rest/v1/production_lines?${query({ select: '*', order: 'sort.asc,created_at.asc' })}`),
        read(`/rest/v1/factory_settings?${query({ select: '*', id: 'eq.1' })}`).catch(noPlanWithoutTable),
        read(`/rest/v1/reports?${query({ select: 'id,loc,sev,status', status: 'neq.closed' })}`),
      ]);
      return { lines: rows<LineRow>(lines), settings: rows<SettingsRow>(settings)[0] ?? null, reports: rows<ReportRow>(reports) };
    },

    subscribe,
  };
  return client;
};
