// Phase 9 contracts (D19): everything the Factory board shares. The rows it reads and the view it draws are
// in view.ts, re-exported here, so the model stays headless; this file adds the Let Report client's contracts,
// which need the browser's fetch, WebSocket and storage.
//
// `lead` owns this file. factory-model builds a FactoryView from FactoryData (model.ts), factory-client
// reads FactoryData and the changes from Let Report (supabase.ts), and factory-ui draws the view (board.ts).
// Phase 10 (D20) adds the 3D view's contract at the end: factory-scene draws the same view on the factory
// floor (scene/), laid out by layout.ts.
import type { DemoFactory, FactoryData, FactoryView } from './view';

export * from './view';

// ───── The Let Report client (supabase.ts) ─────

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAtS: number;
  userId: string;
  email: string;
}

/** The live connection: 'live' while the socket is joined, 'connecting' while it (re)connects, 'offline' once stopped. */
export type LiveState = 'live' | 'connecting' | 'offline';

/** The tables whose changes the board follows. */
export type WatchedTable = 'production_lines' | 'factory_settings' | 'reports';

export const WATCHED_TABLES: readonly WatchedTable[] = ['production_lines', 'factory_settings', 'reports'];

export interface ClientOptions {
  supabaseUrl: string;
  publishableKey: string;
  /** Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Defaults to globalThis.WebSocket. */
  WebSocket?: typeof WebSocket;
  /** Where the session is kept; defaults to localStorage when it can be used, null keeps it in memory only. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

/** A failed request: `status` 0 when offline. A 401 also signs the client out. */
export interface ClientErrorLike extends Error {
  status: number;
  code: string;
}

export interface FactoryClient {
  session(): Session | null;
  /** Password sign-in, as Let Report signs in. */
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  /** Called with the new session, or null when signed out (also when a refresh fails). Returns an unsubscribe. */
  onSession(listener: (session: Session | null) => void): () => void;
  /** Reads the lines, the settings and the open reports, refreshing the session first when it is about to expire. */
  load(): Promise<FactoryData>;
  /**
   * Follows Let Report's changes over its realtime socket: `onChange` after each change to a watched table
   * (the caller reloads), `onState` as the connection changes. Reconnects by itself until stopped.
   */
  subscribe(handlers: { onChange(table: WatchedTable): void; onState(state: LiveState): void }): () => void;
}

/** supabase.ts. */
export type CreateFactoryClient = (options: ClientOptions) => FactoryClient;

/** How often the page reloads everything while signed in, whatever the socket does. */
export const POLL_MS = 15_000;

// ───── Phase 10: the factory floor in 3D (scene/scene.ts) ─────

/** What the board and the 3D view have picked: a UHT by its name, or a line by its id. */
export type FactorySelection = { kind: 'uht'; name: string } | { kind: 'line'; id: string };

/** How the page shows the factory: the cards, or the cards beside the 3D floor. Kept in the address as #3d. */
export type FactoryViewMode = 'board' | '3d';

export interface FactorySceneOptions {
  /**
   * The viewer picked a machine in the view (a click on it, or on its label), or went back to the whole
   * factory (Esc, or "Whole factory"): null. Not called for select().
   */
  onSelect(selection: FactorySelection | null): void;
  /** Load the hero filler model over the grey box (D20); ?greybox turns it off, as in the 3D plant. */
  heroModels?: boolean;
}

export interface FactoryScene {
  /**
   * Draws `view`: builds the floor again when its layout's key changes (layout.ts), otherwise only moves the
   * lamps, labels, belts and pipes on to the new statuses. The page calls it on every reload and once a second.
   */
  render(view: FactoryView): void;
  /** Flies the camera to the selection and marks it, or back to the whole factory for null. Calls no onSelect. */
  select(selection: FactorySelection | null): void;
  /** The frame loop runs while the 3D view shows and stops while the board alone shows. */
  setActive(active: boolean): void;
  /** Frees the GPU context and removes the canvas and the labels. */
  dispose(): void;
}

/** scene/scene.ts, loaded only when the viewer first opens the 3D view: the board alone loads no three.js. */
export type CreateFactoryScene = (host: HTMLElement, options: FactorySceneOptions) => FactoryScene;

// ───── Phase 11: the demo's client (demoClient.ts) ─────

export interface DemoClientOptions {
  /** The clock, in ms since the epoch; defaults to Date.now. The demo begins at the first reading. */
  now?: () => number;
  /** The demo's rows (demoData.ts by default); a test hands in its own. */
  factory?: DemoFactory;
  /** How often the client looks for the demo's next change, in ms; defaults to DEMO_TICK_MS. */
  tickMs?: number;
}

/** The demo client looks for its next change this often: a change shows within a second, as Let Report's do. */
export const DEMO_TICK_MS = 1_000;

/**
 * demoClient.ts: a FactoryClient for the demo (D21), with nothing behind it: always signed in as the demo, and
 * nothing sent anywhere. load() gives the demo's rows now; subscribe() reports live at once, then a change each
 * time the rows change, as Let Report's socket would; signOut() ends the session (the page leaves the demo).
 */
export type CreateDemoClient = (options?: DemoClientOptions) => FactoryClient;

/** The demo's session: its user, as the header shows it. Never stored. */
export const DEMO_USER = 'Demo';
