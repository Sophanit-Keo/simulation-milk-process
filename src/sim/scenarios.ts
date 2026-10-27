// The six fault scenarios of plan 06 (phase 5), behind triggerScenario and resetScenarios. Each acts on the
// liquid line or the packs model through their scenario hooks and keeps a run: what it is doing now, and a
// log of what happened and why (process's scenario scripts, plan/hand-calculations.md).
//
// The plant reacts on its own (a divert, a starved filler, a blocked batch), so a run gathers those entries
// too: every log entry passes through annotate(), and a run that follows its consequences claims the ones
// about them and says why they happened. A scenario draws no random numbers, so the same seed and the same
// triggers give the same log.
import {
  fracToPct,
  sToMin,
  SCENARIO_RUNS_KEPT,
  type LogEntry,
  type LogKind,
  type PlantConfig,
  type ScenarioId,
  type ScenarioRunSnapshot,
  type ScenariosSnapshot,
  type ScenarioVariant,
  type Status,
  type StageId,
  type UhtMode,
} from '../contracts';
import type { Setpoints } from './core';
import type { QueuedEvent } from './eventQueue';
import { divertLimitC, holdTimeS, tubeVolumeL } from './formulas';
import { creamingRiskPct, globuleUm } from './liquid/stageModels';
import type { LiquidLine } from './liquidLine';
import { formatDayTime, type LogTag, type LogWriter } from './log';
import type { PacksLine } from './packsLine';

/** The queued event that ends a timed fault (the filter replaced, the homogenizer repaired). */
export const SCENARIO_EVENTS = { faultEnds: 'scenarioFaultEnds' } as const;

interface FaultEndsPayload {
  run: number;
}

/** What the scenarios act on, and the core's queue and log. */
export interface ScenarioDeps {
  liquid: LiquidLine;
  packs: PacksLine;
  setpoints: Readonly<Setpoints>;
  schedule<P>(timeS: number, type: string, payload: P): QueuedEvent<P>;
  cancel(seq: number): boolean;
  log: LogWriter;
}

export interface Scenarios {
  trigger(id: ScenarioId, variant: ScenarioVariant | undefined, nowS: number): void;
  reset(nowS: number): void;
  /** Every log entry, before it is kept: the scenario that caused it and why, if a run claims it. */
  annotate(entry: LogEntry, tag: LogTag | undefined): Pick<LogEntry, 'scenario' | 'why'> | undefined;
  /** After each clock step: runs that end once a state is reached (the extra trucks gone). */
  afterStep(nowS: number): void;
  /** A queued scenario event; false if the event is not one. */
  onEvent(event: QueuedEvent): boolean;
  /** Stage statuses a running scenario makes worse: the aseptic tank amber during a filter deviation. */
  adjustStatuses(statuses: Record<StageId, Status>): void;
  snapshot(nowS: number): ScenariosSnapshot;
}

interface Run {
  run: number;
  id: ScenarioId;
  variant: ScenarioVariant | null;
  startedS: number;
  endedS: number | null;
  following: boolean;
  /** Where it is in its script; each scenario has its own phases. */
  phase: string;
  log: LogEntry[];
  /** What it claims in the log: its filler, its batches, its trucks' origin. */
  filler: number;
  batchIds: Set<number>;
  /** Its batches still waiting for a verdict. */
  pending: Set<number>;
  /** It made the UHT plant throttle, or starved the fillers, and follows that until it is over. */
  throttled: boolean;
  starved: boolean;
  /** The queued end of its fault, while one is due. */
  endSeq: number | null;
  /** Numbers for its entries, kept from the trigger. */
  riskPct: number;
}

const MODE_TEXT: Readonly<Record<UhtMode, string>> = {
  production: 'in production',
  divert: 'diverting',
  cip: 'cleaning (CIP)',
  sterilize: 're-sterilizing',
  aic: 'in an intermediate clean',
};

const formatMin = (seconds: number): string => `${Math.max(1, Math.round(sToMin(seconds)))} min`;
const formatHours = (seconds: number): string => {
  const minutes = Math.round(sToMin(seconds));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};
const formatNumber = (value: number): string => Math.round(value).toLocaleString('en-US');
const listIds = (ids: Iterable<number>): string => {
  const sorted = [...ids].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.join('');
  return `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`;
};
const batchWord = (ids: Iterable<number>): string => ([...ids].length === 1 ? 'batch' : 'batches');

export function createScenarios(config: PlantConfig, deps: ScenarioDeps): Scenarios {
  const { scenarios: spec, uht, fillers: fillerSpec, warehouse: wh, homogenizer } = config;
  const { liquid, packs } = deps;
  const { fillers, quality, warehouse } = packs.parts;
  const tubeL = tubeVolumeL(uht.holdAtCapacityS, uht.capacityLph);
  const runs: Run[] = [];
  let nextRun = 1;

  const note = (run: Run, timeS: number, kind: LogKind, message: string, why: string): void =>
    deps.log(timeS, kind, message, { topic: 'scenario', scenario: run.id, run: run.run, why });
  const fillerName = (index: number): string => fillers.units[index]?.name ?? String(index + 1);
  const acting = (id: ScenarioId): Run | undefined => runs.find((run) => run.id === id && run.endedS === null);
  const stop = (run: Run, nowS: number): void => {
    if (run.endedS === null) run.endedS = nowS;
  };
  const finish = (run: Run, nowS: number): void => {
    stop(run, nowS);
    run.following = false;
  };
  /** Trucks of its kind still to arrive: held-up ones, or extra ones of a spike. */
  const trucksToCome = (run: Run): boolean => (run.variant === 'lateTrucks' ? warehouse.trucksHeld() : warehouse.extraTrucksToCome() > 0);
  const trucksDisrupted = (): boolean =>
    warehouse.extraTrucksToCome() > 0 || warehouse.trucksHeld() || warehouse.trucksPresent('extra') > 0 || warehouse.trucksPresent('late') > 0;

  function unavailable(id: ScenarioId): string | null {
    switch (id) {
      case 'uhtTempDrop':
        if (liquid.state.steamFaultSinceS !== null) return 'The steam supply is down already';
        if (liquid.state.mode !== 'production') return `The UHT plant is ${MODE_TEXT[liquid.state.mode]}; the steam dip needs it in production`;
        return null;
      case 'fillerBreakdown':
        return fillers.units.some((unit) => unit.down === 'none') ? null : 'Every filler is down already';
      case 'sterileAirFilterFailure':
        return acting(id) ? 'The sterile-air filter is down already' : null;
      case 'failedIncubation':
        return quality.oldestOnHold() ? null : 'No batch is on hold';
      case 'homogenizerPressureLoss':
        return acting(id) ? 'The homogenizer is down already' : null;
      case 'demandSpikeOrLateTruck':
        return trucksDisrupted() ? 'Trucks are disrupted already' : null;
    }
  }

  /** Ends a timed fault now: the filter replaced, or the homogenizer repaired. */
  function endFault(run: Run, nowS: number): void {
    if (run.endedS !== null) return;
    if (run.endSeq !== null) deps.cancel(run.endSeq);
    run.endSeq = null;
    stop(run, nowS);
    if (run.id === 'sterileAirFilterFailure') {
      quality.setInvestigation('sterileAir', false);
      run.phase = 'awaiting';
      note(
        run,
        nowS,
        'ok',
        `Sterile-air filter replaced: deviation closed after ${formatHours(nowS - run.startedS)}`,
        `Milk filled from now on is safe again. The ${batchWord(run.batchIds)} filled during the deviation stay under investigation until ${run.batchIds.size === 1 ? 'its' : 'their'} incubation ends.`,
      );
    } else {
      liquid.setHomogenizerFault(null);
      quality.setInvestigation('creaming', false);
      run.phase = 'awaiting';
      note(
        run,
        nowS,
        'ok',
        `Homogenizer repaired: stage 1 back to ${formatNumber(deps.setpoints.homogenizerStage1Bar)} bar`,
        `Milk homogenized from now on is fine. The ${batchWord(run.batchIds)} filled meanwhile get a sensory check for a cream layer when ${run.batchIds.size === 1 ? 'its' : 'their'} incubation ends.`,
      );
    }
    if (run.pending.size === 0) run.following = false;
  }

  function start(run: Run, nowS: number): void {
    switch (run.id) {
      case 'uhtTempDrop': {
        liquid.startSteamFault(nowS);
        const uhtLph = uht.capacityLph * (liquid.state.throttled ? config.asepticTank.throttledFlowFrac : 1);
        const holdS = holdTimeS(tubeL, uhtLph);
        run.phase = 'falling';
        note(
          run,
          nowS,
          'warn',
          `Steam supply dips: the UHT outlet falls toward ${uht.faultTempC} °C`,
          `Less steam reaches the injector, so the milk is heated less. Below ${divertLimitC(holdS).toFixed(1)} °C at a ${holdS.toFixed(0)} s hold, B* falls under 1: the milk would not be sterile.`,
        );
        return;
      }
      case 'fillerBreakdown': {
        const index = fillers.units.findIndex((unit) => unit.down === 'none');
        run.filler = index;
        run.phase = 'repair';
        // Its own entry is the filler's: claimed below with the why.
        fillers.breakDownNow(index, nowS, spec.fillerRepairS, deps.setpoints.fillerRatePacksPerH);
        return;
      }
      case 'sterileAirFilterFailure': {
        const ids = quality.setInvestigation('sterileAir', true);
        for (const id of ids) {
          run.batchIds.add(id);
          run.pending.add(id);
        }
        run.phase = 'deviation';
        run.endSeq = deps.schedule<FaultEndsPayload>(nowS + spec.filterReplaceS, SCENARIO_EVENTS.faultEnds, { run: run.run }).seq;
        const samples = fracToPct(1 - (1 - spec.filterFailurePerPack) ** (config.quality.batchS / config.quality.sampleEveryS));
        note(
          run,
          nowS,
          'bad',
          `Sterile-air filter on the aseptic tank fails its integrity test: process deviation, ${batchWord(ids)} ${listIds(ids)} under investigation`,
          `The filter keeps the air over the sterile milk germ-free; breached, it may let germs in. Milk filled now is suspect, so the ${batchWord(ids)} are held for investigation, and each sample is far more likely to spoil (${formatNumber(fracToPct(spec.filterFailurePerPack))}%; a batch of 16 samples fails ${formatNumber(samples)}% of the time).`,
        );
        return;
      }
      case 'failedIncubation': {
        const batch = quality.oldestOnHold();
        if (!batch) return;
        run.batchIds.add(batch.id);
        run.phase = 'blocked';
        stop(run, nowS);
        quality.failIncubation(batch.id, nowS);
        return;
      }
      case 'homogenizerPressureLoss': {
        const bar = Math.min(spec.homogenizerFaultBar, deps.setpoints.homogenizerStage1Bar);
        const globule = globuleUm(config, bar);
        run.riskPct = creamingRiskPct(config, globule);
        liquid.setHomogenizerFault(spec.homogenizerFaultBar);
        const ids = quality.setInvestigation('creaming', true, run.riskPct);
        for (const id of ids) {
          run.batchIds.add(id);
          run.pending.add(id);
        }
        run.phase = 'fault';
        run.endSeq = deps.schedule<FaultEndsPayload>(nowS + spec.homogenizerRepairS, SCENARIO_EVENTS.faultEnds, { run: run.run }).seq;
        note(
          run,
          nowS,
          'bad',
          `Homogenizer stage 1 pressure falls to ${formatNumber(bar)} bar: a valve seal leaks`,
          `At ${formatNumber(bar)} bar the fat globules stay about ${globule.toFixed(1)} µm, too big to stay mixed (under ${homogenizer.creamingOkUm} µm they do): cream will rise in the packs, a creaming risk of ${formatNumber(run.riskPct)}%. The ${batchWord(ids)} filling now, ${listIds(ids)}, ${ids.length === 1 ? 'is' : 'are'} made from that milk.`,
        );
        return;
      }
      case 'demandSpikeOrLateTruck': {
        if (run.variant === 'lateTrucks') {
          const untilS = nowS + spec.lateTruckDelayS;
          run.phase = 'held';
          note(
            run,
            nowS,
            'warn',
            `Trucks late: the haulier is held up, no truck until ${formatDayTime(untilS)}`,
            `No pallets leave meanwhile, so stock builds up in the racks. Then the trucks due in the meantime arrive together, more than the ${wh.dockDoors} doors take: the dock backs up.`,
          );
          warehouse.holdTrucks(untilS, nowS);
        } else {
          const pallets = spec.spikeTrucks * wh.palletsPerTruck;
          run.phase = 'spike';
          note(
            run,
            nowS,
            'warn',
            `Demand spike: a large order brings ${spec.spikeTrucks} extra trucks, one every ${formatMin(spec.spikeEveryS)}`,
            `Each takes ${wh.palletsPerTruck} pallets on top of the schedule: ${formatNumber(pallets)} pallets, ${(pallets / warehouse.palletsPerDay).toFixed(1)} days of shipments in ${formatHours((spec.spikeTrucks - 1) * spec.spikeEveryS)}. Stock and days of cover fall, and with ${wh.dockDoors} doors the trucks queue in the yard.`,
          );
          warehouse.sendExtraTrucks(spec.spikeTrucks, spec.spikeEveryS, nowS);
        }
        return;
      }
    }
  }

  /** The why for a model entry a following run claims, or null if it doesn't claim it. May move the run on. */
  function claim(run: Run, tag: LogTag, timeS: number): string | null {
    switch (run.id) {
      case 'uhtTempDrop':
        switch (tag.topic) {
          case 'divert':
            if (run.phase !== 'falling') return null;
            run.phase = 'divert';
            return `Milk under the divert limit must not reach the aseptic tank: the valve sends it to the reject tank for ${formatMin(uht.divertBeforeCleaningS)} while the line is flushed.`;
          case 'cipStart':
            if (run.phase !== 'divert') return null;
            run.phase = 'cip';
            stop(run, timeS);
            return `The steam is back, but the line carried milk that was not sterile: it is cleaned in place for ${formatMin(config.cleaning.cipS)}, then re-sterilized.`;
          case 'fillersStarved':
            if (run.phase === 'falling' || run.phase === 'done') return null;
            run.starved = true;
            return `With no product coming in, the fillers drained the aseptic tank at ${formatNumber(fillerSpec.count * deps.setpoints.fillerRatePacksPerH * config.product.packVolumeL)} L/h down to its ${formatNumber(config.asepticTank.fillersStopBelowL)} L stop level.`;
          case 'sterilizeStart':
            if (run.phase !== 'cip') return null;
            run.phase = 'sterilize';
            return `Before product may flow again, hot water at ${uht.sterilizeTempC} °C or more sterilizes the line for ${formatMin(uht.sterilizeS)}.`;
          case 'productionResumed':
            if (run.phase !== 'sterilize' && run.phase !== 'divert') return null;
            run.phase = 'production';
            if (!run.starved) run.following = false;
            return `Sterile again, the plant makes product after ${formatMin(timeS - run.startedS)} out.`;
          case 'fillersFed':
            if (run.phase !== 'production' || !run.starved) return null;
            run.phase = 'done';
            run.following = false;
            return `Product reaches the aseptic tank again; the fillers restart once it holds ${formatNumber(config.asepticTank.fillersRestartAboveL)} L.`;
          default:
            return null;
        }
      case 'fillerBreakdown': {
        const name = fillerName(run.filler);
        switch (tag.topic) {
          case 'fillerDown':
            if (tag.filler !== run.filler || run.phase !== 'repair') return null;
            return `A jammed sealing jaw stops filler ${name}: ${formatMin(spec.fillerRepairS)} of repair, then its aseptic zone is re-sterilized. The aseptic tank takes the milk it no longer draws.`;
          case 'fillerRepaired':
            if (tag.filler !== run.filler || run.phase !== 'repair') return null;
            run.phase = 'cleaning';
            return `Before it may fill again, its aseptic zone is sterilized for ${formatMin(fillerSpec.repairFixedS)}.`;
          case 'fillerSterile':
            if (tag.filler !== run.filler || run.phase !== 'cleaning') return null;
            run.phase = run.throttled ? 'throttled' : 'done';
            stop(run, timeS);
            if (!run.throttled) run.following = false;
            return `Filler ${name} fills again; QA takes ${config.quality.samplesAfterStop} extra samples from it after the restart.`;
          case 'throttled':
            if (run.phase !== 'repair' && run.phase !== 'cleaning') return null;
            run.throttled = true;
            return `With one filler drawing against ${formatNumber(uht.capacityLph)} L/h coming in, the tank rose; above ${fracToPct(config.asepticTank.throttleAboveFrac)}% the UHT plant drops to ${fracToPct(config.asepticTank.throttledFlowFrac)}% so it cannot overflow.`;
          case 'unthrottled':
            if (!run.throttled || run.phase !== 'throttled') return null;
            run.phase = 'done';
            run.following = false;
            return `With both fillers drawing again the tank fell below ${fracToPct(config.asepticTank.resumeBelowFrac)}%: full flow again.`;
          default:
            return null;
        }
      }
      case 'sterileAirFilterFailure':
      case 'homogenizerPressureLoss': {
        const filter = run.id === 'sterileAirFilterFailure';
        if (tag.topic === 'batchFlagged') {
          if (run.endedS !== null || tag.batchId === undefined || tag.flag !== (filter ? 'sterileAir' : 'creaming')) return null;
          run.batchIds.add(tag.batchId);
          run.pending.add(tag.batchId);
          return filter ? 'It is filled from the same tank while the filter is down.' : 'It is filled from milk homogenized at too low a pressure.';
        }
        if ((tag.topic !== 'batchReleased' && tag.topic !== 'batchBlocked') || tag.batchId === undefined || !run.pending.has(tag.batchId)) return null;
        run.pending.delete(tag.batchId);
        if (run.pending.size === 0 && run.endedS !== null) {
          run.phase = 'done';
          run.following = false;
        }
        if (tag.topic === 'batchReleased') {
          return filter
            ? 'Its samples incubated clean despite the higher risk: the batch is safe.'
            : 'No cream layer at the sensory check: the batch is fine.';
        }
        return filter
          ? 'One of its samples spoiled, as the filter failure made likely: the whole batch may be contaminated and is blocked.'
          : 'Days after it was made, the sensory check finds a cream layer in its packs: the batch is blocked.';
      }
      case 'failedIncubation':
        if (tag.batchId === undefined || !run.batchIds.has(tag.batchId)) return null;
        if (tag.topic === 'batchBlocked') {
          return `At the incubator check a pack of the batch is blown, a sign of spoilage. One spoiled sample means the batch may not be sterile: all its pallets are blocked.`;
        }
        if (tag.topic === 'batchDestroyed') {
          run.phase = 'done';
          run.following = false;
          return `Blocked pallets wait ${formatHours(config.quality.blockedHoldS)} in quarantine, lamps red, then leave for destruction.`;
        }
        return null;
      case 'demandSpikeOrLateTruck': {
        const origin = run.variant === 'lateTrucks' ? 'late' : 'extra';
        if (tag.origin !== origin) return null;
        switch (tag.topic) {
          case 'truckLeft':
            // Only the last of its trucks: the departure that clears the dock ends the run.
            if (trucksToCome(run) || warehouse.trucksPresent(origin) > 0) return null;
            run.phase = 'done';
            finish(run, timeS);
            return `The last ${origin === 'late' ? 'late' : 'extra'} truck leaves the dock: stock is now ${formatNumber(warehouse.palletsInStock)} pallets, ${warehouse.daysOfCover().toFixed(1)} days of cover.`;
          case 'trucksArrived':
            run.phase = 'queue';
            stop(run, timeS);
            return `The haulier sends the trucks due meanwhile together: more than the ${wh.dockDoors} doors can take at once.`;
          case 'truckYard':
            return `All ${wh.dockDoors} doors are taken by trucks loading for ${formatMin(wh.truckLoadS)}: it waits in the yard.`;
          case 'truckWaiting':
            return `Released stock is short of a full load: it waits at the door until a batch is released.`;
          default:
            return null;
        }
      }
    }
  }

  /** What a run is doing now, in a few words. */
  function summary(run: Run, nowS: number): string {
    const left = (untilS: number) => formatMin(Math.max(0, untilS - nowS));
    switch (run.id) {
      case 'uhtTempDrop': {
        const modeLeft = formatMin(liquid.state.modeRemainingS);
        switch (run.phase) {
          case 'falling':
            return `Outlet falling toward ${uht.faultTempC} °C`;
          case 'divert':
            return `Diverting to the reject tank · ${modeLeft} left`;
          case 'cip':
            return `Cleaning in place · ${modeLeft} left`;
          case 'sterilize':
            return `Re-sterilizing the line · ${modeLeft} left`;
          case 'production':
            return 'Fillers waiting for product';
          case 'calledOff':
            return 'Called off before the divert';
          default:
            return 'Over: back in production';
        }
      }
      case 'fillerBreakdown': {
        const unit = fillers.units[run.filler];
        const name = fillerName(run.filler);
        if (run.phase === 'repair') return `Filler ${name} under repair · ${left(unit?.downUntilS ?? nowS)} left`;
        if (run.phase === 'cleaning') return `Filler ${name} re-sterilizing · ${left(unit?.downUntilS ?? nowS)} left`;
        if (run.phase === 'throttled') return `UHT plant throttled until the tank falls below ${fracToPct(config.asepticTank.resumeBelowFrac)}%`;
        return `Over: filler ${name} running`;
      }
      case 'sterileAirFilterFailure':
      case 'homogenizerPressureLoss': {
        const filter = run.id === 'sterileAirFilterFailure';
        if (run.phase === 'deviation') return `Deviation: filter down · replaced in ${left(run.startedS + spec.filterReplaceS)}`;
        if (run.phase === 'fault') return `Stage 1 at ${formatNumber(spec.homogenizerFaultBar)} bar · repaired in ${left(run.startedS + spec.homogenizerRepairS)}`;
        if (run.phase === 'awaiting') {
          const due = Math.min(...[...run.pending].map((id) => quality.quarantine().find((batch) => batch.id === id)?.releaseAtS ?? Infinity));
          const what = filter ? 'under investigation' : 'awaiting the sensory check';
          return `${batchWord(run.pending)} ${listIds(run.pending)} ${what}${Number.isFinite(due) ? ` · verdict ${formatDayTime(due)}` : ''}`.replace(/^b/, 'B');
        }
        return 'Over: every batch judged';
      }
      case 'failedIncubation': {
        const id = [...run.batchIds][0];
        const batch = quality.quarantine().find((each) => each.id === id);
        return batch ? `Batch ${id} blocked · destroyed in ${formatHours(Math.max(0, batch.releaseAtS - nowS))}` : `Over: batch ${id} destroyed`;
      }
      case 'demandSpikeOrLateTruck':
        if (run.phase === 'held') return `No trucks until ${formatDayTime(run.startedS + spec.lateTruckDelayS)}`;
        if (run.phase === 'spike') return `Extra trucks: ${warehouse.extraTrucksToCome()} still to come, ${warehouse.trucksPresent('extra')} at the dock`;
        if (run.phase === 'queue') return `Late trucks at the dock: ${warehouse.trucksPresent('late')}`;
        return 'Over: the dock is clear';
    }
  }

  function newRun(id: ScenarioId, variant: ScenarioVariant | null, nowS: number): Run {
    const run: Run = {
      run: nextRun++,
      id,
      variant,
      startedS: nowS,
      endedS: null,
      following: true,
      phase: '',
      log: [],
      filler: -1,
      batchIds: new Set(),
      pending: new Set(),
      throttled: false,
      starved: false,
      endSeq: null,
      riskPct: 0,
    };
    runs.unshift(run);
    // Old runs that have played out leave the list; those still following stay, so their logs stay whole.
    while (runs.length > SCENARIO_RUNS_KEPT) {
      let oldest = runs.length - 1;
      while (oldest >= 0 && runs[oldest]?.following) oldest--;
      if (oldest < 0) break;
      runs.splice(oldest, 1);
    }
    return run;
  }

  return {
    trigger(id, variant, nowS) {
      const why = unavailable(id);
      if (why) {
        deps.log(nowS, 'warn', `Scenario not started: ${why}`);
        return;
      }
      const run = newRun(id, id === 'demandSpikeOrLateTruck' ? (variant ?? 'demandSpike') : null, nowS);
      start(run, nowS);
    },
    reset(nowS) {
      const live = runs.filter((run) => run.endedS === null);
      if (live.length === 0) {
        deps.log(nowS, 'info', 'Scenarios reset: none was acting on the plant');
        return;
      }
      for (const run of live) {
        switch (run.id) {
          case 'uhtTempDrop':
            liquid.endSteamFault();
            stop(run, nowS);
            if (run.phase === 'falling') {
              run.phase = 'calledOff';
              run.following = false;
              note(run, nowS, 'ok', 'Steam supply restored before the plant diverted', 'The outlet is back at its set point: B* never fell under 1.');
            } else {
              note(run, nowS, 'ok', 'Steam supply restored', 'The divert and the clean after it still run their course: the line carried milk that was not sterile.');
            }
            break;
          case 'fillerBreakdown':
            stop(run, nowS);
            fillers.endRepairNow(run.filler, nowS, deps.setpoints.fillerRatePacksPerH);
            break;
          case 'sterileAirFilterFailure':
          case 'homogenizerPressureLoss':
            endFault(run, nowS);
            break;
          case 'demandSpikeOrLateTruck':
            stop(run, nowS);
            if (run.variant === 'lateTrucks') {
              const count = warehouse.releaseHeldTrucks(nowS);
              if (count === 0) {
                run.phase = 'done';
                run.following = false;
                note(run, nowS, 'ok', 'Trucks on time again: none was due yet', 'The schedule goes on as before.');
              }
            } else {
              const cancelled = warehouse.cancelExtraTrucks();
              note(run, nowS, 'ok', `Demand spike called off: ${cancelled} extra truck${cancelled === 1 ? '' : 's'} cancelled`, 'The extra trucks already at the dock still load and leave.');
            }
            break;
          default:
            stop(run, nowS);
        }
      }
    },
    annotate(entry, tag) {
      if (!tag) return undefined;
      if (tag.topic === 'scenario') {
        const run = runs.find((each) => each.run === tag.run);
        const noted = { ...entry, scenario: tag.scenario, why: tag.why };
        run?.log.push(noted);
        return { scenario: tag.scenario, why: tag.why };
      }
      // Oldest first: the run that started a chain of reactions claims them.
      for (let i = runs.length - 1; i >= 0; i--) {
        const run = runs[i] as Run;
        if (!run.following) continue;
        const why = claim(run, tag, entry.timeS);
        if (why === null) continue;
        run.log.push({ ...entry, scenario: run.id, why });
        return { scenario: run.id, why };
      }
      return undefined;
    },
    afterStep(nowS) {
      // A truck run ends with its last truck's departure (claim); this catches one left with no truck to leave.
      for (const run of runs) {
        if (!run.following || run.id !== 'demandSpikeOrLateTruck') continue;
        if (trucksToCome(run) || warehouse.trucksPresent(run.variant === 'lateTrucks' ? 'late' : 'extra') > 0) continue;
        run.phase = 'done';
        finish(run, nowS);
        note(run, nowS, 'ok', 'Trucks back on schedule', `Stock is now ${formatNumber(warehouse.palletsInStock)} pallets, ${warehouse.daysOfCover().toFixed(1)} days of cover.`);
      }
    },
    onEvent(event) {
      if (event.type !== SCENARIO_EVENTS.faultEnds) return false;
      const run = runs.find((each) => each.run === (event.payload as FaultEndsPayload).run);
      if (run && run.endSeq === event.seq) {
        run.endSeq = null;
        endFault(run, event.timeS);
      }
      return true;
    },
    adjustStatuses(statuses) {
      if (acting('sterileAirFilterFailure') && statuses[6] !== 'bad') statuses[6] = 'warn';
    },
    snapshot(nowS): ScenariosSnapshot {
      const unavailableNow: ScenariosSnapshot['unavailable'] = {};
      for (const id of [
        'uhtTempDrop',
        'fillerBreakdown',
        'sterileAirFilterFailure',
        'failedIncubation',
        'homogenizerPressureLoss',
        'demandSpikeOrLateTruck',
      ] as const) {
        const why = unavailable(id);
        if (why) unavailableNow[id] = why;
      }
      const runSnapshots: ScenarioRunSnapshot[] = runs.map((run) => ({
        run: run.run,
        id: run.id,
        variant: run.variant,
        startedS: run.startedS,
        endedS: run.endedS,
        following: run.following,
        summary: summary(run, nowS),
        log: run.log.map((entry) => ({ ...entry })),
      }));
      return { runs: runSnapshots, unavailable: unavailableNow };
    },
  };
}
