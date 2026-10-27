// Contracts v3 (phase 4): stages 7–10, from the fillers to the trucks, as the discrete model hands them to
// the 3D view and the panels. Counts are whole packs, trays and pallets; times are sim seconds since
// day 1, 00:00 (units rule D6).

/**
 * What a filler is doing (plan 04, stage 7):
 * - `running`: forming, filling and sealing packs at the set rate;
 * - `starved`: waiting for product, the aseptic tank below its stop level (150 L, until 500 L again);
 * - `stopped`: the filler rate is set to 0;
 * - `repair`: broken down, being repaired (the random part of the repair time, D2);
 * - `cleaning`: re-sterilizing its aseptic zone after a repair (the fixed part, D14), then running again.
 */
export type FillerState = 'running' | 'starved' | 'stopped' | 'repair' | 'cleaning';

export const FILLER_STATES: readonly FillerState[] = ['running', 'starved', 'stopped', 'repair', 'cleaning'];

/** One filler and the pack line it feeds (contracts v3). */
export interface FillerSnapshot {
  /** 'A' or 'B': filler A on the back row feeds line A. */
  name: string;
  state: FillerState;
  /** Sim seconds left in a repair or in the cleaning after it; 0 in the other states. */
  stateRemainingS: number;
  /** Packs it makes now: the set rate while it runs, else 0. */
  packsPerH: number;
  /** The batch it fills now: one filler for one shift (D1). */
  batchId: number;
  /** Since the plant opened: packs formed, those of them rejected at the seal check, and breakdowns. */
  packsMade: number;
  packsRejected: number;
  breakdowns: number;
  /**
   * OEE since the plant opened (OEE.com): availability = time running ÷ time open, performance = packs
   * made ÷ what the machine maximum would have made in the running time, quality = good packs ÷ packs made.
   */
  availabilityPct: number;
  performancePct: number;
  qualityPct: number;
  oeePct: number;
}

/**
 * The tray packer's lane for one pack line (stage 8): `running` packs what arrives, `changeover` stands
 * for the batch change at a shift change, `catchUp` runs up to 30% faster to clear the packs that queued
 * meanwhile (D9), and `idle` has nothing to pack.
 */
export type PackerState = 'running' | 'changeover' | 'catchUp' | 'idle';

export const PACKER_STATES: readonly PackerState[] = ['running', 'changeover', 'catchUp', 'idle'];

export interface PackLaneSnapshot {
  /** 'A' or 'B', as the filler that feeds it. */
  name: string;
  packerState: PackerState;
  /** Sim seconds left in a changeover; 0 otherwise. */
  changeoverRemainingS: number;
  /** Packs on the conveyor and the accumulation table, waiting for the tray packer. */
  queuePacks: number;
  /** Packs in the tray being filled (0–11) and trays on the pallet being built (0–83). */
  trayPacks: number;
  palletTrays: number;
  /** The batch of that pallet. */
  batchId: number;
}

/** A pallet as its GS1 label names it: the batch and its number within the batch (the SSCC follows, sscc.ts). */
export interface PalletRef {
  batchId: number;
  palletNo: number;
  /** Sim time it was closed. */
  atS: number;
}

export interface PackagingSnapshot {
  /** One lane per filler, in filler order. */
  lanes: PackLaneSnapshot[];
  /** Since the plant opened. Pallets count physically, so a batch's part-full last pallet counts as one (D1). */
  traysMade: number;
  palletsMade: number;
  /** Packs taken off the lines as QA samples since the plant opened (1 per filler every 30 min, plus 2 after each restart). */
  packsSampled: number;
  /** The newest pallet closed, or null before the first. */
  lastPallet: PalletRef | null;
}

/** HOLD → RELEASED or BLOCKED (plan 04, stage 9); a batch is `filling` until its shift ends. */
export type BatchStatus = 'filling' | 'hold' | 'released' | 'blocked';

export const BATCH_STATUSES: readonly BatchStatus[] = ['filling', 'hold', 'released', 'blocked'];

/** The QA lab's override for a batch (setQaResult), or `pending` while its samples decide. */
export type QaResult = 'pending' | 'pass' | 'fail';

/**
 * Why a batch is under investigation (contracts v4): it was filled while the aseptic tank's sterile-air filter
 * had failed (a higher chance that a sample spoils), or from milk homogenized at too low a pressure (a
 * sensory check for a cream layer when its incubation ends).
 */
export type BatchFlag = 'sterileAir' | 'creaming';

export const BATCH_FLAGS: readonly BatchFlag[] = ['sterileAir', 'creaming'];

export interface BatchSnapshot {
  id: number;
  /** The filler that made it: 'A' or 'B'. */
  filler: string;
  status: BatchStatus;
  /** Its shift: from startS (or the plant opening) to endS; endS is still ahead while it fills. */
  startS: number;
  endS: number;
  /**
   * While filling or on hold: when its incubation ends and it is released or blocked (endS + incubation).
   * Once blocked: when its pallets leave for destruction.
   */
  releaseAtS: number;
  /** Best-before date of its packs: the shift's start plus the shelf life (D9: 182 days). */
  bestBeforeS: number;
  /** Closed pallets and the packs on them; its open pallet is in packaging.lanes. */
  pallets: number;
  packs: number;
  /** Packs on its last closed pallet: 1,008 for a full one, fewer for the part-full one that closes a batch (D1). */
  lastPalletPacks: number;
  /** Samples owed to the incubators: 1 per 30 min of its shift, plus 2 after each restart. */
  samples: number;
  qaResult: QaResult;
  /** Why it is under investigation, if it is (contracts v4). */
  flags: BatchFlag[];
  /** Creaming risk of the milk it was filled from, if a homogenizer pressure loss reached it; else 0 (contracts v4). */
  creamingRiskPct: number;
}

/** Released pallets of one batch in the warehouse. */
export interface StockSnapshot {
  batchId: number;
  pallets: number;
  bestBeforeS: number;
}

/** A truck at the dock: `waiting` for released stock, or `loading` 22 pallets (D3). */
export type TruckState = 'waiting' | 'loading';

export const TRUCK_STATES: readonly TruckState[] = ['waiting', 'loading'];

export interface TruckSnapshot {
  id: number;
  /** Dock door 0, 1 or 2; -1 while it waits in the yard for a free door. */
  door: number;
  state: TruckState;
  arrivedS: number;
  /** Sim seconds left loading; 0 while waiting. */
  remainingS: number;
  /** Pallets on board: the full load while loading, 0 while waiting. */
  pallets: number;
}

export interface WarehouseSnapshot {
  /** Released stock by batch, first-expired-first-out: the next pick comes from the first entry. */
  stock: StockSnapshot[];
  palletsInStock: number;
  /** Trucks at the dock or in the yard, in arrival order. */
  trucks: TruckSnapshot[];
  /** Sim time the next truck arrives. */
  nextTruckS: number;
  /** Since the plant opened. */
  trucksArrived: number;
  /** Trucks that found a full load in stock when they arrived (the order fill rate, D2). */
  trucksFilledOnArrival: number;
  trucksShipped: number;
  palletsShipped: number;
  /** Pallets of blocked batches that have left quarantine for destruction. */
  palletsDestroyed: number;
}

/** Stages 7–10: packs, pallets, quarantine, warehouse and trucks (contracts v3, phase 4). */
export interface PacksSnapshot {
  fillers: FillerSnapshot[];
  packaging: PackagingSnapshot;
  /** Batches in quarantine, oldest first: the filling ones, those on hold, and blocked ones not yet destroyed. */
  batches: BatchSnapshot[];
  warehouse: WarehouseSnapshot;
}
