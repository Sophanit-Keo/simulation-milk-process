// The top bar's scenario menu (plan 08: "Scenario: pick a fault, watch the plant react, then read a short log
// of what happened and why"; phase 5). One entry per fault of plan 06, the demand spike and late trucks
// apart, with the text `process` keeps in src/data/scenarios.json; an entry that cannot start now says why
// and is disabled. Below them, a reset puts every running fault right. Picking a fault sends
// triggerScenario and selects its stage, so the camera flies to where the plant reacts.
import {
  SCENARIO_IDS,
  SCENARIO_VARIANTS,
  STAGE_IDS,
  type Command,
  type ScenarioId,
  type ScenarioVariant,
  type Snapshot,
  type StageId,
} from '../contracts';
import scenariosJson from '../data/scenarios.json';
import { el, setAttr, setText } from './dom';

export interface ScenarioMenuItem {
  id: ScenarioId;
  /** demandSpikeOrLateTruck's form; undefined for the others. */
  variant?: ScenarioVariant;
  name: string;
  /** The stage the camera flies to when it starts: where the plant first reacts. */
  stage: StageId;
  description: string;
}

/** Checks src/data/scenarios.json: every scenario once (the spike and late trucks once each), a stage, some text. */
export function parseScenarioMenu(json: unknown): ScenarioMenuItem[] {
  const list = (json as { scenarios?: unknown })?.scenarios;
  if (!Array.isArray(list)) throw new Error('scenarios.json needs a "scenarios" list');
  const items = list.map((raw, index): ScenarioMenuItem => {
    const item = raw as Partial<ScenarioMenuItem>;
    const where = `scenarios.json entry ${index + 1}`;
    if (!SCENARIO_IDS.includes(item.id as ScenarioId)) throw new Error(`${where}: unknown id "${String(item.id)}"`);
    if (item.id === 'demandSpikeOrLateTruck' ? !SCENARIO_VARIANTS.includes(item.variant as ScenarioVariant) : item.variant !== undefined) {
      throw new Error(`${where}: a variant goes with demandSpikeOrLateTruck only, and it needs one`);
    }
    if (!STAGE_IDS.includes(item.stage as StageId)) throw new Error(`${where}: unknown stage ${String(item.stage)}`);
    if (!item.name?.trim() || !item.description?.trim()) throw new Error(`${where}: needs a name and a description`);
    return { id: item.id as ScenarioId, ...(item.variant ? { variant: item.variant } : {}), name: item.name, stage: item.stage as StageId, description: item.description };
  });
  const keys = items.map((item) => `${item.id}/${item.variant ?? ''}`);
  const expected = SCENARIO_IDS.flatMap((id) => (id === 'demandSpikeOrLateTruck' ? SCENARIO_VARIANTS.map((variant) => `${id}/${variant}`) : [`${id}/`]));
  if (keys.length !== new Set(keys).size || expected.some((key) => !keys.includes(key))) {
    throw new Error('scenarios.json must list each scenario once, and both forms of demandSpikeOrLateTruck');
  }
  return items;
}

export const SCENARIO_MENU: readonly ScenarioMenuItem[] = parseScenarioMenu(scenariosJson);

/** The menu's name for a run: "Demand spike" or "Late trucks" for the two forms of one scenario. */
export function scenarioName(id: ScenarioId, variant: ScenarioVariant | null | undefined): string {
  const item = SCENARIO_MENU.find((entry) => entry.id === id && (entry.variant ?? null) === (variant ?? null));
  return item?.name ?? SCENARIO_MENU.find((entry) => entry.id === id)?.name ?? id;
}

export interface ScenarioMenuOptions {
  dispatch(command: Command): void;
  /** A fault was picked: the stage where the plant reacts first. */
  onStarted(stage: StageId): void;
  /** "Scenario log" was picked: show what happened and why. */
  onOpenLog(): void;
  signal: AbortSignal;
}

export interface ScenarioMenu {
  readonly root: HTMLElement;
  update(snapshot: Snapshot): void;
  close(): void;
  dispose(): void;
}

export function createScenarioMenu(options: ScenarioMenuOptions): ScenarioMenu {
  const { signal } = options;
  const wrap = el('div', 'menu-wrap');
  const toggle = el('button', 'btn btn-menu', 'Scenarios');
  toggle.type = 'button';
  toggle.dataset.testid = 'scenario-menu';
  toggle.title = 'Start a fault scenario, or put the running ones right';
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  const menu = el('div', 'menu card');
  menu.id = 'scenario-menu-list';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Fault scenarios');
  menu.hidden = true;
  toggle.setAttribute('aria-controls', menu.id);
  wrap.append(toggle, menu);

  const rows = SCENARIO_MENU.map((item) => {
    const button = el('button', 'menu-item');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.scenario = item.id;
    if (item.variant) button.dataset.variant = item.variant;
    const why = el('span', 'menu-why');
    button.append(el('strong', '', item.name), el('span', 'menu-text', item.description), why);
    button.addEventListener(
      'click',
      () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        options.dispatch({ type: 'triggerScenario', id: item.id, ...(item.variant ? { variant: item.variant } : {}) });
        close(false);
        options.onStarted(item.stage);
      },
      { signal },
    );
    menu.append(button);
    return { item, button, why };
  });
  const separator = el('div', 'menu-sep');
  separator.setAttribute('role', 'separator');
  const reset = el('button', 'menu-item menu-reset');
  reset.type = 'button';
  reset.setAttribute('role', 'menuitem');
  reset.dataset.testid = 'scenario-reset';
  reset.append(el('strong', '', 'Reset scenarios'), el('span', 'menu-text', 'Put every running fault right; what it caused runs its course.'));
  reset.addEventListener(
    'click',
    () => {
      if (reset.getAttribute('aria-disabled') === 'true') return;
      options.dispatch({ type: 'resetScenarios' });
      close(false);
    },
    { signal },
  );
  const logItem = el('button', 'menu-item');
  logItem.type = 'button';
  logItem.setAttribute('role', 'menuitem');
  logItem.dataset.testid = 'scenario-log-menu';
  logItem.append(el('strong', '', 'Scenario log'), el('span', 'menu-text', 'What each scenario did, step by step, and why.'));
  logItem.addEventListener(
    'click',
    () => {
      close(false);
      options.onOpenLog();
    },
    { signal },
  );
  menu.append(separator, reset, logItem);

  const items = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>('.menu-item')];
  function open(): void {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    (items().find((item) => item.getAttribute('aria-disabled') !== 'true') ?? items()[0])?.focus();
  }
  function close(refocus: boolean): void {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (refocus) toggle.focus();
  }

  toggle.addEventListener('click', () => (menu.hidden ? open() : close(true)), { signal });
  menu.addEventListener(
    'keydown',
    (event) => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        // The menu keeps Escape: it closes the menu, not the stage (hud.ts checks defaultPrevented).
        event.preventDefault();
        close(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        list[(at + step + list.length) % list.length]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        (event.key === 'Home' ? list[0] : list.at(-1))?.focus();
      } else if (event.key === 'Tab') {
        close(false);
      }
    },
    { signal },
  );
  // A click anywhere else closes it.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && !(event.target instanceof Node && wrap.contains(event.target))) close(false);
    },
    { signal },
  );

  return {
    root: wrap,
    update(snapshot) {
      const { unavailable, runs } = snapshot.scenarios;
      for (const { item, button, why } of rows) {
        const reason = unavailable[item.id] ?? null;
        // aria-disabled, not disabled: the entry stays in the keyboard's reach, with its reason read out.
        setAttr(button, 'aria-disabled', reason ? 'true' : null);
        setText(why, reason ? `Not now: ${reason}` : '');
        setAttr(button, 'title', reason ?? item.description);
      }
      const acting = runs.some((run) => run.endedS === null);
      setAttr(reset, 'aria-disabled', acting ? null : 'true');
      setAttr(reset, 'title', acting ? 'Put every running fault right' : 'No fault is running');
    },
    close: () => close(false),
    dispose() {
      wrap.remove();
    },
  };
}
