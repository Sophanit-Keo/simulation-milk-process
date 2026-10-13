import type { Snapshot, StageId, StageInfo } from '../contracts';
import { createLamp, el, setLamp } from './dom';

export interface StageRail {
  /** Marks the selected stage (aria-current) and makes it the rail's tab stop. */
  select(stage: StageId): void;
  /** Lamps from the snapshot's stage statuses. */
  update(snapshot: Snapshot): void;
  dispose(): void;
}

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft']);

/**
 * The stage rail: one button per stage, in stage order, each with its status lamp. A click
 * calls `onPick`, which puts selectStage on the view bus; the mark follows the bus, not the
 * click, so a selection from the 3D view moves it too.
 *
 * Keyboard: the rail is one tab stop (roving tabindex). Up and down (left and right in the
 * narrow one-row layout) move along it, Home and End jump to the ends, and the selection
 * follows the focus, like tabs that activate on focus: the panel and the camera keep up.
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
  const items = stages.map((info) => {
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
  });
  list.replaceChildren(...items);
  // Before any selection the first stage is the tab stop.
  const first = stages[0];
  if (first) setTabStop(first.id);

  const order = stages.map((info) => info.id);
  let selected: StageId | null = null;

  list.addEventListener(
    'click',
    (event) => {
      const stage = stageOf(event.target);
      if (stage !== null) onPick(stage);
    },
    { signal },
  );

  list.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const from = stageOf(event.target);
      if (from === null) return;
      const at = order.indexOf(from);
      let to: number;
      if (NEXT_KEYS.has(event.key)) to = Math.min(at + 1, order.length - 1);
      else if (PREVIOUS_KEYS.has(event.key)) to = Math.max(at - 1, 0);
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = order.length - 1;
      else return;
      // Also stops the arrow from scrolling the rail or the page.
      event.preventDefault();
      const stage = order[to];
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
      if (stage !== selected) {
        if (selected !== null) buttons.get(selected)?.removeAttribute('aria-current');
        button.setAttribute('aria-current', 'true');
        selected = stage;
        setTabStop(stage);
      }
      revealInRail(button, [list, rail]);
    },
    update(snapshot) {
      for (const [id, lamp] of lamps) {
        const status = snapshot.stages[id]?.status;
        if (status) setLamp(lamp, status);
      }
    },
    dispose() {
      list.replaceChildren(...original);
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
