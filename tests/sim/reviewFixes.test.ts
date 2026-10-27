// Phase 3 review fixes for the sim: each test fails on the code before the fix.
import { describe, expect, it } from 'vitest';
import { checkPlantConfig, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { copyConfig, NO_BREAKDOWNS_MTBF_S, plantConfig } from '../helpers/plantConfig';
import { quietConfig, startLiquid } from '../helpers/liquidRun';

/** Steps a sim 1 sim second at a time (×10: 0.1 s of real time per step) and calls `each` after every step. */
function runSeconds(sim: ReturnType<typeof createSim>, seconds: number, each: (snap: Snapshot) => void): void {
  for (let i = 0; i < seconds; i++) {
    sim.step(0.1);
    each(sim.snapshot());
  }
}

describe('checkPlantConfig (review)', () => {
  it('refuses a fast step over 60 s (plan 06, D8), where one cut could drain the silo', () => {
    const config = copyConfig();
    config.clock.fastStepS = 61;
    expect(checkPlantConfig(config)).toContain('clock.fastStepS must be at most 60 s');
    config.clock.fastStepS = 60;
    expect(checkPlantConfig(config)).toEqual([]);
  });

  it('refuses raw-milk fat at or above the cream fat, which would need endless or negative raw milk', () => {
    for (const rawMilkFatPct of [40, 45]) {
      const config = copyConfig();
      config.standardization.rawMilkFatPct = rawMilkFatPct;
      expect(checkPlantConfig(config), `${rawMilkFatPct} %`).toContain('raw-milk fat must be below the cream fat');
    }
  });
});

describe('set points out of range', () => {
  it('are refused with a warning, and the plant keeps running on the last good value', () => {
    const sim = createSim(plantConfig);
    for (const [key, value] of [
      ['uhtSetpointC', 1e308],
      ['uhtSetpointC', 129.9],
      ['homogenizerStage1Bar', -500],
      ['homogenizerStage1Bar', 251],
      ['fillerRatePacksPerH', plantConfig.fillers.maxRatePacksPerH + 1],
      ['fillerRatePacksPerH', -1],
    ] as const) {
      sim.dispatch({ type: 'setSetpoint', key, value });
      expect(sim.snapshot().log[0]).toMatchObject({ kind: 'warn', message: expect.stringContaining('outside') });
    }
    sim.step(0.1);
    const { stages, kpis } = sim.snapshot();
    expect(stages[4].values.setpointC).toBe(plantConfig.uht.setpointC);
    expect(stages[3].values.stage1Bar).toBe(plantConfig.homogenizer.stage1Bar);
    for (const value of [kpis.bStar, kpis.f0Min, stages[3].values.powerKw, stages[5].values.waterRemovedLph]) {
      expect(Number.isFinite(value) && value > 0).toBe(true);
    }
  });

  it('accept the ends of each range', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 150 });
    sim.dispatch({ type: 'setSetpoint', key: 'homogenizerStage1Bar', value: 100 });
    expect(sim.snapshot().log.slice(0, 2).map((entry) => entry.kind)).toEqual(['info', 'info']);
  });
});

describe('the divert check', () => {
  it('never shows production with B* under 1 after a step, even when a mode ends on the step’s last instant', () => {
    // Noise off and 138 °C: after the 113 min of divert, CIP and sterilizing, production starts again exactly
    // on a step boundary (6,780 s) and must divert in that same step.
    const sim = createSim(quietConfig());
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138 });
    let shownBad = 0;
    runSeconds(sim, 7_000, (snap) => {
      if (snap.liquid.uhtMode === 'production' && snap.stages[4].values.flowLph > 0 && snap.stages[4].values.bStar < 1) shownBad++;
    });
    expect(shownBad).toBe(0);
    expect(sim.snapshot().liquid.divertCount).toBe(2);
  });

  it('says which number diverted, rounded down, so it never reads "B* 1.00, below 1"', () => {
    const run = startLiquid(quietConfig());
    // 139.22 °C is a hair under the 139.224 °C limit: B* 0.9996.
    run.setpoints.uhtSetpointC = 139.22;
    run.run(1);
    const divert = run.log.find((entry) => entry.message.includes('diverting'));
    expect(divert?.message).toBe('UHT set point 139.2 °C gives B* 0.99, below 1: diverting to the reject tank');
  });
});

describe('the homogenizer and the fillers when stopped', () => {
  it('builds no pressure while the UHT plant cleans, and full pressure again in production', () => {
    const sim = createSim(quietConfig());
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138 });
    let seenClean = false;
    runSeconds(sim, 1_000, (snap) => {
      if (snap.liquid.uhtMode !== 'cip') return;
      seenClean = true;
      expect(snap.stages[3].values).toMatchObject({ stage1Bar: 0, stage2Bar: 0, powerKw: 0 });
      expect(snap.stages[3].values.outletTempC).toBe(snap.stages[3].values.inletTempC);
    });
    expect(seenClean).toBe(true);
    const fresh = createSim(plantConfig).snapshot().stages[3].values;
    expect(fresh).toMatchObject({ stage1Bar: plantConfig.homogenizer.stage1Bar, stage2Bar: plantConfig.homogenizer.stage2Bar });
  });

  it('shows stage 7 idle while the fillers wait for product, and running again once they restart', () => {
    // A divert at once: the fillers drain the 10,000 L tank in about 40 min (H37) and wait. No breakdowns,
    // which would turn stage 7 red with one filler still running.
    const config = quietConfig();
    config.fillers.mtbfMeanS = NO_BREAKDOWNS_MTBF_S;
    const sim = createSim(config);
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138 });
    let seenStarved = false;
    runSeconds(sim, 3_000, (snap) => {
      if (snap.liquid.fillersRunning === 0) {
        seenStarved = true;
        expect(snap.stages[7].status).toBe('idle');
      } else {
        expect(snap.stages[7].status).toBe('ok');
      }
    });
    expect(seenStarved).toBe(true);
  });
});

describe('the ?mock sim (review)', () => {
  it('diverts on a set point under the limit, even in an amber window', () => {
    const sim = createMockSim(plantConfig);
    // Run on to the first amber stage 4 window in production, where the mock runs a little low.
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    const amber = () => sim.snapshot().stages[4].status === 'warn' && sim.snapshot().liquid.uhtMode === 'production';
    for (let step = 0; step < 100_000 && !amber(); step++) sim.step(0.001);
    expect(amber()).toBe(true);
    sim.dispatch({ type: 'setSpeed', speed: 10 });
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138 });
    sim.step(0.1);
    expect(sim.snapshot().liquid.uhtMode).toBe('divert');
  });

  it('never diverts without cleaning afterwards: every divert is followed by a CIP', () => {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    let last = sim.snapshot().liquid.uhtMode;
    const after: string[] = [];
    // 14 sim days at ×1,000 in 0.1 s frames (100 s steps of sim time each).
    for (let frame = 0; frame < (14 * 86_400) / 100; frame++) {
      sim.step(0.1);
      const mode = sim.snapshot().liquid.uhtMode;
      if (last === 'divert' && mode !== 'divert') after.push(mode);
      last = mode;
    }
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after)).toEqual(new Set(['cip']));
  }, 30_000);
});
