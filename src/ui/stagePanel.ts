import type { Snapshot, StageId, StageInfo, Status, ZoneId } from '../contracts';
import { el, setText, STATUS_TEXT } from './dom';
import { formatValue } from './format';

export interface StagePanel {
  /** Shows a stage's name, description and value rows, filled from the snapshot if there is one yet. */
  show(stage: StageId, snapshot: Snapshot | null): void;
  /** Refreshes the shown stage's status and live values. */
  update(snapshot: Snapshot): void;
  dispose(): void;
}

/** Zone names as the floor plan has them (plan 05; the 3D view labels the zones the same way). */
const ZONE_NAMES: Readonly<Record<ZoneId, string>> = {
  silo: 'Silo yard & mixing',
  process: 'UHT process hall',
  aseptic: 'Aseptic tank',
  filling: 'Filling hall',
  packaging: 'Packaging hall',
  quarantine: 'Quarantine & QA lab',
  warehouse: 'Warehouse & dispatch',
};

const EMPTY_TITLE = 'Select a stage';
const EMPTY_HINT = 'Pick a stage from the list, or click a machine in the 3D view, to see what it does and its live values.';

/** Shown until the first selection; app.css styles <kbd>. */
const HOW_TO: readonly (readonly (string | { key: string })[])[] = [
  [{ key: 'Space' }, ' pauses and resumes the clock.'],
  [{ key: '1' }, '–', { key: '5' }, ' set the speed, ×1 to ×10,000.'],
  [{ key: '↑' }, ' ', { key: '↓' }, ' move along the stage list.'],
  ['Drag to orbit, scroll to zoom, click a machine to select it.'],
];

/**
 * The info panel (#panel): "Select a stage" and a short how-to until something is selected,
 * then that stage's name, zone, status, description (stages.json) and one row per live value,
 * formatted with the value's scale, decimals and unit.
 */
export function createStagePanel(panel: HTMLElement, stages: readonly StageInfo[]): StagePanel {
  const infos = new Map(stages.map((info) => [info.id, info]));
  const original = [...panel.childNodes];

  const head = el('div', 'p-head');
  const number = el('span', 'p-no');
  number.setAttribute('aria-hidden', 'true'); // the subtitle says "Stage 3" in words
  const titles = el('div', 'p-titles');
  const title = el('h2', '', EMPTY_TITLE);
  title.dataset.testid = 'panel-title';
  const subtitle = el('p', 'p-sub');
  const chip = el('span', 'chip');
  const chipLamp = el('span', 'lamp');
  chipLamp.setAttribute('aria-hidden', 'true'); // the chip's text says the same
  const chipText = el('span');
  chip.append(chipLamp, chipText);
  titles.append(title, subtitle, chip);
  head.append(number, titles);

  const description = el('p', 'p-what', EMPTY_HINT);
  description.dataset.testid = 'panel-description';

  const live = el('section', 'p-live');
  const liveTitle = el('h3', 'eyebrow', 'Live values');
  liveTitle.id = 'panel-live-title';
  live.setAttribute('aria-labelledby', liveTitle.id);
  const rows = el('dl', 'vals');
  live.append(liveTitle, rows);

  const howTo = el('ul', 'how');
  howTo.setAttribute('aria-label', 'How to use');
  for (const line of HOW_TO) {
    const item = el('li');
    for (const part of line) item.append(typeof part === 'string' ? part : el('kbd', '', part.key));
    howTo.append(item);
  }

  panel.replaceChildren(head, description, live, howTo);

  let shown: StageInfo | null = null;
  let shownStatus: Status | null = null;
  // The value cell of each row of the shown stage, by value key.
  let cells = new Map<string, HTMLElement>();
  showEmpty();

  function showEmpty(): void {
    for (const node of [number, subtitle, chip, live]) node.hidden = true;
    howTo.hidden = false;
  }

  function update(snapshot: Snapshot): void {
    if (!shown) return;
    const stage = snapshot.stages[shown.id] as Snapshot['stages'][StageId] | undefined;
    const status = stage?.status ?? 'idle';
    if (status !== shownStatus) {
      shownStatus = status;
      chipLamp.dataset.status = status;
      setText(chipText, STATUS_TEXT[status]);
    }
    for (const info of shown.values) {
      const cell = cells.get(info.key);
      if (cell) setText(cell, formatValue(stage?.values[info.key], info));
    }
  }

  return {
    show(stage, snapshot) {
      const info = infos.get(stage);
      if (!info) return;
      if (info !== shown) {
        shown = info;
        shownStatus = null;
        number.textContent = String(info.id);
        title.textContent = info.name;
        subtitle.textContent = `Stage ${info.id} · ${ZONE_NAMES[info.zone]}`;
        description.textContent = info.description;
        cells = new Map();
        rows.replaceChildren(
          ...info.values.map((value) => {
            const row = el('div', 'val');
            row.dataset.valueKey = value.key;
            const cell = el('dd', '', '—');
            cells.set(value.key, cell);
            // The space keeps "Flow 16,000 L/h" apart in the row's text; the grid ignores it.
            row.append(el('dt', '', value.label), ' ', cell);
            return row;
          }),
        );
        for (const node of [number, subtitle, chip, live]) node.hidden = false;
        live.hidden = info.values.length === 0;
        howTo.hidden = true;
        chipLamp.dataset.status = 'idle';
        chipText.textContent = STATUS_TEXT.idle;
      }
      // A new selection starts at the top of the panel, even for the stage already shown.
      panel.scrollTop = 0;
      if (snapshot) update(snapshot);
    },
    update,
    dispose() {
      panel.replaceChildren(...original);
    },
  };
}
