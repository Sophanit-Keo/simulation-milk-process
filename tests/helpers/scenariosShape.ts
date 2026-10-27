// The shape rules of contracts v4 (src/contracts/scenarios.ts) that the scenario menu and log rely on,
// checked the same way for both sims and every recorded fixture.
import { expect } from 'vitest';
import { SCENARIO_IDS, SCENARIO_RUNS_KEPT, SCENARIO_VARIANTS, type Snapshot } from '../../src/contracts';

const LOG_KINDS = ['info', 'ok', 'warn', 'bad'];

/** Fails on the first broken rule, naming where it broke. */
export function expectWellFormedScenarios(snap: Snapshot, where: string): void {
  const { runs, unavailable } = snap.scenarios;
  expect(runs.length, `${where}: runs kept`).toBeLessThanOrEqual(SCENARIO_RUNS_KEPT);
  const numbers = runs.map((run) => run.run);
  expect(numbers, `${where}: runs newest first`).toEqual([...numbers].sort((a, b) => b - a));
  for (const run of runs) {
    const at = `${where}: run ${run.run}`;
    expect(SCENARIO_IDS, `${at} id`).toContain(run.id);
    if (run.id === 'demandSpikeOrLateTruck') expect(SCENARIO_VARIANTS, `${at} variant`).toContain(run.variant);
    else expect(run.variant, `${at} variant`).toBeNull();
    expect(run.startedS, `${at} started`).toBeLessThanOrEqual(snap.timeS);
    if (run.endedS !== null) expect(run.endedS, `${at} ended`).toBeGreaterThanOrEqual(run.startedS);
    // Still acting means still following; a run follows its consequences after it stops acting.
    if (run.endedS === null) expect(run.following, `${at} following while acting`).toBe(true);
    expect(run.summary.length, `${at} summary`).toBeGreaterThan(0);
    for (let i = 0; i < run.log.length; i++) {
      const entry = run.log[i];
      if (!entry) continue;
      expect(LOG_KINDS, `${at} log ${i} kind`).toContain(entry.kind);
      expect(entry.scenario, `${at} log ${i} scenario`).toBe(run.id);
      expect(entry.why?.length ?? 0, `${at} log ${i} why`).toBeGreaterThan(0);
      expect(entry.timeS, `${at} log ${i} time`).toBeGreaterThanOrEqual(run.startedS);
      if (i > 0) expect(entry.timeS, `${at} log oldest first`).toBeGreaterThanOrEqual(run.log[i - 1]?.timeS ?? 0);
    }
  }
  for (const [id, why] of Object.entries(unavailable)) {
    expect(SCENARIO_IDS, `${where}: unavailable ${id}`).toContain(id);
    expect(why?.length ?? 0, `${where}: why ${id} is unavailable`).toBeGreaterThan(0);
  }
  // Entries in the main log that a scenario caused say why.
  for (const entry of snap.log) if (entry.scenario) expect(entry.why?.length ?? 0, `${where}: why for "${entry.message}"`).toBeGreaterThan(0);
}
