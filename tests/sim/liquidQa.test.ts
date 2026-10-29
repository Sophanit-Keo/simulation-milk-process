// Independent checks of the live liquid line (qa lane, phase 3), written against mutants of
// src/sim/liquidLine.ts that tests/sim/liquidLine.test.ts and acceptance.test.ts let through: a step
// not cut where a mode timer runs out or where the aseptic tank fills, a full reject tank that keeps
// taking milk, a divert threshold above B* 1, tankers that bring less than a load, the panel's F0 taken
// from the set point instead of the reading, the mixing-tank lag integrated by Euler steps. Each of those
// mutants fails a test here; the hysteresis and noise tests check the same rules from other angles
// (a level parked on a threshold, step sizes up to 600 s, the shape of the noise).
import { describe, expect, it } from 'vitest';
import { dayToS, hToS, minToS, type PlantConfig } from '../../src/contracts';
import { bStar, f0Min, surplusCreamFrac } from '../../src/sim/formulas';
import type { LiquidLine } from '../../src/sim/liquidLine';
import { expectWithin } from '../helpers/expectWithin';
import { quietConfig, startLiquid, type LiquidRun } from '../helpers/liquidRun';
import { copyConfig, plantConfig } from '../helpers/plantConfig';

const START_S = plantConfig.clock.startTimeS;

/** Runs one step at tempC, so the plant diverts on it, then puts the set point back. */
function divertOnce(run: LiquidRun, tempC: number, dtS: number): void {
  const before = run.setpoints.uhtSetpointC;
  run.setpoints.uhtSetpointC = tempC;
  run.run(dtS, dtS);
  run.setpoints.uhtSetpointC = before;
}

/**
 * Every tank's contents follow from the litres in and out since opening, every step (the end-of-step clamps
 * in step() must never have anything to do), and every level stays within its tank.
 */
function expectConserved(line: LiquidLine, config: PlantConfig, where: string): void {
  const { state, totals } = line;
  const { standardization: std, asepticTank: tank, uht, product } = config;
  // Rounding only: a millionth of a litre, plus 1e-11 of the litres moved so far (30 days add up to about 4e-6 L).
  const tolL = 1e-6 + 1e-11 * totals.rawDrawnL;
  const checks: [string, number, number][] = [
    ['silo', state.siloL, std.siloCapacityL * std.siloStartFrac + totals.tankerL - totals.rawDrawnL],
    ['mixing tank', state.mixTankL, std.mixTankCapacityL * std.mixTankStartFrac + totals.standardizedL - totals.uhtL],
    ['aseptic tank', state.asepticL, tank.capacityL * tank.startFrac + totals.toAsepticL - totals.toFillersL],
    ['reject tank', state.rejectL, totals.divertedL - totals.rejectPumpedL],
    ['UHT plant: to the aseptic tank or the reject tank', totals.uhtL, totals.toAsepticL + totals.divertedL],
    ['separator: standardized milk and cream', totals.rawDrawnL, totals.standardizedL + totals.surplusCreamL],
    ['separator: 1.37% of raw milk leaves as cream (H2)', totals.surplusCreamL, totals.rawDrawnL * surplusCreamFrac(std.rawMilkFatPct, product.fatPct, std.creamFatPct)],
    // Whole tankers only: what has come in plus what the one unloading still holds.
    ['tankers: whole loads', (totals.tankerL + state.tankerLeftL) % std.tankerL, 0],
  ];
  for (const [name, actual, expected] of checks) {
    const off = Math.abs(actual - expected);
    if (!(off <= tolL || (name === 'tankers: whole loads' && Math.abs(off - std.tankerL) <= tolL))) {
      expect.fail(`${where}: ${name} is ${actual}, the flows give ${expected}`);
    }
  }
  const levels: [string, number, number][] = [
    ['silo', state.siloL, std.siloCapacityL],
    ['mixing tank', state.mixTankL, std.mixTankCapacityL],
    ['aseptic tank', state.asepticL, tank.capacityL],
    ['reject tank', state.rejectL, uht.rejectTankL],
  ];
  for (const [name, levelL, capacityL] of levels) {
    if (!(levelL >= 0 && levelL <= capacityL)) expect.fail(`${where}: ${name} at ${levelL} L of ${capacityL} L`);
  }
}

describe('conservation in every step, with every tank pushed to its limit', () => {
  it('a reject tank smaller than a divert fills up and stops the flow; a full aseptic tank takes only what the fillers draw', () => {
    // 500 L of reject tank against an 800 L divert; 7 s steps, which divide none of the mode times.
    const config = copyConfig();
    config.uht.rejectTankL = 500;
    const run = startLiquid(config);
    const each = () => expectConserved(run.line, config, `at ${run.timeS - START_S} s`);
    run.run(hToS(1), 7, each);
    divertOnce(run, 139, 7);
    each();
    // 500 L at 16,000 L/h take 112.5 s; at 140 s the divert has 40 s to run.
    run.run(140, 7, each);
    // The reject tank is full and the UHT plant has stopped (a full reject tank takes nothing).
    expect(run.line.state.mode).toBe('divert');
    expectWithin(run.line.state.rejectL, 500, 1e-6);
    expect(run.line.view(run.setpoints, run.timeS).flows.uhtLph).toBe(0);
    expectWithin(run.line.totals.divertedL, 500, 1e-6);
    run.run(hToS(3), 7, each);
    expect(run.line.state.mode).toBe('production');
    // Slow fillers (3,000 L/h): the tank fills up, then the UHT plant makes only what they take.
    run.setpoints.fillerRatePacksPerH = 1_500;
    run.run(dayToS(1), 7, each);
    expectWithin(run.line.state.asepticL, config.asepticTank.capacityL, 1e-6);
    expect(run.line.view(run.setpoints, run.timeS).values[6].inflowLph).toBe(3_000);
    run.setpoints.fillerRatePacksPerH = config.fillers.ratePacksPerH;
    run.run(dayToS(2), 7, each);
    expect(run.line.totals.tankerL).toBeGreaterThan(0);
  });

  it('30 days at 10 s steps, a fault every 3 days and the fillers slowed every other week: nothing leaks, nothing overflows', () => {
    const run = startLiquid(plantConfig);
    for (let day = 0; day < 30; day += 3) {
      run.setpoints.fillerRatePacksPerH = Math.floor(day / 7) % 2 === 1 ? 4_000 : plantConfig.fillers.ratePacksPerH;
      divertOnce(run, plantConfig.uht.faultTempC, 10);
      run.run(dayToS(3) - 10, 10, () => expectConserved(run.line, plantConfig, `at ${run.timeS - START_S} s`));
    }
    expect(run.line.state.divertCount).toBe(10);
  });
});

describe('the step size does not change the outcome', () => {
  /** A day on a grid all three step sizes share: a divert at 3 h 2 min, then on to 24 h 9 min (86,940 s, 420 × 207). */
  function day(dtS: number, change: (run: LiquidRun) => void = () => {}): LiquidRun {
    const run = startLiquid(plantConfig);
    change(run);
    run.run(10_920, dtS);
    divertOnce(run, 139, dtS);
    run.run(86_940 - 10_920 - dtS, dtS);
    expect(run.timeS).toBe(START_S + 86_940);
    return run;
  }

  // The plan asks for 1% between 1 s and 60 s steps (H96). The model cuts each step at every event, so the
  // levels are exact whatever the step: 7 s steps, which divide none of the mode times, agree as closely.
  it.each([
    ['a day with a divert', undefined],
    ['a day with the fillers slowed, so the aseptic tank sits full', (run: LiquidRun) => (run.setpoints.fillerRatePacksPerH = 3_000)],
  ])('1 s, 7 s and 60 s steps agree within 1e-9 on every level and total: %s', (_label, change) => {
    const [fine, ...others] = [1, 7, 60].map((dtS) => day(dtS, change).line);
    for (const [index, other] of others.entries()) {
      const dtS = [7, 60][index];
      for (const source of ['state', 'totals'] as const) {
        for (const [key, value] of Object.entries(fine[source])) {
          // The steam (phase 8) follows the set point, which divertOnce holds at 139 °C for one step: 1 s, 7 s or
          // 60 s of steam toward 139 °C, a real difference. tests/sim/energy.test.ts checks it over a steam dip.
          if (typeof value !== 'number' || key === 'noiseC' || key === 'steamKg') continue;
          const otherValue = (other[source] as unknown as Record<string, number>)[key];
          if (Math.abs(value - otherValue) > 1e-9 * Math.max(1, Math.abs(value))) {
            expect.fail(`${source}.${key}: ${value} at 1 s steps, ${otherValue} at ${dtS} s steps`);
          }
        }
      }
    }
    expect(fine.totals.productionS).toBeGreaterThan(0);
  });

  it.each([7, 13, 60])('a divert, its CIP and the sterilizing end on the second at %i s steps: 800 L rejected, back 6,780 s later (H36)', (dtS) => {
    const run = startLiquid(quietConfig());
    run.run(dtS * 10, dtS);
    const startS = run.timeS;
    divertOnce(run, 139, dtS);
    run.run(Math.ceil(7_000 / dtS) * dtS, dtS);
    const modes = run.log.filter((entry) => /divert|CIP|sterile/.test(entry.message) && !/filler/.test(entry.message));
    expect(modes.map((entry) => entry.timeS - startS)).toEqual([0, 180, 180 + 4_800, 6_780]);
    expectWithin(run.line.totals.divertedL, 800, 1e-6);
    expectWithin(run.line.totals.rejectPumpedL, 800, 1e-6);
    expect(run.line.state.mode).toBe('production');
  });
});

describe('the divert rule is B* < 1, from the live hold (D4, R6)', () => {
  it('noise off: 139.3 °C (B* 1.017) runs a day without diverting, 139.2 °C (B* 0.995) diverts on the first step', () => {
    expect(bStar(139.3, 4)).toBeGreaterThan(1);
    expect(bStar(139.2, 4)).toBeLessThan(1);
    const above = startLiquid(quietConfig());
    above.setpoints.uhtSetpointC = 139.3;
    above.run(dayToS(1), 10);
    expect(above.line.state.divertCount).toBe(0);
    const below = startLiquid(quietConfig());
    divertOnce(below, 139.2, 1);
    expect(below.line.state.mode).toBe('divert');
  });

  it('at 50% flow (8 s hold, limit 136.06 °C) 136.2 °C keeps producing and 135.9 °C diverts', () => {
    const throttled = () => {
      const config = quietConfig();
      config.asepticTank.startFrac = 0.95;
      return startLiquid(config);
    };
    const above = throttled();
    above.setpoints.uhtSetpointC = 136.2;
    above.run(minToS(30));
    expect(above.line.state.throttled).toBe(true);
    expect(above.line.state.divertCount).toBe(0);
    const below = throttled();
    divertOnce(below, 135.9, 1);
    expect(below.line.state.mode).toBe('divert');
  });
});

describe('hysteresis: one switch per crossing', () => {
  it('fillers that draw exactly the throttled flow park the tank on its 90% line: one switch, no flip-flop', () => {
    // 2 × 4,000 packs/h of 1 L is the throttled 8,000 L/h: once throttled at 18,000 L the level stands still.
    const run = startLiquid(quietConfig());
    run.setpoints.fillerRatePacksPerH = 4_000;
    run.run(hToS(6), 10);
    const switches = run.log.filter((entry) => /UHT plant (throttled|back to full flow)/.test(entry.message));
    expect(switches.map((entry) => entry.kind)).toEqual(['warn']);
    expectWithin(run.line.state.asepticL, 18_000, 1e-6);
    expect(run.line.state.throttled).toBe(true);
  });

  it.each([1, 7, 60, 600])('switches alternate, at exactly 90%% and 60%%, with %i s steps over 3 days', (dtS) => {
    const run = startLiquid(plantConfig);
    run.run(dayToS(3), dtS);
    const switches = run.log.filter((entry) => /UHT plant (throttled|back to full flow)/.test(entry.message));
    expect(switches.length).toBeGreaterThanOrEqual(4);
    switches.forEach((entry, i) => {
      expect(entry.message, `switch ${i}`).toMatch(i % 2 === 0 ? /throttled/ : /back to full flow/);
      expectWithin(entry.asepticL, i % 2 === 0 ? 18_000 : 12_000, 1e-6);
    });
  });
});

describe('display noise (D4)', () => {
  it('moves the panel’s F0 and B* with it: both follow the reading shown, F0 across 4.83–5.55 min (H22)', () => {
    const run = startLiquid(plantConfig);
    const f0s: number[] = [];
    run.run(hToS(2), 1, () => {
      const four = run.line.view(run.setpoints, run.timeS).values[4];
      expectWithin(four.f0Min, f0Min(four.tempC, four.holdS), 1e-12);
      expectWithin(four.bStar, bStar(four.tempC, four.holdS), 1e-12);
      f0s.push(four.f0Min);
    });
    expect(Math.min(...f0s)).toBeLessThan(4.9);
    expect(Math.max(...f0s)).toBeGreaterThan(5.45);
  });

  it('stays within ±0.3 °C and spreads evenly over it, with no tails, over a week of 1 s steps', () => {
    const run = startLiquid(plantConfig);
    const binCount = 6;
    const bins = new Array<number>(binCount).fill(0);
    let draws = 0;
    let widestC = 0;
    run.run(dayToS(7), 1, () => {
      const { noiseC } = run.line.state;
      widestC = Math.max(widestC, Math.abs(noiseC));
      bins[Math.min(binCount - 1, Math.floor(((noiseC + 0.3) / 0.6) * binCount))]++;
      draws++;
    });
    expect(widestC).toBeLessThanOrEqual(plantConfig.uht.displayNoiseC);
    // Uniform: each 0.1 °C band takes a sixth of the draws (about 100,800 each, ± a few hundred).
    for (const count of bins) expectWithin(count / draws, 1 / binCount, 0.005);
    expect(run.line.state.divertCount).toBe(0);
  });
});
