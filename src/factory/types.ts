// Phase 9 contracts: what the Factory board reads from Let Report, and what it draws (D19). The factory's
// layout lives in Let Report: each production line names the UHT that feeds it, its filler, the filler's
// speed and the pack size, and the plan lists the UHTs with their capacity. The board mirrors it live: a
// line shows what Let Report says, as soon as it changes, and adds nothing of its own.
//
// `lead` owns this file. factory-model builds a FactoryView from FactoryData (model.ts), factory-client
// reads FactoryData and the changes from Let Report (supabase.ts), and factory-ui draws the view (board.ts).
import type { Status } from '../contracts';

// ───── What Let Report holds (its REST rows, only the columns the board reads) ─────

/** A production line's status in Let Report (migration 0002). */
export type LineStatus = 'running' | 'stopped' | 'cleaning' | 'changeover' | 'maintenance' | 'idle';

export const LINE_STATUSES: readonly LineStatus[] = ['running', 'stopped', 'cleaning', 'changeover', 'maintenance', 'idle'];

/** A `production_lines` row. The columns after `status_since` came with later migrations, so any may be missing. */
export interface LineRow {
  id: string;
  name: string;
  /** 'UHT', 'SCM', 'Yogurt' or 'Other'. */
  type: string;
  product: string;
  /** Today's output, as people type it in Let Report. */
  qty: number;
  target: number;
  status: LineStatus;
  sort: number;
  /** ISO time of the last status change. */
  status_since?: string | null;
  /** The lot running now; '' for none (migration 0008). */
  lot?: string;
  lot_started_at?: string | null;
  /** The planned end of the CIP while the status is 'cleaning' (migration 0008). */
  cip_until?: string | null;
  /** The UHT that feeds the line, a name from `uht_units`; '' for none (migration 0013). */
  uht?: string;
  /** The filler model: 'TFA', 'TBA/19', 'TBA/22', 'A3/Speed' or another; '' for none (migration 0013). */
  filler?: string;
  /** The filler's speed (migration 0013). */
  filler_packs_per_h?: number | null;
  /** The pack size (migration 0013). */
  pack_ml?: number | null;
}

/** One UHT plant of the factory, as `factory_settings.uht_units` lists it (migration 0013). */
export interface UhtUnitRow {
  name: string;
  capacityLph: number;
}

/** The `factory_settings` row (there is one). */
export interface SettingsRow {
  site_name?: string;
  uht_units?: UhtUnitRow[] | null;
}

/** An open report (a trouble): where it is and how serious. `loc` is a line's name or a place. */
export interface ReportRow {
  id: string;
  loc: string;
  /** 0 low to 3 critical. */
  sev: number;
  /** 'open', 'action' or 'verify': the board reads only reports that are not closed. */
  status: string;
}

/** Everything the board reads from Let Report, as last read. */
export interface FactoryData {
  lines: LineRow[];
  settings: SettingsRow | null;
  reports: ReportRow[];
}

// ───── What the board draws (model.ts builds it; board.ts draws it) ─────

export interface LineView {
  id: string;
  name: string;
  /** '' when Let Report gives none. */
  filler: string;
  packsPerH: number | null;
  packMl: number | null;
  /** packs/h × ml ÷ 1,000; null when the speed or the pack size is missing. */
  ratedLph: number | null;
  /** What it draws from its UHT now: ratedLph while running, otherwise 0. */
  drawLph: number;
  status: LineStatus;
  lamp: Status;
  /** "Running", "Stopped", "Maintenance", "Changeover", "Idle", or "CIP · 1 h 10 min left" ("CIP · overdue"). */
  statusText: string;
  product: string;
  lot: string;
  /** Seconds since the lot started; null with no lot or no start time. */
  lotRunS: number | null;
  /** Seconds of CIP left while cleaning with a planned end, 0 once overdue; otherwise null. */
  cipLeftS: number | null;
  qty: number;
  target: number;
  /** Reports at this line (loc = its name) that are not closed. */
  openTroubles: number;
  /** The most serious of them, 0–3; null with none. */
  worstSev: number | null;
}

export type UhtState = 'producing' | 'cip' | 'stopped';

export interface UhtView {
  name: string;
  capacityLph: number;
  /** The sum of its lines' drawLph. */
  drawLph: number;
  /** drawLph ÷ capacityLph × 100; 0 when the capacity is not above 0. */
  loadPct: number;
  /** Its lines draw more than it makes. */
  overCapacity: boolean;
  /** Producing while any of its lines runs; CIP when it has lines and all are cleaning; otherwise stopped. */
  state: UhtState;
  /** ok producing (warn when over capacity), idle in CIP, bad stopped with lines, idle with no lines. */
  lamp: Status;
  /** "Producing · 5,550 of 8,000 L/h", "CIP", "Stopped", "No lines". */
  stateText: string;
  /** In Let Report's order: by `sort`, then by name. */
  lines: LineView[];
}

export interface FactoryView {
  /** Let Report's site name; '' when it has none. */
  siteName: string;
  /** In the order of `uht_units`. */
  uhts: UhtView[];
  /** UHT lines (type 'UHT') whose `uht` names none of the UHTs, in Let Report's order. */
  unassigned: LineView[];
  /** Lines running in all, and their total draw. */
  runningLines: number;
  totalDrawLph: number;
}

/** model.ts: the board's view of what Let Report holds, at the time `nowMs` (for the CIP and lot clocks). */
export type BuildFactory = (data: FactoryData, nowMs: number) => FactoryView;

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
