// Stage 8: from packs to labelled pallets (plan 04). Each pack line has its own lane through the tray
// packer and its own pallet at the palletizer, since a pallet carries one batch and a batch is one filler's
// shift (D1). Packs queue on the conveyor and the accumulation table; the tray packer packs 12 to a tray and
// the palletizer stacks 84 trays to a pallet. At each shift change the old batch's last tray and pallet close
// part-full and the packer stops for the batch change (packaging.batchChangeS), while the new batch's packs
// queue; then it runs up to 30% over its rated speed (catchUpFrac, D9) until the queue is clear.
//
// Counts are whole packs. The packer's capacity in a cut carries its fraction over, like a filler's packs.
import { sToH, type PackagingSnapshot, type PackerState, type PackLaneSnapshot, type PalletRef, type PlantConfig } from '../../contracts';
import type { QueuedEvent } from '../eventQueue';
import { TIME_EPS_S, wholeUnits, type Scheduler } from './types';

export const PACKAGING_EVENTS = { changeoverDone: 'changeoverDone' } as const;

/** One lane's state. Read-only outside this file. */
export interface PackLane {
  readonly index: number;
  readonly name: string;
  /** The batch of the pallet being built. */
  batchId: number;
  /** Packs waiting for the tray packer. */
  queuePacks: number;
  /** Packs in the open tray, trays and packs on the open pallet. */
  trayPacks: number;
  palletTrays: number;
  palletPacks: number;
  /** The packer stands for a batch change until this time. */
  changeoverUntilS: number;
  /** The fraction of a pack the packer could still have packed in the last cut (at most one). */
  capacityPacks: number;
  /** Whether its filler ran during the last cut, sending packs. */
  fed: boolean;
}

export interface PackagingHooks {
  /** A pallet of `packs` packs closed for the lane's batch at atS; returns its number within the batch. */
  onPallet(batchId: number, packs: number, atS: number): number;
}

export interface Packaging {
  readonly lanes: readonly PackLane[];
  readonly traysMade: number;
  readonly palletsMade: number;
  readonly lastPallet: PalletRef | null;
  /** One cut of dtS ending at endS: `packsIn` good packs arrive at lane `index` from its filler, and its packer packs what it can. */
  run(index: number, dtS: number, endS: number, packsIn: number, fillerRunning: boolean): void;
  /** At a shift change: packs the lane's waiting packs and closes the old batch's last tray and pallet, part-full (D1). */
  closeBatch(index: number, atS: number): void;
  /** Then the lane builds pallets of the new batch, after the packer's batch change. */
  startBatch(index: number, atS: number, batchId: number): void;
  onEvent(event: QueuedEvent): boolean;
  packerState(lane: PackLane, nowS: number): PackerState;
  snapshot(nowS: number, packsSampled: number): PackagingSnapshot;
}

export function createPackaging(config: PlantConfig, names: readonly string[], firstBatchIds: readonly number[], scheduler: Scheduler, hooks: PackagingHooks): Packaging {
  const { packsPerTray, traysPerPallet, catchUpFrac, batchChangeS } = config.packaging;
  // The packer is rated for the filler's machine maximum, and catches up at up to catchUpFrac over that.
  const catchUpPacksPerH = config.fillers.maxRatePacksPerH * (1 + catchUpFrac);
  const lanes: PackLane[] = names.map((name, index) => ({
    index,
    name,
    batchId: firstBatchIds[index] ?? 0,
    queuePacks: 0,
    trayPacks: 0,
    palletTrays: 0,
    palletPacks: 0,
    changeoverUntilS: -Infinity,
    capacityPacks: 0,
    // The plant opens running (D8): the fillers send packs from the first step.
    fed: true,
  }));
  let traysMade = 0;
  let palletsMade = 0;
  let lastPallet: PalletRef | null = null;
  let changeover: QueuedEvent | null = null;

  function closePallet(lane: PackLane, atS: number): void {
    const palletNo = hooks.onPallet(lane.batchId, lane.palletPacks, atS);
    palletsMade += 1;
    lastPallet = { batchId: lane.batchId, palletNo, atS };
    lane.palletTrays = 0;
    lane.palletPacks = 0;
  }

  function closeTray(lane: PackLane, packs: number, atS: number): void {
    traysMade += 1;
    lane.palletTrays += 1;
    lane.palletPacks += packs;
    if (lane.palletTrays >= traysPerPallet) closePallet(lane, atS);
  }

  function pack(lane: PackLane, packs: number, atS: number): void {
    lane.trayPacks += packs;
    while (lane.trayPacks >= packsPerTray) {
      lane.trayPacks -= packsPerTray;
      closeTray(lane, packsPerTray, atS);
    }
  }

  const inChangeover = (lane: PackLane, atS: number): boolean => atS < lane.changeoverUntilS - TIME_EPS_S;

  function packerState(lane: PackLane, nowS: number): PackerState {
    if (inChangeover(lane, nowS)) return 'changeover';
    // More than a tray's worth waiting means the packer is clearing a queue, not keeping pace.
    if (lane.queuePacks > packsPerTray) return 'catchUp';
    return lane.fed || lane.queuePacks > 0 ? 'running' : 'idle';
  }

  return {
    lanes,
    get traysMade() {
      return traysMade;
    },
    get palletsMade() {
      return palletsMade;
    },
    get lastPallet() {
      return lastPallet;
    },
    run(index, dtS, endS, packsIn, fillerRunning) {
      const lane = lanes[index];
      if (!lane) return;
      lane.fed = fillerRunning;
      if (!(dtS > 0)) return;
      lane.queuePacks += packsIn;
      // A changeover ends on a queued event, so a cut lies wholly inside one or wholly after it.
      if (inChangeover(lane, endS - dtS)) return;
      lane.capacityPacks += catchUpPacksPerH * sToH(dtS);
      const packed = Math.min(lane.queuePacks, wholeUnits(lane.capacityPacks));
      // Capacity the queue could not use is lost, so an idle packer can't save up for a burst.
      lane.capacityPacks = Math.min(1, Math.max(0, lane.capacityPacks - packed));
      lane.queuePacks -= packed;
      pack(lane, packed, endS);
    },
    closeBatch(index, atS) {
      const lane = lanes[index];
      if (!lane) return;
      // The old batch's packs still waiting go into its trays now; a tray and a pallet never mix two batches.
      pack(lane, lane.queuePacks, atS);
      lane.queuePacks = 0;
      if (lane.trayPacks > 0) {
        const packs = lane.trayPacks;
        lane.trayPacks = 0;
        closeTray(lane, packs, atS);
      }
      if (lane.palletTrays > 0) closePallet(lane, atS);
    },
    startBatch(index, atS, batchId) {
      const lane = lanes[index];
      if (!lane) return;
      lane.batchId = batchId;
      if (batchChangeS > 0) {
        lane.changeoverUntilS = atS + batchChangeS;
        // One event ends every lane's changeover: they all start at the same shift change.
        if (!changeover || changeover.timeS !== lane.changeoverUntilS) {
          changeover = scheduler.schedule(lane.changeoverUntilS, PACKAGING_EVENTS.changeoverDone, null);
        }
      }
    },
    onEvent(event) {
      if (event.type !== PACKAGING_EVENTS.changeoverDone) return false;
      if (event.seq === changeover?.seq) changeover = null;
      return true;
    },
    packerState,
    snapshot(nowS, packsSampled) {
      const laneSnapshots: PackLaneSnapshot[] = lanes.map((lane) => ({
        name: lane.name,
        packerState: packerState(lane, nowS),
        changeoverRemainingS: inChangeover(lane, nowS) ? lane.changeoverUntilS - nowS : 0,
        queuePacks: lane.queuePacks,
        trayPacks: lane.trayPacks,
        palletTrays: lane.palletTrays,
        batchId: lane.batchId,
      }));
      return { lanes: laneSnapshots, traysMade, palletsMade, packsSampled, lastPallet: lastPallet && { ...lastPallet } };
    },
  };
}
