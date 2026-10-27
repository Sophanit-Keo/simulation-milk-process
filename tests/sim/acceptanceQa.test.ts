// The parts of the phase 3 acceptance rows (plan/hand-calculations.md, H76–H96) that acceptance.test.ts
// checks only in part, as process listed them at sign-off (plan/agent-plan/phase-3-liquid-line.md): the
// rest of H76–H82, H86's zero flows and nextCleanS reset, H88 with the default noise over many seeds, H83's
// 4 h read made unskippable, and H95 through createSim with H88's divert at t = 0. Run as the rows say:
// phase3Config() (day 1 06:00, no filler breakdowns), only the named keys changed, seed 81006,
// t = snapshot.timeS − 21,600, tolerances from the rows.
import { describe, expect, it } from 'vitest';
import { LINE_POINT_IDS, type LinePointId, type PlantConfig, type Sim, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import type { LiquidLine } from '../../src/sim/liquidLine';
import { expectWithin } from '../helpers/expectWithin';
import { phase3Config } from '../helpers/plantConfig';

const OPEN_S = 21_600;
const quiet = (): PlantConfig => {
  const config = phase3Config();
  config.uht.displayNoiseC = 0;
  return config;
};

interface Run {
  sim: Sim;
  line: LiquidLine;
  t(): number;
  /** Steps until t, calling `each` with every snapshot along the way. */
  runTo(tS: number, each?: (snap: Snapshot) => void): Snapshot;
}

function start(config: PlantConfig, speed: 10 | 1_000 = 10): Run {
  let line: LiquidLine | undefined;
  const sim = createSim(config, { onLiquidLine: (created) => (line = created) });
  if (!line) throw new Error('no liquid line');
  if (speed !== 10) sim.dispatch({ type: 'setSpeed', speed });
  const t = () => sim.snapshot().timeS - OPEN_S;
  return {
    sim,
    line,
    t,
    runTo(tS, each) {
      while (t() < tS) {
        sim.step(Math.min(0.1, (tS - t()) / sim.snapshot().speed));
        each?.(sim.snapshot());
      }
      return sim.snapshot();
    },
  };
}

/** H88's divert: 139 °C for the first step at ×10, then 140 °C again. */
function divertAtStart(run: Run): Snapshot {
  run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 139 });
  const speed = run.sim.snapshot().speed;
  run.sim.step(1 / speed); // one 1 s step
  const first = run.sim.snapshot();
  run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 140 });
  return first;
}

describe('normal run, the rest of H76–H82', () => {
  it('H76: every line point at t = 600 s, noise off', () => {
    const snap = start(quiet()).runTo(600);
    const expected: Record<LinePointId, [tempC: number, flowLph: number]> = {
      silo: [4, 16_222.22],
      separator: [60, 16_000],
      feedTank: [4, 16_000],
      preheater: [80, 16_000],
      deaerator: [76, 16_000],
      homogenizer: [81.75, 16_000],
      holdingTube: [140, 16_000],
      divert: [140, 0],
      flashVessel: [80, 16_000],
      cooler: [20, 16_000],
      asepticTank: [20, 15_000],
      filler: [20, 15_000],
    };
    for (const id of LINE_POINT_IDS) {
      const [tempC, flowLph] = expected[id];
      expect(Math.abs(snap.line[id].tempC - tempC), `${id}: ${snap.line[id].tempC} °C`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(snap.line[id].flowLph - flowLph), `${id}: ${snap.line[id].flowLph} L/h`).toBeLessThanOrEqual(0.01);
    }
  });

  it('H77–H79, H81: stages 1, 2, 3 and 5 at t = 600 s, noise off', () => {
    const config = quiet();
    const { stages, line } = start(config).runTo(600);
    const one = stages[1].values;
    expectWithin(one.rawMilkLph, 16_222.22, 0.01);
    expectWithin(one.surplusCreamLph, 222.22, 0.01);
    expectWithin(one.creamShareFrac, 0.08636, 0.00001);
    expect(one.rawMilkFatPct).toBe(4);
    expect(one.productFatPct).toBe(3.5);
    expectWithin(one.mixTankLevelPct, 50, 0.5);
    expect(one.siloLevelPct).toBeGreaterThan(0);
    expect(one.siloLevelPct).toBeLessThanOrEqual(100);

    expectWithin(stages[2].values.preheatTempC, 80, 0.01);
    expectWithin(stages[2].values.deaeratorTempC, 76, 0.01);

    const three = stages[3].values;
    expect(three.stage1Bar).toBe(200);
    expect(three.stage2Bar).toBe(30);
    expectWithin(three.inletTempC, 76, 0.001);
    expectWithin(three.outletTempC, 81.75, 0.001);
    // Context in H79: 102.22 kW hydraulic at 16,000 L/h and 230 bar, before the D13 efficiency.
    expectWithin(three.powerKw * config.homogenizer.efficiencyFrac, 102.22, 0.01);

    expectWithin(stages[5].values.flashTempC, 80, 0.01);
    expectWithin(stages[5].values.coolerTempC, 20, 0.01);
    expectWithin(line.flashVessel.flowLph, 16_000, 0.01);
    expectWithin(line.cooler.flowLph, 16_000, 0.01);
  });

  it('H80: stage 4 and the KPIs at t = 600 s, noise off', () => {
    const snap = start(quiet()).runTo(600);
    const four = snap.stages[4].values;
    expect(four.setpointC).toBe(140);
    expect(four.tempC).toBe(140);
    expect(four.flowLph).toBe(16_000);
    expectWithin(four.holdS, 4, 0.001);
    expectWithin(four.f0Min, 5.175, 0.001);
    expectWithin(four.bStar, 1.1856, 0.0001);
    expectWithin(four.divertLimitC, 139.224, 0.001);
    expect(four.rejectLevelL).toBe(0);
    expect(snap.kpis.uhtFlowLph).toBe(16_000);
    expect(snap.kpis.f0Min).toBe(four.f0Min);
    expect(snap.kpis.bStar).toBe(four.bStar);
    expect(snap.kpis.divertedL).toBe(0);
    expect(snap.liquid.uhtMode).toBe('production');
  });

  it('H80: with the default noise, every step of 2 h stays in the bands (tempC 139.7–140.3, B* 1.1101–1.2662, F0 4.830–5.545) and stage 4 is never red', () => {
    const run = start(phase3Config());
    const seenC: number[] = [];
    run.runTo(7_200, (snap) => {
      const four = snap.stages[4].values;
      const where = `t = ${snap.timeS - OPEN_S} s`;
      seenC.push(four.tempC);
      if (!(four.tempC >= 139.7 && four.tempC <= 140.3)) expect.fail(`${where}: tempC ${four.tempC}`);
      if (!(four.bStar >= 1.1101 - 0.0001 && four.bStar <= 1.2662 + 0.0001)) expect.fail(`${where}: bStar ${four.bStar}`);
      if (!(four.f0Min >= 4.83 - 0.001 && four.f0Min <= 5.545 + 0.001)) expect.fail(`${where}: f0Min ${four.f0Min}`);
      expectWithin(four.divertLimitC, 139.224, 0.001);
      expect(snap.stages[4].status, where).not.toBe('bad');
    });
    expect(seenC).toHaveLength(7_200);
    // The noise uses its band, both ways.
    expect(Math.min(...seenC)).toBeLessThan(139.75);
    expect(Math.max(...seenC)).toBeGreaterThan(140.25);
  });

  it('H82: stage 6 and the liquid snapshot at t = 0, and the tank at t = 600 s', () => {
    const run = start(quiet());
    const opening = run.sim.snapshot();
    expect(opening.timeS).toBe(OPEN_S);
    const six = opening.stages[6].values;
    expectWithin(six.levelL, 10_000, 0.01);
    expect(six.levelPct).toBe(50);
    expect(six.capacityL).toBe(20_000);
    expect(six.tempC).toBe(20);
    expectWithin(six.nextCleanS, 36_000, 1);
    expect(opening.liquid.tanks).toEqual({
      silo: { levelL: 60_000, capacityL: 100_000 },
      mixTank: { levelL: 5_000, capacityL: 10_000 },
      asepticTank: { levelL: 10_000, capacityL: 20_000 },
      rejectTank: { levelL: 0, capacityL: 6_000 },
    });
    expect(opening.liquid).toMatchObject({ throttled: false, fillersRunning: 2, fillersStarved: false, divertCount: 0, modeRemainingS: 0 });
    expect(opening.kpis.tankLevelPct).toBe(50);

    const later = run.runTo(600).stages[6].values;
    expectWithin(later.inflowLph, 16_000, 0.01);
    expectWithin(later.outflowLph, 15_000, 0.01);
    expectWithin(later.levelL, 10_166.67, 0.01);
    expectWithin(later.nextCleanS, 35_400, 1);
    expect(later.headspaceBar).toBeGreaterThan(0);
    expect(later.headspaceBar).toBeLessThanOrEqual(3);
  });
});

describe('H83: the tank rises 1,000 L/h', () => {
  it('reads 14,000 L at t = 14,400 s (a sample must land there), and every frame moves by (inflow − outflow) × time', () => {
    const run = start(quiet(), 1_000);
    let atFourHoursL: number | undefined;
    let last = run.sim.snapshot();
    run.runTo(14_400, (snap) => {
      const dtS = snap.timeS - last.timeS;
      const { inflowLph, outflowLph } = last.stages[6].values;
      expectWithin(snap.stages[6].values.levelL - last.stages[6].values.levelL, ((inflowLph - outflowLph) * dtS) / 3_600, 1e-6);
      if (snap.timeS - OPEN_S === 14_400) atFourHoursL = snap.stages[6].values.levelL;
      last = snap;
    });
    if (atFourHoursL === undefined) expect.fail('no snapshot landed on t = 14,400 s');
    expectWithin(atFourHoursL, 14_000, 0.1);
    expectWithin(run.sim.snapshot().stages[6].values.levelPct, 70, 0.001);
  });
});

describe('H86: the first intermediate clean', () => {
  it('nothing flows from the feed tank to the cooler, the timer counts down from 1,800 s, the fillers keep drawing, and nextCleanS goes back to 36,000', () => {
    const run = start(quiet(), 1_000);
    run.runTo(35_900);
    run.sim.dispatch({ type: 'setSpeed', speed: 10 }); // 1 s samples around the clean
    const inClean: Snapshot[] = [];
    let resumed: Snapshot | undefined;
    run.runTo(37_900, (snap) => {
      if (snap.liquid.uhtMode === 'aic') inClean.push(snap);
      else if (inClean.length > 0 && !resumed) resumed = snap;
    });
    expect(inClean.length).toBeGreaterThan(0);
    expectWithin(inClean[0].timeS - OPEN_S, 36_000, 1);
    expectWithin(inClean[0].liquid.modeRemainingS, 1_800, 1);
    expectWithin(inClean[0].stages[6].values.levelL, 13_142.86, 5);
    let lastRemainingS = Infinity;
    for (const snap of inClean) {
      const where = `t = ${snap.timeS - OPEN_S} s`;
      for (const id of ['feedTank', 'preheater', 'deaerator', 'homogenizer', 'holdingTube', 'divert', 'flashVessel', 'cooler'] as const) {
        expect(snap.line[id].flowLph, `${where}: ${id}`).toBe(0);
      }
      expect(snap.liquid.fillersRunning, where).toBe(2);
      expect(snap.liquid.fillersStarved, where).toBe(false);
      expect(snap.liquid.modeRemainingS, where).toBeLessThan(lastRemainingS);
      expectWithin(snap.liquid.modeRemainingS, 37_800 - (snap.timeS - OPEN_S), 1);
      lastRemainingS = snap.liquid.modeRemainingS;
    }
    if (!resumed) expect.fail('production did not resume by t = 37,900 s');
    expectWithin(resumed.timeS - OPEN_S, 37_800, 1);
    expectWithin(resumed.stages[6].values.nextCleanS, 36_000, 1);
    expectWithin(resumed.stages[6].values.levelL, 5_642.86, 5);
    expectWithin(inClean[0].stages[6].values.levelL - resumed.stages[6].values.levelL, 7_500, 5);
  });
});

describe('H88: 139 °C with the default noise', () => {
  it('diverts on the first step for 100 seeds, including steps whose reading is above the 139.224 °C limit, and 140 °C again does not stop it', () => {
    let readingAboveLimit = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const config = phase3Config();
      config.seed = seed;
      const run = start(config);
      const first = divertAtStart(run);
      const where = `seed ${seed}`;
      expect(first.timeS - OPEN_S, where).toBe(1);
      expect(first.liquid.uhtMode, where).toBe('divert');
      expect(first.liquid.divertCount, where).toBe(1);
      expect(first.stages[4].status, where).toBe('bad');
      expect(first.line.divert.flowLph, where).toBe(16_000);
      expect(first.line.flashVessel.flowLph, where).toBe(0);
      expect(first.line.cooler.flowLph, where).toBe(0);
      expect(first.log.filter((entry) => /diverting to the reject tank/.test(entry.message)), where).toHaveLength(1);
      if (first.stages[4].values.tempC > first.stages[4].values.divertLimitC) readingAboveLimit++;
      const later = run.runTo(181);
      expect(later.liquid.uhtMode, where).toBe('cip');
      expect(later.liquid.divertCount, where).toBe(1);
    }
    // About 13% of uniform draws within ±0.3 °C lift 139 °C over 139.224 °C.
    expect(readingAboveLimit).toBeGreaterThanOrEqual(3);
  });

  it('139.3 °C, above the limit, diverts only in a step whose reading falls under 139.224 °C', () => {
    const run = start(phase3Config());
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 139.3 });
    let diverted: Snapshot | undefined;
    run.runTo(600, (snap) => {
      if (diverted) return;
      const { tempC, divertLimitC } = snap.stages[4].values;
      if (snap.liquid.uhtMode === 'divert') {
        diverted = snap;
        expect(tempC, `t = ${snap.timeS - OPEN_S} s`).toBeLessThan(divertLimitC);
      } else {
        expect(tempC, `t = ${snap.timeS - OPEN_S} s`).toBeGreaterThanOrEqual(divertLimitC);
      }
    });
    expect(diverted).toBeDefined();
  });
});

describe('H95: mass balance over 24 h through createSim', () => {
  /** Drawn = fillers + divertedL + cream + Δ mixing tank + Δ aseptic tank, within 0.1% of the litres drawn. */
  function balance(run: Run, opening: Snapshot): { end: Snapshot; drawnL: number } {
    const end = run.runTo(86_400);
    const { totals } = run.line;
    const delta = (tank: 'mixTank' | 'asepticTank') => end.liquid.tanks[tank].levelL - opening.liquid.tanks[tank].levelL;
    const accountedL = totals.toFillersL + end.kpis.divertedL + totals.surplusCreamL + delta('mixTank') + delta('asepticTank');
    expect(Math.abs(totals.rawDrawnL - accountedL)).toBeLessThanOrEqual(0.001 * totals.rawDrawnL);
    return { end, drawnL: totals.rawDrawnL };
  }

  it('without faults: fillers 360,000 L, aseptic tank +1,142.86 L, nothing rejected', () => {
    const run = start(quiet(), 1_000);
    const opening = run.sim.snapshot();
    const { end, drawnL } = balance(run, opening);
    const tolL = 0.001 * drawnL;
    expectWithin(run.line.totals.toFillersL, 360_000, tolL);
    expectWithin(end.liquid.tanks.asepticTank.levelL - opening.liquid.tanks.asepticTank.levelL, 1_142.86, tolL);
    expect(end.kpis.divertedL).toBe(0);
  });

  it('with H88’s divert at t = 0: 800 L to the reject tank, counted although the CIP pumped the tank out', () => {
    const run = start(quiet(), 1_000);
    const opening = run.sim.snapshot();
    divertAtStart(run);
    const { end } = balance(run, opening);
    expectWithin(end.kpis.divertedL, 800, 5);
    expect(end.liquid.tanks.rejectTank.levelL).toBeLessThan(1e-6);
    expect(end.liquid.divertCount).toBe(1);
  });
});
