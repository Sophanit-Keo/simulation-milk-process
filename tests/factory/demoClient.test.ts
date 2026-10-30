// The Factory board's demo client (src/factory/demoClient.ts, D21): signed in as the demo from the start, it
// reads the demo's rows at the clock's time and reports a change each time they change, with nothing behind it.
// The tests hand in a short script of their own rather than demoData.ts's, and move the clock on fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoClient } from '../../src/factory/demoClient';
import {
  DEMO_TICK_MS,
  DEMO_USER,
  type DemoClientOptions,
  type DemoFactory,
  type FactoryClient,
  type FactoryData,
  type LineRow,
  type LineStatus,
  type LiveState,
  type Session,
  type WatchedTable,
} from '../../src/factory/types';

const MINUTE_MS = 60_000;
/** When the tests' clock starts. */
const T0_MS = Date.UTC(2026, 9, 30, 8, 0, 0);

const UHT_1 = { name: 'UHT 1', capacityLph: 8_000 };
const UHT_2 = { name: 'UHT 2', capacityLph: 6_000 };

/** A line as Let Report holds it, its status since one of the script's marks. */
const line = (id: string, status: LineStatus, sinceIso: string): LineRow => ({
  id,
  name: `UHT line ${id}`,
  type: 'UHT',
  product: 'UHT milk 1 L',
  qty: 0,
  target: 100,
  status,
  sort: Number(id),
  status_since: sinceIso,
  uht: 'UHT 1',
});

/**
 * The tests' script, by whole minutes since the start: at 0 both lines run; at 1 line 2 stops; at 2 a trouble
 * opens at it; at 3 line 2 runs again and its trouble closes (two tables at one mark); at 4 the plan gets a
 * second UHT; then nothing changes. The rows carry the times of the marks, never the clock's.
 */
function scriptRows(startMs: number, nowMs: number): FactoryData {
  const minute = Math.floor((nowMs - startMs) / MINUTE_MS);
  const mark = (at: number) => new Date(startMs + at * MINUTE_MS).toISOString();
  const lineTwo = minute < 1 ? line('2', 'running', mark(0)) : minute < 3 ? line('2', 'stopped', mark(1)) : line('2', 'running', mark(3));
  return {
    lines: [line('1', 'running', mark(0)), lineTwo],
    settings: { site_name: 'Test factory', uht_units: minute < 4 ? [UHT_1] : [UHT_1, UHT_2] },
    reports: minute === 2 ? [{ id: 'r1', loc: 'UHT line 2', sev: 2, status: 'open' }] : [],
  };
}

/** The script as a DemoFactory, with the times it was asked for. */
function scripted() {
  const calls: { startMs: number; nowMs: number }[] = [];
  const factory: DemoFactory = (startMs, nowMs) => {
    calls.push({ startMs, nowMs });
    return scriptRows(startMs, nowMs);
  };
  return { factory, calls };
}

/** A demo client on the tests' script. */
function demo(extra: DemoClientOptions = {}) {
  const script = scripted();
  const client = createDemoClient({ factory: script.factory, ...extra });
  return { client, calls: script.calls };
}

/** A subscription, with what it reported. */
function follow(client: FactoryClient) {
  const states: LiveState[] = [];
  const changes: WatchedTable[] = [];
  const stop = client.subscribe({ onChange: (table) => changes.push(table), onState: (state) => states.push(state) });
  return { states, changes, stop };
}

const DEMO_SESSION: Session = { accessToken: 'demo', refreshToken: 'demo', expiresAtS: expect.any(Number) as number, userId: 'demo', email: DEMO_USER };

afterEach(() => {
  vi.useRealTimers();
});

describe('the demo’s session', () => {
  it('starts signed in as the demo, with a token that runs out only far ahead', () => {
    const { client } = demo();
    const session = client.session();
    expect(session).toEqual(DEMO_SESSION);
    expect(session?.email).toBe('Demo');
    expect(session?.expiresAtS).toBeGreaterThan(Date.UTC(2100, 0, 1) / 1000);
  });

  it('signs out: forgets the session, tells the listeners once, and resolves', async () => {
    const { client } = demo();
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));
    await expect(client.signOut()).resolves.toBeUndefined();
    expect(client.session()).toBeNull();
    expect(heard).toEqual([null]);
    await client.signOut();
    expect(heard).toEqual([null]);
  });

  it('signs in again with any email and password, and tells the listeners only when it was signed out', async () => {
    const { client } = demo();
    const heard: (Session | null)[] = [];
    client.onSession((s) => heard.push(s));
    await expect(client.signIn('', '')).resolves.toEqual(DEMO_SESSION);
    expect(heard).toEqual([]);

    await client.signOut();
    const session = await client.signIn('anyone@example.test', 'anything');
    expect(session).toEqual(DEMO_SESSION);
    expect(client.session()).toEqual(DEMO_SESSION);
    expect(heard).toEqual([null, DEMO_SESSION]);
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const { client } = demo();
    const heard = vi.fn();
    const off = client.onSession(heard);
    off();
    await client.signOut();
    await client.signIn('', '');
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('loading the demo’s rows', () => {
  it('gives the factory’s rows for the time now, the demo beginning at the clock’s first reading', async () => {
    vi.useFakeTimers({ now: T0_MS });
    const { client, calls } = demo();
    // Making the client reads no clock: the demo begins at the first load.
    vi.advanceTimersByTime(30_000);
    const startMs = T0_MS + 30_000;
    await expect(client.load()).resolves.toEqual(scriptRows(startMs, startMs));

    vi.advanceTimersByTime(90_000);
    const later = await client.load();
    expect(calls).toEqual([
      { startMs, nowMs: startMs },
      { startMs, nowMs: startMs + 90_000 },
    ]);
    expect(later).toEqual(scriptRows(startMs, startMs + 90_000));
    expect(later.lines[1].status).toBe('stopped');
  });

  it('reads Date.now when it reads the clock, not when the client is made', async () => {
    const { client, calls } = demo();
    vi.useFakeTimers({ now: T0_MS });
    await client.load();
    expect(calls).toEqual([{ startMs: T0_MS, nowMs: T0_MS }]);
  });

  it('reads a clock of its own when given one', async () => {
    let clockMs = 1_000;
    const { client, calls } = demo({ now: () => clockMs });
    await client.load();
    clockMs = 61_000;
    await expect(client.load()).resolves.toEqual(scriptRows(1_000, 61_000));
    expect(calls).toEqual([
      { startMs: 1_000, nowMs: 1_000 },
      { startMs: 1_000, nowMs: 61_000 },
    ]);
  });

  it('rejects with a 401 shaped as Let Report’s while signed out, reads nothing, and reads again once signed in', async () => {
    const { client, calls } = demo({ now: () => T0_MS });
    await client.signOut();
    const error = await client.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 401, code: 'signed_out' });
    expect(calls).toEqual([]);

    await client.signIn('', '');
    await expect(client.load()).resolves.toEqual(scriptRows(T0_MS, T0_MS));
  });
});

describe('following the demo’s changes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0_MS });
  });

  it('reports live at once, with no network to wait for', () => {
    const { client } = demo();
    const { states, changes, stop } = follow(client);
    expect(states).toEqual(['live']);
    expect(changes).toEqual([]);
    stop();
  });

  it('reads the rows every tick, and reports one change for each table whose rows changed and none while they stay the same', () => {
    const { client, calls } = demo();
    const { states, changes, stop } = follow(client);
    // The first reading, at T0, is what the next ticks are compared with.
    expect(calls).toEqual([{ startMs: T0_MS, nowMs: T0_MS }]);

    vi.advanceTimersByTime(MINUTE_MS - 1);
    expect(calls).toHaveLength(MINUTE_MS / DEMO_TICK_MS);
    expect(changes).toEqual([]);

    // The tick at 1:00: line 2 stops.
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(['production_lines']);
    vi.advanceTimersByTime(MINUTE_MS - 1);
    expect(changes).toEqual(['production_lines']);

    // 2:00: a trouble opens; 4:00: the plan changes.
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(['production_lines', 'reports']);
    vi.advanceTimersByTime(2 * MINUTE_MS);
    expect(changes).toEqual(['production_lines', 'reports', 'production_lines', 'reports', 'factory_settings']);

    // Then the clock alone moves on: the rows stay the same, and nothing is reported.
    vi.advanceTimersByTime(10 * MINUTE_MS);
    expect(changes).toHaveLength(5);
    expect(states).toEqual(['live']);
    stop();
  });

  it('reports a burst of two tables changing at one tick, each once', () => {
    const { client } = demo();
    const { changes, stop } = follow(client);
    vi.advanceTimersByTime(3 * MINUTE_MS - 1);
    const before = changes.length;
    vi.advanceTimersByTime(1);
    expect(changes.slice(before)).toEqual(['production_lines', 'reports']);
    vi.advanceTimersByTime(DEMO_TICK_MS);
    expect(changes).toHaveLength(before + 2);
    stop();
  });

  it('looks as often as tickMs says', () => {
    const { client, calls } = demo({ tickMs: 5_000 });
    const { stop } = follow(client);
    vi.advanceTimersByTime(4_999);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(2);
    stop();
  });

  it('stops when stopped: reports offline once, clears its timer, and reads and reports nothing more', () => {
    const { client, calls } = demo();
    const { states, changes, stop } = follow(client);
    vi.advanceTimersByTime(30_000);
    stop();
    expect(states).toEqual(['live', 'offline']);
    expect(vi.getTimerCount()).toBe(0);
    const reads = calls.length;
    vi.advanceTimersByTime(5 * MINUTE_MS);
    expect(calls).toHaveLength(reads);
    expect(changes).toEqual([]);
    stop();
    expect(states).toEqual(['live', 'offline']);
  });

  it('runs several subscriptions at once, and stopping one leaves the others', () => {
    const { client } = demo();
    const first = follow(client);
    const second = follow(client);
    vi.advanceTimersByTime(MINUTE_MS);
    expect(first.changes).toEqual(['production_lines']);
    expect(second.changes).toEqual(['production_lines']);
    first.stop();
    vi.advanceTimersByTime(MINUTE_MS);
    expect(first.changes).toEqual(['production_lines']);
    expect(second.changes).toEqual(['production_lines', 'reports']);
    expect(second.states).toEqual(['live']);
    second.stop();
  });

  it('goes offline on sign-out after the listeners hear it, and live again on the next sign-in', async () => {
    const { client } = demo();
    const log: string[] = [];
    client.onSession((session) => log.push(`session ${session?.email ?? 'none'}`));
    const changes: WatchedTable[] = [];
    const stop = client.subscribe({ onChange: (table) => changes.push(table), onState: (state) => log.push(`state ${state}`) });
    expect(log).toEqual(['state live']);

    vi.advanceTimersByTime(30_000);
    await client.signOut();
    expect(log).toEqual(['state live', 'session none', 'state offline']);
    expect(vi.getTimerCount()).toBe(0);
    // Signed out across the marks at 1:00 and 2:00: no events, and no rows to read.
    vi.advanceTimersByTime(2 * MINUTE_MS);
    expect(changes).toEqual([]);
    await expect(client.load()).rejects.toMatchObject({ status: 401 });

    // Signed in again at 2:30: live, and the next change is the next mark's, 3:00.
    await client.signIn('', '');
    expect(log).toEqual(['state live', 'session none', 'state offline', 'session Demo', 'state live']);
    vi.advanceTimersByTime(30_000 - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(['production_lines', 'reports']);
    stop();
    expect(log.at(-1)).toBe('state offline');
  });

  it('stays offline when it starts signed out, until someone signs in', async () => {
    const { client, calls } = demo();
    await client.signOut();
    const { states, stop } = follow(client);
    expect(states).toEqual(['offline']);
    vi.advanceTimersByTime(MINUTE_MS);
    expect(calls).toEqual([]);
    await client.signIn('', '');
    expect(states).toEqual(['offline', 'live']);
    stop();
    expect(states).toEqual(['offline', 'live', 'offline']);
  });
});

describe('nothing sent, nothing kept', () => {
  it('touches no fetch, WebSocket or storage, from its import to its sign-in again', async () => {
    const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB'] as const;
    const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    const touched: string[] = [];
    for (const name of names) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name);
          throw new Error(`The demo touched ${name}`);
        },
      });
    }
    try {
      vi.resetModules();
      const module = await import('../../src/factory/demoClient');
      vi.useFakeTimers({ now: T0_MS });
      const script = scripted();
      const client = module.createDemoClient({ factory: script.factory });
      client.onSession(() => undefined);
      expect(client.session()).not.toBeNull();
      const { states, changes, stop } = follow(client);
      await client.load();
      vi.advanceTimersByTime(5 * MINUTE_MS);
      await client.signOut();
      await expect(client.load()).rejects.toMatchObject({ status: 401 });
      await client.signIn('', '');
      await client.load();
      stop();
      expect(states).toEqual(['live', 'offline', 'live', 'offline']);
      expect(changes).toHaveLength(5);
      expect(touched).toEqual([]);
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    }
  });
});
