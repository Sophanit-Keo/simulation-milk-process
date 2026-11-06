import type { CleaningSnapshot, TankLevel } from './snapshot';

/**
 * The yogurt line, Line P8 (plan 12, D25, D26; contracts v8): stages 11–16 beyond their per-stage values. Phase 15
 * sets the shape; phases 17–19 make it live, and add fields (only add) as P8 and the cold chain gain detail.
 * Since phase 17 the live sim runs stages 11–14 (D27), with P8's draw stubbed at its rate and the cold chain standing
 * until phases 18–19; ?mock fills every stage.
 */

/** The yogurt line's products (D26): P8 makes one at a time, one a shift. */
export type YogurtProductId = 'plainStirred' | 'strawberryStirred' | 'plainSet';

export const YOGURT_PRODUCT_IDS: readonly YogurtProductId[] = ['plainStirred', 'strawberryStirred', 'plainSet'];

/** Stirred yogurt ferments in the bulk tanks and is cooled before P8; set yogurt ferments in the cup, in the warm room. */
export type YogurtRoute = 'stirred' | 'set';

export const YOGURT_ROUTES: readonly YogurtRoute[] = ['stirred', 'set'];

/**
 * What the heat treatment (stage 12) does: heats the mix forward, diverts it to the reprocess tank (below the divert
 * limit, or a hold too short), runs the wing's clean, or stands.
 */
export type YogurtHeatMode = 'production' | 'divert' | 'cleaning' | 'idle';

export const YOGURT_HEAT_MODES: readonly YogurtHeatMode[] = ['production', 'divert', 'cleaning', 'idle'];

/** A fermentation tank's cycle (plan 12, stage 13): fill, ferment, hold at the end pH, empty, clean. */
export type FermentTankState = 'empty' | 'filling' | 'fermenting' | 'ready' | 'emptying' | 'cleaning';

export const FERMENT_TANK_STATES: readonly FermentTankState[] = ['empty', 'filling', 'fermenting', 'ready', 'emptying', 'cleaning'];

/** One of the three insulated fermentation tanks (stage 13). The 3D view fills it to levelL ÷ capacityL. */
export interface FermentTank extends TankLevel {
  state: FermentTankState;
  /** The product in it; null while it is empty or cleaning. */
  product: YogurtProductId | null;
  /** What its pH probe reads. */
  ph: number;
  /** Titratable acidity, % lactic acid; it follows the pH (D26). */
  taPct: number;
  /** Sim time its fermentation started (full and inoculated); null before. */
  startedS: number | null;
  /** Sim time it reaches, or reached, the end pH at its temperature (H125); null before it starts. */
  readyAtS: number | null;
}

/** What Line P8 is doing (stage 15); `stopReason` says why it stopped (contracts v10). */
export type P8State = 'idle' | 'cleaning' | 'sterilizing' | 'running' | 'starved' | 'stopped';

export const P8_STATES: readonly P8State[] = ['idle', 'cleaning', 'sterilizing', 'running', 'starved', 'stopped'];

/** Why P8 stopped (contracts v10, phase 18, D28): the HEPA cabin under its limit, or the cup or foil magazine run out. */
export type P8StopReason = 'hepa' | 'cups' | 'foils';

export const P8_STOP_REASONS: readonly P8StopReason[] = ['hepa', 'cups', 'foils'];

/** Cups the in-line checks threw out since the plant opened, by cause (contracts v10). */
export interface P8Rejects {
  /** The checkweigher: under `fill.underBelowG`, over `fill.overAboveG`. */
  underFill: number;
  overFill: number;
  metal: number;
  vision: number;
  /** Cups held by a seal test that failed: every cup made since the last test that passed. */
  sealHold: number;
}

/** The batch P8 fills now (contracts v10): one product's run in one shift (D1, D28), coded on every cup. */
export interface P8Batch {
  /** "P8-008-1": Line P8, the day of the shift's start, the shift's number from 06:00. */
  code: string;
  product: YogurtProductId;
  /** Date of manufacture: the batch's first cup. */
  madeS: number;
  /** Expiry: madeS plus the shelf life. */
  expiresS: number;
  /** Cups of the batch made so far: filled, sealed and passed. */
  cups: number;
}

/** Line P8, the cup filler (stage 15). Contracts v10 (phase 18) adds every field after cupsRejected; each is absent from an older snapshot. */
export interface P8Snapshot {
  state: P8State;
  /** Cups filled per hour now; 0 while it stands. */
  cupsPerH: number;
  /** Cups filled, sealed and passed by every check since the plant opened. */
  cupsMade: number;
  /** Cups the checks threw out since the plant opened. */
  cupsRejected: number;
  /** Why it stopped, while `state` is 'stopped'; null otherwise. */
  stopReason?: P8StopReason | null;
  /** Cycles of `p8.lanes` cups a minute now; 0 while it stands. */
  cyclesPerMin?: number;
  rejects?: P8Rejects;
  /** The fill weight of the last cup filled; null before the first. */
  lastFillG?: number | null;
  /** The current batch's fill weights: counts[i] cups weighed from fromG + i × binG to fromG + (i + 1) × binG; the end bins take the rest. */
  fillHistogram?: { fromG: number; binG: number; counts: number[] };
  /** The sealing heads now. */
  seal?: { tempC: number; timeS: number; bar: number };
  /** The HEPA cabin's overpressure against the packaging hall. */
  hepaPa?: number;
  /** The last SIP: when it ended, and whether it held its temperature and time; lastS null before any. */
  sip?: { lastS: number | null; ok: boolean };
  /** The last ATP swab, RLU; null before any. */
  atpRlu?: number | null;
  /** Sim time of the next seal test if P8 keeps running; null while it does not run. */
  nextSealTestS?: number | null;
  /** Seal tests since the plant opened, and the cups they took. */
  sealTests?: { passed: number; failed: number; cupsTaken: number };
  /** How full the de-nester's cup magazine and the lidder's foil magazine are. */
  magazines?: { cupsPct: number; foilsPct: number };
  /** The batch it fills; null before its first cup. */
  currentBatch?: P8Batch | null;
}

/** Where a yogurt pallet stands (contracts v11, phase 19, D29): waiting by the wrapper, in a room, or on a reefer. */
export type YogurtPalletPlace = 'staging' | 'warmRoom' | 'chiller' | 'coldRoom' | 'reefer';

export const YOGURT_PALLET_PLACES: readonly YogurtPalletPlace[] = ['staging', 'warmRoom', 'chiller', 'coldRoom', 'reefer'];

/** One yogurt pallet in the cold chain (contracts v11): one batch's trays (D1). */
export interface YogurtPallet {
  id: number;
  /** P8's batch code, "P8-008-1". */
  batch: string;
  product: YogurtProductId;
  route: YogurtRoute;
  cups: number;
  trays: number;
  place: YogurtPalletPlace;
  /** Sim time it closed at the palletizer. */
  closedS: number;
  /** Its core temperature. */
  tempC: number;
  ph: number;
  /** Sim time its 24 h hold in the cold room ends; null before it comes in. */
  holdUntilS: number | null;
  /** Sim time it must have left, the 48 h maximum; null before the cold room. */
  leaveByS: number | null;
  /** Its hold is over and every seal test covering it passed: it may leave. */
  released: boolean;
}

/** A reefer at the yogurt dock (contracts v11): backing up to its door, or loading its pallets. */
export type YogurtReeferState = 'arriving' | 'loading';

export const YOGURT_REEFER_STATES: readonly YogurtReeferState[] = ['arriving', 'loading'];

export interface YogurtReefer {
  id: number;
  /** The dock door, from 0, in the cold room's north wall. */
  door: number;
  state: YogurtReeferState;
  /** Pallets on board, of its load. */
  pallets: number;
  load: number;
  /** Sim time it docks (arriving) or leaves (loading). */
  untilS: number;
}

/**
 * Trays, pallets and the cold chain (stage 16). Contracts v11 (phase 19, D29) adds every field marked so; each is
 * absent from an older snapshot.
 */
export interface ColdChainSnapshot {
  /** The 41–43 °C incubation room, where set yogurt sets in the cup; its positions (v11). */
  warmRoom: { tempC: number; pallets: number; capacity?: number };
  /** The blast-chilling tunnel: its positions and its air (v11). */
  chiller: { pallets: number; capacity?: number; airC?: number };
  /** The 2–4 °C cold room, where every pallet holds 24–48 h before release: its positions and the next release (v11). */
  coldRoom: { tempC: number; positionsUsed: number; capacity?: number; nextReleaseS?: number | null };
  /** Since the plant opened. */
  palletsShipped: number;
  reefersShipped: number;
  /** Trays packed since the plant opened, and the open tray and pallet at the palletizer (v11). */
  trays?: { made: number; openBatch: string | null; openCups: number; openTrays: number };
  /**
   * Every pallet in the cold chain (v11), in the chain's order: on the reefers, in the cold room, the chiller, the warm
   * room, then staging, each place first in first out.
   */
  pallets?: YogurtPallet[];
  /** The reefers at the dock (v11). */
  reefers?: YogurtReefer[];
  /** Cups shipped since the plant opened, and cups a failed seal test pulled from the trays and pallets (v11). */
  cupsShipped?: number;
  cupsHeld?: number;
}

/**
 * What runs between two products on Line P8 (contracts v9, phase 17, D27): a rinse of the buffer and the fruit line
 * before a stirred product, and before set yogurt the wing's CIP of the buffer and P8, then P8's SIP.
 */
export type YogurtChangeoverKind = 'rinse' | 'cip' | 'sip';

export const YOGURT_CHANGEOVER_KINDS: readonly YogurtChangeoverKind[] = ['rinse', 'cip', 'sip'];

/** The heat treatment's steam and the boiler's gas for it (contracts v9, phase 17), counted apart from the UHT's. */
export interface YogurtEnergySnapshot {
  steamKgPerH: number;
  gasKw: number;
  /** Since the plant opened. */
  steamKg: number;
  gasKwh: number;
}

/** The yogurt group of the KPI strip (phase 16 shows it). */
export interface YogurtKpis {
  /** Mix through the heat treatment now. */
  mixLph: number;
  /** Mix sent to the reprocess tank since the plant opened. */
  divertedL: number;
  cupsPerH: number;
  cupsMade: number;
  coldRoomPallets: number;
  reefersShipped: number;
}

export interface YogurtSnapshot {
  /** The product this shift makes, and the one the next shift will (the setYogurtProduct command picks it). */
  product: { id: YogurtProductId; route: YogurtRoute; fruit: boolean; next: YogurtProductId };
  /** Stage 11: the mix's recipe and the wing's own raw-milk silo and mix tank. */
  mix: {
    /** Mix made now, into the mix tank. */
    flowLph: number;
    fatPct: number;
    snfPct: number;
    /** Skim-milk powder dosed per tonne of mix (H122). */
    powderKgPerT: number;
    tanks: { silo: TankLevel; mixTank: TankLevel };
  };
  /** Stage 12: deaeration, homogenization and the heat treatment, the line's critical control point. */
  heat: {
    mode: YogurtHeatMode;
    flowLph: number;
    /** At the holding cell's outlet. */
    outletC: number;
    /** The hold the flow gives in the holding cell (H123). */
    holdS: number;
    /** β-lactoglobulin denatured over the hold (H124). */
    denatPct: number;
    divertCount: number;
    reprocessTank: TankLevel;
    /** Time left in a divert or a clean; 0 otherwise (contracts v9). Absent from an older snapshot. */
    modeRemainingS?: number;
    /** The step of the wing's CIP after a divert, while it runs; null otherwise (contracts v9). */
    cleaning?: CleaningSnapshot | null;
  };
  /** Stage 13: inoculation and the three fermentation tanks. */
  ferment: { tempC: number; tanks: FermentTank[] };
  /** Stage 14: the P8 buffer, after the smoothing valve, the cooler and the fruit dosing. */
  buffer: TankLevel & {
    /** From the inoculation (set) or an emptying tank through the cooler (stirred). */
    inflowLph: number;
    /** What P8 draws. */
    outflowLph: number;
    tempC: number;
    /** How long the set mix in it has waited (it starts to set); null for stirred yogurt. */
    waitS: number | null;
    /** The plate cooler's outlet; null for set yogurt, which skips it. */
    coolerOutletC: number | null;
    /** Fruit preparation dosed into the flow; 0 without a fruit recipe. */
    fruitDosePct: number;
    /** The product in the buffer, or the one it is made ready for; null while it changes over (contracts v9). */
    product?: YogurtProductId | null;
    /** The changeover under way between two products on P8, or null (contracts v9). */
    changeover?: { kind: YogurtChangeoverKind; remainingS: number } | null;
  };
  /** Stage 15. */
  p8: P8Snapshot;
  /** Stage 16. */
  coldChain: ColdChainSnapshot;
  kpis: YogurtKpis;
  /** The heat treatment's steam (contracts v9, phase 17). Absent from an older snapshot. */
  energy?: YogurtEnergySnapshot;
}
