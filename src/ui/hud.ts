import { SPEEDS, type Command, type Hud, type Snapshot, type StageInfo, type ViewBus } from '../contracts';
import { createKpiStrip } from './kpiStrip';
import { createStagePanel } from './stagePanel';
import { createStageRail } from './stageRail';
import { createTopBar, speedKey } from './topBar';

/** Focus in one of these keeps Space for itself: it presses a button, types a space, opens a select. */
const SPACE_TAKERS = 'button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"])';
/** Focus in one of these keeps digits for itself. */
const TEXT_TAKERS = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * The one-screen HUD (plan 08) in the app root of index.html: the top bar (#bar), the stage
 * rail (#rail), the info panel (#panel) and the KPI strip (#kpis).
 *
 * The bar's buttons and keys send Commands through `dispatch`. Stage selection runs only
 * through the view bus: a rail click emits selectStage, and the rail and the panel follow every
 * selectStage on the bus, whether it came from the rail or from a click in the 3D view, and
 * every overview event, which clears the selection.
 *
 * Keys, anywhere on the page: Space pauses and resumes (unless focus is on a button or a form
 * control, which use Space themselves); 1–5 pick the speeds ×1 to ×10,000; Escape goes back to
 * the whole plant (the overview event, like the rail's "Whole plant"); arrows move along the
 * rail while it has focus.
 */
export function createHud(root: HTMLElement, dispatch: (command: Command) => void, bus: ViewBus, stages: readonly StageInfo[]): Hud {
  const part = (selector: string): HTMLElement => {
    const node = root.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`createHud needs a ${selector} element inside the app root (see index.html)`);
    return node;
  };
  const barRoot = part('#bar');
  const railRoot = part('#rail');
  const panelRoot = part('#panel');
  const kpiRoot = part('#kpis');

  // Every DOM listener the HUD adds takes this signal, so dispose() removes them all at once.
  const listeners = new AbortController();
  const { signal } = listeners;

  const bar = createTopBar(barRoot, dispatch, signal);
  const rail = createStageRail(railRoot, stages, (stage) => bus.emit({ type: 'selectStage', stage }), signal);
  const panel = createStagePanel(panelRoot, stages);
  const kpis = createKpiStrip(kpiRoot);

  let lastSnapshot: Snapshot | null = null;

  const stopListening = bus.on((event) => {
    if (event.type === 'selectStage') {
      rail.select(event.stage);
      panel.show(event.stage, lastSnapshot);
    } else if (event.type === 'overview') {
      rail.clear();
      panel.clear();
    }
  });

  // index.html's "Whole plant" link in the rail head, as in the preview.
  railRoot
    .querySelector('[data-testid="overview"]')
    ?.addEventListener('click', () => bus.emit({ type: 'overview' }), { signal });

  const doc = root.ownerDocument;
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === 'Escape') {
        if (!target?.closest(TEXT_TAKERS)) bus.emit({ type: 'overview' });
        return;
      }
      if (event.key === ' ') {
        if (target?.closest(SPACE_TAKERS)) return;
        event.preventDefault(); // no page scroll on narrow screens
        if (!event.repeat) bar.togglePause(); // holding Space must not flicker the clock
        return;
      }
      const speed = SPEEDS.find((preset) => speedKey(preset) === event.key);
      if (speed !== undefined && !target?.closest(TEXT_TAKERS)) {
        event.preventDefault();
        bar.pickSpeed(speed);
      }
    },
    { signal },
  );

  return {
    update(snapshot: Snapshot) {
      lastSnapshot = snapshot;
      bar.update(snapshot);
      rail.update(snapshot);
      panel.update(snapshot);
      kpis.update(snapshot);
    },
    dispose() {
      listeners.abort();
      stopListening();
      bar.dispose();
      rail.dispose();
      panel.dispose();
      kpis.dispose();
    },
  };
}
