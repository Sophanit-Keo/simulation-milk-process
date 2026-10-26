// The phase 3 acceptance runs of plan/hand-calculations.md (H76–H96), run through createSim as the
// rows describe: phase3Config() (day 1 06:00, no filler breakdowns), only the named keys changed, seed 81006,
// t = snapshot.timeS − 21,600.
import { describe, expect, it } from 'vitest';
import type { PlantConfig, Sim, Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import type { LiquidLine } from '../../src/sim/liquidLine';
import { expectWithin } from '../helpers/expectWithin';
import { phase3Config } from '../helpers/plantConfig';

const OPEN_S = 21_600;
const quiet = (change: (config: PlantConfig) => void = () => {}): PlantConfig => {
  const config = phase3Config();
  config.uht.displayNoiseC = 0;
  change(config);
  return config;
};

interface Run {
  sim: Sim;
  line: LiquidLine;
  /** Sim time since the plant opened. */
  t(): number;
  /** Steps until t, calling `each` with every snapshot along the way. */
  runTo(tS: number, each?: (snap: Snapshot) => void): Snapshot;
}

function start(config: PlantConfig, speed: 10 | 1_000 | 10_000 = 10): Run {
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
        // Whole 0.1 s frames, and a shorter last one, so a fast run does not overshoot the target.
        sim.step(Math.min(0.1, (tS - t()) / sim.snapshot().speed));
        each?.(sim.snapshot());
      }
      return sim.snapshot();
    },
  };
}

describe('normal run (H76–H87)', () => {
  it('H76–H82: the line and stages 1–6 at t = 600 s, noise off', () => {
    const run = start(quiet());
    const opening = run.sim.snapshot();
    expect(opening.stages[6].values.nextCleanS).toBe(36_000);
    expect(opening.liquid).toMatchObject({ throttled: false, fillersRunning: 2, fillersStarved: false, divertCount: 0, modeRemainingS: 0 });
    const snap = run.runTo(600);
    expectWithin(snap.line.silo.flowLph, 16_222.22, 0.01);
    expect(snap.line.preheater.tempC).toBe(80);
    expectWithin(snap.line.homogenizer.tempC, 81.75, 0.001);
    expect(snap.line.divert.flowLph).toBe(0);
    expect(snap.line.filler.flowLph).toBe(15_000);
    expectWithin(snap.stages[1].values.mixTankLevelPct, 50, 0.5);
    const four = snap.stages[4].values;
    expectWithin(four.f0Min, 5.175, 0.001);
    expectWithin(four.bStar, 1.1856, 0.0001);
    expectWithin(four.divertLimitC, 139.224, 0.001);
    expectWithin(snap.stages[6].values.levelL, 10_166.67, 0.01);
    expectWithin(snap.stages[6].values.nextCleanS, 35_400, 1);
  });

  it('H83–H87: 24 h at ×1,000: rise, one throttle, two cleans, the end level', () => {
    const run = start(quiet(), 1_000);
    const modes: { tS: number; mode: string }[] = [];
    let lowestL = Infinity;
    let throttles = 0;
    let wasThrottled = false;
    run.runTo(86_400, (snap) => {
      const { uhtMode, throttled } = snap.liquid;
      if (modes.at(-1)?.mode !== uhtMode) modes.push({ tS: snap.timeS - OPEN_S, mode: uhtMode });
      if (throttled && !wasThrottled) throttles++;
      wasThrottled = throttled;
      lowestL = Math.min(lowestL, snap.liquid.tanks.asepticTank.levelL);
      if (snap.timeS - OPEN_S === 14_400) expectWithin(snap.stages[6].values.levelL, 14_000, 0.1);
    });
    expect(throttles).toBe(1);
    // ×1,000 samples every 100 s, so each mode change is seen at the first sample after it.
    expect(modes.map((entry) => entry.mode)).toEqual(['production', 'aic', 'production', 'aic', 'production']);
    expect(modes.map((entry) => entry.tS)).toEqual([100, 36_000, 37_800, 73_800, 75_600]);
    expectWithin(lowestL, 5_642.86, 5);
    expectWithin(run.line.state.asepticL, 11_142.86, 5);
    expectWithin(run.line.totals.toAsepticL, 361_142.86, 5);
    expectWithin(run.line.totals.toFillersL, 360_000, 5);
    expect(run.line.state.divertCount).toBe(0);
    expect(run.line.state.fillersStarved).toBe(false);
    // H95 without faults: 366,158.73 L drawn and 5,015.87 L of cream when the mixing tank ends at its start level.
    expectWithin(run.line.state.mixTankL, 5_000, 0.01);
    expectWithin(run.line.totals.rawDrawnL, 366_158.73, 0.5);
    expectWithin(run.line.totals.surplusCreamL, 5_015.87, 0.5);
  });

  it('H84–H85: the throttle switches at 28,800 s and back at 31,885.7 s, once each way', () => {
    const run = start(quiet(), 1_000);
    run.runTo(28_700);
    const switches: number[] = [];
    let wasThrottled = false;
    // Back to ×10 for 1 s samples around the switches.
    run.sim.dispatch({ type: 'setSpeed', speed: 10 });
    run.runTo(32_000, (snap) => {
      if (snap.liquid.throttled !== wasThrottled) switches.push(snap.timeS - OPEN_S);
      wasThrottled = snap.liquid.throttled;
      if (snap.timeS - OPEN_S === 28_801) {
        expectWithin(snap.line.silo.flowLph, 8_111.11, 0.01);
        expect(snap.line.cooler.flowLph).toBe(8_000);
        expectWithin(snap.stages[6].values.nextCleanS, 7_200, 1);
      }
    });
    expect(switches).toHaveLength(2);
    expectWithin(switches[0], 28_800, 1);
    expectWithin(switches[1], 31_885.7, 3);
  });
});

describe('set 139 °C: divert (H88–H91)', () => {
  it('H88–H90: noise off, 139 °C diverts on the first step; 800 L rejected; back in production at 6,780 s', () => {
    const run = start(quiet());
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 139 });
    run.sim.step(0.1);
    const first = run.sim.snapshot();
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 140 });
    expect(first.liquid.uhtMode).toBe('divert');
    expect(first.liquid.divertCount).toBe(1);
    expect(first.stages[4].status).toBe('bad');
    expectWithin(first.stages[4].values.bStar, 0.9521, 0.0001);
    expectWithin(first.stages[4].values.f0Min, 4.111, 0.001);
    expect(first.line.divert.flowLph).toBe(16_000);
    expect(first.line.flashVessel.flowLph).toBe(0);
    const changes: { tS: number; mode: string }[] = [];
    let starvedAtS: number | undefined;
    run.runTo(7_000, (snap) => {
      const tS = snap.timeS - OPEN_S;
      if (changes.at(-1)?.mode !== snap.liquid.uhtMode) changes.push({ tS, mode: snap.liquid.uhtMode });
      if (snap.liquid.fillersStarved && starvedAtS === undefined) starvedAtS = tS;
      if (tS === 181) {
        expectWithin(snap.liquid.tanks.rejectTank.levelL, 800, 5);
        expectWithin(snap.kpis.divertedL, 800, 5);
      }
      if (tS > 2_364 && tS < 6_780) expectWithin(snap.liquid.tanks.asepticTank.levelL, 150, 4.17);
    });
    expect(changes).toEqual([
      { tS: 2, mode: 'divert' },
      { tS: 180, mode: 'cip' },
      { tS: 4_980, mode: 'sterilize' },
      { tS: 6_780, mode: 'production' },
    ]);
    expectWithin(starvedAtS ?? Number.NaN, 2_364, 2);
    expect(run.line.state.divertCount).toBe(1);
    expect(run.line.state.productionSinceCleanS).toBe(220);
  });

  it('H88: with the default noise, 138.9 °C diverts on the first step', () => {
    const sim = createSim(phase3Config());
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138.9 });
    sim.step(0.1);
    expect(sim.snapshot().liquid.uhtMode).toBe('divert');
  });

  it('H91: at 50% flow 139 °C does not divert, 135.5 °C does, and the reject tank gains 400 L', () => {
    const run = start(withStart(0.95));
    run.runTo(60);
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 139 });
    run.runTo(120);
    expect(run.line.state.divertCount).toBe(0);
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 135.5 });
    run.sim.step(0.1);
    expect(run.sim.snapshot().liquid.uhtMode).toBe('divert');
    const snap = run.runTo(300);
    expect(snap.liquid.throttled).toBe(true);
    expectWithin(snap.liquid.tanks.rejectTank.levelL, 400, 5);
  });
});

function withStart(frac: number): PlantConfig {
  const config = phase3Config();
  config.asepticTank.startFrac = frac;
  return config;
}

describe('throttle to 50% and a covered clean (H92–H94)', () => {
  it('H92–H93: 8 s hold from the first step, back to full flow at 3,600 s', () => {
    const run = start(quiet((config) => (config.asepticTank.startFrac = 0.95)));
    let snap = run.runTo(60);
    expect(snap.liquid.throttled).toBe(true);
    const four = snap.stages[4].values;
    expect(four.flowLph).toBe(8_000);
    expectWithin(four.holdS, 8, 0.001);
    expectWithin(four.bStar, 2.3712, 0.0001);
    expectWithin(four.f0Min, 10.35, 0.001);
    expectWithin(four.divertLimitC, 136.063, 0.001);
    expectWithin(snap.stages[1].values.surplusCreamLph, 111.11, 0.01);
    expectWithin(snap.liquid.tanks.asepticTank.levelL, 18_883.33, 5);
    snap = run.runTo(3_599);
    expect(snap.liquid.throttled).toBe(true);
    snap = run.runTo(3_601);
    expect(snap.liquid.throttled).toBe(false);
    expectWithin(snap.stages[4].values.holdS, 4, 0.001);
    expectWithin(snap.stages[4].values.bStar, 1.1856, 0.0001);
  });

  it('H94: a clean from about 10,000 L, 10 s after opening, draws exactly 7,500 L and never starves the fillers', () => {
    const run = start(quiet((config) => (config.cleaning.aicEveryProductionS = 10)));
    let atStartL = Number.NaN;
    let atEndL = Number.NaN;
    run.runTo(1_900, (snap) => {
      const tS = snap.timeS - OPEN_S;
      if (tS === 10) atStartL = snap.liquid.tanks.asepticTank.levelL;
      if (tS === 1_810) atEndL = snap.liquid.tanks.asepticTank.levelL;
      if (tS > 10 && tS < 1_810) {
        expect(snap.liquid.uhtMode).toBe('aic');
        expect(snap.liquid.fillersRunning).toBe(2);
      }
    });
    expectWithin(atStartL, 10_002.78, 5);
    expectWithin(atEndL, 2_502.78, 5);
  });
});

describe('step size (H96)', () => {
  it('24 h at 1 s steps and at 60 s steps agree within 1%, with the same throttles, cleans and diverts', () => {
    const counts = (run: Run) => {
      let throttles = 0;
      let cleans = 0;
      let last = run.sim.snapshot();
      run.runTo(86_400, (snap) => {
        if (snap.liquid.throttled && !last.liquid.throttled) throttles++;
        if (snap.liquid.uhtMode === 'aic' && last.liquid.uhtMode !== 'aic') cleans++;
        last = snap;
      });
      return { throttles, cleans, diverts: run.line.state.divertCount };
    };
    const fine = start(phase3Config(), 1_000);
    const coarse = start(
      (() => {
        const config = phase3Config();
        config.clock.fastStepS = 60;
        return config;
      })(),
      10_000,
    );
    expect(counts(fine)).toEqual({ throttles: 1, cleans: 2, diverts: 0 });
    expect(counts(coarse)).toEqual({ throttles: 1, cleans: 2, diverts: 0 });
    for (const key of ['asepticL', 'siloL', 'mixTankL'] as const) {
      expect(Math.abs(fine.line.state[key] - coarse.line.state[key]) / fine.line.state[key], key).toBeLessThan(0.01);
    }
    for (const key of ['rawDrawnL', 'toFillersL'] as const) {
      expect(Math.abs(fine.line.totals[key] - coarse.line.totals[key]) / fine.line.totals[key], key).toBeLessThan(0.01);
    }
  });
});
