// The demo script (docs/demo-script.md, phase 6) replayed headlessly: the same scenarios at the same clock
// times and speeds, on the shipped config and seed, so every number the script tells the presenter to expect
// is checked. Unlike the scenario scripts (tests/sim/scenarios.test.ts, each fault alone as the plant
// opens), the faults here follow one another, so each starts from what the one before left: the tank level,
// the trucks already gone, the batches already flagged.
import { describe, expect, it } from 'vitest';
import { dayToS, hToS, type Command, type LogEntry, type ScenarioId, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { expectWithin } from '../helpers/expectWithin';
import { copyConfig } from '../helpers/plantConfig';

/** When each step of the demo starts, in sim seconds after the opening (day 8, 06:00). */
const DEMO_AT_S = {
  fillerBreakdown: 1_800, // 06:30, after the 3 min tour at ×10
  uhtTempDrop: 9_000, // 08:30
  homogenizerPressureLoss: 17_100, // 10:45
  sterileAirFilterFailure: 17_160, // 10:46
  failedIncubation: 17_220, // 10:47
  demandSpike: 17_280, // 10:48
} as const;

const config = copyConfig();
const sim = createSim(config);
const openS = sim.snapshot().timeS;
const t = (): number => sim.snapshot().timeS - openS;
let speed = config.clock.defaultSpeed as number;
const send = (command: Command): void => {
  if (command.type === 'setSpeed') speed = command.speed;
  sim.dispatch(command);
};
/** Runs whole frames, as the app does, until the clock reaches tS. */
function runTo(tS: number, each?: (snap: Snapshot) => void): Snapshot {
  while (t() < tS - 1e-6) {
    sim.step(Math.min(config.clock.maxFrameS, Math.max(tS - t(), 1e-6) / speed));
    each?.(sim.snapshot());
  }
  return sim.snapshot();
}

const opening = sim.snapshot();
runTo(DEMO_AT_S.fillerBreakdown);
send({ type: 'setSpeed', speed: 100 });
send({ type: 'triggerScenario', id: 'fillerBreakdown' });
let tankMaxL = 0;
runTo(DEMO_AT_S.uhtTempDrop, (snap) => (tankMaxL = Math.max(tankMaxL, snap.liquid.tanks.asepticTank.levelL)));
const beforeDrop = sim.snapshot();
send({ type: 'triggerScenario', id: 'uhtTempDrop' });
// The steam halfway through re-sterilizing (09:53–10:23), and the energy per tonne as production resumes.
let sterilizing: Snapshot | undefined;
let resumed: Snapshot | undefined;
runTo(DEMO_AT_S.homogenizerPressureLoss, (snap) => {
  if (!sterilizing && snap.liquid.uhtMode === 'sterilize' && snap.liquid.modeRemainingS < 900) sterilizing = snap;
  if (sterilizing && !resumed && snap.liquid.uhtMode === 'production') resumed = snap;
});
const afterDrop = sim.snapshot();
send({ type: 'setSpeed', speed: 10 });
send({ type: 'triggerScenario', id: 'homogenizerPressureLoss' });
runTo(DEMO_AT_S.sterileAirFilterFailure);
const homogenizerDown = sim.snapshot();
send({ type: 'triggerScenario', id: 'sterileAirFilterFailure' });
runTo(DEMO_AT_S.failedIncubation);
send({ type: 'triggerScenario', id: 'failedIncubation' });
runTo(DEMO_AT_S.demandSpike);
const afterFailed = sim.snapshot();
send({ type: 'setSpeed', speed: 100 });
send({ type: 'triggerScenario', id: 'demandSpikeOrLateTruck', variant: 'demandSpike' });
let yardMax = 0;
const afterSpike = runTo(23_400, (snap) => (yardMax = Math.max(yardMax, snap.packs.warehouse.trucks.filter((truck) => truck.door < 0).length)));
send({ type: 'setSpeed', speed: 10_000 });
const verdictS = hToS(8) + dayToS(config.quality.incubationDays); // day 15, 14:00
const week = runTo(verdictS + 600);

const runOf = (id: ScenarioId) => {
  const run = week.scenarios.runs.find((each) => each.id === id);
  if (!run) throw new Error(`no ${id} run`);
  return run;
};
/** Sim seconds after the opening of the run's entry whose message matches. */
function at(id: ScenarioId, pattern: RegExp): number {
  const entry = runOf(id).log.find((each: LogEntry) => pattern.test(each.message));
  if (!entry) throw new Error(`${id}: no entry matching ${pattern}`);
  return entry.timeS - openS;
}

describe('the demo script, replayed (docs/demo-script.md)', () => {
  it('1. opens on day 8 at 06:00 with the KPIs the script reads out', () => {
    expect(opening.kpis).toMatchObject({ uhtFlowLph: 16_000, tankLevelPct: 50, packsPerH: 15_000, oeePct: 93.75, batchesOnHold: 42, palletsInStock: 634, trucksShipped: 0, orderFillPct: 100 });
    expectWithin(opening.kpis.daysOfCover, 2, 0.01);
  });

  it('3. filler breakdown at 06:30: throttled 07:23, filler A back 07:32, full flow again 08:24', () => {
    expectWithin(at('fillerBreakdown', /throttled to 50%/), 4_976.5, 1);
    expect(at('fillerBreakdown', /Filler A repaired/)).toBe(5_400);
    expect(at('fillerBreakdown', /Filler A sterile/)).toBe(5_520);
    expectWithin(at('fillerBreakdown', /back to full flow/), 8_644.5, 1);
    expectWithin(tankMaxL, 18_075, 10);
    expect(beforeDrop.kpis).toMatchObject({ palletsInStock: 612, trucksShipped: 1 });
  });

  it('4. UHT temperature drop at 08:30: diverts within 3 s, fillers stop 09:18, back in production 10:23', () => {
    const divertS = at('uhtTempDrop', /diverting to the reject tank/);
    expect(divertS - DEMO_AT_S.uhtTempDrop).toBeGreaterThan(1.6);
    expect(divertS - DEMO_AT_S.uhtTempDrop).toBeLessThanOrEqual(2.85);
    expectWithin(at('uhtTempDrop', /fillers stopped/), 11_870, 2);
    expectWithin(at('uhtTempDrop', /back in production/), divertS + 6_780, 1e-6);
    expectWithin(at('uhtTempDrop', /fillers running again/) - at('uhtTempDrop', /back in production/), 78.75, 0.01);
    expectWithin(afterDrop.kpis.divertedL, 800, 1e-6);
    expect(afterDrop.kpis).toMatchObject({ palletsInStock: 590, trucksShipped: 2 });
  });

  it('4. … re-sterilizing takes 2,085 kg/h of steam and 1,616 kW of gas; the energy since opening goes from 86.6 to about 107 kWh/t', () => {
    expectWithin(beforeDrop.liquid.energy?.kwhPerT ?? Number.NaN, 86.62, 0.01);
    expect(sterilizing?.liquid.energy?.steamUse).toBe('sterilizing');
    expectWithin(sterilizing?.stages[4].values.steamKgPerH ?? Number.NaN, 2_084.73, 0.01);
    expectWithin(sterilizing?.stages[4].values.gasKw ?? Number.NaN, 1_615.73, 0.01);
    expectWithin(resumed?.liquid.energy?.kwhPerT ?? Number.NaN, 107, 0.5);
  });

  it('5–7. homogenizer at 50 bar, the filter down and batch 12 failed: 54 and 55 under investigation, 41 on hold', () => {
    const values = homogenizerDown.stages[3].values;
    expect(values.stage1Bar).toBe(50);
    expectWithin(values.creamingRiskPct ?? Number.NaN, 83.79, 0.01);
    expectWithin(values.outletTempC ?? Number.NaN, 78, 1e-9);
    const flagged = afterFailed.packs.batches.filter((batch) => batch.flags.length === 2).map((batch) => batch.id);
    expect(flagged).toEqual([54, 55]);
    expect(afterFailed.kpis).toMatchObject({ batchesOnHold: 41, batchesBlocked: 1 });
    expect(runOf('failedIncubation').log[0]?.message).toBe('Batch 12 failed incubation: a blown pack at the incubator check: 59 pallets blocked');
  });

  it('8. demand spike at 10:48: up to 4 trucks in the yard, the last extra one gone at 12:28, 304 pallets left', () => {
    expect(yardMax).toBe(4);
    expect(at('demandSpikeOrLateTruck', /left with 22 pallets/)).toBe(23_280);
    expect(afterSpike.kpis).toMatchObject({ palletsInStock: 304, trucksShipped: 15 });
    expectWithin(afterSpike.kpis.daysOfCover, 0.96, 0.01);
    expectWithin(afterSpike.kpis.orderFillPct, 100 / 3, 1e-9);
  });

  it('9. a week at ×10,000: on day 15 at 14:00 batches 54 and 55 are blocked, each by its own fault, and every run is over', () => {
    expect(at('sterileAirFilterFailure', /^Batch 54 failed incubation/)).toBe(verdictS);
    expect(at('homogenizerPressureLoss', /^Batch 55 failed the sensory check/)).toBe(verdictS);
    for (const run of week.scenarios.runs) expect(run.following, run.id).toBe(false);
    expect(week.kpis).toMatchObject({ batchesOnHold: 42, batchesReleased: 41, batchesBlocked: 3, palletsInStock: 454 });
    expectWithin(week.kpis.oeePct, 90.48, 0.01);
  });
});
