// The six fault scenarios (src/sim/scenarios.ts) against process's scripts in plan/hand-calculations.md
// (H104–H110): each is triggered as the plant opens (day 8, 06:00, the aseptic tank at 10,000 L, full flow),
// then its log, the plant's state and the KPIs are checked at the scripted sim times. Then the resets, the
// menu's "cannot start now" reasons, and the same seed giving the same scenario log.
import { describe, expect, it } from 'vitest';
import { dayToS, hToS, type LogEntry, type ScenarioId, type ScenarioRunSnapshot, type ScenarioVariant, type Snapshot } from '../../src/contracts';
import { createRng, type Rng } from '../../src/sim/rng';
import { packsSeed } from '../../src/sim';
import { expectWithin } from '../helpers/expectWithin';
import { emptyPlantConfig, startPacks, type PacksRun } from '../helpers/packsRun';
import { copyConfig, plantConfig } from '../helpers/plantConfig';
import { expectWellFormedScenarios } from '../helpers/scenariosShape';

const { scenarios: spec, uht, cleaning } = plantConfig;

/** The plant as it opens, with the scenario triggered before the first step. */
function triggered(id: ScenarioId, variant?: ScenarioVariant, options: Parameters<typeof startPacks>[1] = {}): PacksRun {
  const run = startPacks(copyConfig(), options);
  run.sim.dispatch({ type: 'triggerScenario', id, variant });
  return run;
}

const firstRun = (snap: Snapshot): ScenarioRunSnapshot => {
  const run = snap.scenarios.runs.at(-1);
  if (!run) throw new Error('no scenario run');
  return run;
};

/** Sim seconds since the opening of the run's first entry whose message matches. */
function at(run: PacksRun, entries: readonly LogEntry[], pattern: RegExp): number {
  const entry = entries.find((each) => pattern.test(each.message));
  if (!entry) throw new Error(`no entry matching ${pattern}: ${entries.map((each) => each.message).join(' | ')}`);
  return entry.timeS - run.openS;
}

/** Runs to tS, noting the first sim time each check holds. */
function firstTimes(run: PacksRun, tS: number, checks: Record<string, (snap: Snapshot) => boolean>): Record<string, number> {
  const seen: Record<string, number> = {};
  run.runTo(tS, (snap) => {
    for (const [name, check] of Object.entries(checks)) if (seen[name] === undefined && check(snap)) seen[name] = run.t();
  });
  return seen;
}

describe('H104: UHT temperature drop', () => {
  // At ×10 a step is 1 s, so the divert lands on the cut at the crossing or on a step's start.
  const run = triggered('uhtTempDrop');
  const seen = firstTimes(run, hToS(2.5), {
    divert: (snap) => snap.liquid.uhtMode === 'divert',
    stage4Red: (snap) => snap.stages[4].status === 'bad',
    starved: (snap) => snap.liquid.fillersStarved,
    stage7Idle: (snap) => snap.stages[7].status === 'idle',
  });
  const end = run.sim.snapshot();
  const scenario = firstRun(end);
  const log = scenario.log;

  it('starts with the steam dip, and diverts within 3 s: at 2.84 s, when the outlet crosses 139.22 °C, or earlier on a noisy reading', () => {
    expect(log[0]?.message).toBe('Steam supply dips: the UHT outlet falls toward 135.5 °C');
    const divertS = at(run, log, /diverting to the reject tank/);
    expect(divertS).toBeGreaterThanOrEqual(1.68);
    expect(divertS).toBeLessThanOrEqual(2.85);
    // 135.5 + 4.5 e^(−t/15) reaches the 4 s hold's divert limit at t = 15 ln(4.5 / 3.7237) = 2.84 s.
    if (divertS > 2.5) expectWithin(divertS, 2.84, 0.01);
    expect(seen.stage4Red).toBeLessThanOrEqual(Math.ceil(divertS));
  });

  it('diverts 3 min (800 L to the reject tank), cleans 80 min, re-sterilizes 30 min: back in production 113 min after the divert', () => {
    const divertS = at(run, log, /diverting/);
    expectWithin(at(run, log, /Full CIP started/), divertS + uht.divertBeforeCleaningS, 1e-6);
    expectWithin(at(run, log, /sterilizing at 125/), divertS + uht.divertBeforeCleaningS + cleaning.cipS, 1e-6);
    expectWithin(at(run, log, /back in production/), divertS + uht.divertBeforeCleaningS + cleaning.cipS + uht.sterilizeS, 1e-6);
    expectWithin(end.kpis.divertedL, 800, 1e-6);
    expect(end.liquid.divertCount).toBe(1);
  });

  it('lets the fillers drain the tank: they stop at 150 L about 39.4 min into the divert (H37) and restart 78.75 s after production resumes', () => {
    const divertS = at(run, log, /diverting/);
    const starvedS = at(run, log, /fillers stopped/);
    // 10,000 L plus what came in before the divert, down to 150 L at 15,000 L/h.
    expectWithin(starvedS - divertS, ((10_000 + divertS / 3.6 - 150) / 15_000) * 3_600, 0.5);
    expectWithin(seen.starved ?? Number.NaN, starvedS, 1);
    expect(seen.stage7Idle).toBeGreaterThanOrEqual(starvedS - 1);
    // 350 L at 16,000 L/h from production to the 500 L restart level.
    expectWithin(at(run, log, /fillers running again/) - at(run, log, /back in production/), 78.75, 0.01);
  });

  it('logs every step with why, stops acting when the steam is back, and follows until the fillers run again', () => {
    expect(log.map((entry) => entry.message.replace(/\d[\d.,]*\d|\d/g, '#'))).toEqual([
      'Steam supply dips: the UHT outlet falls toward # °C',
      'UHT outlet # °C gives B* #, below #: diverting to the reject tank',
      'Full CIP started after the divert: # min',
      'Aseptic tank below # L: fillers stopped, waiting for product',
      'CIP done: sterilizing at # °C for # min',
      'UHT plant sterile: back in production',
      'Aseptic tank back above # L: fillers running again',
    ]);
    expectWellFormedScenarios(end, 'end');
    expectWithin((scenario.endedS ?? Number.NaN) - run.openS, at(run, log, /Full CIP/), 1e-6);
    expect(scenario.following).toBe(false);
    expect(scenario.summary).toBe('Over: back in production');
  });

  it('diverts at 50% flow too (8 s hold): by 31.2 s, when the outlet crosses 136.06 °C, and 400 L go to the reject tank', () => {
    const config = copyConfig();
    config.asepticTank.startFrac = 0.95; // above 90%: the plant opens throttled, as in H91
    const half = startPacks(config);
    half.sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
    const end = half.runTo(600);
    expect(half.sim.snapshot().liquid.throttled).toBe(true);
    const divertS = at(half, firstRun(end).log, /diverting to the reject tank/);
    // 135.5 + 4.5 e^(−t/15) = 136.063 at t = 15 ln(4.5 / 0.563) = 31.2 s; a reading 0.3 °C low crosses at 24.8 s.
    expect(divertS).toBeGreaterThanOrEqual(24.8);
    expect(divertS).toBeLessThanOrEqual(31.2);
    expectWithin(end.kpis.divertedL, 400, 1e-6);
  });

  it('cannot start again while the steam is down, nor while the plant cleans', () => {
    const again = triggered('uhtTempDrop');
    again.runTo(60);
    expect(again.sim.snapshot().scenarios.unavailable.uhtTempDrop).toBe('The steam supply is down already');
    again.runTo(600);
    const snap = again.sim.snapshot();
    expect(snap.scenarios.unavailable.uhtTempDrop).toBe('The UHT plant is cleaning (CIP); the steam dip needs it in production');
    again.sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
    expect(again.sim.snapshot().log[0]?.message).toBe('Scenario not started: The UHT plant is cleaning (CIP); the steam dip needs it in production');
    expect(again.sim.snapshot().scenarios.runs).toHaveLength(1);
  });
});

describe('H105: filler breakdown', () => {
  const run = triggered('fillerBreakdown');
  const seen = firstTimes(run, hToS(2), {
    aRepair: (snap) => snap.packs.fillers[0]?.state === 'repair',
    stage7Red: (snap) => snap.stages[7].status === 'bad',
    throttled: (snap) => snap.liquid.throttled,
  });
  const end = run.sim.snapshot();
  const log = firstRun(end).log;

  it('stops filler A at once for 60 min of repair and 2 min of re-sterilizing', () => {
    expect(seen.aRepair).toBeLessThanOrEqual(1);
    expect(seen.stage7Red).toBeLessThanOrEqual(1);
    expect(at(run, log, /Filler A broke down/)).toBe(0);
    expect(at(run, log, /Filler A repaired/)).toBe(spec.fillerRepairS);
    expect(at(run, log, /Filler A sterile/)).toBe(spec.fillerRepairS + plantConfig.fillers.repairFixedS);
    expect(end.packs.fillers[0]?.breakdowns).toBe(1);
  });

  it('lets the tank rise 8,500 L/h to 90% at 3,388.2 s, throttles, and is back to full flow below 60% at 6,829.4 s', () => {
    expectWithin(at(run, log, /throttled to 50%/), (8_000 / 8_500) * 3_600, 0.5);
    expectWithin(seen.throttled ?? Number.NaN, (8_000 / 8_500) * 3_600, 1);
    // 18,000 L + 500 L/h until 3,720 s, then down 7,000 L/h to 12,000 L.
    const backS = 3_720 + ((18_000 + (500 * (3_720 - (8_000 / 8_500) * 3_600)) / 3_600 - 12_000) / 7_000) * 3_600;
    expectWithin(at(run, log, /back to full flow/), backS, 0.5);
    expect(firstRun(end).following).toBe(false);
  });

  it('costs line A 3,720 s of packs: 7,750 fewer than line B', () => {
    const [a, b] = end.packs.fillers;
    expectWithin((b?.packsMade ?? 0) - (a?.packsMade ?? 0), 7_750, 2);
  });
});

describe('H106: sterile-air filter failure', () => {
  // A packs stream that notes each chance it is asked for, to see the incubation verdicts' odds.
  const chances: number[] = [];
  const seeded = createRng(packsSeed(plantConfig.seed));
  const noting: Rng = { ...seeded, chance: (probability) => (chances.push(probability), seeded.chance(probability)) };
  const run = triggered('sterileAirFilterFailure', undefined, { speed: 10_000, packsRng: noting });
  const early = run.sim.snapshot();
  const stage6 = firstTimes(run, hToS(2.2), { ok: (snap) => run.t() > hToS(2) && snap.stages[6].status === 'ok' });
  const flagged = early.packs.batches.filter((batch) => batch.flags.includes('sterileAir')).map((batch) => batch.id);
  const verdictS = hToS(8) + dayToS(plantConfig.quality.incubationDays);
  const end = run.runTo(verdictS + 60);
  const log = firstRun(end).log;

  it('puts the batches filling now, 54 and 55, under investigation, with the aseptic tank amber for the 2 h deviation', () => {
    expect(flagged).toEqual([54, 55]);
    expect(early.stages[6].status).toBe('warn');
    expect(log[0]?.message).toBe('Sterile-air filter on the aseptic tank fails its integrity test: process deviation, batches 54 and 55 under investigation');
    expect(at(run, log, /filter replaced/)).toBe(spec.filterReplaceS);
    expect(stage6.ok).toBeLessThanOrEqual(hToS(2) + 1_000);
  });

  it('judges them a week after their shift ends with a 5% spoil chance per sample: 1 − 0.95^n per batch', () => {
    const verdicts = log.filter((entry) => /Batch 5[45] /.test(entry.message));
    expect(verdicts).toHaveLength(2);
    for (const entry of verdicts) expectWithin(entry.timeS - run.openS, verdictS, 1e-6);
    // The odds asked for at the verdicts: 1 − 0.95^n for each flagged batch's samples, among the 0.02% ones.
    const raised = chances.filter((p) => p > 0.1);
    expect(raised).toHaveLength(2);
    for (const p of raised) {
      const samples = Math.log(1 - p) / Math.log(0.95);
      expectWithin(samples, Math.round(samples), 1e-9);
      expect(Math.round(samples)).toBeGreaterThanOrEqual(16);
    }
    expect(firstRun(end).following).toBe(false);
  });
});

describe('H107: failed incubation', () => {
  const run = triggered('failedIncubation', undefined, { speed: 10_000 });
  const open = run.sim.snapshot();
  const batch12 = open.packs.batches.find((batch) => batch.id === 12);
  const end = run.runTo(dayToS(1) + 60);
  const log = firstRun(end).log;

  it('blocks the oldest batch on hold, 12, at once: red in quarantine, one fewer on hold, one blocked', () => {
    expect(batch12?.status).toBe('blocked');
    expect(batch12?.qaResult).toBe('fail');
    expect(open.kpis.batchesOnHold).toBe(41);
    expect(open.kpis.batchesBlocked).toBe(1);
    expect(open.stages[9].status).toBe('bad');
    expect(log[0]?.message).toBe(`Batch 12 failed incubation: a blown pack at the incubator check: ${batch12?.pallets} pallets blocked`);
  });

  it('sends its pallets to destruction a day later', () => {
    expect(at(run, log, /left quarantine for destruction/)).toBe(plantConfig.quality.blockedHoldS);
    expect(end.packs.warehouse.palletsDestroyed).toBe(batch12?.pallets);
    expect(firstRun(end).following).toBe(false);
  });
});

describe('H108: homogenizer pressure loss', () => {
  const run = triggered('homogenizerPressureLoss', undefined, { speed: 10_000 });
  const during = run.sim.snapshot();
  const verdictS = hToS(8) + dayToS(plantConfig.quality.incubationDays);
  const after = run.runTo(hToS(1) + 60);
  const end = run.runTo(verdictS + 60);
  const log = firstRun(end).log;

  it('holds stage 1 at 50 bar for 1 h: globules 1.84 µm, creaming risk 83.8%, outlet 78 °C, stage 3 red', () => {
    const values = during.stages[3].values;
    expect(values.stage1Bar).toBe(50);
    expectWithin(values.globuleUm ?? Number.NaN, 0.8 * 4 ** 0.6, 1e-9);
    expectWithin(values.creamingRiskPct ?? Number.NaN, 83.79, 0.01);
    expectWithin(values.outletTempC ?? Number.NaN, 78, 1e-9);
    expect(during.stages[3].status).toBe('bad');
    expect(after.stages[3].values.stage1Bar).toBe(200);
    expect(after.stages[3].status).toBe('ok');
    expect(at(run, log, /Homogenizer repaired/)).toBe(spec.homogenizerRepairS);
  });

  it('flags batches 54 and 55 with the creaming risk, and the sensory check blocks both when their incubation ends', () => {
    const flagged = during.packs.batches.filter((batch) => batch.flags.includes('creaming'));
    expect(flagged.map((batch) => batch.id)).toEqual([54, 55]);
    for (const batch of flagged) expectWithin(batch.creamingRiskPct, 83.79, 0.01);
    const blocked = log.filter((entry) => /failed the sensory check: a cream layer \(creaming risk 84%\)/.test(entry.message));
    expect(blocked.map((entry) => entry.message.slice(0, 8))).toEqual(['Batch 54', 'Batch 55']);
    for (const entry of blocked) expectWithin(entry.timeS - run.openS, verdictS, 1e-6);
  });
});

describe('H109: demand spike and late trucks', () => {
  it('demand spike: 12 extra trucks every 5 min; at most 3 wait in the yard; the last leaves at 5,400 s with stock down 264 to 370', () => {
    const run = triggered('demandSpikeOrLateTruck', 'demandSpike');
    let yard = 0;
    run.runTo(5_500, (snap) => {
      yard = Math.max(yard, snap.packs.warehouse.trucks.filter((truck) => truck.door < 0).length);
    });
    const end = run.sim.snapshot();
    const scenario = firstRun(end);
    expect(yard).toBe(3);
    expect(scenario.variant).toBe('demandSpike');
    const last = scenario.log.at(-1);
    expect(last?.message).toMatch(/^Truck 12 left with 22 pallets/);
    expect(last?.why).toBe('The last extra truck leaves the dock: stock is now 370 pallets, 1.2 days of cover.');
    expect((last?.timeS ?? 0) - run.openS).toBe(5_400);
    expect(end.packs.warehouse.palletsInStock).toBe(634 - 12 * 22);
    expectWithin(end.kpis.daysOfCover, 370 / 316.8, 1e-9);
    // Only the 3 that found a free door on arrival count as filled (D2).
    expect(end.kpis.orderFillPct).toBe(25);
    expect(scenario.following).toBe(false);
  });

  it('late trucks: none until 24,000 s, then the 4 due arrive together, 1 waits in the yard, the last leaves at 26,400 s', () => {
    const run = triggered('demandSpikeOrLateTruck', 'lateTrucks', { speed: 1_000 });
    expect(run.sim.snapshot().packs.warehouse.nextTruckS - run.openS).toBe(spec.lateTruckDelayS);
    const mid = run.runTo(spec.lateTruckDelayS - 60);
    expect(mid.packs.warehouse.trucksArrived).toBe(0);
    expect(mid.packs.warehouse.palletsInStock).toBe(634);
    const end = run.runTo(27_000);
    const log = firstRun(end).log;
    expect(at(run, log, /4 late trucks arrive together/)).toBe(spec.lateTruckDelayS);
    expect(log.filter((entry) => /waiting in the yard/.test(entry.message))).toHaveLength(1);
    expect(log.at(-1)?.why).toMatch(/^The last late truck leaves the dock/);
    expect((log.at(-1)?.timeS ?? 0) - run.openS).toBe(26_400);
    expect(end.packs.warehouse.palletsInStock).toBe(634 - 4 * 22);
    expect(end.kpis.orderFillPct).toBe(75);
    // The schedule goes on from the next truck due: 30,000 s.
    expect(end.packs.warehouse.nextTruckS - run.openS).toBe(30_000);
  });
});

describe('H110: resets, and what cannot start', () => {
  it('a reset before the divert restores the steam: no divert, the run called off', () => {
    const run = triggered('uhtTempDrop');
    run.runTo(1);
    run.sim.dispatch({ type: 'resetScenarios' });
    const end = run.runTo(600);
    expect(end.liquid.divertCount).toBe(0);
    expect(firstRun(end).summary).toBe('Called off before the divert');
    expect(firstRun(end).log.at(-1)?.message).toBe('Steam supply restored before the plant diverted');
  });

  it('a reset ends a repair: the filler re-sterilizes for 2 min and runs again', () => {
    const run = triggered('fillerBreakdown');
    run.runTo(600);
    run.sim.dispatch({ type: 'resetScenarios' });
    const end = run.runTo(800);
    const log = firstRun(end).log;
    expect(at(run, log, /Filler A repaired/)).toBe(600);
    expect(at(run, log, /Filler A sterile/)).toBe(720);
    expect(end.packs.fillers[0]?.state).toBe('running');
  });

  it('a reset replaces the filter and repairs the homogenizer at once; the batches stay under investigation', () => {
    const run = startPacks(copyConfig());
    run.sim.dispatch({ type: 'triggerScenario', id: 'sterileAirFilterFailure' });
    run.sim.dispatch({ type: 'triggerScenario', id: 'homogenizerPressureLoss' });
    run.runTo(600);
    run.sim.dispatch({ type: 'resetScenarios' });
    const end = run.runTo(660);
    expect(end.stages[3].values.stage1Bar).toBe(200);
    expect(end.stages[6].status).toBe('ok');
    for (const scenario of end.scenarios.runs) expect(scenario.endedS === null ? NaN : scenario.endedS - run.openS).toBe(600);
    expect(end.packs.batches.find((batch) => batch.id === 54)?.flags).toEqual(['sterileAir', 'creaming']);
    // Nothing queued to end them any more.
    run.runTo(hToS(3));
    expect(run.sim.snapshot().log.filter((entry) => /replaced|repaired: stage/.test(entry.message))).toHaveLength(2);
  });

  it('a reset calls off the extra trucks still to come, and brings held-up trucks now', () => {
    const spike = triggered('demandSpikeOrLateTruck', 'demandSpike');
    spike.runTo(610);
    spike.sim.dispatch({ type: 'resetScenarios' });
    expect(spike.sim.snapshot().log[0]?.message).toBe('Demand spike called off: 9 extra trucks cancelled');
    const late = triggered('demandSpikeOrLateTruck', 'lateTrucks');
    late.runTo(6_500);
    late.sim.dispatch({ type: 'resetScenarios' });
    expect(late.sim.snapshot().packs.warehouse.trucks).toHaveLength(1);
    expect(late.sim.snapshot().packs.warehouse.nextTruckS - late.openS).toBe(12_000);
  });

  it('says why a scenario cannot start: no batch on hold, both fillers down, trucks already disrupted', () => {
    const empty = startPacks(emptyPlantConfig());
    expect(empty.sim.snapshot().scenarios.unavailable.failedIncubation).toBe('No batch is on hold');
    const fillers = triggered('fillerBreakdown');
    fillers.sim.dispatch({ type: 'triggerScenario', id: 'fillerBreakdown' });
    expect(fillers.sim.snapshot().scenarios.runs.map((run) => run.summary.slice(0, 8))).toEqual(['Filler B', 'Filler A']);
    expect(fillers.sim.snapshot().scenarios.unavailable.fillerBreakdown).toBe('Every filler is down already');
    const trucks = triggered('demandSpikeOrLateTruck', 'lateTrucks');
    expect(trucks.sim.snapshot().scenarios.unavailable.demandSpikeOrLateTruck).toBe('Trucks are disrupted already');
    expect(startPacks(copyConfig()).sim.snapshot().scenarios.unavailable).toEqual({});
  });
});

describe('two faults on the same batches (phase 6 bug bash)', () => {
  it('judges each batch once: the fault that blocked it tells why, and both runs end', () => {
    const run = startPacks(copyConfig(), { speed: 10_000 });
    run.sim.dispatch({ type: 'triggerScenario', id: 'homogenizerPressureLoss' });
    run.sim.dispatch({ type: 'triggerScenario', id: 'sterileAirFilterFailure' });
    const end = run.runTo(hToS(8) + dayToS(plantConfig.quality.incubationDays) + 60);
    const byId = (id: ScenarioId) => end.scenarios.runs.find((each) => each.id === id);
    const homogenizer = byId('homogenizerPressureLoss');
    const filter = byId('sterileAirFilterFailure');
    for (const each of [homogenizer, filter]) {
      expect(each?.following, each?.id).toBe(false);
      expect(each?.summary, each?.id).toBe('Over: every batch judged');
    }
    for (const id of [54, 55]) {
      const verdict = (entries: readonly LogEntry[]) => entries.filter((entry) => entry.message.startsWith(`Batch ${id} `) && /passed|blocked/.test(entry.message));
      expect(verdict(end.log), `batch ${id} judged once`).toHaveLength(1);
      const [entry] = verdict(end.log);
      const tellers = [homogenizer, filter].filter((each) => verdict(each?.log ?? []).length > 0).map((each) => each?.id);
      if (/spoiled/.test(entry?.message ?? '')) expect(tellers).toEqual(['sterileAirFilterFailure']);
      else if (/sensory check/.test(entry?.message ?? '')) expect(tellers).toEqual(['homogenizerPressureLoss']);
      else expect(tellers).toHaveLength(1);
    }
  });
});

describe('the same seed gives the same scenario log', () => {
  const play = (): unknown => {
    const run = startPacks(copyConfig(), { speed: 1_000 });
    run.sim.dispatch({ type: 'triggerScenario', id: 'fillerBreakdown' });
    run.runTo(1_800);
    run.sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
    run.sim.dispatch({ type: 'triggerScenario', id: 'demandSpikeOrLateTruck', variant: 'demandSpike' });
    run.runTo(hToS(4));
    return run.sim.snapshot().scenarios;
  };

  it('twice over, entry for entry', () => {
    const first = play();
    expect(play()).toEqual(first);
    expect(JSON.stringify(first)).toContain('Steam supply dips');
  });
});
