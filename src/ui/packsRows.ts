import { formatSscc, ssccFor, type FillerSnapshot, type PackLaneSnapshot, type PacksSnapshot, type WarehouseSnapshot } from '../contracts';
import { formatDuration, formatNumber, NO_VALUE } from './format';
import type { StateText } from './liquidRows';

/**
 * A filler's state in words, and its lamp (plan 08): green while it runs, red while it is broken down (the
 * fault table's "filler lamp red"), amber while it re-sterilizes after the repair or stands at rate 0, and
 * unlit while the aseptic tank has no product for it.
 */
export function fillerText(filler: FillerSnapshot | undefined): StateText {
  if (!filler) return { text: NO_VALUE, status: 'idle' };
  const left = filler.stateRemainingS > 0 ? ` · ${formatDuration(filler.stateRemainingS)} left` : '';
  switch (filler.state) {
    case 'running':
      return { text: `Running · batch ${filler.batchId}`, status: 'ok' };
    case 'starved':
      return { text: 'Waiting for product · tank low', status: 'idle' };
    case 'stopped':
      return { text: 'Stopped · rate set to 0', status: 'warn' };
    case 'repair':
      return { text: `Broken down · repair${left}`, status: 'bad' };
    case 'cleaning':
      return { text: `Re-sterilizing${left}`, status: 'warn' };
    default:
      return { text: NO_VALUE, status: 'idle' };
  }
}

/** A tray packer lane: running, standing for the batch change, catching up with what queued, or idle. */
export function packerText(lane: PackLaneSnapshot | undefined): StateText {
  if (!lane) return { text: NO_VALUE, status: 'idle' };
  switch (lane.packerState) {
    case 'running':
      return { text: 'Running', status: 'ok' };
    case 'changeover':
      return { text: `Batch change · ${formatDuration(lane.changeoverRemainingS)} left`, status: 'warn' };
    case 'catchUp':
      return { text: `Catching up · ${formatNumber(lane.queuePacks)} packs waiting`, status: 'ok' };
    case 'idle':
      return { text: 'Idle · no packs coming', status: 'idle' };
    default:
      return { text: NO_VALUE, status: 'idle' };
  }
}

/** The pallet a lane is building: "37 of 84 trays · batch 54". */
export function palletText(lane: PackLaneSnapshot | undefined, traysPerPallet: number): StateText {
  if (!lane) return { text: NO_VALUE, status: 'idle' };
  const of = traysPerPallet > 0 ? ` of ${formatNumber(traysPerPallet)}` : '';
  return { text: `${formatNumber(lane.palletTrays)}${of} trays · batch ${lane.batchId}`, status: lane.palletTrays > 0 ? 'ok' : 'idle' };
}

/** The newest pallet's label code: "(00) 3 0614141 000054012 6", and which pallet it is. */
export function lastPalletText(packs: Pick<PacksSnapshot, 'packaging'>): StateText {
  const pallet = packs.packaging.lastPallet;
  if (!pallet) return { text: 'None yet', status: 'idle' };
  try {
    return { text: `${formatSscc(ssccFor(pallet.batchId, pallet.palletNo))} · batch ${pallet.batchId}, pallet ${pallet.palletNo}`, status: 'ok' };
  } catch {
    return { text: NO_VALUE, status: 'idle' };
  }
}

/** The next pick, first-expired-first-out: "Batch 3 · 41 pallets"; the stock list gives its best-before date. */
export function nextPickText(warehouse: Pick<WarehouseSnapshot, 'stock'>): StateText {
  const first = warehouse.stock[0];
  if (!first) return { text: 'No stock released', status: 'warn' };
  return { text: `Batch ${first.batchId} · ${formatNumber(first.pallets)} pallets`, status: 'ok' };
}

/**
 * The dock: the first truck there loading or waiting, and how many more wait; a truck waiting for stock is
 * amber (stage 10's lamp, D2). Door numbers count from 1, as on the dock.
 */
export function dockText(warehouse: Pick<WarehouseSnapshot, 'trucks'>): StateText {
  const [first, ...rest] = warehouse.trucks;
  if (!first) return { text: 'No truck at the dock', status: 'idle' };
  const more = rest.length > 0 ? ` · ${rest.length} more` : '';
  const where = first.door >= 0 ? `at door ${first.door + 1}` : 'in the yard';
  if (first.state === 'loading') return { text: `Truck ${first.id} loading ${where} · ${formatDuration(first.remainingS)} left${more}`, status: 'ok' };
  return { text: `Truck ${first.id} waiting ${where} for stock${more}`, status: 'warn' };
}
