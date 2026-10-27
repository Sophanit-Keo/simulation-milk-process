// Stages 7–10, packs to trucks, as a discrete model (plan 06): the fillers (packs/filler.ts), the tray packer
// and palletizer (packaging.ts), batches, samples and incubation (quality.ts), and the warehouse and trucks
// (warehouse.ts). Every timed change runs through the core's event queue: breakdowns, repairs and
// cleanings, batch changes, the end of each batch's incubation, truck arrivals and departures.
//
// It meets the liquid line at the aseptic tank. The liquid line asks the fillers how many are ready to
// draw, and tells them after every cut of its step how long they ran and whether the tank fed them, so
// packs are made exactly while milk is drawn: litres to the fillers = packs made × the pack volume.
import type { BatchSnapshot, Kpis, PacksSnapshot, PlantConfig, Status } from '../contracts';
import type { Setpoints } from './core';
import type { QueuedEvent } from './eventQueue';
import type { FillerSupply } from './fillerStub';
import { createFillers, type Fillers } from './packs/filler';
import { createPackaging } from './packs/packaging';
import { createQuality, type Quality } from './packs/quality';
import type { Scheduler } from './packs/types';
import { createWarehouse, type Warehouse } from './packs/warehouse';
import type { Rng } from './rng';

export type PacksStageId = 7 | 8 | 9 | 10;
export const PACKS_STAGE_IDS: readonly PacksStageId[] = [7, 8, 9, 10];

/** The core's shift change, which closes every filler's batch and opens the next (D1). */
const SHIFT_CHANGE = 'shiftChange';

/** Counts since the plant opened, for the conservation checks and the long-run tests. */
export interface PacksTotals {
  packsMade: number;
  packsRejected: number;
  /** Samples taken off the lines, and samples owed but not yet taken (a filler that was down when one fell due). */
  packsSampled: number;
  samplesOwed: number;
  /** Packs on the conveyors and accumulation tables, in open trays, and on open pallets. */
  packsQueued: number;
  packsInTrays: number;
  packsOnOpenPallets: number;
  /** Packs on the pallets closed since the plant opened. */
  packsOnClosedPallets: number;
  palletsMade: number;
  /** Pallets the plant opened with: on hold in quarantine and released in stock (D11). */
  palletsAtOpen: number;
  palletsInQuarantine: number;
  palletsInStock: number;
  /** On trucks still loading at the dock. */
  palletsLoading: number;
  palletsShipped: number;
  palletsDestroyed: number;
}

/** Stages 7–10 as the snapshot shows them. */
export interface PacksView {
  values: Record<PacksStageId, Record<string, number>>;
  statuses: Record<PacksStageId, Status>;
  packs: PacksSnapshot;
  kpis: Pick<
    Kpis,
    | 'packsPerH'
    | 'oeePct'
    | 'traysMade'
    | 'palletsMade'
    | 'batchesOnHold'
    | 'batchesReleased'
    | 'batchesBlocked'
    | 'palletsInStock'
    | 'daysOfCover'
    | 'orderFillPct'
    | 'trucksShipped'
  >;
}

export interface PacksLine {
  /** The fillers as the liquid line sees them. */
  readonly fillers: FillerSupply;
  readonly totals: Readonly<PacksTotals>;
  /** After each clock step, once the liquid line has run it: samples due, and each running filler's next breakdown. */
  afterStep(endS: number, setpoints: Readonly<Setpoints>): void;
  /** A queued event as it falls due; false if it is not one of the packs model's. */
  onEvent(event: QueuedEvent, setpoints: Readonly<Setpoints>): boolean;
  setQaResult(batchId: number, result: 'pass' | 'fail', atS: number): void;
  view(setpoints: Readonly<Setpoints>, timeS: number): PacksView;
  /** The fillers, the batches and the warehouse, which the fault scenarios act on (scenarios.ts, phase 5). */
  readonly parts: { readonly fillers: Fillers; readonly quality: Quality; readonly warehouse: Warehouse };
}

export function createPacksLine(config: PlantConfig, rng: Rng, scheduler: Scheduler, openS: number): PacksLine {
  const { fillers: fillerSpec, packaging: packSpec, quality: q, warehouse: wh, product } = config;
  // Quality makes the opening history (D11), whose released stock the warehouse then opens with; the
  // releases that follow reach the warehouse through this holder.
  const store: { warehouse?: Warehouse } = {};
  const quality = createQuality(config, rng, scheduler, openS, {
    onRelease: (batch, atS) => store.warehouse?.receive(batch, atS),
    onDestroyed: (pallets) => store.warehouse?.destroyed(pallets),
  });
  const warehouse = createWarehouse(config, scheduler, openS, quality.openingStock);
  store.warehouse = warehouse;
  const palletsAtOpen = warehouse.palletsInStock + quality.quarantine().reduce((sum, batch) => sum + batch.pallets, 0);

  /** Samples each filler owes and has not yet taken off its line. */
  const samplesOwed: number[] = Array.from({ length: fillerSpec.count }, () => 0);
  let packsSampled = 0;
  let packsOnClosedPallets = 0;
  const units = createFillers(config, rng, scheduler, {
    onRestart(index) {
      quality.restarted(index);
      samplesOwed[index] = (samplesOwed[index] ?? 0) + q.samplesAfterStop;
    },
  });
  const names = units.units.map((unit) => unit.name);
  const packaging = createPackaging(config, names, quality.openBatchIds, scheduler, {
    onPallet(batchId, packs) {
      packsOnClosedPallets += packs;
      return quality.addPallet(batchId, packs);
    },
  });
  /** Sample times on the grid firstShiftStartS + k × sampleEveryS (D1) before this time have been counted. */
  let samplesCountedToS = openS;
  const sampleIndexBefore = (timeS: number): number => Math.ceil((timeS - q.firstShiftStartS) / q.sampleEveryS - 1e-9);

  const fillers: FillerSupply = {
    readyCount: () => units.readyCount(),
    drawLph: (running, ratePacksPerH) => running * Math.max(0, ratePacksPerH) * product.packVolumeL,
    ran(dtS, endS, fed, ratePacksPerH) {
      const made = units.run(dtS, endS, fed, ratePacksPerH);
      made.forEach(({ made: packs, rejected }, index) => {
        const good = packs - rejected;
        // The samples come off the line first, from good packs (they passed the seal check).
        const sampled = Math.min(samplesOwed[index] ?? 0, good);
        samplesOwed[index] = (samplesOwed[index] ?? 0) - sampled;
        packsSampled += sampled;
        const unit = units.units[index];
        packaging.run(index, dtS, endS, good - sampled, unit !== undefined && units.state(unit, ratePacksPerH) === 'running');
      });
    },
  };

  function changeShift(atS: number): void {
    for (let index = 0; index < names.length; index++) packaging.closeBatch(index, atS);
    quality.changeShift(atS);
    for (let index = 0; index < names.length; index++) packaging.startBatch(index, atS, quality.openBatchIds[index] as number);
  }

  const totals = (): PacksTotals => {
    const lanes = packaging.lanes;
    return {
      packsMade: units.units.reduce((sum, unit) => sum + unit.packsMade, 0),
      packsRejected: units.units.reduce((sum, unit) => sum + unit.packsRejected, 0),
      packsSampled,
      samplesOwed: samplesOwed.reduce((sum, owed) => sum + owed, 0),
      packsQueued: lanes.reduce((sum, lane) => sum + lane.queuePacks, 0),
      packsInTrays: lanes.reduce((sum, lane) => sum + lane.trayPacks, 0),
      packsOnOpenPallets: lanes.reduce((sum, lane) => sum + lane.palletPacks, 0),
      packsOnClosedPallets,
      palletsMade: packaging.palletsMade,
      palletsAtOpen,
      palletsInQuarantine: quality.quarantine().reduce((sum, batch) => sum + batch.pallets, 0),
      palletsInStock: warehouse.palletsInStock,
      palletsLoading: warehouse.palletsLoading,
      palletsShipped: warehouse.palletsShipped,
      palletsDestroyed: warehouse.palletsDestroyed,
    };
  };

  return {
    fillers,
    parts: { fillers: units, quality, warehouse },
    get totals() {
      return totals();
    },
    afterStep(endS, setpoints) {
      const due = sampleIndexBefore(endS) - sampleIndexBefore(samplesCountedToS);
      samplesCountedToS = endS;
      if (due > 0) {
        for (let index = 0; index < names.length; index++) {
          quality.oweSamples(index, due);
          samplesOwed[index] = (samplesOwed[index] ?? 0) + due;
        }
      }
      units.reconcile(endS, setpoints.fillerRatePacksPerH);
    },
    onEvent(event, setpoints) {
      if (event.type === SHIFT_CHANGE) {
        changeShift(event.timeS);
        return true;
      }
      return (
        units.onEvent(event, setpoints.fillerRatePacksPerH) || packaging.onEvent(event) || quality.onEvent(event) || warehouse.onEvent(event)
      );
    },
    setQaResult: (batchId, result, atS) => quality.setQaResult(batchId, result, atS),
    view(setpoints, timeS) {
      const rate = setpoints.fillerRatePacksPerH;
      const batches: BatchSnapshot[] = quality.snapshot();
      const fillerSnapshots = units.units.map((unit) => units.snapshot(unit, timeS, openS, rate, quality.openBatchIds[unit.index] ?? 0));
      const packagingSnapshot = packaging.snapshot(timeS, packsSampled);
      const warehouseSnapshot = warehouse.snapshot(timeS);
      const packs: PacksSnapshot = { fillers: fillerSnapshots, packaging: packagingSnapshot, batches, warehouse: warehouseSnapshot };

      const running = fillerSnapshots.filter((filler) => filler.state === 'running').length;
      const packsPerH = fillerSnapshots.reduce((sum, filler) => sum + filler.packsPerH, 0);
      const oeePct = fillerSnapshots.length > 0 ? fillerSnapshots.reduce((sum, filler) => sum + filler.oeePct, 0) / fillerSnapshots.length : 0;
      const onHold = batches.filter((batch) => batch.status === 'hold');
      const nextRelease = Math.min(...onHold.map((batch) => batch.releaseAtS));
      const palletsInQuarantine = batches.reduce((sum, batch) => sum + batch.pallets, 0);
      const trucksAtDock = warehouseSnapshot.trucks.filter((truck) => truck.door >= 0).length;

      const values: PacksView['values'] = {
        7: {
          fillerCount: fillerSpec.count,
          ratePacksPerH: rate,
          runningCount: running,
          packsPerH,
          oeePct,
          // Each filler's OEE too, keyed by its name: oeeAPct, oeeBPct.
          ...Object.fromEntries(fillerSnapshots.map((filler) => [`oee${filler.name}Pct`, filler.oeePct])),
          packsMade: fillerSnapshots.reduce((sum, filler) => sum + filler.packsMade, 0),
          packsRejected: fillerSnapshots.reduce((sum, filler) => sum + filler.packsRejected, 0),
          tempC: fillerSpec.tempC,
        },
        8: {
          packsPerTray: packSpec.packsPerTray,
          traysPerPallet: packSpec.traysPerPallet,
          packsPerPallet: packSpec.packsPerTray * packSpec.traysPerPallet,
          queuePacks: packagingSnapshot.lanes.reduce((sum, lane) => sum + lane.queuePacks, 0),
          traysMade: packagingSnapshot.traysMade,
          palletsMade: packagingSnapshot.palletsMade,
        },
        9: {
          incubationTempC: q.incubationTempC,
          incubationDays: q.incubationDays,
          samplesPerBatch: q.batchS / q.sampleEveryS,
          batchesOnHold: onHold.length,
          palletsInQuarantine,
          nextReleaseS: Number.isFinite(nextRelease) ? Math.max(0, nextRelease - timeS) : 0,
          batchesReleased: quality.released,
          batchesBlocked: quality.blocked,
          samplesTaken: packsSampled,
        },
        10: {
          tempC: wh.tempC,
          palletsPerTruck: wh.palletsPerTruck,
          palletsInStock: warehouse.palletsInStock,
          daysOfCover: warehouse.daysOfCover(),
          trucksAtDock,
          nextTruckS: Math.max(0, warehouseSnapshot.nextTruckS - timeS),
          trucksShipped: warehouse.trucksShipped,
          orderFillPct: warehouse.orderFillPct(),
        },
      };

      const states = fillerSnapshots.map((filler) => filler.state);
      // A breakdown is red, as in the fault table; cleaning after it, or a filler stopped at rate 0, amber.
      const fillerStatus: Status = states.includes('repair')
        ? 'bad'
        : states.includes('cleaning') || states.includes('stopped')
          ? 'warn'
          : running > 0
            ? 'ok'
            : 'idle';
      const laneStates = packagingSnapshot.lanes.map((lane) => lane.packerState);
      const packagingStatus: Status = laneStates.includes('changeover') ? 'warn' : laneStates.every((state) => state === 'idle') ? 'idle' : 'ok';
      // Amber while batches wait on hold (plan 08: amber is on hold), red while a blocked batch is in quarantine.
      const qualityStatus: Status = batches.some((batch) => batch.status === 'blocked') ? 'bad' : batches.length > 0 ? 'warn' : 'ok';
      const warehouseStatus: Status = warehouseSnapshot.trucks.some((truck) => truck.state === 'waiting') ? 'warn' : 'ok';

      return {
        values,
        statuses: { 7: fillerStatus, 8: packagingStatus, 9: qualityStatus, 10: warehouseStatus },
        packs,
        kpis: {
          packsPerH,
          oeePct,
          traysMade: packagingSnapshot.traysMade,
          palletsMade: packagingSnapshot.palletsMade,
          batchesOnHold: onHold.length,
          batchesReleased: quality.released,
          batchesBlocked: quality.blocked,
          palletsInStock: warehouse.palletsInStock,
          daysOfCover: warehouse.daysOfCover(),
          orderFillPct: warehouse.orderFillPct(),
          trucksShipped: warehouse.trucksShipped,
        },
      };
    },
  };
}
