import { LINE_IDS, LINE_NAMES, lineOfStage, type LineId, type Snapshot, type StageId, type StageInfo, type Status } from '../contracts';
import { createLamp, el, setLamp } from './dom';

export interface StageRail {
  /** Marks the selected stage (aria-current) and makes it the rail's tab stop. */
  select(stage: StageId): void;
  /** No stage selected (the whole plant): no aria-current; the last stage stays the tab stop. */
  clear(): void;
  /** Lamps from the snapshot's stage statuses. */
  update(snapshot: Snapshot): void;
  /**
   * True for the rail button a mouse click focused, until focus moves on. Space then pauses the
   * clock (hud.ts), as after a click in the top bar, rather than pressing the stage again.
   */
  clickFocused(target: Element | null): boolean;
  /**
   * The header row of a line's group, where a control of that line can sit beside the fold button (phase 21: the
   * yogurt tour); null when the rail shows one line, ungrouped.
   */
  groupHead(line: LineId): HTMLElement | null;
  dispose(): void;
}

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft']);

const STATUS_RANK: Readonly<Record<Status, number>> = { idle: 0, ok: 1, warn: 2, bad: 3 };

/**
 * The stage rail: one button per stage, in stage order, each with its status lamp. A click
 * calls `onPick`, which puts selectStage on the view bus; the mark follows the bus, not the
 * click, so a selection from the 3D view moves it too.
 *
 * With stages of both lines (phase 16) the rail groups them under "UHT milk" and "Yogurt P8". Each group's
 * header folds it and carries a lamp for its worst stage, so a folded group still shows a fault; a stage
 * selected inside a folded group unfolds it. Where the rail cannot show every stage (1280 × 720), the groups
 * work as an accordion, so the rail never scrolls: it keeps the selected stage's group open (the UHT line's
 * before any selection) and folds the other, and opening a group folds the other.
 *
 * Keyboard: the stages are one tab stop (roving tabindex), the group headers a tab stop each. Up and down
 * (left and right in the narrow one-row layout) move along the stages shown, Home and End jump to the ends,
 * and the selection follows the focus, like tabs that activate on focus: the panel and the camera keep up.
 */
export function createStageRail(
  rail: HTMLElement,
  stages: readonly StageInfo[],
  onPick: (stage: StageId) => void,
  signal: AbortSignal,
): StageRail {
  // index.html holds the list; build one if it is missing, so the rail never depends on the markup.
  const list = rail.querySelector<HTMLOListElement>('ol.stages') ?? rail.appendChild(el('ol', 'stages'));
  const original = [...list.childNodes];

  const buttons = new Map<StageId, HTMLButtonElement>();
  const lamps = new Map<StageId, HTMLSpanElement>();
  const makeItem = (info: StageInfo): HTMLLIElement => {
    const button = el('button', 'stage');
    button.type = 'button';
    button.dataset.testid = `rail-stage-${info.id}`;
    button.dataset.stage = String(info.id);
    button.title = info.name;
    button.tabIndex = -1;
    const lamp = createLamp('idle');
    // Number and name first in the DOM, so the button reads "1 Standardization Running";
    // app.css draws the lamp on the left. The grid ignores the spaces; they keep the words apart in the text.
    button.append(el('span', 'n', String(info.id)), ' ', el('span', 'name', info.shortName), ' ', lamp);
    buttons.set(info.id, button);
    lamps.set(info.id, lamp);
    const item = el('li');
    item.append(button);
    return item;
  };

  // One group per line the stages come from; a single line keeps the flat list of phases 2–15.
  const lineIds = LINE_IDS.filter((line) => stages.some((info) => lineOfStage(info.id) === line));
  const groups = new Map<LineId, { item: HTMLLIElement; head: HTMLDivElement; toggle: HTMLButtonElement; body: HTMLOListElement; lamp: HTMLSpanElement; stages: StageId[] }>();
  if (lineIds.length > 1) {
    list.replaceChildren(
      ...lineIds.map((line) => {
        const own = stages.filter((info) => lineOfStage(info.id) === line);
        const item = el('li', 'stage-group');
        item.dataset.line = line;
        const toggle = el('button', 'group-toggle');
        toggle.type = 'button';
        toggle.dataset.testid = `rail-group-${line}`;
        toggle.setAttribute('aria-expanded', 'true');
        const bodyId = `rail-group-${line}-stages`;
        toggle.setAttribute('aria-controls', bodyId);
        const first = own[0]?.id;
        const last = own[own.length - 1]?.id;
        const lamp = createLamp('idle');
        toggle.title = `${LINE_NAMES[line]}: show or hide stages ${first}–${last}`;
        toggle.append(el('span', 'chevron'), ' ', el('span', 'group-name', LINE_NAMES[line]), ' ', el('span', 'group-range', `${first}–${last}`), ' ', lamp);
        const body = el('ol', 'group-stages');
        body.id = bodyId;
        body.append(...own.map(makeItem));
        // The fold button fills the header row; a line's own control can follow it there (groupHead).
        const head = el('div', 'group-head');
        head.append(toggle);
        item.append(head, body);
        groups.set(line, { item, head, toggle, body, lamp, stages: own.map((info) => info.id) });
        return item;
      }),
    );
  } else {
    list.replaceChildren(...stages.map(makeItem));
  }
  const setFolded = (line: LineId, folded: boolean): void => {
    const group = groups.get(line);
    if (!group) return;
    group.toggle.setAttribute('aria-expanded', String(!folded));
    group.body.hidden = folded;
    group.item.classList.toggle('folded', folded);
  };
  const isShown = (stage: StageId): boolean => !groups.get(lineOfStage(stage))?.body.hidden;
  if (groups.size > 1) list.classList.add('grouped');
  /** Folds every group but `keep` while the rail overflows; it never opens one. */
  const fit = (keep: LineId): void => {
    if (groups.size < 2 || rail.scrollHeight <= rail.clientHeight + 0.5) return;
    for (const line of groups.keys()) if (line !== keep) setFolded(line, true);
  };
  const keepLine = (): LineId => lineOfStage(selected ?? stages[0]?.id ?? 1);
  // Before any selection the first stage is the tab stop.
  const first = stages[0];
  if (first) setTabStop(first.id);

  const order = stages.map((info) => info.id);
  let selected: StageId | null = null;
  // Before any selection, and whenever the rail's size or its content's changes (the window, the fonts loading),
  // the groups are fitted to the room there is.
  fit(keepLine());
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit(keepLine()));
  resize?.observe(rail);
  resize?.observe(list);
  // Unlike the top bar's buttons, a rail button keeps focus after a mouse click, so the arrow keys
  // go on from it; this remembers that the mouse, not the keyboard, put focus there.
  let clicked: HTMLButtonElement | null = null;

  list.addEventListener(
    'click',
    (event) => {
      const toggle = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button.group-toggle') : null;
      if (toggle && list.contains(toggle)) {
        const line = toggle.closest<HTMLElement>('.stage-group')?.dataset.line as LineId | undefined;
        if (!line) return;
        const opening = toggle.getAttribute('aria-expanded') !== 'true';
        setFolded(line, !opening);
        // Opened where the rail has no room for both: the other folds.
        if (opening) fit(line);
        return;
      }
      const stage = stageOf(event.target);
      if (stage === null) return;
      clicked = event.detail > 0 ? (buttons.get(stage) ?? null) : null;
      onPick(stage);
    },
    { signal },
  );

  list.addEventListener(
    'focusout',
    (event) => {
      // Still the document's focus: only the window lost it, and it comes back to the same button.
      if (event.target === list.ownerDocument.activeElement) return;
      clicked = null;
    },
    { signal },
  );

  list.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const from = stageOf(event.target);
      if (from === null) return;
      // Only the stages shown: a folded group's are skipped.
      const shown = order.filter(isShown);
      const at = shown.indexOf(from);
      let to: number;
      if (NEXT_KEYS.has(event.key)) to = Math.min(at + 1, shown.length - 1);
      else if (PREVIOUS_KEYS.has(event.key)) to = Math.max(at - 1, 0);
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = shown.length - 1;
      else return;
      // Also stops the arrow from scrolling the rail or the page.
      event.preventDefault();
      const stage = shown[to];
      if (stage === undefined || to === at) return;
      buttons.get(stage)?.focus();
      onPick(stage);
    },
    { signal },
  );

  function stageOf(target: EventTarget | null): StageId | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>('button.stage');
    if (!button || !list.contains(button)) return null;
    const stage = Number(button.dataset.stage) as StageId;
    return buttons.has(stage) ? stage : null;
  }

  function setTabStop(stage: StageId): void {
    for (const [id, button] of buttons) button.tabIndex = id === stage ? 0 : -1;
  }

  return {
    select(stage) {
      const button = buttons.get(stage);
      if (!button) return;
      // A stage picked in the 3D view or by the tour inside a folded group: the group opens, so its mark shows,
      // and where the rail has no room for both, the other folds.
      if (!isShown(stage)) setFolded(lineOfStage(stage), false);
      fit(lineOfStage(stage));
      if (stage !== selected) {
        if (selected !== null) buttons.get(selected)?.removeAttribute('aria-current');
        button.setAttribute('aria-current', 'true');
        selected = stage;
        setTabStop(stage);
      }
      revealInRail(button, [list, rail]);
    },
    clear() {
      if (selected === null) return;
      buttons.get(selected)?.removeAttribute('aria-current');
      selected = null;
    },
    update(snapshot) {
      for (const [id, lamp] of lamps) {
        const status = snapshot.stages[id]?.status;
        if (status) setLamp(lamp, status);
      }
      // Each group's header lamp shows its worst stage.
      for (const group of groups.values()) {
        let worst: Status = 'idle';
        for (const id of group.stages) {
          const status = snapshot.stages[id]?.status;
          if (status && STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
        }
        setLamp(group.lamp, worst);
      }
    },
    clickFocused(target) {
      return target !== null && target === clicked;
    },
    groupHead: (line) => groups.get(line)?.head ?? null,
    dispose() {
      resize?.disconnect();
      list.replaceChildren(...original);
      list.classList.remove('grouped');
    },
  };
}

/**
 * Scrolls whichever of the rail's containers scrolls (the rail itself on wide screens, the
 * one-row list on narrow ones) so the button shows. Not scrollIntoView: that would also
 * scroll the page on narrow screens, pulling the 3D view away after a click in it.
 */
function revealInRail(button: HTMLElement, containers: readonly HTMLElement[]): void {
  for (const box of containers) {
    const outer = box.getBoundingClientRect();
    const inner = button.getBoundingClientRect();
    if (box.scrollHeight > box.clientHeight) {
      if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top;
      else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
    }
    if (box.scrollWidth > box.clientWidth) {
      if (inner.left < outer.left) box.scrollLeft -= outer.left - inner.left;
      else if (inner.right > outer.right) box.scrollLeft += inner.right - outer.right;
    }
  }
}
