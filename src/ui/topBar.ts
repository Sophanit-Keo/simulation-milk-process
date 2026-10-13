import { SPEEDS, type Command, type Snapshot, type Speed } from '../contracts';
import { el, setAttr, setText } from './dom';
import { formatSimTime, formatSpeed } from './format';

/** The keyboard shortcut of each speed preset: 1 for ×1 up to 5 for ×10,000 (see hud.ts). */
export const speedKey = (speed: Speed): string => String(SPEEDS.indexOf(speed) + 1);

export interface TopBar {
  update(snapshot: Snapshot): void;
  /** What the pause button and the Space key do. */
  togglePause(): void;
  /** What a speed button and the keys 1–5 do. */
  pickSpeed(speed: Speed): void;
  dispose(): void;
}

/**
 * The top bar's controls, after the brand: the sim clock and run state, pause, the five speed
 * presets, next event and the scenario menu (disabled until phase 5). Every button sends a
 * Command; the bar then shows what the snapshot says, so it can never disagree with the sim.
 */
export function createTopBar(bar: HTMLElement, dispatch: (command: Command) => void, signal: AbortSignal): TopBar {
  const time = el('div', 'sim-time');
  time.setAttribute('role', 'group');
  time.setAttribute('aria-label', 'Simulation time');

  // The <time> element is only created by the first update, so whoever reads
  // data-testid="sim-clock" (the e2e smoke test) never sees it without a time.
  const clockBox = el('div', 'clock', '—');
  let clock: HTMLTimeElement | null = null;

  // Both words sit in the same grid cell and only one is visible, so the chip keeps the width
  // of the longer one and nothing in the bar moves when the clock pauses.
  const run = el('span', 'run');
  run.dataset.state = 'running';
  const runLamp = el('span', 'lamp');
  runLamp.dataset.status = 'idle';
  runLamp.setAttribute('aria-hidden', 'true');
  const runState = el('span', 'run-state');
  runState.append(el('span', 'when-running', 'Running'), el('span', 'when-paused', 'Paused'));
  run.append(runLamp, runState);
  run.hidden = true;
  time.append(clockBox, run);

  const controls = el('div', 'seg');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Clock controls');

  // A toggle button keeps its label; aria-pressed (and the filled style) says it is paused.
  const pause = button('Pause', 'pause', 'Pause or resume the sim clock (Space)');
  pause.classList.add('btn-pause');
  pause.setAttribute('aria-pressed', 'false');
  pause.setAttribute('aria-keyshortcuts', 'Space');
  onPress(pause, () => togglePause(), signal);
  controls.append(pause);

  const speedButtons = new Map<Speed, HTMLButtonElement>();
  for (const speed of SPEEDS) {
    const key = speedKey(speed);
    const what = speed === 1 ? 'real time' : `${formatSpeed(speed)} real time`;
    const speedButton = button(formatSpeed(speed), `speed-${speed}`, `Run at ${what} (key ${key})`);
    speedButton.setAttribute('aria-pressed', 'false');
    speedButton.setAttribute('aria-keyshortcuts', key);
    onPress(speedButton, () => pickSpeed(speed), signal);
    speedButtons.set(speed, speedButton);
    controls.append(speedButton);
  }

  const nextEvent = button('Next event', 'next-event', 'Jump the clock to the next event');
  onPress(nextEvent, () => dispatch({ type: 'nextEvent' }), signal);

  // Present so the bar has its final shape; the fault scenarios behind it arrive in phase 5.
  const scenarios = button('Scenarios', 'scenario-menu', 'Fault scenarios arrive in phase 5');
  scenarios.classList.add('btn-menu');
  scenarios.disabled = true;
  scenarios.setAttribute('aria-haspopup', 'menu');

  bar.append(time, controls, nextEvent, scenarios);

  // What the bar shows now, so a 4 Hz update only touches the DOM when something changed.
  let shownS: number | null = null;
  let shownPaused: boolean | null = null;
  let shownSpeed: Speed | null = null;
  let shownNextS: number | null | undefined;

  function showPaused(paused: boolean): void {
    if (paused === shownPaused) return;
    shownPaused = paused;
    pause.setAttribute('aria-pressed', String(paused));
    run.dataset.state = paused ? 'paused' : 'running';
    // Amber for paused, as for anything on hold (plan 08 colour rules).
    runLamp.dataset.status = paused ? 'warn' : 'ok';
  }

  function showSpeed(speed: Speed): void {
    if (speed === shownSpeed) return;
    shownSpeed = speed;
    for (const [preset, speedButton] of speedButtons) speedButton.setAttribute('aria-pressed', String(preset === speed));
  }

  // Clicks show their result at once rather than at the next HUD update (up to 250 ms later).
  // That is safe: the frame loop runs the command before the next snapshot, so no update can undo it.
  function togglePause(): void {
    const paused = !(shownPaused ?? false);
    dispatch({ type: 'pause', paused });
    showPaused(paused);
  }

  function pickSpeed(speed: Speed): void {
    dispatch({ type: 'setSpeed', speed });
    showSpeed(speed);
  }

  return {
    update(snapshot) {
      const wholeS = Math.floor(snapshot.timeS);
      if (!clock) {
        clock = el('time');
        clock.dataset.testid = 'sim-clock';
        clockBox.replaceChildren(clock);
        run.hidden = false;
      }
      if (wholeS !== shownS) {
        shownS = wholeS;
        clock.dataset.timeS = String(wholeS);
        // Machine-readable form: a duration since day 1, 00:00.
        if (wholeS >= 0) clock.dateTime = `PT${wholeS}S`;
        setText(clock, formatSimTime(wholeS));
      }
      showPaused(snapshot.paused);
      showSpeed(snapshot.speed);
      if (snapshot.nextEventS !== shownNextS) {
        shownNextS = snapshot.nextEventS;
        nextEvent.disabled = shownNextS === null;
        setAttr(
          nextEvent,
          'title',
          shownNextS === null ? 'No events queued' : `Jump the clock to the next event, ${formatSimTime(shownNextS)}`,
        );
      }
    },
    togglePause,
    pickSpeed,
    dispose() {
      // Listeners go with the AbortSignal the HUD aborts; this removes what the bar added.
      for (const node of [time, controls, nextEvent, scenarios]) node.remove();
    },
  };
}

/**
 * Runs `action` on a click. After a mouse click the button hands focus back to the page, so
 * Space then pauses (hud.ts) instead of pressing the same button again; a keyboard press
 * (detail 0) keeps focus where the user put it.
 */
function onPress(node: HTMLButtonElement, action: () => void, signal: AbortSignal): void {
  node.addEventListener(
    'click',
    (event) => {
      action();
      if (event.detail > 0) node.blur();
    },
    { signal },
  );
}

function button(label: string, testId: string, title: string): HTMLButtonElement {
  const node = el('button', 'btn', label);
  node.type = 'button';
  node.dataset.testid = testId;
  node.title = title;
  return node;
}
