import { ZONE_NAMES, type Snapshot, type StageId, type StageInfo, type Status } from '../contracts';
import { el, setText, STATUS_TEXT } from './dom';
import { formatValue } from './format';
import { DERIVED_ROWS, type DerivedRow } from './liquidRows';
import { PANEL_STATE_ROWS, type PanelStateRow } from './panelRows';

export interface StagePanel {
  /** The stage shown, or null for the whole plant. */
  readonly stage: StageId | null;
  /** Shows a stage's name, description and value rows, filled from the snapshot if there is one yet. */
  show(stage: StageId, snapshot: Snapshot | null): void;
  /** Back to "Select a stage" and the how-to, as before the first selection (the whole plant). */
  clear(): void;
  /** Refreshes the shown stage's status and live values. */
  update(snapshot: Snapshot): void;
  dispose(): void;
}

/** Something the panel shows for one stage below its live values, such as a trend chart or a set-point slider. */
export interface PanelPart {
  update(snapshot: Snapshot): void;
  /** Removes what the part added, and its listeners; the panel calls it when it shows another stage. */
  dispose(): void;
}

/** Builds a stage's parts into `host`, in the order they should appear; none for most stages. */
export type PanelParts = (stage: StageId, host: HTMLElement) => PanelPart[];

const EMPTY_TITLE = 'Select a stage';
const EMPTY_HINT = 'Pick a stage from the list, or click a machine in the 3D view, to see what it does and its live values.';

/** Shown until the first selection; app.css styles <kbd>. */
const HOW_TO: readonly (readonly (string | { key: string })[])[] = [
  [{ key: 'Space' }, ' pauses and resumes the clock.'],
  [{ key: '1' }, '–', { key: '5' }, ' set the speed, ×1 to ×10,000.'],
  [{ key: '↑' }, ' ', { key: '↓' }, ' move along the stage list.'],
  [{ key: 'Esc' }, ' or Whole plant goes back to the overview.'],
  ['Drag to orbit, scroll to zoom, click a machine to select it.'],
];

interface StateCell {
  row: PanelStateRow;
  lamp: HTMLElement;
  text: HTMLElement;
}

/**
 * The info panel (#panel): "Select a stage" and a short how-to until something is selected,
 * then that stage's name, zone, status, description (stages.json) and its live values: first the
 * states in words where they belong (the UHT mode, the throttle, the fillers, the packers, the dock; panelRows.ts),
 * then one row per value, formatted with the value's scale, decimals and unit, with any value the panel
 * works out itself (the margin over the divert limit) after the row it follows; then the stage's parts.
 *
 * Only the stages.json rows carry data-value-key; the state rows carry data-state-key and the worked-out
 * ones data-derived-key.
 */
export function createStagePanel(panel: HTMLElement, stages: readonly StageInfo[], parts: PanelParts = () => []): StagePanel {
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

  // Charts and sliders; empty, and so taking no room, for a stage without any.
  const tools = el('div', 'p-tools');

  const howTo = el('ul', 'how');
  howTo.setAttribute('aria-label', 'How to use');
  for (const line of HOW_TO) {
    const item = el('li');
    for (const part of line) item.append(typeof part === 'string' ? part : el('kbd', '', part.key));
    howTo.append(item);
  }

  panel.replaceChildren(head, description, live, tools, howTo);

  let shown: StageInfo | null = null;
  let shownStatus: Status | null = null;
  // The value cell of each row of the shown stage, by value key; the state and worked-out rows likewise.
  let cells = new Map<string, HTMLElement>();
  let stateCells: StateCell[] = [];
  let derivedCells: { row: DerivedRow; cell: HTMLElement }[] = [];
  let shownParts: PanelPart[] = [];
  showEmpty();

  function dropParts(): void {
    for (const part of shownParts) part.dispose();
    shownParts = [];
    tools.replaceChildren();
  }

  function showEmpty(): void {
    shown = null;
    shownStatus = null;
    dropParts();
    title.textContent = EMPTY_TITLE;
    description.textContent = EMPTY_HINT;
    for (const node of [number, subtitle, chip, live, tools]) node.hidden = true;
    howTo.hidden = false;
    panel.scrollTop = 0;
  }

  function valueRow(key: string, label: string, keyAttribute: 'valueKey' | 'derivedKey'): { row: HTMLElement; cell: HTMLElement } {
    const row = el('div', 'val');
    row.dataset[keyAttribute] = key;
    const cell = el('dd', '', '—');
    // The space keeps "Flow 16,000 L/h" apart in the row's text; the grid ignores it.
    row.append(el('dt', '', label), ' ', cell);
    return { row, cell };
  }

  function buildRows(info: StageInfo): HTMLElement[] {
    cells = new Map();
    stateCells = [];
    derivedCells = [];
    const built: HTMLElement[] = [];
    for (const state of PANEL_STATE_ROWS[info.id] ?? []) {
      const row = el('div', 'val val-state');
      row.dataset.stateKey = state.key;
      const lamp = el('span', 'lamp');
      lamp.dataset.status = 'idle';
      lamp.setAttribute('aria-hidden', 'true'); // the words say the same
      const text = el('span', '', '—');
      const cell = el('dd');
      cell.append(lamp, text);
      row.append(el('dt', '', state.label), ' ', cell);
      stateCells.push({ row: state, lamp, text });
      built.push(row);
    }
    const derived = DERIVED_ROWS[info.id] ?? [];
    for (const value of info.values) {
      const { row, cell } = valueRow(value.key, value.label, 'valueKey');
      cells.set(value.key, cell);
      built.push(row);
      for (const extra of derived.filter((candidate) => candidate.after === value.key)) {
        const worked = valueRow(extra.key, extra.label, 'derivedKey');
        derivedCells.push({ row: extra, cell: worked.cell });
        built.push(worked.row);
      }
    }
    return built;
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
    const values = stage?.values ?? {};
    for (const { row, cell } of derivedCells) setText(cell, row.read(values));
    for (const { row, lamp, text } of stateCells) {
      const state = row.read(snapshot);
      if (lamp.dataset.status !== state.status) lamp.dataset.status = state.status;
      setText(text, state.text);
    }
    for (const part of shownParts) part.update(snapshot);
  }

  return {
    get stage() {
      return shown?.id ?? null;
    },
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
        rows.replaceChildren(...buildRows(info));
        for (const node of [number, subtitle, chip, live]) node.hidden = false;
        live.hidden = rows.childElementCount === 0;
        howTo.hidden = true;
        chipLamp.dataset.status = 'idle';
        chipText.textContent = STATUS_TEXT.idle;
        // The old stage's charts are destroyed before the new stage's are built.
        dropParts();
        // On show while they are built, so a chart measures its box at once.
        tools.hidden = false;
        shownParts = parts(info.id, tools);
        tools.hidden = shownParts.length === 0;
      }
      // A new selection starts at the top of the panel, even for the stage already shown.
      panel.scrollTop = 0;
      if (snapshot) update(snapshot);
    },
    clear: showEmpty,
    update,
    dispose() {
      dropParts();
      panel.replaceChildren(...original);
    },
  };
}
