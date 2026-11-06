import type { Snapshot, StageId } from '../contracts';
import { STATE_ROWS as LIQUID_STATE_ROWS, type StateRow, type StateText } from './liquidRows';
import { dockText, fillerText, lastPalletText, lastSsccText, nextPickText, packerText, palletText } from './packsRows';
import {
  p8BatchText,
  p8FillText,
  p8HepaText,
  p8HygieneText,
  p8MagazinesText,
  p8Of,
  p8RejectsText,
  p8SealTestText,
  p8SealText,
  p8StateText,
} from './p8Rows';
import {
  bufferProductText,
  changeoverText,
  heatCleaningText,
  heatModeText,
  nextProductText,
  productText,
  setWaitText,
  steamText,
  tankText,
} from './yogurtRows';

/** A state row of the info panel, read from the whole snapshot. */
export interface PanelStateRow {
  key: string;
  label: string;
  read(snapshot: Snapshot): StateText;
}

const fromLiquid = (rows: readonly StateRow[] | undefined): PanelStateRow[] =>
  (rows ?? []).map(({ key, label, read }) => ({ key, label, read: (snapshot) => read(snapshot.liquid) }));

const NAMES = ['A', 'B'] as const;

/**
 * The aseptic tank's sterile-air filter (contracts v4): failed while a filter scenario acts on the plant,
 * the deviation that turns the tank amber; intact otherwise.
 */
export function sterileAirText(snapshot: Pick<Snapshot, 'scenarios'>): StateText {
  const failed = snapshot.scenarios?.runs.some((run) => run.id === 'sterileAirFilterFailure' && run.endedS === null);
  return failed ? { text: 'Filter failed · deviation, batches held', status: 'bad' } : { text: 'Filter intact', status: 'ok' };
}
const traysPerPallet = (snapshot: Snapshot): number => snapshot.stages[8]?.values.traysPerPallet ?? 0;

/** The yogurt part of a snapshot, or undefined for an older one. */
const yogurtOf = (snapshot: Snapshot) => (snapshot as Partial<Snapshot>).yogurt;

/** The yogurt line's three fermentation tanks, numbered from 1 as the stage's values are. */
const TANK_NUMBERS = [1, 2, 3] as const;

/**
 * Every stage's state rows above its values: the liquid line's (liquidRows.ts), the tank's sterile air (v4) and, from contracts v3, each
 * filler's state (stage 7), each tray packer lane and the pallet it builds, with the newest pallet's SSCC
 * (stage 8), and the next pick and the dock (stage 10). Stage 9 lists its batches in a panel part instead
 * (batchList.ts). The plant has two fillers, A and B; a missing one reads "—".
 *
 * The yogurt line's (phase 17, yogurtRows.ts): the product and the next shift's (stage 11), the heat treatment's mode,
 * its clean and its steam (12), each fermentation tank (13), and the buffer's product, changeover and set-mix wait (14);
 * and Line P8's (phase 18, p8Rows.ts): what it does, its batch, the last fill, the rejects, the seal, the HEPA cabin,
 * the SIP and swab, the next seal test and the magazines (15).
 */
export const PANEL_STATE_ROWS: Readonly<Partial<Record<StageId, readonly PanelStateRow[]>>> = {
  4: fromLiquid(LIQUID_STATE_ROWS[4]),
  6: [...fromLiquid(LIQUID_STATE_ROWS[6]), { key: 'sterileAir', label: 'Sterile air', read: sterileAirText }],
  7: NAMES.map((name, index) => ({ key: `filler${name}`, label: `Filler ${name}`, read: (snapshot) => fillerText(snapshot.packs?.fillers[index]) })),
  8: [
    ...NAMES.map((name, index) => ({ key: `packer${name}`, label: `Tray packer, line ${name}`, read: (snapshot: Snapshot) => packerText(snapshot.packs?.packaging.lanes[index]) })),
    ...NAMES.map((name, index) => ({
      key: `pallet${name}`,
      label: `Pallet on line ${name}`,
      read: (snapshot: Snapshot) => palletText(snapshot.packs?.packaging.lanes[index], traysPerPallet(snapshot)),
    })),
    { key: 'lastPallet', label: 'Newest pallet', read: (snapshot) => (snapshot.packs ? lastPalletText(snapshot.packs) : { text: '—', status: 'idle' }) },
    { key: 'lastSscc', label: 'Its SSCC', read: (snapshot) => (snapshot.packs ? lastSsccText(snapshot.packs) : { text: '—', status: 'idle' }) },
  ],
  10: [
    { key: 'nextPick', label: 'Next pick', read: (snapshot) => (snapshot.packs ? nextPickText(snapshot.packs.warehouse) : { text: '—', status: 'idle' }) },
    { key: 'dock', label: 'Dock', read: (snapshot) => (snapshot.packs ? dockText(snapshot.packs.warehouse) : { text: '—', status: 'idle' }) },
  ],
  11: [
    { key: 'product', label: 'Product', read: (snapshot) => productText(yogurtOf(snapshot)) },
    { key: 'nextProduct', label: 'Next shift', read: (snapshot) => nextProductText(yogurtOf(snapshot)) },
  ],
  12: [
    { key: 'heatMode', label: 'Mode', read: (snapshot) => heatModeText(yogurtOf(snapshot)) },
    { key: 'heatCleaning', label: 'Cleaning step', read: (snapshot) => heatCleaningText(yogurtOf(snapshot)) },
    { key: 'steam', label: 'Steam', read: (snapshot) => steamText(yogurtOf(snapshot)) },
  ],
  13: TANK_NUMBERS.map((n) => ({
    key: `tank${n}`,
    label: `Tank ${n}`,
    read: (snapshot: Snapshot) => tankText(yogurtOf(snapshot)?.ferment.tanks[n - 1], snapshot.timeS),
  })),
  14: [
    { key: 'bufferProduct', label: 'In the buffer', read: (snapshot) => bufferProductText(yogurtOf(snapshot)) },
    { key: 'changeover', label: 'Changeover', read: (snapshot) => changeoverText(yogurtOf(snapshot)) },
    { key: 'setWait', label: 'Set mix waited', read: (snapshot) => setWaitText(yogurtOf(snapshot)) },
  ],
  15: [
    { key: 'p8State', label: 'Line P8', read: (snapshot) => p8StateText(p8Of(snapshot)) },
    { key: 'p8Batch', label: 'Batch', read: (snapshot) => p8BatchText(p8Of(snapshot)) },
    { key: 'p8Fill', label: 'Last fill', read: (snapshot) => p8FillText(p8Of(snapshot)) },
    { key: 'p8Rejects', label: 'Rejects', read: (snapshot) => p8RejectsText(p8Of(snapshot)) },
    { key: 'p8Seal', label: 'Seal', read: (snapshot) => p8SealText(p8Of(snapshot)) },
    { key: 'p8Hepa', label: 'HEPA cabin', read: (snapshot) => p8HepaText(p8Of(snapshot)) },
    { key: 'p8Hygiene', label: 'SIP and swab', read: (snapshot) => p8HygieneText(p8Of(snapshot)) },
    { key: 'p8SealTest', label: 'Next seal test', read: (snapshot) => p8SealTestText(p8Of(snapshot), snapshot.timeS) },
    { key: 'p8Magazines', label: 'Magazines', read: (snapshot) => p8MagazinesText(p8Of(snapshot)) },
  ],
};
