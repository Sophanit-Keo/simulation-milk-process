import type { TankLevel } from './snapshot';

/**
 * The yogurt line, Line P8 (plan 12, D25, D26; contracts v8): stages 11–16 beyond their per-stage values. Phase 15
 * sets the shape; phases 17–19 make it live, and add fields (only add) as P8 and the cold chain gain detail.
 * Until phase 17 the live sim reports the line standing (idle, nothing made) and ?mock fills it.
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

/** What Line P8 is doing (stage 15). Phase 18 adds why it stopped. */
export type P8State = 'idle' | 'cleaning' | 'sterilizing' | 'running' | 'starved' | 'stopped';

export const P8_STATES: readonly P8State[] = ['idle', 'cleaning', 'sterilizing', 'running', 'starved', 'stopped'];

/** Line P8, the cup filler (stage 15). Phase 18 adds the rejects by cause, the seal, HEPA, SIP, ATP and the magazines. */
export interface P8Snapshot {
  state: P8State;
  /** Cups filled per hour now; 0 while it stands. */
  cupsPerH: number;
  /** Cups filled, sealed and passed by every check since the plant opened. */
  cupsMade: number;
  /** Cups the checks threw out since the plant opened. */
  cupsRejected: number;
}

/** Trays, pallets and the cold chain (stage 16). Phase 19 adds the trays, each pallet, the capacities and the reefers. */
export interface ColdChainSnapshot {
  /** The 41–43 °C incubation room, where set yogurt sets in the cup. */
  warmRoom: { tempC: number; pallets: number };
  /** The blast-chilling tunnel. */
  chiller: { pallets: number };
  /** The 2–4 °C cold room, where every pallet holds 24–48 h before release. */
  coldRoom: { tempC: number; positionsUsed: number };
  /** Since the plant opened. */
  palletsShipped: number;
  reefersShipped: number;
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
  };
  /** Stage 15. */
  p8: P8Snapshot;
  /** Stage 16. */
  coldChain: ColdChainSnapshot;
  kpis: YogurtKpis;
}
