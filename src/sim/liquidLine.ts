// The liquid line, stages 1–6, as a fixed-step continuous model (plan 06). Every step the
// silo, the mixing tank, the aseptic tank and the reject tank move by inflow minus outflow, and the
// UHT plant walks its modes: production, divert, CIP, sterilize, and an intermediate clean (AIC).
//
// Step size: the flows are constant between two events (a mode timer running out, a clean falling
// due, the aseptic tank's level crossing a throttle or filler threshold, a tank filling up, the silo
// calling for a tanker, a tanker running empty), so a step is cut at each such event and the levels are
// exact at any step the clock takes (checkPlantConfig caps clock.fastStepS at 60 s). The lags (preheater, air content, mixing-tank level control) are integrated exactly
// (formulas.ts, lagToward). The display noise is drawn once per step.
//
// Two fault scenarios act here (phase 5, scenarios.ts): a steam dip, which lets the holding-tube outlet fall
// toward uht.faultTempC until the plant diverts (a step is cut at the instant it crosses the divert limit),
// and a homogenizer pressure loss, which holds stage 1 at a low pressure.
//
// A full CIP and an intermediate clean walk their programme's steps (phase 7, plant.json cleaning.cipSteps and
// aicSteps): the step under way follows from the time already spent in the mode, so the modes keep their
// times. A CIP step sets the temperature the preheater and the holding-tube outlet run at; an AIC step holds
// the UHT set point. The cleaning fluids are no part of the milk's balance.
import {
  cleaningSteps,
  fracToPct,
  lphToLps,
  lpsToLph,
  sToH,
  sToMin,
  type CleaningProgram,
  type CleaningSnapshot,
  type CleaningStep,
  type Kpis,
  type LiquidSnapshot,
  type PlantConfig,
  type Status,
  type UhtMode,
} from '../contracts';
import type { Setpoints } from './core';
import { createFillerStub, type FillerSupply } from './fillerStub';
import type { LogWriter } from './log';
import { bStar, creamShareFrac, divertLimitC, f0Min, holdTimeS, homogenizerOutletC, lagToward, surplusCreamFrac, tubeVolumeL } from './formulas';
import {
  condenserKw,
  creamingRiskPct,
  globuleUm,
  headspaceBar,
  heatRecoveredKw,
  homogenizerPowerKw,
  separatorFlows,
  steamLph,
} from './liquid/stageModels';
import type { Rng } from './rng';

/** Levels this close to a threshold count as on it (floating-point slack, far below any level shown). */
const LEVEL_EPS_L = 1e-6;
/** Times this close to zero count as zero. */
const TIME_EPS_S = 1e-9;
/** At most this many cuts in one step; a well-formed config needs a handful at most. */
const MAX_CUTS_PER_STEP = 64;

export type LiquidStageId = 1 | 2 | 3 | 4 | 5 | 6;
export const LIQUID_STAGE_IDS: readonly LiquidStageId[] = [1, 2, 3, 4, 5, 6];

/** Everything the model carries from one step to the next. */
export interface LiquidState {
  mode: UhtMode;
  /** Time left in a timed mode (divert, cip, sterilize, aic); 0 in production. */
  modeRemainingS: number;
  throttled: boolean;
  fillersStarved: boolean;
  /** Production time since the last clean (AIC or full CIP). */
  productionSinceCleanS: number;
  divertCount: number;
  siloL: number;
  mixTankL: number;
  asepticL: number;
  rejectL: number;
  /** Raw milk the tanker now unloading still holds; 0 while no tanker unloads. */
  tankerLeftL: number;
  /** Preheater outlet, lagging its target (preheating.lagS). */
  preheatTempC: number;
  /** Air left in the milk after the deaerator, lagging its target. */
  airPct: number;
  /** Display noise on the holding-tube reading, drawn once per step, within ±uht.displayNoiseC (D4). */
  noiseC: number;
  /** When the steam supply dipped (the UHT temperature drop scenario), or null while it is normal. */
  steamFaultSinceS: number | null;
  /** Stage 1 pressure a homogenizer fault holds it at, or null while the homogenizer works. */
  homogenizerFaultBar: number | null;
}

/** Litres and seconds summed since the plant opened, for the mass balance and the long-run checks. */
export interface LiquidTotals {
  /** Raw milk drawn from the silo by the separator. */
  rawDrawnL: number;
  /** Standardized milk from the separator into the mixing tank. */
  standardizedL: number;
  surplusCreamL: number;
  /** Milk through the holding tube, to the flash vessel or the reject tank. */
  uhtL: number;
  /** Milk sent to the reject tank (the divertedL KPI). */
  divertedL: number;
  /** Milk into the aseptic tank. */
  toAsepticL: number;
  /** Milk the fillers drew from the aseptic tank. */
  toFillersL: number;
  /** Raw milk the tankers unloaded into the silo. */
  tankerL: number;
  /** Reject milk pumped out of the reject tank during full CIPs. */
  rejectPumpedL: number;
  productionS: number;
  /** Production time spent throttled (H59: about 9% of production time). */
  throttledProductionS: number;
}

/** Flows at one instant, for the line points and the stage values. */
export interface LiquidFlows {
  /** Raw milk from the silo to the separator. */
  rawLph: number;
  /** Standardized milk from the separator to the mixing tank. */
  standardizedLph: number;
  surplusCreamLph: number;
  /** Through the UHT plant: feed pump, preheater, homogenizer, holding tube. */
  uhtLph: number;
  /** From the holding tube to the reject tank. */
  divertLph: number;
  /** On through the flash vessel and the cooler to the aseptic tank. */
  productLph: number;
  /** From the aseptic tank to the fillers. */
  fillerLph: number;
  fillersRunning: number;
}

/** Stages 1–6 as the snapshot shows them. */
export interface LiquidView {
  values: Record<LiquidStageId, Record<string, number>>;
  statuses: Record<LiquidStageId, Status>;
  flows: LiquidFlows;
  liquid: LiquidSnapshot;
  kpis: Pick<Kpis, 'uhtFlowLph' | 'f0Min' | 'bStar' | 'divertedL' | 'tankLevelPct' | 'packsPerH'>;
}

export type LiquidLog = LogWriter;

export interface LiquidLine {
  readonly state: Readonly<LiquidState>;
  readonly totals: Readonly<LiquidTotals>;
  /** One fixed step of dtS that ends at endS, with the live set points; mode changes and switches go to log. */
  step(dtS: number, endS: number, setpoints: Readonly<Setpoints>, log: LiquidLog): void;
  /** The stage values, statuses, line flows and liquid snapshot for the current state. */
  view(setpoints: Readonly<Setpoints>, timeS: number): LiquidView;
  /**
   * The steam supply dips from nowS (UHT temperature drop): the outlet falls toward uht.faultTempC, and the
   * plant diverts once B* falls below 1. The steam comes back when the divert ends. False, and nothing
   * happens, unless the UHT plant is in production with steam normal.
   */
  startSteamFault(nowS: number): boolean;
  /** Steam back before the divert (a reset): the outlet is at its set point again. */
  endSteamFault(): void;
  /** Holds stage 1 at `bar` (homogenizer pressure loss), or lets it follow its set point again with null. */
  setHomogenizerFault(bar: number | null): void;
  /** Stage 1 pressure the homogenizer runs at: the set point, or the lower one a fault holds it at. */
  stage1Bar(setpoints: Readonly<Setpoints>): number;
}

export interface LiquidLineOptions {
  /** The fillers that draw from the aseptic tank; defaults to the phase 3 stub. */
  fillers?: FillerSupply;
}

const TIMED_MODES: ReadonlySet<UhtMode> = new Set(['divert', 'cip', 'sterilize', 'aic']);

/** Time for a level moving at rateLps to reach targetL, or Infinity if it is moving away or still. */
function timeToReachS(levelL: number, rateLps: number, targetL: number): number {
  if (rateLps > 0 && targetL > levelL) return (targetL - levelL) / rateLps;
  if (rateLps < 0 && targetL < levelL) return (levelL - targetL) / -rateLps;
  return Infinity;
}

const formatL = (litres: number): string => Math.round(litres).toLocaleString('en-US');
const formatMin = (seconds: number): string => `${Math.round(sToMin(seconds))} min`;

export function createLiquidLine(config: PlantConfig, rng: Rng, options: LiquidLineOptions = {}): LiquidLine {
  const { standardization: std, preheating, homogenizer, uht, flashCooling, asepticTank: tank, cleaning, product } = config;
  const fillers = options.fillers ?? createFillerStub(config);
  const tubeL = tubeVolumeL(uht.holdAtCapacityS, uht.capacityLph);
  const creamOutFrac = surplusCreamFrac(std.rawMilkFatPct, product.fatPct, std.creamFatPct);
  const throttleAboveL = tank.throttleAboveFrac * tank.capacityL;
  const resumeBelowL = tank.resumeBelowFrac * tank.capacityL;
  const tankerBelowL = std.tankerBelowFrac * std.siloCapacityL;
  const programSteps: Readonly<Record<CleaningProgram, readonly CleaningStep[]>> = { cip: cleaningSteps(config, 'cip'), aic: cleaningSteps(config, 'aic') };

  const asepticStartL = tank.capacityL * tank.startFrac;
  const state: LiquidState = {
    mode: 'production',
    modeRemainingS: 0,
    throttled: asepticStartL >= throttleAboveL,
    fillersStarved: asepticStartL <= tank.fillersStopBelowL,
    productionSinceCleanS: 0,
    divertCount: 0,
    siloL: std.siloCapacityL * std.siloStartFrac,
    mixTankL: std.mixTankCapacityL * std.mixTankStartFrac,
    asepticL: asepticStartL,
    rejectL: 0,
    tankerLeftL: 0,
    // The plant opens running at its set points, so the lags start on their targets.
    preheatTempC: preheating.preheatTempC,
    airPct: preheating.deaeratedAirPct,
    noiseC: 0,
    steamFaultSinceS: null,
    homogenizerFaultBar: null,
  };
  const totals: LiquidTotals = {
    rawDrawnL: 0,
    standardizedL: 0,
    surplusCreamL: 0,
    uhtL: 0,
    divertedL: 0,
    toAsepticL: 0,
    toFillersL: 0,
    tankerL: 0,
    rejectPumpedL: 0,
    productionS: 0,
    throttledProductionS: 0,
  };

  /**
   * The cleaning step under way in a full CIP or an intermediate clean: the step of the programme that the time
   * already spent in the mode falls in, and the time left in it. Null in any other mode.
   */
  function cleaningStepNow(): { program: CleaningProgram; index: number; step: CleaningStep; remainingS: number } | null {
    if (state.mode !== 'cip' && state.mode !== 'aic') return null;
    const program = state.mode;
    const steps = programSteps[program];
    const spentS = Math.max(0, (program === 'cip' ? cleaning.cipS : cleaning.aicS) - state.modeRemainingS);
    let endS = 0;
    for (const [index, step] of steps.entries()) {
      endS += step.durationS;
      if (spentS < endS - TIME_EPS_S || index === steps.length - 1) return { program, index, step, remainingS: Math.max(0, endS - spentS) };
    }
    return null;
  }

  /** UHT flow the plant runs at in production or divert: full capacity, or the throttled share. */
  const nominalUhtLph = (): number => uht.capacityLph * (state.throttled ? tank.throttledFlowFrac : 1);
  const producing = (): boolean => state.mode === 'production' || state.mode === 'divert';
  /**
   * The milk's temperature at the holding-tube outlet, before display noise: the set point, or during a steam
   * dip a first-order fall from it toward the fault temperature (never above the set point).
   */
  function milkOutletC(nowS: number, setpointC: number): number {
    if (state.steamFaultSinceS === null) return setpointC;
    const targetC = Math.min(setpointC, uht.faultTempC);
    return targetC + (setpointC - targetC) * Math.exp(-Math.max(0, nowS - state.steamFaultSinceS) / config.scenarios.steamFaultLagS);
  }

  /** Time from nowS until a falling outlet reaches the divert limit at holdS: Infinity without a steam dip, or if it never does. */
  function timeToDivertLimitS(nowS: number, setpointC: number, holdS: number): number {
    if (state.steamFaultSinceS === null || state.mode !== 'production') return Infinity;
    const targetC = Math.min(setpointC, uht.faultTempC);
    const limitC = divertLimitC(holdS);
    if (!(limitC > targetC)) return Infinity;
    if (setpointC <= limitC) return 0;
    const crossS = state.steamFaultSinceS + config.scenarios.steamFaultLagS * Math.log((setpointC - targetC) / (limitC - targetC));
    return crossS - nowS;
  }

  /** Stage 1 pressure the homogenizer runs at: the set point, or the lower one a fault holds it at. */
  const stage1BarNow = (setpoints: Readonly<Setpoints>): number =>
    state.homogenizerFaultBar === null ? setpoints.homogenizerStage1Bar : Math.min(state.homogenizerFaultBar, setpoints.homogenizerStage1Bar);

  /** The level the mixing tank's level control steers to: hold while the UHT plant draws, fill up while it doesn't. */
  const mixTargetL = (uhtLph: number): number => std.mixTankCapacityL * (uhtLph > 0 ? std.mixTankStartFrac : std.mixTankIdleFrac);

  /** Flows that hold until the next event. The mixing tank's inflow is its rate right now. */
  function flowsNow(setpoints: Readonly<Setpoints>, timeS: number): LiquidFlows {
    // Ready fillers draw unless the tank starves them or their rate is set to 0 (stopped).
    const fillersRunning = state.fillersStarved || !(setpoints.fillerRatePacksPerH > 0) ? 0 : fillers.readyCount(timeS);
    const fillerLph = fillers.drawLph(fillersRunning, setpoints.fillerRatePacksPerH);
    let uhtLph = producing() ? nominalUhtLph() : 0;
    // A full aseptic tank takes only what the fillers draw; a full reject tank takes nothing.
    if (state.mode === 'production' && state.asepticL >= tank.capacityL - LEVEL_EPS_L) uhtLph = Math.min(uhtLph, fillerLph);
    if (state.mode === 'divert' && state.rejectL >= uht.rejectTankL - LEVEL_EPS_L) uhtLph = 0;
    const divertLph = state.mode === 'divert' ? uhtLph : 0;
    const productLph = state.mode === 'production' ? uhtLph : 0;
    const correctionLph = lpsToLph((mixTargetL(uhtLph) - state.mixTankL) / std.mixTankLagS);
    const standardizedLph = Math.max(0, uhtLph + correctionLph);
    const { rawMilkLph, surplusCreamLph } = separatorFlows(config, standardizedLph);
    return { rawLph: rawMilkLph, standardizedLph, surplusCreamLph, uhtLph, divertLph, productLph, fillerLph, fillersRunning };
  }

  /** Time until the next event that changes a flow, with the flows constant until then. */
  function nextEventS(flows: LiquidFlows, nowS: number, setpoints: Readonly<Setpoints>): number {
    let soonestS = Infinity;
    const at = (s: number) => (soonestS = Math.min(soonestS, Math.max(0, s)));
    if (TIMED_MODES.has(state.mode)) at(state.modeRemainingS);
    // A cleaning step's end, where its temperature changes.
    const cleaningStep = cleaningStepNow();
    if (cleaningStep && cleaningStep.remainingS > TIME_EPS_S) at(cleaningStep.remainingS);
    // A falling outlet crossing the divert limit; one already on it is caught by checkDivert at the cut's start.
    if (flows.uhtLph > 0) {
      const crossS = timeToDivertLimitS(nowS, setpoints.uhtSetpointC, holdTimeS(tubeL, flows.uhtLph));
      if (crossS > TIME_EPS_S) at(crossS);
    }
    if (state.mode === 'production') at(cleaning.aicEveryProductionS - state.productionSinceCleanS);
    const netLps = lphToLps(flows.productLph - flows.fillerLph);
    at(timeToReachS(state.asepticL, netLps, state.throttled ? resumeBelowL : throttleAboveL));
    at(timeToReachS(state.asepticL, netLps, state.fillersStarved ? tank.fillersRestartAboveL : tank.fillersStopBelowL));
    at(timeToReachS(state.asepticL, netLps, tank.capacityL));
    at(timeToReachS(state.rejectL, lphToLps(flows.divertLph), uht.rejectTankL));
    // The silo's tanker threshold: exact while the mixing tank sits on its target, close otherwise.
    if (state.tankerLeftL <= 0) at(timeToReachS(state.siloL, -lphToLps(flows.rawLph), tankerBelowL));
    // A tanker running empty changes the silo's inflow.
    else at(state.tankerLeftL / lphToLps(std.tankerUnloadLph));
    return soonestS;
  }

  /** Moves every level and lag on by dtS at constant flows. */
  function advance(dtS: number, flows: LiquidFlows): void {
    if (dtS <= 0) return;
    const hours = sToH(dtS);
    const uhtL = flows.uhtLph * hours;

    // Stage 1: level control steers the mixing tank to its target (exact first-order lag); the separator
    // supplies what the UHT plant draws plus the correction, never less than nothing.
    let mixDeltaL = lagToward(state.mixTankL, mixTargetL(flows.uhtLph), dtS, std.mixTankLagS) - state.mixTankL;
    let standardizedL = uhtL + mixDeltaL;
    if (standardizedL < 0) {
      standardizedL = 0;
      mixDeltaL = -uhtL;
    }
    state.mixTankL += mixDeltaL;
    const rawL = standardizedL / (1 - creamOutFrac);
    const tankerInL = Math.min(state.tankerLeftL, std.tankerUnloadLph * hours);
    state.tankerLeftL -= tankerInL;
    // checkPlantConfig keeps the tanker ahead of the draw, so the silo never runs dry; the floor is a guard.
    state.siloL = Math.max(0, state.siloL + tankerInL - rawL);
    totals.rawDrawnL += rawL;
    totals.standardizedL += standardizedL;
    totals.surplusCreamL += rawL - standardizedL;
    totals.tankerL += tankerInL;
    totals.uhtL += uhtL;

    // Stages 4–6: product goes on to the aseptic tank, or to the reject tank while diverting.
    const fillersL = flows.fillerLph * hours;
    const productL = flows.productLph * hours;
    const divertL = flows.divertLph * hours;
    state.asepticL += productL - fillersL;
    state.rejectL += divertL;
    totals.toAsepticL += productL;
    totals.toFillersL += fillersL;
    totals.divertedL += divertL;
    // A full CIP pumps the reject tank out (reject milk leaves by road), emptying it by the CIP's end.
    if (state.mode === 'cip' && state.rejectL > 0) {
      const pumpedL = Math.min(state.rejectL, (state.rejectL * dtS) / Math.max(state.modeRemainingS, dtS));
      state.rejectL -= pumpedL;
      totals.rejectPumpedL += pumpedL;
    }

    // Stage 2: the preheater outlet runs at the preheat temperature (the CIP step's during a full CIP);
    // the deaerator takes the air down while milk flows, and it creeps back while the plant stands.
    const preheatTargetC = cleaningStepNow()?.step.tempC ?? preheating.preheatTempC;
    state.preheatTempC = lagToward(state.preheatTempC, preheatTargetC, dtS, preheating.lagS);
    const airTargetPct = flows.uhtLph > 0 ? preheating.deaeratedAirPct : preheating.rawAirPct;
    state.airPct = lagToward(state.airPct, airTargetPct, dtS, preheating.lagS);

    if (TIMED_MODES.has(state.mode)) state.modeRemainingS -= dtS;
    if (state.mode === 'production') {
      state.productionSinceCleanS += dtS;
      totals.productionS += dtS;
      if (state.throttled) totals.throttledProductionS += dtS;
    }
  }

  function enterMode(mode: UhtMode, durationS: number): void {
    // A timer that ran a hair past zero carries the overrun into the next mode.
    const carryS = TIMED_MODES.has(state.mode) ? Math.min(0, state.modeRemainingS) : 0;
    state.mode = mode;
    state.modeRemainingS = mode === 'production' ? 0 : durationS + carryS;
  }

  /**
   * In production, divert when B* falls below 1 (D4), for the noisy reading at the holding-tube outlet or
   * for the set point. The reading scatters around the set point, the temperature the milk really has, so
   * a set point under the divert limit diverts at once too, even in a step whose noise lifts the reading
   * over it. Noise alone still never diverts: at 140 °C the lowest reading gives B* 1.11 (H21).
   * During a steam dip the milk is no longer at the set point: its falling outlet temperature diverts once it
   * reaches the limit, at the instant the step was cut for (or a noisy reading under the limit, earlier).
   */
  function checkDivert(nowS: number, setpoints: Readonly<Setpoints>, flows: LiquidFlows, log: LiquidLog): void {
    if (state.mode !== 'production' || flows.uhtLph <= 0) return;
    const holdS = holdTimeS(tubeL, flows.uhtLph);
    const setpointC = setpoints.uhtSetpointC;
    const milkC = milkOutletC(nowS, setpointC);
    const readingC = milkC + state.noiseC;
    const steamDip = state.steamFaultSinceS !== null;
    // The crossing time is computed, so it gets floating-point slack; a set point is compared as it is.
    const byMilk = steamDip ? milkC <= divertLimitC(holdS) + 1e-9 : bStar(setpointC, holdS) < 1;
    if (!byMilk && bStar(readingC, holdS) >= 1) return;
    enterMode('divert', uht.divertBeforeCleaningS);
    state.divertCount += 1;
    // Say which number diverted, rounded down so it never reads "B* 1.00, below 1".
    const [what, tempC] = byMilk ? [steamDip ? 'outlet' : 'set point', milkC] : ['reading', readingC];
    const bStarText = (Math.floor(Math.min(bStar(tempC, holdS), 0.999) * 100) / 100).toFixed(2);
    log(nowS, 'bad', `UHT ${what} ${tempC.toFixed(1)} °C gives B* ${bStarText}, below 1: diverting to the reject tank`, { topic: 'divert' });
  }

  /** Switches whose threshold the last cut landed on, then mode changes whose time has come. */
  function applyEvents(nowS: number, log: LiquidLog): void {
    if (!state.throttled && state.asepticL >= throttleAboveL - LEVEL_EPS_L) {
      state.throttled = true;
      log(nowS, 'warn', `Aseptic tank above ${fracToPct(tank.throttleAboveFrac)}%: UHT plant throttled to ${fracToPct(tank.throttledFlowFrac)}%`, {
        topic: 'throttled',
      });
    } else if (state.throttled && state.asepticL <= resumeBelowL + LEVEL_EPS_L) {
      state.throttled = false;
      log(nowS, 'ok', `Aseptic tank below ${fracToPct(tank.resumeBelowFrac)}%: UHT plant back to full flow`, { topic: 'unthrottled' });
    }
    if (!state.fillersStarved && state.asepticL <= tank.fillersStopBelowL + LEVEL_EPS_L) {
      state.fillersStarved = true;
      log(nowS, 'warn', `Aseptic tank below ${formatL(tank.fillersStopBelowL)} L: fillers stopped, waiting for product`, { topic: 'fillersStarved' });
    } else if (state.fillersStarved && state.asepticL >= tank.fillersRestartAboveL - LEVEL_EPS_L) {
      state.fillersStarved = false;
      log(nowS, 'ok', `Aseptic tank back above ${formatL(tank.fillersRestartAboveL)} L: fillers running again`, { topic: 'fillersFed' });
    }
    if (state.tankerLeftL <= 0 && state.siloL <= tankerBelowL + LEVEL_EPS_L) state.tankerLeftL = std.tankerL;

    if (TIMED_MODES.has(state.mode) && state.modeRemainingS <= TIME_EPS_S) {
      switch (state.mode) {
        case 'divert':
          // A steam dip lasts as long as the divert: the steam is back by the time the line is flushed.
          state.steamFaultSinceS = null;
          if (cleaning.cipAfterDivert) {
            enterMode('cip', cleaning.cipS);
            log(nowS, 'warn', `Full CIP started after the divert: ${formatMin(cleaning.cipS)}`, { topic: 'cipStart' });
          } else {
            enterMode('production', 0);
            log(nowS, 'ok', 'Divert over: UHT plant back in production', { topic: 'productionResumed' });
          }
          break;
        case 'cip':
          enterMode('sterilize', uht.sterilizeS);
          log(nowS, 'info', `CIP done: sterilizing at ${uht.sterilizeTempC} °C for ${formatMin(uht.sterilizeS)}`, { topic: 'sterilizeStart' });
          break;
        case 'sterilize':
          enterMode('production', 0);
          state.productionSinceCleanS = 0;
          log(nowS, 'ok', 'UHT plant sterile: back in production', { topic: 'productionResumed' });
          break;
        case 'aic':
          enterMode('production', 0);
          state.productionSinceCleanS = 0;
          log(nowS, 'ok', 'Intermediate clean done: back in production', { topic: 'aicDone' });
          break;
      }
    }
    if (state.mode === 'production' && state.productionSinceCleanS >= cleaning.aicEveryProductionS - TIME_EPS_S) {
      enterMode('aic', cleaning.aicS);
      log(nowS, 'info', `Intermediate clean (AIC) started: ${formatMin(cleaning.aicS)}, the aseptic tank feeds the fillers`, { topic: 'aicStart' });
    }
  }

  function step(dtS: number, endS: number, setpoints: Readonly<Setpoints>, log: LiquidLog): void {
    const startS = endS - dtS;
    // Bounded noise with no tails (D4): uniform within ±displayNoiseC, so noise alone never diverts at 140 °C.
    state.noiseC = uht.displayNoiseC * (2 * rng.next() - 1);
    let doneS = 0;
    for (let cuts = 0; doneS < dtS - TIME_EPS_S; cuts++) {
      const nowS = startS + doneS;
      checkDivert(nowS, setpoints, flowsNow(setpoints, nowS), log);
      const flows = flowsNow(setpoints, nowS);
      const leftS = dtS - doneS;
      const cutS = cuts < MAX_CUTS_PER_STEP ? Math.min(leftS, nextEventS(flows, nowS, setpoints)) : leftS;
      // Whether the tank fed the fillers in this cut: a starving or refilling switch comes at its end.
      const fed = !state.fillersStarved;
      advance(cutS, flows);
      doneS += cutS;
      // The last cut ends on the step's end exactly, where the packs model and the event queue meet it.
      const cutEndS = doneS >= dtS - TIME_EPS_S ? endS : startS + doneS;
      fillers.ran?.(cutS, cutEndS, fed, setpoints.fillerRatePacksPerH);
      applyEvents(cutEndS, log);
    }
    // A mode change or throttle switch on the step's last instant must not leave production showing a
    // B* under 1 until the next step: check once more at the end.
    checkDivert(endS, setpoints, flowsNow(setpoints, endS), log);
    // And a tank that starved or fed the fillers again on that instant shows in their states at once.
    fillers.ran?.(0, endS, !state.fillersStarved, setpoints.fillerRatePacksPerH);
    // Floating-point slack only; the cuts above keep every level inside its tank.
    state.asepticL = Math.min(tank.capacityL, Math.max(0, state.asepticL));
    state.rejectL = Math.min(uht.rejectTankL, Math.max(0, state.rejectL));
  }

  function view(setpoints: Readonly<Setpoints>, timeS: number): LiquidView {
    const flows = flowsNow(setpoints, timeS);
    const { uhtLph } = flows;

    const deaeratorTempC = state.preheatTempC - preheating.deaeratorDropC;
    // A stopped homogenizer builds no pressure; the globule size and creaming risk stay those of the pressure
    // it runs at, its set point or a fault's.
    const runningBar = stage1BarNow(setpoints);
    const stage1Bar = uhtLph > 0 ? runningBar : 0;
    const stage2Bar = uhtLph > 0 ? homogenizer.stage2Bar : 0;
    const totalBar = stage1Bar + stage2Bar;
    const outletTempC = homogenizerOutletC(deaeratorTempC, totalBar, homogenizer.barPerDegreeC);
    const globule = globuleUm(config, runningBar);
    const creamingRisk = creamingRiskPct(config, globule);

    // The holding-tube outlet reads the milk's temperature plus noise while product or an AIC's water and lye
    // run at sterilizing heat (the set point, or lower during a steam dip), the CIP step's temperature during a
    // full CIP, and the hot water while re-sterilizing.
    const setpointC = setpoints.uhtSetpointC;
    const cleaningStep = cleaningStepNow();
    const cipTempC = cleaningStep?.program === 'cip' ? cleaningStep.step.tempC : null;
    const tempC = cipTempC ?? (state.mode === 'sterilize' ? uht.sterilizeTempC : milkOutletC(timeS, setpointC) + state.noiseC);
    // With nothing flowing there is no hold and no sterilizing effect; the limit shown is the one production restarts at.
    const holdS = uhtLph > 0 ? holdTimeS(tubeL, uhtLph) : 0;
    const f0 = uhtLph > 0 ? f0Min(tempC, holdS) : 0;
    const bStarNow = uhtLph > 0 ? bStar(tempC, holdS) : 0;
    const limitC = divertLimitC(holdTimeS(tubeL, uhtLph > 0 ? uhtLph : nominalUhtLph()));
    const waterLph = steamLph(config, flows.productLph, outletTempC, setpointC);
    const levelFrac = state.asepticL / tank.capacityL;

    const values: LiquidView['values'] = {
      1: {
        siloTempC: std.siloTempC,
        separatorTempC: std.separatorTempC,
        feedTankTempC: std.feedTankTempC,
        rawMilkFatPct: std.rawMilkFatPct,
        productFatPct: product.fatPct,
        creamShareFrac: creamShareFrac(product.fatPct, std.skimFatPct, std.creamFatPct),
        rawMilkLph: flows.rawLph,
        surplusCreamLph: flows.surplusCreamLph,
        siloLevelPct: fracToPct(state.siloL / std.siloCapacityL),
        mixTankLevelPct: fracToPct(state.mixTankL / std.mixTankCapacityL),
      },
      2: {
        preheatTempC: state.preheatTempC,
        deaeratorTempC,
        airPct: state.airPct,
        heatRecoveredKw: heatRecoveredKw(config, uhtLph, state.preheatTempC),
      },
      3: {
        stage1Bar,
        stage2Bar,
        inletTempC: deaeratorTempC,
        outletTempC,
        globuleUm: globule,
        creamingRiskPct: creamingRisk,
        powerKw: homogenizerPowerKw(config, uhtLph, totalBar),
      },
      4: { setpointC, tempC, flowLph: uhtLph, holdS, f0Min: f0, bStar: bStarNow, divertLimitC: limitC, rejectLevelL: state.rejectL },
      5: {
        flashTempC: flashCooling.flashTempC,
        coolerTempC: flashCooling.coolerTempC,
        waterRemovedLph: waterLph,
        condenserKw: condenserKw(config, waterLph),
      },
      6: {
        levelL: state.asepticL,
        levelPct: fracToPct(levelFrac),
        capacityL: tank.capacityL,
        tempC: tank.tempC,
        inflowLph: flows.productLph,
        outflowLph: flows.fillerLph,
        headspaceBar: headspaceBar(config, levelFrac),
        nextCleanS: Math.max(0, cleaning.aicEveryProductionS - state.productionSinceCleanS),
      },
    };

    const flowing = (lph: number): Status => (lph > 0 ? 'ok' : 'idle');
    // Stage 4 follows B*, not F0 (D4): red while diverting, amber while cleaning or when the margin is thin.
    let uhtStatus: Status;
    if (state.mode === 'divert') uhtStatus = 'bad';
    else if (state.mode !== 'production') uhtStatus = 'warn';
    else if (uhtLph <= 0) uhtStatus = 'idle';
    else if (Math.min(bStarNow, bStar(setpointC, holdS)) < 1) uhtStatus = 'bad';
    else if (bStarNow < uht.bStarWarnBelow) uhtStatus = 'warn';
    else uhtStatus = 'ok';
    const statuses: LiquidView['statuses'] = {
      1: flowing(flows.rawLph),
      2: flowing(uhtLph),
      // A pressure fault is red, as a breakdown; a set point low enough to risk creaming amber.
      3: uhtLph <= 0 ? 'idle' : state.homogenizerFaultBar !== null ? 'bad' : creamingRisk > 0 ? 'warn' : 'ok',
      4: uhtStatus,
      5: flowing(flows.productLph),
      6: state.throttled || state.fillersStarved ? 'warn' : 'ok',
    };

    const tankLevel = (levelL: number, capacityL: number) => ({ levelL, capacityL });
    const cleaningView: CleaningSnapshot | null = cleaningStep
      ? {
          program: cleaningStep.program,
          step: cleaningStep.step.step,
          fluid: cleaningStep.step.fluid,
          stepIndex: cleaningStep.index,
          stepCount: programSteps[cleaningStep.program].length,
          stepRemainingS: cleaningStep.remainingS,
          tempC: cleaningStep.step.tempC,
          flowLph: cleaning.circulateLph,
        }
      : null;
    const liquid: LiquidSnapshot = {
      uhtMode: state.mode,
      modeRemainingS: Math.max(0, state.modeRemainingS),
      throttled: state.throttled,
      fillersRunning: flows.fillersRunning,
      fillersStarved: state.fillersStarved,
      headspaceBar: values[6].headspaceBar,
      productionSinceCleanS: state.productionSinceCleanS,
      divertCount: state.divertCount,
      cleaning: cleaningView,
      tanks: {
        silo: tankLevel(state.siloL, std.siloCapacityL),
        mixTank: tankLevel(state.mixTankL, std.mixTankCapacityL),
        asepticTank: tankLevel(state.asepticL, tank.capacityL),
        rejectTank: tankLevel(state.rejectL, uht.rejectTankL),
      },
    };

    return {
      values,
      statuses,
      flows,
      liquid,
      kpis: {
        uhtFlowLph: uhtLph,
        f0Min: f0,
        bStar: bStarNow,
        divertedL: totals.divertedL,
        tankLevelPct: values[6].levelPct,
        packsPerH: flows.fillerLph / product.packVolumeL,
      },
    };
  }

  return {
    state,
    totals,
    step,
    view,
    startSteamFault(nowS) {
      if (state.mode !== 'production' || state.steamFaultSinceS !== null) return false;
      state.steamFaultSinceS = nowS;
      return true;
    },
    endSteamFault() {
      state.steamFaultSinceS = null;
    },
    setHomogenizerFault(bar) {
      state.homogenizerFaultBar = bar;
    },
    stage1Bar: (setpoints) => stage1BarNow(setpoints),
  };
}
