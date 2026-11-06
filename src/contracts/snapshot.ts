import type { ScenarioId } from './commands';
import type { PacksSnapshot } from './packs';
import type { ScenariosSnapshot } from './scenarios';
import type { LineId, LinePointId, Speed, StageId, Status } from './stages';
import type { YogurtSnapshot } from './yogurt';

/**
 * Bump on every contract change (plan/agent-plan/README.md#contracts):
 * v0 week 1, v1 at G1, v2 at week 6, v3 at G2, v4 in phase 5 (scenarios), v5 in phase 7 (cleaning steps), v6 in
 * phase 8 (steam and energy), v7 in phase 13 (the CIP station's chemicals and returns), v8 in phase 15 (the yogurt
 * line: stages 11–16, their line points and Snapshot.yogurt), v9 in phase 17 (the live yogurt line's heat treatment
 * clean, buffer changeover and steam), v10 in phase 18 (Line P8: its cycles, rejects by cause, seal, hygiene,
 * magazines and batch), v11 in phase 19 (the yogurt cold chain: trays, pallets, the rooms and the reefers), v12 in phase 20
 * (the yogurt line's five fault scenarios: a tank held for a slow fermentation, pallets on QA hold, the cold room's
 * excursion). From v3 on, fields may only be added.
 */
export const CONTRACT_VERSION = 12;

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

/** The UHT plant's two cleaning programmes (contracts v5, phase 7): the full CIP after a divert, and the intermediate clean. */
export type CleaningProgram = 'cip' | 'aic';

/** What circulates through the UHT plant in a cleaning step: water, the alkaline detergent (NaOH lye) or the acid (HNO3). */
export type CleaningFluid = 'water' | 'lye' | 'acid';
export const CLEANING_FLUIDS: readonly CleaningFluid[] = ['water', 'lye', 'acid'];

/**
 * The steps the programmes are made of (plant.json cleaning.cipSteps and aicSteps): the CIP's pre-rinse, lye,
 * rinse, acid, post-rinse and gradual cooling (Dairy Processing Handbook), and the AIC's water that displaces
 * the product before its lye and rinse.
 */
export type CleaningStepId = 'preRinse' | 'lye' | 'rinse' | 'acid' | 'postRinse' | 'cooling' | 'displace';
export const CLEANING_STEP_IDS: readonly CleaningStepId[] = ['preRinse', 'lye', 'rinse', 'acid', 'postRinse', 'cooling', 'displace'];

/**
 * Where the CIP station's change-over valve sends the return (contracts v7, phase 13, D23): back to the lye's or the
 * acid's tank while the return is that solution, to the water tank in a recovered rinse, or to drain.
 */
export type CleaningReturn = 'drain' | 'waterTank' | 'lyeTank' | 'acidTank';
export const CLEANING_RETURNS: readonly CleaningReturn[] = ['drain', 'waterTank', 'lyeTank', 'acidTank'];

/** The cleaning step under way (contracts v5, phase 7). */
export interface CleaningSnapshot {
  program: CleaningProgram;
  step: CleaningStepId;
  fluid: CleaningFluid;
  /** The step's place in its programme, from 0, and how many steps the programme has. */
  stepIndex: number;
  stepCount: number;
  /** Sim seconds left in this step. */
  stepRemainingS: number;
  /** The temperature the step runs at; null for an AIC step, which holds the UHT set point so the plant stays sterile. */
  tempC: number | null;
  /** What the CIP station circulates through the UHT plant, stages 2–5, and back. */
  flowLph: number;
  /**
   * The step's chemical strength by weight (contracts v7): the lye's sodium hydroxide or the acid's nitric acid; null
   * for water. Absent from an older snapshot.
   */
  concentrationPct?: number | null;
  /** What the conductivity transmitter on the return reads, referred to 20 °C (contracts v7). Absent from an older snapshot. */
  returnConductivityMsPerCm?: number;
  /** Where the change-over valve sends the return now (contracts v7). Absent from an older snapshot. */
  returnTo?: CleaningReturn;
}

/**
 * What the cleans have used since the plant opened (contracts v7, phase 13, D23): pure sodium hydroxide and nitric
 * acid lost at the chemical steps' interfaces (litres of solution count as kilograms), and the rinse water sent to drain.
 */
export interface CleaningUseSnapshot {
  lyeKg: number;
  acidKg: number;
  drainWaterL: number;
}

/**
 * What the steam injector heats (contracts v6, phase 8): the milk, in production and while diverting; a cleaning
 * step's fluid, in a full CIP or an intermediate clean; or the hot water that re-sterilizes the plant.
 */
export type SteamUse = 'milk' | 'cleaning' | 'sterilizing';
export const STEAM_USES: readonly SteamUse[] = ['milk', 'cleaning', 'sterilizing'];

/**
 * The UHT plant's steam and energy (contracts v6, phase 8, D17): the boiler house raises the steam the injector
 * uses and burns gas for it, and the homogenizer draws the electricity. The totals count since the plant opened.
 */
export interface EnergySnapshot {
  /** Steam to the injector now. */
  steamKgPerH: number;
  /** What the steam heats now; null while the injector takes none. */
  steamUse: SteamUse | null;
  /** Gas the boiler burns for that steam. */
  gasKw: number;
  /** Electricity now: the homogenizer's, the one drive the model counts. */
  electricKw: number;
  /** Share of the milk's heating to UHT temperature that regeneration (the preheater) gives it; null while no milk flows. */
  regenerationPct: number | null;
  steamKg: number;
  gasKwh: number;
  electricKwh: number;
  /** Gas and electricity per tonne of raw milk drawn, both since the plant opened (litres count as kg); null before any. */
  kwhPerT: number | null;
}

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
  /**
   * The cleaning step under way during a full CIP or an intermediate clean, null otherwise (contracts v5,
   * phase 7). Absent from an older snapshot. The milk's line points (Snapshot.line) carry no cleaning flow.
   */
  cleaning?: CleaningSnapshot | null;
  /** The steam, the gas and the electricity (contracts v6, phase 8). Absent from an older snapshot. */
  energy?: EnergySnapshot;
  /** The chemicals and the rinse water the cleans have used (contracts v7, phase 13). Absent from an older snapshot. */
  cleaningUse?: CleaningUseSnapshot;
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
  /** The scenario that caused it, if one did (contracts v4). */
  scenario?: ScenarioId;
  /** Why it happened, one or two sentences, for the scenario log (contracts v4). */
  why?: string;
  /** The line it is about, where it is the yogurt line's (contracts v9); absent for the UHT line's and the plant's. */
  line?: LineId;
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
  /** Every stage, 1–16 (contracts v8 adds the yogurt line's 11–16). */
  stages: Record<StageId, StageSnapshot>;
  /** Temperature and flow at each point of the UHT line and, from contracts v8, of the yogurt line, for pipe colours and flow (contracts v1). */
  line: Record<LinePointId, LinePoint>;
  /** Stages 1–6 beyond their per-stage values: modes, tank levels and filler draw (contracts v2). */
  liquid: LiquidSnapshot;
  /** Stages 7–10: fillers, packaging, batches in quarantine, warehouse and trucks (contracts v3). */
  packs: PacksSnapshot;
  /** The fault scenarios triggered so far, and those that cannot start now (contracts v4). */
  scenarios: ScenariosSnapshot;
  /** Stages 11–16, the yogurt line on Line P8, beyond their per-stage values (contracts v8). */
  yogurt: YogurtSnapshot;
  /** The UHT line's KPIs; the yogurt line's are in yogurt.kpis. */
  kpis: Kpis;
  /** Newest first, capped in length by the sim. */
  log: readonly LogEntry[];
}
