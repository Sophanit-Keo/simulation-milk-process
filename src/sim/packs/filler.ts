// Stage 7: the aseptic fillers, one state machine each (plan 06, discrete model). A filler runs while it is
// not broken down, its rate is above 0 and the aseptic tank feeds it. Its time to the next breakdown is
// random (exponential, D2) and counts only while it runs; a breakdown takes it into repair (the random part
// of the repair time), then into cleaning, re-sterilizing its aseptic zone (the fixed part, D14), then it
// runs again. Breakdowns, repairs and cleanings are queued events, so each happens at its own time. The
// filler breakdown scenario (phase 5) breaks one down on demand, with a fixed repair time.
//
// Packs are whole: each filler carries the fraction of the pack it is forming from one cut of the liquid
// line to the next, and the seal check rejects an even share of them (fillers.rejectFrac).
import { fracToPct, sToH, sToMin, type FillerSnapshot, type FillerState, type PlantConfig } from '../../contracts';
import type { QueuedEvent } from '../eventQueue';
import type { Rng } from '../rng';
import { TIME_EPS_S, wholeUnits, type Scheduler } from './types';

export const FILLER_NAMES: readonly string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Queued event types, with the filler's index as payload. */
export const FILLER_EVENTS = { fault: 'fillerFault', repaired: 'fillerRepaired', cleaned: 'fillerCleaned' } as const;

interface FillerPayload {
  filler: number;
}

/** One filler's state and counters. Read-only outside this file. */
export interface FillerUnit {
  readonly index: number;
  readonly name: string;
  /** 'none' while it can run; 'repair' or 'cleaning' after a breakdown, until downUntilS. */
  down: 'none' | 'repair' | 'cleaning';
  downUntilS: number;
  /** The queued event that ends the repair or cleaning now under way, so a stale one is ignored. */
  downSeq: number;
  /** Whether it ran in the last cut of the liquid line, and whether the tank fed it then. */
  running: boolean;
  fed: boolean;
  /** Running time left until the next breakdown. */
  toFailureRunS: number;
  fault: QueuedEvent<FillerPayload> | null;
  /** Since the plant opened. */
  runS: number;
  packsMade: number;
  packsRejected: number;
  breakdowns: number;
  /** The part of the next pack formed so far, and the share of a reject owed. */
  formingPacks: number;
  rejectOwed: number;
}

/** Whole packs one filler made in one cut, and how many of them the seal check rejected. */
export interface CutPacks {
  made: number;
  rejected: number;
}

export interface FillerHooks {
  /** The filler started running again after a stop of any kind, at sinceS: QA owes it after-stop samples (D1). */
  onRestart(index: number, sinceS: number): void;
}

export interface Fillers {
  readonly units: readonly FillerUnit[];
  /** Fillers not broken down: they draw from the tank whenever it feeds them and the rate is above 0. */
  readyCount(): number;
  /** Runs every filler for one cut of dtS ending at endS, fed or starved, at the live rate. */
  run(dtS: number, endS: number, fed: boolean, ratePacksPerH: number): CutPacks[];
  /** Keeps each running filler's breakdown queued at the time its running time runs out, and none for the others. */
  reconcile(nowS: number, ratePacksPerH: number): void;
  /** A queued filler event; false if the event is not a filler's. */
  onEvent(event: QueuedEvent, ratePacksPerH: number): boolean;
  /** Breaks a filler down now with a repair of repairS, then re-sterilizing (filler breakdown scenario); false if it is down already. */
  breakDownNow(index: number, nowS: number, repairS: number, ratePacksPerH: number): boolean;
  /** Ends a repair now (a scenario reset): the filler goes on to re-sterilizing. False if it is not under repair. */
  endRepairNow(index: number, nowS: number, ratePacksPerH: number): boolean;
  state(unit: FillerUnit, ratePacksPerH: number): FillerState;
  snapshot(unit: FillerUnit, nowS: number, openS: number, ratePacksPerH: number, batchId: number): FillerSnapshot;
}

const formatMin = (seconds: number): string => `${Math.max(1, Math.round(sToMin(seconds)))} min`;

export function createFillers(config: PlantConfig, rng: Rng, scheduler: Scheduler, hooks: FillerHooks): Fillers {
  const { fillers: spec } = config;
  const units: FillerUnit[] = Array.from({ length: spec.count }, (_, index) => ({
    index,
    name: FILLER_NAMES[index] ?? String(index + 1),
    down: 'none',
    downUntilS: 0,
    downSeq: -1,
    // The plant opens running (D8), so the first run is not a restart.
    running: true,
    fed: true,
    toFailureRunS: rng.exponential(spec.mtbfMeanS),
    fault: null,
    runS: 0,
    packsMade: 0,
    packsRejected: 0,
    breakdowns: 0,
    formingPacks: 0,
    rejectOwed: 0,
  }));

  const runsAt = (unit: FillerUnit, ratePacksPerH: number): boolean => unit.down === 'none' && ratePacksPerH > 0 && unit.fed;

  function stateOf(unit: FillerUnit, ratePacksPerH: number): FillerState {
    if (unit.down !== 'none') return unit.down;
    if (!(ratePacksPerH > 0)) return 'stopped';
    return unit.fed ? 'running' : 'starved';
  }

  function cancelFault(unit: FillerUnit): void {
    if (unit.fault) scheduler.cancel(unit.fault.seq);
    unit.fault = null;
  }

  function reconcileUnit(unit: FillerUnit, nowS: number, ratePacksPerH: number): void {
    if (!runsAt(unit, ratePacksPerH)) return cancelFault(unit);
    const dueS = nowS + Math.max(0, unit.toFailureRunS);
    if (unit.fault && Math.abs(unit.fault.timeS - dueS) <= TIME_EPS_S) return;
    cancelFault(unit);
    unit.fault = scheduler.schedule<FillerPayload>(dueS, FILLER_EVENTS.fault, { filler: unit.index });
  }

  /** Into repair for repairS (a random draw, D2, unless a scenario gives one), then into cleaning. */
  function breakDown(unit: FillerUnit, nowS: number, repairS = rng.exponential(spec.repairRandomMeanS)): void {
    cancelFault(unit);
    unit.breakdowns += 1;
    unit.down = 'repair';
    unit.downUntilS = nowS + repairS;
    unit.downSeq = scheduler.schedule<FillerPayload>(unit.downUntilS, FILLER_EVENTS.repaired, { filler: unit.index }).seq;
    scheduler.log(nowS, 'bad', `Filler ${unit.name} broke down: repair about ${formatMin(repairS + spec.repairFixedS)} with re-sterilizing`, {
      topic: 'fillerDown',
      filler: unit.index,
    });
  }

  /** Repaired: re-sterilizing its aseptic zone for the fixed part of the repair (D14). */
  function startCleaning(unit: FillerUnit, nowS: number): void {
    unit.down = 'cleaning';
    unit.downUntilS = nowS + spec.repairFixedS;
    unit.downSeq = scheduler.schedule<FillerPayload>(unit.downUntilS, FILLER_EVENTS.cleaned, { filler: unit.index }).seq;
    scheduler.log(nowS, 'info', `Filler ${unit.name} repaired: re-sterilizing its aseptic zone for ${formatMin(spec.repairFixedS)}`, {
      topic: 'fillerRepaired',
      filler: unit.index,
    });
  }

  return {
    units,
    readyCount: () => units.filter((unit) => unit.down === 'none').length,
    run(dtS, endS, fed, ratePacksPerH) {
      return units.map((unit) => {
        unit.fed = fed;
        // A cut of no time only tells the filler whether the tank feeds it now.
        if (!(dtS > 0)) return { made: 0, rejected: 0 };
        const running = runsAt(unit, ratePacksPerH);
        if (running && !unit.running) hooks.onRestart(unit.index, endS - dtS);
        unit.running = running;
        if (!running) return { made: 0, rejected: 0 };
        unit.runS += dtS;
        unit.toFailureRunS -= dtS;
        unit.formingPacks += ratePacksPerH * sToH(dtS);
        const made = wholeUnits(unit.formingPacks);
        unit.formingPacks = Math.max(0, unit.formingPacks - made);
        unit.rejectOwed += made * spec.rejectFrac;
        const rejected = Math.min(made, wholeUnits(unit.rejectOwed));
        unit.rejectOwed = Math.max(0, unit.rejectOwed - rejected);
        unit.packsMade += made;
        unit.packsRejected += rejected;
        return { made, rejected };
      });
    },
    reconcile(nowS, ratePacksPerH) {
      for (const unit of units) reconcileUnit(unit, nowS, ratePacksPerH);
    },
    onEvent(event, ratePacksPerH) {
      const types: readonly string[] = Object.values(FILLER_EVENTS);
      if (!types.includes(event.type)) return false;
      const unit = units[(event.payload as FillerPayload).filler];
      if (!unit) return true;
      const nowS = event.timeS;
      switch (event.type) {
        case FILLER_EVENTS.fault:
          // Only the breakdown queued last counts, and only once its running time has run out.
          if (event.seq === unit.fault?.seq && unit.down === 'none' && unit.toFailureRunS <= TIME_EPS_S) breakDown(unit, nowS);
          break;
        case FILLER_EVENTS.repaired:
          // A repair a reset ended early has its event cancelled; any other stale one is ignored too.
          if (event.seq === unit.downSeq && unit.down === 'repair') startCleaning(unit, nowS);
          break;
        case FILLER_EVENTS.cleaned:
          if (event.seq !== unit.downSeq || unit.down !== 'cleaning') break;
          unit.down = 'none';
          unit.downUntilS = nowS;
          unit.toFailureRunS = rng.exponential(spec.mtbfMeanS);
          scheduler.log(nowS, 'ok', `Filler ${unit.name} sterile: running again`, { topic: 'fillerSterile', filler: unit.index });
          break;
      }
      reconcileUnit(unit, nowS, ratePacksPerH);
      return true;
    },
    breakDownNow(index, nowS, repairS, ratePacksPerH) {
      const unit = units[index];
      if (!unit || unit.down !== 'none') return false;
      breakDown(unit, nowS, repairS);
      reconcileUnit(unit, nowS, ratePacksPerH);
      return true;
    },
    endRepairNow(index, nowS, ratePacksPerH) {
      const unit = units[index];
      if (!unit || unit.down !== 'repair') return false;
      scheduler.cancel(unit.downSeq);
      startCleaning(unit, nowS);
      reconcileUnit(unit, nowS, ratePacksPerH);
      return true;
    },
    state: stateOf,
    snapshot(unit, nowS, openS, ratePacksPerH, batchId) {
      const state = stateOf(unit, ratePacksPerH);
      const openForS = nowS - openS;
      // At the opening instant nothing has been measured yet: full availability and quality, the set rate's performance.
      const availabilityFrac = openForS > 0 ? Math.min(1, unit.runS / openForS) : 1;
      // The pack being formed counts too: whole packs alone would make the first seconds read low (2 packs in
      // the first second is 90% of 8,000 packs/h), and the KPI strip would flicker as the plant opens.
      const performanceFrac =
        unit.runS > 0 ? (unit.packsMade + unit.formingPacks) / (spec.maxRatePacksPerH * sToH(unit.runS)) : Math.max(0, ratePacksPerH) / spec.maxRatePacksPerH;
      const qualityFrac = unit.packsMade > 0 ? (unit.packsMade - unit.packsRejected) / unit.packsMade : 1;
      return {
        name: unit.name,
        state,
        stateRemainingS: unit.down === 'none' ? 0 : Math.max(0, unit.downUntilS - nowS),
        packsPerH: state === 'running' ? ratePacksPerH : 0,
        batchId,
        packsMade: unit.packsMade,
        packsRejected: unit.packsRejected,
        breakdowns: unit.breakdowns,
        availabilityPct: fracToPct(availabilityFrac),
        performancePct: fracToPct(performanceFrac),
        qualityPct: fracToPct(qualityFrac),
        oeePct: fracToPct(availabilityFrac * performanceFrac * qualityFrac),
      };
    },
  };
}
