// The guided tour (plan 08: "the camera visits stages 1–10 in order with a two-line caption each, about 3
// minutes in total"; phase 5). The tour selects each stage in turn through the view bus, as a rail click
// does, so the camera flies there and the panel follows; a caption over the 3D view shows the stage's two
// lines from src/data/stages.json. It runs on real time, paused sim or not, and stops on any other
// selection, on Escape (the overview event), when the viewer takes the camera (the scene's tour-off event),
// or from its own Stop button. At the end it goes back to the whole plant.
import type { StageId, StageInfo, ViewBus } from '../contracts';
import { el, onPress, setAttr, setText } from './dom';

/** Real seconds at each stage: 10 stops make the plan's 3 minutes. */
export const TOUR_STOP_S = 18;

/** Where the tour is `elapsedS` in: the stop's index, or `done` once the last stop is over. */
export function tourStop(elapsedS: number, stops: number): { index: number; done: boolean } {
  const index = Math.floor(Math.max(0, elapsedS) / TOUR_STOP_S);
  return index >= stops ? { index: stops - 1, done: true } : { index, done: false };
}

export interface Tour {
  readonly running: boolean;
  start(): void;
  stop(): void;
  /** Moves the tour on; nowMs is real time (performance.now()). */
  update(nowMs: number): void;
  dispose(): void;
}

export interface TourOptions {
  bus: ViewBus;
  stages: readonly StageInfo[];
  /** The 3D view's box, where the caption goes. */
  view: HTMLElement;
  /** The button that starts and stops it (the rail head's "Tour"). */
  button: HTMLButtonElement;
  signal: AbortSignal;
}

export function createTour(options: TourOptions): Tour {
  const { bus, stages, view, button, signal } = options;
  const caption = el('section', 'overlay overlay-tour');
  caption.dataset.testid = 'tour-caption';
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  caption.hidden = true;
  const step = el('p', 'tour-step');
  const lines = [el('p', 'tour-line'), el('p', 'tour-line')] as const;
  const progress = el('div', 'tour-progress');
  const bar = el('i');
  progress.append(bar);
  const stopButton = el('button', 'btn tour-stop', 'Stop tour');
  stopButton.type = 'button';
  stopButton.dataset.testid = 'tour-stop';
  caption.append(step, ...lines, progress, stopButton);
  view.append(caption);

  let startedMs: number | null = null;
  let shownIndex = -1;
  /** True while the tour itself emits, so its own selections don't stop it. */
  let emitting = false;

  function show(index: number): void {
    const stage = stages[index];
    if (!stage) return;
    shownIndex = index;
    emitting = true;
    bus.emit({ type: 'selectStage', stage: stage.id as StageId });
    emitting = false;
    setText(step, `Stage ${stage.id} of ${stages.length} · ${stage.name}`);
    setText(lines[0], stage.tourCaption[0]);
    setText(lines[1], stage.tourCaption[1]);
  }

  function finish(goHome: boolean): void {
    if (startedMs === null) return;
    startedMs = null;
    shownIndex = -1;
    caption.hidden = true;
    setAttr(button, 'aria-pressed', 'false');
    emitting = true;
    bus.emit({ type: 'tour', on: false });
    if (goHome) bus.emit({ type: 'overview' });
    emitting = false;
  }

  const tour: Tour = {
    get running() {
      return startedMs !== null;
    },
    start() {
      if (startedMs !== null || stages.length === 0) return;
      startedMs = performance.now();
      caption.hidden = false;
      setAttr(button, 'aria-pressed', 'true');
      emitting = true;
      bus.emit({ type: 'tour', on: true });
      emitting = false;
      show(0);
      bar.style.width = '0%';
    },
    stop: () => finish(false),
    update(nowMs) {
      if (startedMs === null) return;
      const elapsedS = (nowMs - startedMs) / 1_000;
      const { index, done } = tourStop(elapsedS, stages.length);
      if (done) return finish(true);
      if (index !== shownIndex) show(index);
      bar.style.width = `${Math.min(100, (100 * elapsedS) / (TOUR_STOP_S * stages.length)).toFixed(1)}%`;
    },
    dispose() {
      stopListening();
      caption.remove();
    },
  };

  // Anything else that moves the view ends the tour where it is: a rail or 3D click, Escape or "Whole plant",
  // the viewer taking the camera (the scene says tour off), a batch picked in quarantine.
  const stopListening = bus.on((event) => {
    if (emitting || startedMs === null) return;
    if (event.type === 'tour' ? !event.on : true) finish(false);
  });
  onPress(button, () => (startedMs === null ? tour.start() : tour.stop()), signal);
  onPress(stopButton, () => tour.stop(), signal);
  return tour;
}
