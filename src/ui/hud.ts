import { SPEEDS, type Command, type Hud, type SetpointKey, type Snapshot, type StageInfo, type ViewBus } from '../contracts';
import { createAbout } from './about';
import { createBatchList } from './batchList';
import { el, onPress } from './dom';
import { createEventLog } from './eventLog';
import { createKpiStrip } from './kpiStrip';
import { createPipeLegend } from './pipeLegend';
import { createScenarioLog } from './scenarioLog';
import { createScenarioMenu } from './scenarioMenu';
import { createSetpointSlider, SETPOINT_SLIDERS } from './setpointSlider';
import { createStagePanel, type PanelPart } from './stagePanel';
import { createStageRail } from './stageRail';
import { createStockList } from './stockList';
import { createTopBar, speedKey } from './topBar';
import { createTour } from './tour';
import { createTrendChart, TREND_CHARTS } from './trendChart';
import { createTrendHistory } from './trends';

export interface HudOptions {
  /** The set points the sim starts from (plant.json), for a slider whose stage reports no set point of its own. */
  setpoints?: Partial<Record<SetpointKey, number>>;
  /** A slider's top where plant.json sets it: the filler rate's machine maximum. */
  setpointMax?: Partial<Record<SetpointKey, number>>;
}

/** The HUD, plus the way into the sim it uses, for other controls (the ?debug panel) to share. */
export interface MainHud extends Hud {
  /** Sends a command as the HUD's own controls do, so the HUD knows of every set point sent. */
  dispatch(command: Command): void;
  /** The last value sent for each set point, from plant.json's on. */
  sentSetpoints(): Partial<Record<SetpointKey, number>>;
}

/**
 * Focus in one of these keeps Space for itself: it presses a button, types a space, opens a select.
 * Not a rail button the mouse clicked (stageRail.ts): the other buttons hand focus back after a click.
 */
const SPACE_TAKERS = 'button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"])';
/** Focus in one of these keeps digits and Escape for itself; a range slider takes neither. */
const TEXT_TAKERS = 'input:not([type="range"]), select, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * The one-screen HUD (plan 08) in the app root of index.html: the top bar (#bar), the stage
 * rail (#rail), the event log (#log), the info panel (#panel) and the KPI strip (#kpis).
 *
 * The bar's buttons and keys, and the panel's set-point sliders, send Commands through `dispatch`.
 * The trends record the snapshot on every update, whichever stage is shown, so a chart opened later
 * already has the last few sim hours. Stage selection runs only
 * through the view bus: a rail click emits selectStage, and the rail and the panel follow every
 * selectStage on the bus, whether it came from the rail or from a click in the 3D view, and
 * every overview event, which clears the selection.
 *
 * Keys, anywhere on the page: Space pauses and resumes (unless the keyboard put focus on a button
 * or a form control, which use Space themselves; after a mouse click Space stays the clock's);
 * 1–5 pick the speeds ×1 to ×10,000; Escape goes back to the whole plant (the overview event,
 * like the rail's "Whole plant"); arrows move along the rail while it has focus.
 */
export function createHud(
  root: HTMLElement,
  dispatch: (command: Command) => void,
  bus: ViewBus,
  stages: readonly StageInfo[],
  options: HudOptions = {},
): MainHud {
  const part = (selector: string): HTMLElement => {
    const node = root.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`createHud needs a ${selector} element inside the app root (see index.html)`);
    return node;
  };
  const barRoot = part('#bar');
  const viewRoot = part('.view');
  const railRoot = part('#rail');
  const logRoot = part('#log');
  const panelRoot = part('#panel');
  const kpiRoot = part('#kpis');

  // Every DOM listener the HUD adds takes this signal, so dispose() removes them all at once.
  const listeners = new AbortController();
  const { signal } = listeners;

  // The last value sent for each set point, from plant.json on: shown by a slider whose stage doesn't report it.
  const sentSetpoints: Partial<Record<SetpointKey, number>> = { ...options.setpoints };
  const send = (command: Command): void => {
    if (command.type === 'setSetpoint') sentSetpoints[command.key] = command.value;
    dispatch(command);
  };

  // The batch picked last, from the batch list or a block in the 3D view (selectBatch on the bus).
  let selectedBatch: number | null = null;

  const history = createTrendHistory();
  const panelParts = (stage: StageInfo['id'], host: HTMLElement): PanelPart[] => {
    const built: PanelPart[] = [];
    const chart = TREND_CHARTS[stage];
    if (chart) built.push(createTrendChart(host, stage, chart, history));
    const spec = SETPOINT_SLIDERS[stage];
    if (spec) {
      const max = options.setpointMax?.[spec.key];
      const slider = max !== undefined && max > spec.min ? { ...spec, max } : spec;
      built.push(createSetpointSlider(host, stage, slider, send, () => sentSetpoints[slider.key]));
    }
    if (stage === 9) {
      built.push(createBatchList(host, { selected: () => selectedBatch, onSelect: (batchId) => bus.emit({ type: 'selectBatch', batchId }), dispatch: send }));
    }
    if (stage === 10) built.push(createStockList(host));
    return built;
  };

  const bar = createTopBar(barRoot, send, signal);
  const scenarioLog = createScenarioLog(viewRoot, signal);
  const scenarioMenu = createScenarioMenu({
    dispatch: send,
    onStarted: (stage) => bus.emit({ type: 'selectStage', stage }),
    onOpenLog: () => scenarioLog.open(),
    signal,
  });
  barRoot.append(scenarioMenu.root);
  const about = createAbout(barRoot, signal);
  const rail = createStageRail(railRoot, stages, (stage) => bus.emit({ type: 'selectStage', stage }), signal);
  const log = createEventLog(logRoot);
  const panel = createStagePanel(panelRoot, stages, panelParts);
  const kpis = createKpiStrip(kpiRoot);
  const legend = createPipeLegend(viewRoot);

  let lastSnapshot: Snapshot | null = null;

  const stopListening = bus.on((event) => {
    if (event.type === 'selectStage') {
      rail.select(event.stage);
      panel.show(event.stage, lastSnapshot);
    } else if (event.type === 'overview') {
      rail.clear();
      panel.clear();
    } else if (event.type === 'selectBatch') {
      selectedBatch = event.batchId;
      // A batch lives in quarantine: its stage 9 panel lists it, picked, whichever stage was shown. A pick in
      // the list itself leaves the panel where it is scrolled to.
      if (panel.stage !== 9) {
        rail.select(9);
        panel.show(9, lastSnapshot);
      } else if (lastSnapshot) {
        panel.update(lastSnapshot);
      }
    }
  });

  // index.html's "Whole plant" link in the rail head, as in the preview. Like the top bar's
  // buttons, it hands focus back to the page after a mouse click, so Space then pauses.
  const overview = railRoot.querySelector<HTMLButtonElement>('button[data-testid="overview"]');
  if (overview) onPress(overview, () => bus.emit({ type: 'overview' }), signal);

  // The guided tour starts from the rail head too, before "Whole plant": it walks the rail's stages in order.
  const tourButton = el('button', 'link tour-open', 'Tour');
  tourButton.type = 'button';
  tourButton.dataset.testid = 'tour';
  tourButton.title = 'Guided tour: stages 1 to 10 with a caption each, about 3 minutes';
  tourButton.setAttribute('aria-pressed', 'false');
  if (overview) overview.before(tourButton);
  else railRoot.querySelector('.rail-head')?.append(tourButton);
  const tour = createTour({ bus, stages, view: viewRoot, button: tourButton, signal });

  const doc = root.ownerDocument;
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // An open dialog (About) keeps every key: Escape closes it, Space and digits do nothing to the sim.
      if (target?.closest('dialog[open]')) return;
      if (event.key === 'Escape') {
        if (!target?.closest(TEXT_TAKERS)) bus.emit({ type: 'overview' });
        return;
      }
      if (event.key === ' ') {
        if (target?.closest(SPACE_TAKERS) && !rail.clickFocused(target)) return;
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
      history.record(snapshot);
      bar.update(snapshot);
      scenarioMenu.update(snapshot);
      scenarioLog.update(snapshot);
      tour.update(performance.now());
      rail.update(snapshot);
      log.update(snapshot);
      panel.update(snapshot);
      kpis.update(snapshot);
      legend.update(snapshot);
    },
    dispatch: send,
    sentSetpoints: () => ({ ...sentSetpoints }),
    dispose() {
      listeners.abort();
      stopListening();
      bar.dispose();
      scenarioMenu.dispose();
      scenarioLog.dispose();
      tour.dispose();
      tourButton.remove();
      about.dispose();
      rail.dispose();
      log.dispose();
      panel.dispose();
      kpis.dispose();
      legend.dispose();
    },
  };
}
