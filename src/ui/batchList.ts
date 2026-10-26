import { formatSscc, ssccFor, type BatchSnapshot, type BatchStatus, type Command, type Snapshot, type Status } from '../contracts';
import { createLamp, el, onPress, setAttr, setLamp, setText } from './dom';
import { formatDay, formatLongDuration, formatNumber, formatSimTime } from './format';
import type { PanelPart } from './stagePanel';

/** A batch's lamp, in the plan 08 colours: green while it fills, amber on hold, red once blocked. */
export const BATCH_LAMP: Readonly<Record<BatchStatus, Status>> = { filling: 'ok', hold: 'warn', released: 'ok', blocked: 'bad' };

export const BATCH_STATUS_TEXT: Readonly<Record<BatchStatus, string>> = {
  filling: 'Filling',
  hold: 'On hold',
  released: 'Released',
  blocked: 'Blocked',
};

/** What happens to a batch next, and when: "releases in 6 d 23 h", "closes in 5 h 20 min", "destroyed in 20 h". */
export function batchDueText(batch: Pick<BatchSnapshot, 'status' | 'endS' | 'releaseAtS'>, nowS: number): string {
  switch (batch.status) {
    case 'filling':
      return `closes in ${formatLongDuration(batch.endS - nowS)}`;
    case 'hold':
      return `releases in ${formatLongDuration(batch.releaseAtS - nowS)}`;
    case 'blocked':
      return batch.releaseAtS > nowS ? `destroyed in ${formatLongDuration(batch.releaseAtS - nowS)}` : 'blocked';
    default:
      return '';
  }
}

/** One pallet of a batch as its label lists it: number, SSCC and packs; the last of a closed batch may be part-full (D1). */
export interface PalletLine {
  palletNo: number;
  sscc: string;
  packs: number;
}

export function palletLines(batch: Pick<BatchSnapshot, 'id' | 'pallets' | 'lastPalletPacks'>, packsPerPallet: number): PalletLine[] {
  return Array.from({ length: batch.pallets }, (_, i) => ({
    palletNo: i + 1,
    sscc: formatSscc(ssccFor(batch.id, i + 1)),
    packs: i + 1 === batch.pallets ? batch.lastPalletPacks : packsPerPallet,
  }));
}

export interface BatchListOptions {
  /** The batch picked last (the view bus's selectBatch), or null. */
  selected(): number | null;
  /** A batch row was clicked: puts selectBatch on the view bus. */
  onSelect(batchId: number): void;
  dispatch(command: Command): void;
}

interface Row {
  button: HTMLButtonElement;
  lamp: HTMLSpanElement;
  pallets: HTMLElement;
  due: HTMLElement;
  /** The status and pallet count the row was built with. */
  key: string;
}

/**
 * Stage 9's batch list (plan 08: "the batch list with status and release countdown"): every batch in
 * quarantine, oldest first, each a button with its lamp, filler, pallets and what is due next. A click
 * selects it, as a click on its block in the 3D view does, and the batch then shows below the list: its
 * shift, best-before date, samples and QA result, its pallets with their SSCCs, and the QA override
 * (setQaResult): a failed sample blocks the batch at once, a pass releases it when incubation ends.
 */
export function createBatchList(host: HTMLElement, options: BatchListOptions): PanelPart {
  const listeners = new AbortController();
  const { signal } = listeners;
  const box = el('section', 'batches');
  box.dataset.testid = 'batch-list';
  const title = el('h3', 'eyebrow', 'Batches in quarantine');
  title.id = 'batch-list-title';
  box.setAttribute('aria-labelledby', title.id);
  const list = el('ol', 'batch-rows');
  const detail = el('div', 'batch-detail');
  detail.dataset.testid = 'batch-detail';
  box.append(title, list, detail);
  host.append(box);

  const rows = new Map<number, Row>();
  let shownDetail: string | null = null;

  function row(batch: BatchSnapshot): Row {
    const button = el('button', 'batch-row');
    button.type = 'button';
    button.dataset.batchId = String(batch.id);
    const lamp = createLamp(BATCH_LAMP[batch.status]);
    const pallets = el('span', 'b-pallets');
    const due = el('span', 'b-due');
    button.append(lamp, ' ', el('span', 'b-name', `Batch ${batch.id} · ${batch.filler}`), ' ', pallets, ' ', due);
    onPress(button, () => options.onSelect(batch.id), signal);
    const item = el('li');
    item.append(button);
    list.append(item);
    return { button, lamp, pallets, due, key: '' };
  }

  function updateRows(snapshot: Snapshot): void {
    const batches = snapshot.packs?.batches ?? [];
    const ids = new Set(batches.map((batch) => batch.id));
    for (const [id, existing] of rows) {
      if (ids.has(id)) continue;
      existing.button.parentElement?.remove();
      rows.delete(id);
    }
    // Batches only join at the end (a new shift) and leave from anywhere, so appending keeps the order.
    const selected = options.selected();
    for (const batch of batches) {
      const existing = rows.get(batch.id) ?? row(batch);
      rows.set(batch.id, existing);
      setLamp(existing.lamp, BATCH_LAMP[batch.status]);
      setText(existing.pallets, `${formatNumber(batch.pallets)} pallets`);
      setText(existing.due, batchDueText(batch, snapshot.timeS));
      setAttr(existing.button, 'aria-pressed', batch.id === selected ? 'true' : 'false');
      setAttr(existing.button, 'title', `${BATCH_STATUS_TEXT[batch.status]}: batch ${batch.id}, filler ${batch.filler}`);
    }
  }

  function qaButton(label: string, batchId: number, result: 'pass' | 'fail'): HTMLButtonElement {
    const button = el('button', 'btn qa-button', label);
    button.type = 'button';
    button.dataset.result = result;
    onPress(button, () => options.dispatch({ type: 'setQaResult', batchId, result }), signal);
    return button;
  }

  function updateDetail(snapshot: Snapshot): void {
    const id = options.selected();
    const batch = snapshot.packs?.batches.find((each) => each.id === id);
    const packsPerPallet = snapshot.stages[8]?.values.packsPerPallet ?? 0;
    // Rebuilt only when what it lists changes; the countdown in it is the only text that moves.
    const key = batch ? `${batch.id}|${batch.status}|${batch.pallets}|${batch.lastPalletPacks}|${batch.samples}|${batch.qaResult}` : `none|${id}`;
    if (key !== shownDetail) {
      shownDetail = key;
      if (!batch) {
        detail.replaceChildren(
          el('p', 'batch-hint', id === null ? 'Pick a batch, here or on its block in the 3D view, to see its pallets.' : `Batch ${id} is no longer in quarantine.`),
        );
      } else {
        const head = el('div', 'batch-head');
        const lamp = createLamp(BATCH_LAMP[batch.status]);
        head.append(lamp, el('strong', '', `Batch ${batch.id} · filler ${batch.filler}`), el('span', 'b-status', BATCH_STATUS_TEXT[batch.status]));
        const facts = el('dl', 'vals batch-facts');
        const fact = (label: string, value: string, testid?: string) => {
          const item = el('div', 'val');
          const cell = el('dd', '', value);
          if (testid) cell.dataset.testid = testid;
          item.append(el('dt', '', label), ' ', cell);
          facts.append(item);
          return cell;
        };
        fact('Shift', `${formatSimTime(batch.startS)} – ${formatSimTime(batch.endS).replace(/^day \d+ · /, '')}`);
        fact('Best before', formatDay(batch.bestBeforeS));
        fact('Samples', formatNumber(batch.samples));
        fact('QA result', batch.qaResult === 'pending' ? 'Pending incubation' : batch.qaResult === 'pass' ? 'Passed (override)' : 'Failed');
        // A blocked batch's releaseAtS is when its pallets leave for destruction; the list row counts it down.
        fact(batch.status === 'blocked' ? 'Destruction' : 'Release', formatSimTime(batch.releaseAtS), 'batch-due');
        const parts: HTMLElement[] = [head, facts];
        if (batch.status === 'filling' || batch.status === 'hold') {
          const qa = el('div', 'qa-override');
          qa.setAttribute('role', 'group');
          qa.setAttribute('aria-label', `QA override for batch ${batch.id}`);
          qa.append(qaButton('Sample passed', batch.id, 'pass'), qaButton('Sample failed', batch.id, 'fail'));
          parts.push(qa);
        }
        const pallets = el('ol', 'pallet-rows');
        pallets.setAttribute('aria-label', `Pallets of batch ${batch.id}`);
        const lines = palletLines(batch, packsPerPallet);
        for (const line of lines) {
          const item = el('li');
          item.append(el('span', 'p-no-small', String(line.palletNo)), ' ', el('span', 'sscc', line.sscc));
          pallets.append(item);
        }
        if (batch.pallets === 0) pallets.append(el('li', 'batch-hint', 'No pallet closed yet.'));
        // Every pallet but the last holds a full load; a closed batch's last is part-full (D1).
        const last = lines.at(-1);
        const packsNote =
          last && last.packs < packsPerPallet
            ? `${formatNumber(packsPerPallet)} packs each, the last ${formatNumber(last.packs)}`
            : `${formatNumber(packsPerPallet)} packs each`;
        parts.push(el('h4', 'eyebrow', `Pallets · ${formatNumber(batch.pallets)}`));
        if (last) parts.push(el('p', 'batch-hint', packsNote));
        parts.push(pallets);
        detail.replaceChildren(...parts);
      }
    }
  }

  return {
    update(snapshot) {
      updateRows(snapshot);
      updateDetail(snapshot);
    },
    dispose() {
      listeners.abort();
      box.remove();
    },
  };
}
