// What a fault scenario did, and why (plan 08's scenario mode; phase 5). A banner over the 3D view names the
// newest scenario, says what it is doing now and its latest step; it stays until that scenario has played
// out, or until it is hidden. Its button opens a dialog with every scenario's log, oldest step first, each
// with the reason behind it: the scenario's own steps and the plant's reactions to it.
import type { LogEntry, ScenarioRunSnapshot, Snapshot } from '../contracts';
import { createLamp, el, onPress, setLamp, setText } from './dom';
import { LOG_KIND_TEXT, LOG_LAMP } from './eventLog';
import { formatSimTime } from './format';
import { scenarioName } from './scenarioMenu';

/** Real seconds the banner stays up after its scenario has played out, showing "Over: …". */
export const BANNER_AFTER_S = 15;

/**
 * The run the banner shows: the newest, while it follows its consequences and for BANNER_AFTER_S after
 * (`overForS`, real time since it was first seen over), unless the viewer hid it.
 */
export function bannerRun(runs: readonly ScenarioRunSnapshot[], hiddenRun: number | null, overForS: number): ScenarioRunSnapshot | null {
  const newest = runs[0];
  if (!newest || newest.run === hiddenRun) return null;
  return newest.following || overForS < BANNER_AFTER_S ? newest : null;
}

/** "Started day 8 · 06:00 · over day 8 · 07:53", or "· running" while it still acts on the plant. */
export function runTimes(run: Pick<ScenarioRunSnapshot, 'startedS' | 'endedS'>): string {
  return `Started ${formatSimTime(run.startedS)} · ${run.endedS === null ? 'acting now' : `stopped acting ${formatSimTime(run.endedS)}`}`;
}

export interface ScenarioLog {
  update(snapshot: Snapshot): void;
  /** Opens the dialog with every scenario's log. */
  open(): void;
  dispose(): void;
}

function entryItem(entry: LogEntry): HTMLLIElement {
  const li = el('li', 'sc-entry');
  li.dataset.kind = entry.kind;
  const lamp = el('span', 'lamp');
  lamp.dataset.status = LOG_LAMP[entry.kind];
  lamp.setAttribute('role', 'img');
  lamp.setAttribute('aria-label', LOG_KIND_TEXT[entry.kind]);
  const time = el('time', '', formatSimTime(entry.timeS));
  time.dateTime = `PT${Math.floor(Math.max(0, entry.timeS))}S`;
  li.append(lamp, ' ', time, ' ', el('span', 'sc-what', entry.message));
  if (entry.why) li.append(' ', el('span', 'sc-why', entry.why));
  return li;
}

export function createScenarioLog(view: HTMLElement, signal: AbortSignal): ScenarioLog {
  const banner = el('section', 'overlay overlay-scenario');
  banner.dataset.testid = 'scenario-banner';
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-label', 'Fault scenario');
  banner.hidden = true;
  const lamp = createLamp('warn');
  const name = el('strong', 'sc-name');
  const summary = el('span', 'sc-summary');
  const hide = el('button', 'sc-hide', '×');
  hide.type = 'button';
  hide.title = 'Hide until the next scenario';
  hide.setAttribute('aria-label', 'Hide the scenario banner');
  const head = el('div', 'sc-head');
  head.append(lamp, name, summary, hide);
  const last = el('p', 'sc-last');
  const openLog = el('button', 'link sc-open', 'What happened and why');
  openLog.type = 'button';
  openLog.dataset.testid = 'scenario-log-open';
  banner.append(head, last, openLog);
  view.append(banner);

  const dialog = el('dialog', 'about card scenario-log');
  dialog.dataset.testid = 'scenario-log';
  dialog.setAttribute('aria-labelledby', 'scenario-log-title');
  const body = el('div', 'about-body');
  const title = el('h2', '', 'What happened and why');
  title.id = 'scenario-log-title';
  const runsBox = el('div', 'sc-runs');
  body.append(title, runsBox);
  const close = el('button', 'btn', 'Close');
  close.type = 'button';
  close.dataset.testid = 'scenario-log-close';
  const foot = el('div', 'about-foot');
  foot.append(close);
  dialog.append(body, foot);
  document.body.append(dialog);

  let hiddenRun: number | null = null;
  let shownRun: number | null = null;
  /** The run seen over last, and when (real time). */
  let over: { run: number; atMs: number } | null = null;
  /** What the dialog last drew; null until it first draws, so an empty log draws its "none yet" line too. */
  let runsKey: string | null = null;
  let lastSnapshot: Snapshot | null = null;

  function renderRuns(runs: readonly ScenarioRunSnapshot[]): void {
    const key = runs.map((run) => `${run.run}:${run.log.length}:${run.summary}:${run.endedS}`).join('|');
    if (key === runsKey) return;
    runsKey = key;
    if (runs.length === 0) {
      runsBox.replaceChildren(el('p', 'sc-none', 'No scenario has run yet. Pick one from the Scenarios menu in the top bar.'));
      return;
    }
    runsBox.replaceChildren(
      ...runs.map((run) => {
        const section = el('section', 'sc-run');
        section.dataset.run = String(run.run);
        const heading = el('h3', '', scenarioName(run.id, run.variant));
        const meta = el('p', 'sc-meta', `${runTimes(run)} · ${run.summary}`);
        const list = el('ol', 'sc-entries');
        list.append(...run.log.map(entryItem));
        section.append(heading, meta, list);
        return section;
      }),
    );
  }

  hide.addEventListener(
    'click',
    () => {
      hiddenRun = shownRun;
      banner.hidden = true;
    },
    { signal },
  );
  const openDialog = (): void => {
    if (lastSnapshot) renderRuns(lastSnapshot.scenarios.runs);
    else renderRuns([]);
    if (!dialog.open) dialog.showModal();
  };
  onPress(openLog, openDialog, signal);
  close.addEventListener('click', () => dialog.close(), { signal });

  return {
    update(snapshot) {
      lastSnapshot = snapshot;
      const newest = snapshot.scenarios.runs[0];
      const nowMs = performance.now();
      if (newest && !newest.following && over?.run !== newest.run) over = { run: newest.run, atMs: nowMs };
      const overForS = newest && !newest.following && over ? (nowMs - over.atMs) / 1_000 : 0;
      const run = bannerRun(snapshot.scenarios.runs, hiddenRun, overForS);
      banner.hidden = run === null;
      if (run) {
        shownRun = run.run;
        setText(name, scenarioName(run.id, run.variant));
        setText(summary, run.summary);
        const latest = run.log.at(-1);
        setText(last, latest ? `${formatSimTime(latest.timeS)} · ${latest.message}` : '');
        setLamp(lamp, latest ? LOG_LAMP[latest.kind] : 'warn');
      }
      if (dialog.open) renderRuns(snapshot.scenarios.runs);
    },
    open: openDialog,
    dispose() {
      if (dialog.open) dialog.close();
      dialog.remove();
      banner.remove();
    },
  };
}
