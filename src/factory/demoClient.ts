// Phase 11: the Factory board's demo client (D21), a FactoryClient with nothing behind it. It starts signed in
// as the demo, reads the demo's made-up rows (demoData.ts) at the clock's time, and reports a change each time
// those rows change, as Let Report's socket would. It sends nothing anywhere and keeps nothing: no fetch, no
// WebSocket and no storage, so the page shows the demo with no account and no network.
//
// Wherever the demo has the same thing to do, it does what supabase.ts does: the listeners hear the session in
// the order they came, before any subscription reports its new state; a subscription goes offline when stopped
// or signed out and comes back on the next sign-in; and a read while signed out fails with a 401 shaped as a
// ClientError (types.ts), so the page treats it as it treats Let Report's.
import { demoFactory } from './demoData';
import {
  DEMO_TICK_MS,
  DEMO_USER,
  WATCHED_TABLES,
  type ClientErrorLike,
  type CreateDemoClient,
  type FactoryClient,
  type FactoryData,
  type LiveState,
  type Session,
  type WatchedTable,
} from './types';

/** The demo's token never runs out: it expires at the last second of the year 9999, in Unix seconds. */
const DEMO_EXPIRES_AT_S = 253_402_300_799;

/** The demo's session, the same for every demo client. Frozen, so no holder can change it for the others. */
const DEMO_SESSION: Session = Object.freeze({
  accessToken: 'demo',
  refreshToken: 'demo',
  expiresAtS: DEMO_EXPIRES_AT_S,
  userId: 'demo',
  email: DEMO_USER,
});

type SessionListener = (session: Session | null) => void;

/** Each watched table's rows at one reading, as JSON. */
type TableKeys = Record<WatchedTable, string>;

/** A failed read, with a status and a code like supabase.ts's ClientError, which the page knows by its shape. */
class DemoClientError extends Error implements ClientErrorLike {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'DemoClientError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Each watched table's rows as JSON, to tell rows that changed from the same rows read again. The demo's rows
 * carry the times of the script's marks, never the clock's, so between two marks they read the same.
 */
function tableKeys(data: FactoryData): TableKeys {
  return {
    production_lines: JSON.stringify(data.lines),
    factory_settings: JSON.stringify(data.settings),
    reports: JSON.stringify(data.reports),
  };
}

export const createDemoClient: CreateDemoClient = (options = {}) => {
  const factory = options.factory ?? demoFactory;
  // A wait that is not above 0 would spin the timer: the default stands in for it.
  const tickMs = options.tickMs !== undefined && Number.isFinite(options.tickMs) && options.tickMs > 0 ? options.tickMs : DEMO_TICK_MS;
  const listeners = new Set<SessionListener>();
  let current: Session | null = DEMO_SESSION;
  /** When the demo began: the clock's first reading, taken by the first load or subscription. */
  let startMs: number | null = null;

  /** The demo's rows at the clock's time. Date.now is looked up at each reading, so a faked clock is the one read. */
  function rowsNow(): FactoryData {
    const nowMs = (options.now ?? Date.now)();
    startMs ??= nowMs;
    return factory(startMs, nowMs);
  }

  /** Takes the new session (or none) and tells the listeners when it changed, in the order they came. */
  function setSession(next: Session | null): void {
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) listener(next);
  }

  function onSession(listener: SessionListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Follows the demo's rows as supabase.ts follows Let Report's socket. Signed in, it is live at once (there is
   * nothing to connect to) and reads the rows every tickMs, calling onChange once for each watched table whose
   * rows differ from the last reading. Signed out, it is offline and reads nothing until someone signs in.
   */
  function subscribe({ onChange, onState }: { onChange(table: WatchedTable): void; onState(state: LiveState): void }): () => void {
    let timer: ReturnType<typeof setInterval> | undefined;
    /** The rows at the last reading; null until the first reading after going live. */
    let lastKeys: TableKeys | null = null;
    let stopped = false;
    let state: LiveState | null = null;

    const report = (next: LiveState): void => {
      if (next === state) return;
      state = next;
      onState(next);
    };

    /** Reads the rows again and reports each table that changed since the last reading. */
    function look(): void {
      let keys: TableKeys;
      try {
        keys = tableKeys(rowsNow());
      } catch {
        // The demo's rows could not be built: the page's next load shows why, and the next tick tries again.
        return;
      }
      const before = lastKeys;
      // Kept before the handlers run, so a handler that throws cannot make the same change come twice.
      lastKeys = keys;
      if (!before) return;
      for (const table of WATCHED_TABLES) if (keys[table] !== before[table]) onChange(table);
    }

    /** Stops looking, and forgets the last reading: a change while it does not look comes with no event. */
    function pause(): void {
      clearInterval(timer);
      timer = undefined;
      lastKeys = null;
    }

    function goLive(): void {
      if (stopped || timer !== undefined) return;
      look();
      timer = setInterval(look, tickMs);
      // Reported last, so a handler that stops the subscription here leaves no timer behind.
      report('live');
    }

    const offSession = onSession((session) => {
      if (stopped) return;
      if (session) {
        goLive();
      } else {
        pause();
        report('offline');
      }
    });

    if (current) goLive();
    else report('offline');

    return () => {
      if (stopped) return;
      stopped = true;
      offSession();
      pause();
      report('offline');
    };
  }

  const client: FactoryClient = {
    session: () => current,

    async signIn() {
      // Any email and password open the demo: there is no account behind it to ask.
      setSession(DEMO_SESSION);
      return DEMO_SESSION;
    },

    async signOut() {
      setSession(null);
    },

    onSession,

    async load(): Promise<FactoryData> {
      if (!current) throw new DemoClientError('The demo is signed out: open it again to see the factory.', 401, 'signed_out');
      return rowsNow();
    },

    subscribe,
  };
  return client;
};
