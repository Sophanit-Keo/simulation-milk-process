// The steam and energy model (phase 8, plan/hand-calculations.md H115–H119, D17): the boiler house raises the
// steam that heats whatever passes the injector and burns gas for it, the homogenizer draws the electricity, and
// the plant counts both per tonne of raw milk, as the EU's dairy benchmark does.
import { describe, expect, it } from 'vitest';
import { checkPlantConfig, lToT, type PlantConfig, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { lagArea, positiveLagArea } from '../../src/sim/formulas';
import { boilerGasKw, boilerGasKwh } from '../../src/sim/liquid/stageModels';
import type { LiquidLine } from '../../src/sim/liquidLine';
import { expectWithin } from '../helpers/expectWithin';
import { quietConfig, startLiquid } from '../helpers/liquidRun';
import { copyConfig, phase3Config, plantConfig } from '../helpers/plantConfig';

/** H116: the rates at the defaults, full flow and 140 °C. */
const PRODUCTION = { steamKgPerH: 1_652.18, gasKw: 1_280.49, electricKw: 124.66, regenerationPct: 56.61, kwhPerT: 86.62 };
/** H118: the divert's steam toward the falling outlet, the CIP's, the re-sterilizing's; the outlet crosses the limit at 2.8402 s. */
const OUTAGE = { divertKg: 76.67, cipKg: 232.64, sterilizeKg: 1_063.64, gasKwh: 1_064.07, crossS: 2.8402 };

/** The energy of a snapshot, which createSim always gives. */
function energyOf(snap: Snapshot) {
  const energy = snap.liquid.energy;
  if (!energy) throw new Error('no liquid.energy in the snapshot');
  return energy;
}

/** createSim with the liquid line to hand, run in 0.1 s frames to t seconds after opening. */
function startSim(config: PlantConfig, speed: 10 | 1_000 = 10) {
  let line: LiquidLine | undefined;
  const sim = createSim(config, { onLiquidLine: (created) => (line = created) });
  if (!line) throw new Error('no liquid line');
  if (speed !== 10) sim.dispatch({ type: 'setSpeed', speed });
  const openS = sim.snapshot().timeS;
  const t = () => sim.snapshot().timeS - openS;
  return {
    sim,
    line,
    runTo(tS: number, each?: (snap: Snapshot) => void): Snapshot {
      while (t() < tS - 1e-6) {
        sim.step(Math.min(0.1, (tS - t()) / sim.snapshot().speed));
        each?.(sim.snapshot());
      }
      return sim.snapshot();
    },
  };
}

describe('the lag areas the totals integrate', () => {
  /** The same areas by the midpoint rule, fine enough for 1e-6. */
  const numeric = (f: (t: number) => number, dtS: number): number => {
    const n = 200_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += f(((i + 0.5) * dtS) / n);
    return (sum * dtS) / n;
  };

  it('lagArea is the area under a + b·e^(−t/τ)', () => {
    expectWithin(lagArea(4, 30, 90, 30), numeric((t) => 4 + 30 * Math.exp(-t / 30), 90), 1e-6);
    expectWithin(lagArea(0, 4.5, 180, 15), 4.5 * 15 * (1 - Math.exp(-12)), 1e-9);
  });

  it('positiveLagArea counts only the part above zero, either side of the one crossing', () => {
    for (const [a, b] of [
      [4, -35],
      [-3, 10],
      [4, 30],
      [-4, -2],
    ] as const) {
      expectWithin(positiveLagArea(a, b, 120, 30), numeric((t) => Math.max(0, a + b * Math.exp(-t / 30)), 120), 1e-6);
    }
    // A fall of 35 K into a 4 K gap: no steam for 30 ln(35 ÷ 4) = 65.1 s, then 4 K less 35 K e^(−t/30).
    expectWithin(positiveLagArea(4, -35, 600, 30), 4 * 600 - 4 * 30 * (1 + Math.log(35 / 4)), 1e-3);
  });
});

describe('H115: the boiler', () => {
  const { energy, uht } = plantConfig;

  it('raises a kilogram of steam at 150 psig from 200 °F feedwater with 1,028 Btu/lb = 2,391.13 kJ/kg', () => {
    expectWithin(energy.boilerHeatKjPerKg, 1_028 * 2.326, 0.01);
    expect(energy.boilerEfficiencyFrac).toBe(0.857);
  });

  it('burns 2,790.11 kJ of gas a kilogram at 85.7%, 0.775 kWh', () => {
    // 3,600 kg/h is 1 kg/s, so the gas in kW is the kJ a kilogram.
    expectWithin(boilerGasKw(plantConfig, 3_600), 2_790.11, 0.01);
    expectWithin(boilerGasKwh(plantConfig, 1), 0.775, 0.0001);
    expectWithin(boilerGasKwh(plantConfig, 3_600), boilerGasKw(plantConfig, 3_600), 1e-9);
  });

  it('gives the milk what the model takes for steam, within 0.4%: 2,780.8 − 589.1 = 2,191.6 kJ/kg against 2,200', () => {
    const givenUpKjPerKg = 2_780.77 - 589.12;
    expect(Math.abs(givenUpKjPerKg / uht.steamLatentKjPerKg - 1)).toBeLessThan(0.004);
  });

  it('refuses a boiler over 100% and steam that gives the milk more than it took to raise', () => {
    const problems = (change: (config: PlantConfig) => void): string[] => {
      const config = copyConfig();
      change(config);
      return checkPlantConfig(config);
    };
    expect(problems(() => {})).toEqual([]);
    expect(problems((c) => (c.energy.boilerEfficiencyFrac = 1.2))).toContain('energy.boilerEfficiencyFrac must lie in 0–1');
    expect(problems((c) => (c.energy.boilerEfficiencyFrac = 0))).toContain('energy.boilerEfficiencyFrac must be greater than 0');
    expect(problems((c) => (c.energy.boilerHeatKjPerKg = 2_000)).join()).toMatch(/energy\.boilerHeatKjPerKg must be at least uht\.steamLatentKjPerKg/);
  });
});

describe('H116: production', () => {
  it('at full flow and 140 °C: 1,652.18 kg/h of steam (the water stage 5 removes), 1,280.49 kW of gas, the homogenizer’s 124.66 kW', () => {
    const snap = startSim(quietConfig()).runTo(600);
    const energy = energyOf(snap);
    expect(energy.steamUse).toBe('milk');
    expectWithin(energy.steamKgPerH, PRODUCTION.steamKgPerH, 0.01);
    expectWithin(snap.stages[4].values.steamKgPerH, PRODUCTION.steamKgPerH, 0.01);
    expectWithin(snap.stages[5].values.waterRemovedLph, PRODUCTION.steamKgPerH, 0.01);
    expectWithin(energy.gasKw, PRODUCTION.gasKw, 0.01);
    expectWithin(snap.stages[4].values.gasKw, PRODUCTION.gasKw, 0.01);
    expectWithin(energy.electricKw, PRODUCTION.electricKw, 0.01);
  });

  it('regeneration gives the milk 56.6% of its heating, and the energy since opening is 86.62 kWh/t of raw milk', () => {
    const snap = startSim(quietConfig()).runTo(600);
    const energy = energyOf(snap);
    expectWithin(energy.regenerationPct ?? Number.NaN, PRODUCTION.regenerationPct, 0.01);
    expectWithin(snap.stages[2].values.regenerationPct, PRODUCTION.regenerationPct, 0.01);
    expectWithin(energy.kwhPerT ?? Number.NaN, PRODUCTION.kwhPerT, 0.01);
    // 10 min at the rates above.
    expectWithin(energy.steamKg, PRODUCTION.steamKgPerH / 6, 0.01);
    expectWithin(energy.electricKwh, PRODUCTION.electricKw / 6, 0.01);
  });

  it('has no energy per tonne before any raw milk is drawn', () => {
    const energy = energyOf(createSim(quietConfig()).snapshot());
    expect(energy.kwhPerT).toBeNull();
    expect(energy.steamKg).toBe(0);
  });

  it('at 50% flow every rate halves, and the regeneration and the energy per tonne stay', () => {
    const config = quietConfig();
    config.asepticTank.startFrac = 0.95;
    const snap = startSim(config).runTo(600);
    const energy = energyOf(snap);
    expect(snap.liquid.throttled).toBe(true);
    expectWithin(energy.steamKgPerH, PRODUCTION.steamKgPerH / 2, 0.01);
    expectWithin(energy.gasKw, PRODUCTION.gasKw / 2, 0.01);
    expectWithin(energy.electricKw, PRODUCTION.electricKw / 2, 0.01);
    expectWithin(energy.regenerationPct ?? Number.NaN, PRODUCTION.regenerationPct, 0.01);
    expectWithin(energy.kwhPerT ?? Number.NaN, PRODUCTION.kwhPerT, 0.01);
  });
});

describe('H117: cleaning and re-sterilizing', () => {
  it('an AIC heats the circulation from the deaerator outlet to the set point: 2,722.91 kg/h, 1,361.45 kg in its 30 min', () => {
    const run = startLiquid(quietConfig());
    run.run(36_000);
    expect(run.line.state.mode).toBe('aic');
    const atStartKg = run.line.totals.steamKg;
    run.run(600);
    const energy = run.line.view(run.setpoints, run.timeS).liquid.energy;
    expect(energy?.steamUse).toBe('cleaning');
    expectWithin(energy?.steamKgPerH ?? Number.NaN, 2_722.91, 0.01);
    expectWithin(energy?.gasKw ?? Number.NaN, 2_110.34, 0.01);
    // No milk flows, so the homogenizer stands and no regeneration is shown.
    expect(energy?.electricKw).toBe(0);
    expect(energy?.regenerationPct).toBeNull();
    run.run(1_200);
    expect(run.line.state.mode).toBe('production');
    expectWithin(run.line.totals.steamKg - atStartKg, 1_361.45, 0.01);
  });

  it('a CIP step makes up the deaerator’s 4 °C, 170.18 kg/h, once the preheater has its temperature; re-sterilizing 2,084.73 kg/h', () => {
    const run = startLiquid(quietConfig());
    run.line.startSteamFault(run.timeS);
    // Into the lye step (10 min into the CIP from 182.84 s), long after its rise.
    run.run(182.84 + 600 + 600);
    const lye = run.line.view(run.setpoints, run.timeS).liquid;
    expect(lye.cleaning?.step).toBe('lye');
    expectWithin(lye.energy?.steamKgPerH ?? Number.NaN, 170.18, 0.01);
    expectWithin(lye.energy?.gasKw ?? Number.NaN, 131.9, 0.01);
    // 10 min into re-sterilizing, from 4,982.84 s.
    run.run(4_982.84 + 600 - run.timeS + plantConfig.clock.startTimeS);
    const sterilizing = run.line.view(run.setpoints, run.timeS).liquid;
    expect(sterilizing.uhtMode).toBe('sterilize');
    expect(sterilizing.energy?.steamUse).toBe('sterilizing');
    expectWithin(sterilizing.energy?.steamKgPerH ?? Number.NaN, 2_084.73, 0.01);
    expectWithin(sterilizing.energy?.gasKw ?? Number.NaN, 1_615.73, 0.01);
  });

  it('stops the steam while a step runs cooler than the preheater, and shows nothing it heats', () => {
    const run = startLiquid(quietConfig());
    run.line.startSteamFault(run.timeS);
    // 30 s into the rinse (from 40 min into the CIP), the preheater still near the lye's 75 °C.
    run.run(182.84 + 2_400 + 30);
    const rinse = run.line.view(run.setpoints, run.timeS).liquid;
    expect(rinse.cleaning?.step).toBe('rinse');
    expect(rinse.energy?.steamKgPerH).toBe(0);
    expect(rinse.energy?.steamUse).toBeNull();
  });
});

describe('H118: the cost of a divert', () => {
  /** The steam from the trigger until production resumes, plus whatever follows to endS. */
  const resumeS = OUTAGE.crossS + 180 + 4_800 + 1_800;
  // The 2.84 s before the divert are production, toward the falling outlet: 1.29 kg.
  const leadInKg = ((16_000 * 3.9) / 2_200 / 3_600) * (53.75 * OUTAGE.crossS + 4.5 * 15 * (1 - Math.exp(-OUTAGE.crossS / 15)));
  const expectedToKg = (endS: number): number =>
    leadInKg + OUTAGE.divertKg + OUTAGE.cipKg + OUTAGE.sterilizeKg + ((endS - resumeS) * PRODUCTION.steamKgPerH) / 3_600;

  it.each([1, 10])('runs the steam on for 113 min with no milk made: 1,372.94 kg after the lead-in (%s s steps)', (dtS) => {
    const run = startLiquid(quietConfig());
    run.line.startSteamFault(run.timeS);
    const endS = 6_790;
    run.run(endS, dtS);
    expect(run.line.state.mode).toBe('production');
    expectWithin(leadInKg, 1.29, 0.01);
    expectWithin(run.line.totals.steamKg, expectedToKg(endS), 0.05);
  });

  it('burns 1,064.07 kWh of gas for it, against 3,111.61 kg of steam in 113 min of production', () => {
    const outageKg = OUTAGE.divertKg + OUTAGE.cipKg + OUTAGE.sterilizeKg;
    expectWithin(boilerGasKwh(plantConfig, outageKg), OUTAGE.gasKwh, 0.05);
    expectWithin((PRODUCTION.steamKgPerH * 113) / 60, 3_111.61, 0.01);
  });

  it('gives the same totals at 1 s, 7 s, 10 s and 60 s steps, within 1e-9: they do not depend on the step size', () => {
    const [fine, ...others] = [1, 7, 10, 60].map((dtS) => {
      const run = startLiquid(quietConfig());
      run.line.startSteamFault(run.timeS);
      // 11,340 s (27 × 420), on the grid of every step size, past the outage's 6,782.84 s.
      run.run(11_340, dtS);
      return run.line.totals;
    });
    for (const other of others) {
      expectWithin(other.steamKg, fine.steamKg, 1e-9 * fine.steamKg);
      expectWithin(other.electricKwh, fine.electricKwh, 1e-9 * fine.electricKwh);
    }
  });
});

describe('H119: a day at the defaults', () => {
  it('takes 40,015.01 kg of steam, 31,012.91 kWh of gas and 2,813.78 kWh for the homogenizer: 92.38 kWh/t, under BAT’s 100–600', () => {
    const config = phase3Config();
    config.uht.displayNoiseC = 0;
    const run = startSim(config, 1_000);
    const snap = run.runTo(86_400);
    const energy = energyOf(snap);
    expectWithin(run.line.totals.uhtL, 361_142.86, 5);
    expectWithin(energy.steamKg, 40_015.01, 40);
    expectWithin(energy.gasKwh, 31_012.91, 31);
    expectWithin(energy.electricKwh, 2_813.78, 2.8);
    expectWithin(energy.kwhPerT ?? Number.NaN, 92.38, 0.09);
    expectWithin(energy.kwhPerT ?? Number.NaN, (energy.gasKwh + energy.electricKwh) / lToT(run.line.totals.rawDrawnL), 1e-9);
    expect(energy.kwhPerT).toBeLessThan(100);
  });
});
