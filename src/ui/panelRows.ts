import type { Snapshot, StageId } from '../contracts';
import { STATE_ROWS as LIQUID_STATE_ROWS, type StateRow, type StateText } from './liquidRows';
import { dockText, fillerText, lastPalletText, lastSsccText, nextPickText, packerText, palletText } from './packsRows';

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

/**
 * Every stage's state rows above its values: the liquid line's (liquidRows.ts), the tank's sterile air (v4) and, from contracts v3, each
 * filler's state (stage 7), each tray packer lane and the pallet it builds, with the newest pallet's SSCC
 * (stage 8), and the next pick and the dock (stage 10). Stage 9 lists its batches in a panel part instead
 * (batchList.ts). The plant has two fillers, A and B; a missing one reads "—".
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
};
