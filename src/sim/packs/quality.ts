// Stage 9: batches, samples and incubation (plan 04). A batch is one filler for one shift (D1). Its samples
// (1 per filler every 30 min, plus 2 after each restart) incubate for 7 days at 55 °C once the batch
// closes; then it is RELEASED to the warehouse, or BLOCKED if a sample failed, with the chance that one of
// n samples spoils, 1 − (1 − p)^n (R10). A blocked batch's pallets stay in quarantine, lamps red, for
// quality.blockedHoldS, then leave for destruction. The QA lab may override a batch (setQaResult): a
// failed sample blocks it at once; a pass releases it, without the draw, when its incubation ends.
//
// The plant opens on day 8 with a week of batches on hold and released stock from before them (D11):
// history() makes them, each from one shift of a filler's breakdowns drawn as the live fillers draw them.
import { dayToS, sToH, type BatchSnapshot, type BatchStatus, type PlantConfig, type QaResult } from '../../contracts';
import type { QueuedEvent } from '../eventQueue';
import { formatDayTime } from '../log';
import type { Rng } from '../rng';
import { FILLER_NAMES } from './filler';
import { wholeUnits, type Scheduler } from './types';

export const QUALITY_EVENTS = { incubationOver: 'incubationOver', destroyed: 'blockedDestroyed' } as const;

interface BatchPayload {
  batchId: number;
}

/** A batch from its first pack until it leaves quarantine. Read-only outside this file. */
export interface Batch {
  readonly id: number;
  readonly filler: number;
  status: BatchStatus;
  startS: number;
  endS: number;
  releaseAtS: number;
  bestBeforeS: number;
  pallets: number;
  packs: number;
  lastPalletPacks: number;
  samples: number;
  /** Restarts of its filler during its shift, each owing after-stop samples. */
  restarts: number;
  qaResult: QaResult;
}

/** A batch of released pallets as the warehouse receives it. */
export interface ReleasedBatch {
  batchId: number;
  pallets: number;
  bestBeforeS: number;
}

export interface QualityHooks {
  /** A batch passed: its pallets go to the warehouse. */
  onRelease(batch: ReleasedBatch, atS: number): void;
  /** A blocked batch's pallets left quarantine for destruction. */
  onDestroyed(pallets: number, atS: number): void;
}

export interface Quality {
  /** The batch each filler fills now. */
  readonly openBatchIds: readonly number[];
  /** The released stock the plant opens with (D11), oldest first, for the warehouse. */
  readonly openingStock: readonly ReleasedBatch[];
  /** Since the plant opened. */
  readonly released: number;
  readonly blocked: number;
  /** A closed pallet joins its batch in quarantine; returns its number within the batch. */
  addPallet(batchId: number, packs: number): number;
  /** Samples a filler owes QA, counted to the batch it fills now. */
  oweSamples(filler: number, count: number): void;
  /** Its filler restarted: the batch owes after-stop samples too. */
  restarted(filler: number): void;
  /** At a shift change: each filler's batch closes and goes on hold, and a new one opens. */
  changeShift(atS: number): void;
  setQaResult(batchId: number, result: 'pass' | 'fail', atS: number): void;
  onEvent(event: QueuedEvent): boolean;
  /** The batches in quarantine, oldest first. */
  quarantine(): Batch[];
  snapshot(): BatchSnapshot[];
}

/** One historical shift of a filler: packs made after its breakdowns, rejects, restarts (D11). */
interface HistoryShift {
  packs: number;
  restarts: number;
}

/**
 * One filler's shift of durationS as the live filler runs it: runs between breakdowns drawn from D2's
 * mean time between failures, each followed by a repair; packs at the set rate while it runs.
 */
function historyShift(config: PlantConfig, rng: Rng, durationS: number): HistoryShift {
  const { mtbfMeanS, repairFixedS, repairRandomMeanS, ratePacksPerH, rejectFrac } = config.fillers;
  let atS = 0;
  let runS = 0;
  let restarts = 0;
  for (;;) {
    const toFailureS = rng.exponential(mtbfMeanS);
    if (atS + toFailureS >= durationS) {
      runS += durationS - atS;
      break;
    }
    runS += toFailureS;
    atS += toFailureS + repairFixedS + rng.exponential(repairRandomMeanS);
    if (atS >= durationS) break;
    restarts += 1;
  }
  const made = wholeUnits(ratePacksPerH * sToH(runS));
  return { packs: made - wholeUnits(made * rejectFrac), restarts };
}

/** A guard on the opening stock's loop: a config whose shifts make no pallets would otherwise never fill it. */
const MAX_STOCK_SHIFTS = 10_000;

export function createQuality(config: PlantConfig, rng: Rng, scheduler: Scheduler, openS: number, hooks: QualityHooks): Quality {
  const { quality: q, product, fillers } = config;
  const packsPerPallet = config.packaging.packsPerTray * config.packaging.traysPerPallet;
  const incubationS = dayToS(q.incubationDays);
  const shelfLifeS = dayToS(product.shelfLifeDays);
  const samplesPerShift = Math.round(q.batchS / q.sampleEveryS);
  const batches = new Map<number, Batch>();
  let nextId = 1;
  let released = 0;
  let blocked = 0;

  /** The start of the shift on the grid firstShiftStartS + k × batchS that holds timeS. */
  const shiftStartS = (timeS: number): number => q.firstShiftStartS + Math.floor((timeS - q.firstShiftStartS) / q.batchS) * q.batchS;

  function newBatch(filler: number, startS: number, endS: number, status: BatchStatus): Batch {
    const batch: Batch = {
      id: nextId++,
      filler,
      status,
      startS,
      endS,
      releaseAtS: endS + incubationS,
      bestBeforeS: startS + shelfLifeS,
      pallets: 0,
      packs: 0,
      lastPalletPacks: 0,
      samples: 0,
      restarts: 0,
      qaResult: 'pending',
    };
    batches.set(batch.id, batch);
    return batch;
  }

  /** Puts a finished batch's packs on pallets: full ones and a part-full last one (D1). */
  function palletize(batch: Batch, packs: number): void {
    batch.packs = packs;
    batch.pallets = Math.ceil(packs / packsPerPallet);
    batch.lastPalletPacks = packs - (batch.pallets - 1) * packsPerPallet;
    if (batch.pallets === 0) batch.lastPalletPacks = 0;
  }

  // D11: the stock released before the history window, then the week of batches on hold. Shifts are made
  // newest first, so the stock stops at its target, then numbered oldest first.
  const openShiftS = shiftStartS(openS);
  const historyStartS = openShiftS - dayToS(q.historyDays);
  const openingStock: ReleasedBatch[] = [];
  {
    const stockShifts: { startS: number; filler: number; pallets: number }[] = [];
    let palletsLeft = config.warehouse.startStockPallets;
    for (let shifts = 0, startS = historyStartS - q.batchS; palletsLeft > 0 && shifts < MAX_STOCK_SHIFTS; shifts++, startS -= q.batchS) {
      for (let filler = fillers.count - 1; filler >= 0 && palletsLeft > 0; filler--) {
        const shift = historyShift(config, rng, q.batchS);
        const pallets = Math.min(palletsLeft, Math.ceil(Math.max(0, shift.packs - samplesPerShift) / packsPerPallet));
        if (pallets <= 0) continue;
        palletsLeft -= pallets;
        stockShifts.push({ startS, filler, pallets });
      }
    }
    for (const { startS, filler, pallets } of stockShifts.reverse()) {
      const batch = newBatch(filler, startS, startS + q.batchS, 'released');
      batches.delete(batch.id);
      openingStock.push({ batchId: batch.id, pallets, bestBeforeS: batch.bestBeforeS });
    }
    for (let startS = historyStartS; startS + q.batchS <= openShiftS; startS += q.batchS) {
      for (let filler = 0; filler < fillers.count; filler++) {
        const shift = historyShift(config, rng, q.batchS);
        const batch = newBatch(filler, startS, startS + q.batchS, 'hold');
        batch.restarts = shift.restarts;
        batch.samples = samplesPerShift + shift.restarts * q.samplesAfterStop;
        palletize(batch, Math.max(0, shift.packs - batch.samples));
        scheduler.schedule<BatchPayload>(batch.releaseAtS, QUALITY_EVENTS.incubationOver, { batchId: batch.id });
      }
    }
  }

  // The batches the fillers fill as the plant opens: from the opening to the end of its shift.
  const openBatchIds: number[] = [];
  for (let filler = 0; filler < fillers.count; filler++) {
    openBatchIds.push(newBatch(filler, openS, openShiftS + q.batchS, 'filling').id);
  }

  const formatPallets = (count: number): string => `${count} pallet${count === 1 ? '' : 's'}`;
  const fillerName = (batch: Batch): string => FILLER_NAMES[batch.filler] ?? String(batch.filler + 1);

  function scheduleDestruction(batch: Batch, fromS: number): void {
    batch.releaseAtS = fromS + q.blockedHoldS;
    scheduler.schedule<BatchPayload>(batch.releaseAtS, QUALITY_EVENTS.destroyed, { batchId: batch.id });
  }

  function block(batch: Batch, atS: number, why: string): void {
    batch.status = 'blocked';
    blocked += 1;
    scheduler.log(atS, 'bad', `Batch ${batch.id} ${why}: ${formatPallets(batch.pallets)} blocked`);
    // A batch still filling keeps its pallets in quarantine until it closes, then they wait their time like the rest.
    if (batch.endS <= atS) scheduleDestruction(batch, atS);
  }

  function release(batch: Batch, atS: number): void {
    batch.status = 'released';
    released += 1;
    batches.delete(batch.id);
    scheduler.log(atS, 'ok', `Batch ${batch.id} passed incubation: ${formatPallets(batch.pallets)} released to the warehouse`);
    hooks.onRelease({ batchId: batch.id, pallets: batch.pallets, bestBeforeS: batch.bestBeforeS }, atS);
  }

  return {
    openBatchIds,
    openingStock,
    get released() {
      return released;
    },
    get blocked() {
      return blocked;
    },
    addPallet(batchId, packs) {
      const batch = batches.get(batchId);
      if (!batch) return 0;
      batch.pallets += 1;
      batch.packs += packs;
      batch.lastPalletPacks = packs;
      return batch.pallets;
    },
    oweSamples(filler, count) {
      const batch = batches.get(openBatchIds[filler] ?? -1);
      if (batch && count > 0) batch.samples += count;
    },
    restarted(filler) {
      const batch = batches.get(openBatchIds[filler] ?? -1);
      if (!batch) return;
      batch.restarts += 1;
      batch.samples += q.samplesAfterStop;
    },
    changeShift(atS) {
      for (let filler = 0; filler < openBatchIds.length; filler++) {
        const batch = batches.get(openBatchIds[filler] as number);
        if (batch) {
          batch.endS = atS;
          if (batch.status === 'blocked') {
            scheduleDestruction(batch, atS);
          } else {
            batch.status = 'hold';
            batch.releaseAtS = atS + incubationS;
            scheduler.schedule<BatchPayload>(batch.releaseAtS, QUALITY_EVENTS.incubationOver, { batchId: batch.id });
            scheduler.log(
              atS,
              'info',
              `Batch ${batch.id} (filler ${fillerName(batch)}) closed: ${formatPallets(batch.pallets)} on hold until ${formatDayTime(batch.releaseAtS)}`,
            );
          }
        }
        openBatchIds[filler] = newBatch(filler, atS, atS + q.batchS, 'filling').id;
      }
    },
    setQaResult(batchId, result, atS) {
      const batch = batches.get(batchId);
      if (!batch || (batch.status !== 'filling' && batch.status !== 'hold')) {
        const where = batch ? `it is ${batch.status}` : 'it is not in quarantine';
        scheduler.log(atS, 'warn', `QA result for batch ${batchId} not applied: ${where}`);
        return;
      }
      batch.qaResult = result;
      if (result === 'fail') block(batch, atS, 'failed a QA sample');
      else scheduler.log(atS, 'ok', `QA passed batch ${batch.id}: released when its incubation ends, ${formatDayTime(batch.releaseAtS)}`);
    },
    onEvent(event) {
      if (event.type !== QUALITY_EVENTS.incubationOver && event.type !== QUALITY_EVENTS.destroyed) return false;
      const batch = batches.get((event.payload as BatchPayload).batchId);
      if (!batch) return true;
      if (event.type === QUALITY_EVENTS.incubationOver) {
        if (batch.status !== 'hold') return true;
        const failChance = 1 - (1 - q.failurePerPack) ** batch.samples;
        // Drawn for every batch, overridden or not, so a QA override doesn't shift the draws after it.
        const spoiled = rng.chance(failChance);
        if (batch.qaResult === 'pass' || !spoiled) release(batch, event.timeS);
        else block(batch, event.timeS, `failed incubation (a sample of ${batch.samples} spoiled)`);
      } else if (batch.status === 'blocked') {
        batches.delete(batch.id);
        scheduler.log(event.timeS, 'warn', `Batch ${batch.id}: ${formatPallets(batch.pallets)} left quarantine for destruction`);
        hooks.onDestroyed(batch.pallets, event.timeS);
      }
      return true;
    },
    quarantine: () => [...batches.values()],
    snapshot: () =>
      [...batches.values()].map((batch) => ({
        id: batch.id,
        filler: fillerName(batch),
        status: batch.status,
        startS: batch.startS,
        endS: batch.endS,
        releaseAtS: batch.releaseAtS,
        bestBeforeS: batch.bestBeforeS,
        pallets: batch.pallets,
        packs: batch.packs,
        lastPalletPacks: batch.lastPalletPacks,
        samples: batch.samples,
        qaResult: batch.qaResult,
      })),
  };
}
