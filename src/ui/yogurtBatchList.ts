// Stage 16's yogurt batch list (phase 19), beside the milk's (stage 9): each P8 batch with pallets in the cold chain,
// oldest first, where its pallets stand and when the first is released. It reads the snapshot's pallets; a batch whose
// pallets have all left by reefer drops off the list.
import type { ColdChainSnapshot, Snapshot, YogurtPallet } from '../contracts';
import { el, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import type { PanelPart } from './stagePanel';
import { coldChainOf } from './coldChainRows';
import { productName } from './yogurtRows';

export interface YogurtBatchRow {
  code: string;
  product: YogurtPallet['product'];
  cups: number;
  places: Record<YogurtPallet['place'], number>;
  /** The first of its pallets on hold in the cold room to be released; null if none is on hold. */
  releaseS: number | null;
  released: number;
}

/** The cold chain's pallets grouped by batch, oldest batch first (by code: day, then shift). */
export function yogurtBatchRows(chain: ColdChainSnapshot | undefined): YogurtBatchRow[] {
  const rows = new Map<string, YogurtBatchRow>();
  for (const pallet of chain?.pallets ?? []) {
    let row = rows.get(pallet.batch);
    if (!row) {
      row = { code: pallet.batch, product: pallet.product, cups: 0, places: { staging: 0, warmRoom: 0, chiller: 0, coldRoom: 0, reefer: 0 }, releaseS: null, released: 0 };
      rows.set(pallet.batch, row);
    }
    row.cups += pallet.cups;
    row.places[pallet.place] += 1;
    if (pallet.released) row.released += 1;
    else if (pallet.place === 'coldRoom' && pallet.holdUntilS !== null) row.releaseS = row.releaseS === null ? pallet.holdUntilS : Math.min(row.releaseS, pallet.holdUntilS);
  }
  return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
}

const PLACE_WORDS: readonly [YogurtPallet['place'], string][] = [
  ['staging', 'waiting'],
  ['warmRoom', 'warm room'],
  ['chiller', 'chiller'],
  ['coldRoom', 'cold room'],
  ['reefer', 'on a reefer'],
];

/** Where a batch's pallets stand, in words: "12 cold room · 4 chiller". */
export function batchPlacesText(row: YogurtBatchRow): string {
  return PLACE_WORDS.filter(([place]) => row.places[place] > 0)
    .map(([place, words]) => `${formatNumber(row.places[place])} ${words}`)
    .join(' · ');
}

/** When it is released: "released, 8 pallets", "first out in 3 h 10 min", or "setting and chilling". */
export function batchReleaseText(row: YogurtBatchRow, timeS: number): string {
  if (row.released > 0) return `${formatNumber(row.released)} released`;
  if (row.releaseS !== null) return `first out in ${formatDuration(Math.max(0, row.releaseS - timeS))}`;
  return 'not yet in the cold room';
}

export function createYogurtBatchList(host: HTMLElement): PanelPart {
  const box = el('section', 'batches yogurt-batches');
  box.dataset.testid = 'yogurt-batch-list';
  const title = el('h3', 'eyebrow', 'Yogurt batches in the cold chain');
  title.id = 'yogurt-batch-list-title';
  const list = el('ul', 'batch-rows');
  list.setAttribute('aria-labelledby', title.id);
  box.append(title, list);
  host.append(box);
  let shown = '';
  return {
    update(snapshot: Snapshot) {
      const rows = yogurtBatchRows(coldChainOf(snapshot));
      const lines = rows.map((row) => ({
        code: row.code,
        head: `${row.code} · ${productName(row.product).toLowerCase()} · ${formatNumber(row.cups)} cups`,
        detail: `${batchPlacesText(row)} · ${batchReleaseText(row, snapshot.timeS)}`,
      }));
      const key = JSON.stringify(lines);
      if (key === shown) return;
      shown = key;
      if (lines.length === 0) {
        list.replaceChildren(el('li', 'batch-hint', 'No yogurt pallets in the cold chain'));
        return;
      }
      list.replaceChildren(
        ...lines.map((line) => {
          const item = el('li', 'yogurt-batch');
          item.dataset.batch = line.code;
          const head = el('span', 'yogurt-batch-head');
          setText(head, line.head);
          const detail = el('span', 'batch-hint');
          setText(detail, line.detail);
          item.append(head, detail);
          return item;
        }),
      );
    },
    dispose() {
      box.remove();
    },
  };
}
