// The phase 5 screens' rules, without a DOM: the scenario menu's data (src/data/scenarios.json), the banner's
// choice of run, the tour's timing, and the stage 6 and batch texts a scenario changes.
import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS, type ScenarioRunSnapshot } from '../../src/contracts';
import scenariosJson from '../../src/data/scenarios.json';
import { investigationText } from '../../src/ui/batchList';
import { sterileAirText } from '../../src/ui/panelRows';
import { BANNER_AFTER_S, bannerRun, runTimes } from '../../src/ui/scenarioLog';
import { parseScenarioMenu, SCENARIO_MENU, scenarioName } from '../../src/ui/scenarioMenu';
import { TOUR_STOP_S, tourStop } from '../../src/ui/tour';

const run = (n: number, following: boolean, endedS: number | null = null): ScenarioRunSnapshot => ({
  run: n,
  id: 'fillerBreakdown',
  variant: null,
  startedS: 626_400,
  endedS,
  following,
  summary: 'Filler A under repair · 59 min left',
  log: [],
});

describe('the scenario menu (src/data/scenarios.json)', () => {
  it('lists the six scenarios in the fault table’s order, the spike and late trucks apart, each with a stage', () => {
    expect(SCENARIO_MENU.map((item) => item.variant ?? item.id)).toEqual([
      'uhtTempDrop',
      'fillerBreakdown',
      'sterileAirFilterFailure',
      'failedIncubation',
      'homogenizerPressureLoss',
      'demandSpike',
      'lateTrucks',
    ]);
    expect(new Set(SCENARIO_MENU.map((item) => item.id))).toEqual(new Set(SCENARIO_IDS));
    expect(SCENARIO_MENU.map((item) => item.stage)).toEqual([4, 7, 6, 9, 3, 10, 10]);
  });

  it('refuses a file that misses a scenario, repeats one, or gives a variant to the wrong one', () => {
    const copy = () => structuredClone(scenariosJson) as { scenarios: Record<string, unknown>[] };
    const missing = copy();
    missing.scenarios.pop();
    expect(() => parseScenarioMenu(missing)).toThrow(/each scenario once/);
    const twice = copy();
    twice.scenarios.push({ ...twice.scenarios[0] });
    expect(() => parseScenarioMenu(twice)).toThrow(/each scenario once/);
    const variant = copy();
    variant.scenarios[0] = { ...variant.scenarios[0], variant: 'demandSpike' };
    expect(() => parseScenarioMenu(variant)).toThrow(/variant goes with demandSpikeOrLateTruck only/);
    const stage = copy();
    stage.scenarios[1] = { ...stage.scenarios[1], stage: 11 };
    expect(() => parseScenarioMenu(stage)).toThrow(/unknown stage/);
  });

  it('names a run as its menu entry does', () => {
    expect(scenarioName('demandSpikeOrLateTruck', 'lateTrucks')).toBe('Late trucks');
    expect(scenarioName('demandSpikeOrLateTruck', 'demandSpike')).toBe('Demand spike');
    expect(scenarioName('uhtTempDrop', null)).toBe('UHT temperature drop');
  });
});

describe('the scenario banner', () => {
  it('shows the newest run while it follows its consequences, and for a while after, unless hidden', () => {
    expect(bannerRun([], null, 0)).toBeNull();
    expect(bannerRun([run(2, true), run(1, false)], null, 0)?.run).toBe(2);
    expect(bannerRun([run(2, true)], 2, 0)).toBeNull();
    expect(bannerRun([run(3, false, 626_500)], null, BANNER_AFTER_S - 1)?.run).toBe(3);
    expect(bannerRun([run(3, false, 626_500)], null, BANNER_AFTER_S)).toBeNull();
  });

  it('says when a run started and whether it still acts', () => {
    expect(runTimes(run(1, true))).toBe('Started day 8 · 06:00 · acting now');
    expect(runTimes(run(1, true, 626_400 + 3_720))).toBe('Started day 8 · 06:00 · stopped acting day 8 · 07:02');
  });
});

describe('the guided tour', () => {
  it('spends 18 s at each of the 10 stages, 3 minutes in all, then is done', () => {
    expect(TOUR_STOP_S * 10).toBe(180);
    expect(tourStop(0, 10)).toEqual({ index: 0, done: false });
    expect(tourStop(17.9, 10)).toEqual({ index: 0, done: false });
    expect(tourStop(18, 10)).toEqual({ index: 1, done: false });
    expect(tourStop(179.9, 10)).toEqual({ index: 9, done: false });
    expect(tourStop(180, 10)).toEqual({ index: 9, done: true });
  });
});

describe('what a scenario changes on the panels', () => {
  it('shows the sterile-air filter failed while its scenario acts, intact otherwise', () => {
    const filter = { ...run(1, true), id: 'sterileAirFilterFailure' as const };
    expect(sterileAirText({ scenarios: { runs: [filter], unavailable: {} } })).toEqual({ text: 'Filter failed · deviation, batches held', status: 'bad' });
    expect(sterileAirText({ scenarios: { runs: [{ ...filter, endedS: 633_600 }], unavailable: {} } }).text).toBe('Filter intact');
    expect(sterileAirText({ scenarios: { runs: [], unavailable: {} } }).status).toBe('ok');
  });

  it('says why a batch is under investigation', () => {
    expect(investigationText({ flags: ['sterileAir'], creamingRiskPct: 0 })).toBe('sterile-air filter failure');
    expect(investigationText({ flags: ['sterileAir', 'creaming'], creamingRiskPct: 83.79 })).toBe('sterile-air filter failure; creaming risk 84%');
  });
});
