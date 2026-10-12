import type { Command, Hud, Snapshot, StageInfo, ViewBus } from '../contracts';
import { formatSimTime, formatSpeed } from './format';

/**
 * The HUD: for now the top bar's time readout (sim clock, speed, running or paused).
 * Phase 2 adds pause, the speed presets and next event, which send commands
 * through dispatch; the bar, rail, panel and KPI strip follow.
 */
export function createHud(
  root: HTMLElement,
  _dispatch: (command: Command) => void,
  _bus: ViewBus,
  _stages: readonly StageInfo[],
): Hud {
  const bar = root.querySelector<HTMLElement>('#bar');
  if (!bar) throw new Error('createHud needs a #bar element inside the app root (see index.html)');

  const group = el('div', 'sim-time');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Simulation time');

  // The <time> element is only created by the first update, so whoever reads
  // data-testid="sim-clock" (the e2e smoke test) never sees it without a time.
  const clockBox = el('div', 'clock');
  clockBox.textContent = '—';
  let clock: HTMLTimeElement | null = null;

  const run = el('span', 'run');
  const lamp = el('span', 'lamp');
  lamp.dataset.s = 'idle';
  const runState = el('span', 'run-state');
  const speed = el('span', 'speed');
  run.append(lamp, runState, speed);
  run.hidden = true;

  group.append(clockBox, run);
  bar.append(group);

  // Last values written, so a 4 Hz update only touches the DOM when something changed.
  let shownS: number | null = null;
  let shownPaused: boolean | null = null;
  let shownSpeed: number | null = null;

  return {
    update(snapshot: Snapshot) {
      const wholeS = Math.floor(snapshot.timeS);
      if (!clock) {
        clock = el('time', '');
        clock.dataset.testid = 'sim-clock';
        clockBox.replaceChildren(clock);
        run.hidden = false;
      }
      if (wholeS !== shownS) {
        shownS = wholeS;
        clock.dataset.timeS = String(wholeS);
        // Machine-readable form: a duration since day 1, 00:00.
        if (wholeS >= 0) clock.dateTime = `PT${wholeS}S`;
        const text = formatSimTime(wholeS);
        if (clock.textContent !== text) clock.textContent = text;
      }
      if (snapshot.paused !== shownPaused) {
        shownPaused = snapshot.paused;
        run.dataset.state = snapshot.paused ? 'paused' : 'running';
        // Amber for paused, as for anything on hold (plan 08 colour rules).
        lamp.dataset.s = snapshot.paused ? 'warn' : 'ok';
        runState.textContent = snapshot.paused ? 'Paused' : 'Running';
      }
      if (snapshot.speed !== shownSpeed) {
        shownSpeed = snapshot.speed;
        speed.textContent = formatSpeed(snapshot.speed);
      }
    },
    dispose() {
      // No listeners yet; remove what this HUD added so a new one can mount.
      group.remove();
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
