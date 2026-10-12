import type { Speed, StageId, Status } from './stages';

/**
 * Bump on every contract change (plan/agent-plan/README.md#contracts):
 * v0 week 1, v1 at G1, v2 at week 6, v3 at G2. After G2, fields may only be added.
 */
export const CONTRACT_VERSION = 0;

export interface StageSnapshot {
  id: StageId;
  status: Status;
  /** Live values keyed by unit-suffixed names, such as `tempC` or `flowLph` (units rule R8). */
  values: Record<string, number>;
}

/** The KPI strip (plan 06, KPIs on screen). Values the model can't produce yet are 0. */
export interface Kpis {
  uhtFlowLph: number;
  f0Min: number;
  bStar: number;
  divertedL: number;
  tankLevelPct: number;
  packsPerH: number;
  oeePct: number;
  traysMade: number;
  palletsMade: number;
  batchesOnHold: number;
  batchesReleased: number;
  batchesBlocked: number;
  palletsInStock: number;
  daysOfCover: number;
  orderFillPct: number;
  trucksShipped: number;
}

export type LogKind = 'info' | 'ok' | 'warn' | 'bad';

export interface LogEntry {
  /** Sim time of the entry, seconds since day 1, 00:00. */
  timeS: number;
  kind: LogKind;
  message: string;
}

/** One plain-object picture of the plant, built once per frame; the 3D view and the UI read only this. */
export interface Snapshot {
  version: number;
  /** Sim time, seconds since day 1, 00:00. */
  timeS: number;
  speed: Speed;
  paused: boolean;
  /** Sim time of the next queued event, or null if the queue is empty. */
  nextEventS: number | null;
  stages: Record<StageId, StageSnapshot>;
  kpis: Kpis;
  /** Newest first, capped in length by the sim. */
  log: readonly LogEntry[];
}
