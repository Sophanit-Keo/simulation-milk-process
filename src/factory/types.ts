// Phase 9 contracts (D19): everything the Factory board shares. The rows it reads and the view it draws are
// in view.ts, re-exported here, so the model stays headless; this file adds the Let Report client's contracts,
// which need the browser's fetch, WebSocket and storage.
//
// `lead` owns this file. factory-model builds a FactoryView from FactoryData (model.ts), factory-client
// reads FactoryData and the changes from Let Report (supabase.ts), and factory-ui draws the view (board.ts).
import type { FactoryData } from './view';

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
