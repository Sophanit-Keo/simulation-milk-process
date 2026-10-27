// Contracts v4 (phase 5): the fault scenarios as the panels and the 3D view see them. A scenario is triggered
// from the menu (triggerScenario), acts on the plant for a while, and its log says what happened and why,
// the plant's reactions included (a divert, a starved filler, a blocked batch), until its consequences have
// played out.
import type { ScenarioId, ScenarioVariant } from './commands';
import type { LogEntry } from './snapshot';

/** One scenario since it was triggered. */
export interface ScenarioRunSnapshot {
  /** 1 for the first scenario triggered since the plant opened, and so on. */
  run: number;
  id: ScenarioId;
  /** The form of 'demandSpikeOrLateTruck'; null for the other five. */
  variant: ScenarioVariant | null;
  startedS: number;
  /**
   * When it stopped acting on the plant, on its own or by a reset; null while it still acts. Its log can go on
   * after that: a batch filled during a filter failure is judged a week later.
   */
  endedS: number | null;
  /** True until its last consequence has played out; its log takes entries until then. */
  following: boolean;
  /** What it is doing now, in a few words: "Diverting to the reject tank", "Over". */
  summary: string;
  /** What happened and why, oldest first: its own entries and the plant's reactions to it. */
  log: LogEntry[];
}

export interface ScenariosSnapshot {
  /** Newest first, the most recent SCENARIO_RUNS_KEPT. */
  runs: ScenarioRunSnapshot[];
  /** Scenarios that cannot start now, with the reason ("The UHT plant is not in production"). */
  unavailable: Partial<Record<ScenarioId, string>>;
}

/** Runs the snapshot keeps. */
export const SCENARIO_RUNS_KEPT = 12;
