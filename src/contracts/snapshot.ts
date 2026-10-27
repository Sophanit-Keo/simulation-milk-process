import type { PacksSnapshot } from './packs';
import type { LinePointId, Speed, StageId, Status } from './stages';

/**
 * Bump on every contract change (plan/agent-plan/README.md#contracts):
 * v0 week 1, v1 at G1, v2 at week 6, v3 at G2. From v3 on, fields may only be added.
 */
export const CONTRACT_VERSION = 3;

/** Milk at one measuring point of the liquid line (contracts v1). */
export interface LinePoint {
  tempC: number;
  /** Flow through this point; 0 when nothing passes (e.g. the divert line in production). */
  flowLph: number;
}

export interface StageSnapshot {
  id: StageId;
  status: Status;
  /** Live values keyed by unit-suffixed names, such as `tempC` or `flowLph` (units rule R8). */
  values: Record<string, number>;
}

/**
 * The KPI strip (plan 06, KPIs on screen). The counters (trays, pallets, batches released and blocked,
 * trucks) count since the plant opened; OEE per filler is in Snapshot.packs.fillers.
 */
export interface Kpis {
  uhtFlowLph: number;
  f0Min: number;
  bStar: number;
  divertedL: number;
  tankLevelPct: number;
  packsPerH: number;
  oeePct: number;
  traysMade: number;
  /** Physical pallets, so each batch's part-full last pallet counts as one (D1). Same for palletsInStock. */
  palletsMade: number;
  batchesOnHold: number;
  batchesReleased: number;
  batchesBlocked: number;
  palletsInStock: number;
  daysOfCover: number;
  orderFillPct: number;
  trucksShipped: number;
}

/**
 * What the UHT plant is doing (contracts v2, phase 3): stages 2–5. Stage 1 runs on its own buffer, the mixing tank,
 * which its separator refills while the UHT plant cleans.
 * After a divert the plant flushes and cleans (`cip`), then re-sterilizes before it makes product again;
 * an intermediate clean (`aic`) runs every so many hours of production while the aseptic tank feeds the fillers.
 */
export type UhtMode = 'production' | 'divert' | 'cip' | 'sterilize' | 'aic';

export const UHT_MODES: readonly UhtMode[] = ['production', 'divert', 'cip', 'sterilize', 'aic'];

/** A tank's contents (contracts v2). The 3D view fills each tank to levelL ÷ capacityL. */
export interface TankLevel {
  levelL: number;
  capacityL: number;
}

/**
 * The liquid line, stages 1–6, as the 3D view and the panels need it beyond the per-stage values
 * (contracts v2, phase 3). Flows and temperatures along the pipes stay in Snapshot.line.
 */
export interface LiquidSnapshot {
  uhtMode: UhtMode;
  /** Sim seconds left in the current divert, cip, sterilize or aic step; 0 in production. */
  modeRemainingS: number;
  /** True while the aseptic tank's high level holds the UHT plant at its throttled flow (hysteresis 90% / 60%). */
  throttled: boolean;
  /** Fillers drawing from the aseptic tank now: running, not starved, stopped, broken down or cleaning (phase 4). */
  fillersRunning: number;
  /** True from the aseptic tank falling below its stop level until it is back above the restart level (150 L and 500 L). */
  fillersStarved: boolean;
  /** Sterile-air pressure over the product in the aseptic tank. */
  headspaceBar: number;
  /** Production time since the last clean, toward the next intermediate clean. */
  productionSinceCleanS: number;
  /** Diverts since the plant opened. */
  divertCount: number;
  tanks: {
    silo: TankLevel;
    /** The mixing (feed) tank after standardization, which feeds the UHT plant. */
    mixTank: TankLevel;
    asepticTank: TankLevel;
    rejectTank: TankLevel;
  };
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
  /** Temperature and flow at each point of the liquid line, for pipe colours and flow (contracts v1). */
  line: Record<LinePointId, LinePoint>;
  /** Stages 1–6 beyond their per-stage values: modes, tank levels and filler draw (contracts v2). */
  liquid: LiquidSnapshot;
  /** Stages 7–10: fillers, packaging, batches in quarantine, warehouse and trucks (contracts v3). */
  packs: PacksSnapshot;
  kpis: Kpis;
  /** Newest first, capped in length by the sim. */
  log: readonly LogEntry[];
}
