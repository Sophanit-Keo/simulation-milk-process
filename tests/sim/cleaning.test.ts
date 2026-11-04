// The cleaning programmes (phase 7, plan/hand-calculations.md H111–H114): the full CIP walks the Dairy
// Processing Handbook's steps for circuits with heated surfaces, the intermediate clean (AIC) its own three,
// each step at its time and temperature, while the modes keep the times the scenario scripts expect.
import { describe, expect, it } from 'vitest';
import { checkPlantConfig, cleaningSteps, hToS, lphToLps, minToS, type CleaningSnapshot, type Snapshot } from '../../src/contracts';
import {
  circulationMps,
  displacementS,
  programChemistry,
  programUse,
  returnMsPerCm,
  returnTo,
  type StepChemistry,
} from '../../src/sim/liquid/cleaningChemistry';
import { expectWithin } from '../helpers/expectWithin';
import { startPacks, type PacksRun } from '../helpers/packsRun';
import { copyConfig, plantConfig } from '../helpers/plantConfig';

const { cleaning } = plantConfig;

/** Every change of cleaning step a run goes through until tS: when it was first seen, and the step then. */
function stepsSeen(run: PacksRun, tS: number): { atS: number; cleaning: CleaningSnapshot; stage4C: number; preheatC: number }[] {
  const seen: { atS: number; cleaning: CleaningSnapshot; stage4C: number; preheatC: number }[] = [];
  run.runTo(tS, (snap: Snapshot) => {
    const now = snap.liquid.cleaning;
    const last = seen.at(-1)?.cleaning;
    if (now && (last?.program !== now.program || last.stepIndex !== now.stepIndex)) {
      seen.push({ atS: run.t(), cleaning: now, stage4C: snap.stages[4].values.tempC ?? Number.NaN, preheatC: snap.stages[2].values.preheatTempC ?? Number.NaN });
    }
  });
  return seen;
}

describe('H111: the programmes in plant.json', () => {
  it('a full CIP is the handbook’s six steps, 10 + 30 + 5 + 20 + 7 + 8 = 80 min, and lye at the CIP temperature', () => {
    const cip = cleaningSteps(plantConfig, 'cip');
    expect(cip.map((step) => [step.step, step.fluid, step.durationS / 60, step.tempC])).toEqual([
      ['preRinse', 'water', 10, 45],
      ['lye', 'lye', 30, 75],
      ['rinse', 'water', 5, 45],
      ['acid', 'acid', 20, 70],
      ['postRinse', 'water', 7, 20],
      ['cooling', 'water', 8, 20],
    ]);
    expect(cip.reduce((sum, step) => sum + step.durationS, 0)).toBe(cleaning.cipS);
  });

  it('an AIC is water, lye and water, 5 + 20 + 5 = 30 min, all at the UHT set point', () => {
    const aic = cleaningSteps(plantConfig, 'aic');
    expect(aic.map((step) => [step.step, step.fluid, step.durationS / 60, step.tempC])).toEqual([
      ['displace', 'water', 5, null],
      ['lye', 'lye', 20, null],
      ['rinse', 'water', 5, null],
    ]);
    expect(aic.reduce((sum, step) => sum + step.durationS, 0)).toBe(cleaning.aicS);
  });

  it('refuses a programme that does not fill its time, an unknown step or fluid, and a temperature in the wrong place', () => {
    const problems = (change: (config: ReturnType<typeof copyConfig>) => void): string[] => {
      const config = copyConfig();
      change(config);
      return checkPlantConfig(config);
    };
    expect(problems((c) => (c.cleaning.cipSteps[0].durationS = 500))).toContain('cleaning.cipSteps must add up to cleaning.cipS (4800 s), not 4700 s');
    expect(problems((c) => (c.cleaning.aicSteps[1].step = 'soak')).join()).toMatch(/cleaning\.aicSteps\[1\]\.step must be one of/);
    expect(problems((c) => (c.cleaning.cipSteps[3].fluid = 'steam')).join()).toMatch(/cleaning\.cipSteps\[3\]\.fluid must be one of water, lye, acid/);
    expect(problems((c) => (c.cleaning.cipSteps[1].tempC = 80))).toContain('cleaning.cipSteps[1]: the lye runs at cleaning.cipTempC');
    expect(problems((c) => Object.assign(c.cleaning.aicSteps[0], { tempC: 140 }))).toContain('cleaning.aicSteps[0].tempC must be left out: an AIC step holds the UHT set point');
    expect(problems((c) => (c.cleaning.aicSteps = []))).toContain('cleaning.aicSteps must list at least one step');
  });
});

describe('H112: the CIP after the UHT temperature drop (H104)', () => {
  const run = startPacks(copyConfig());
  run.sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
  const seen = stepsSeen(run, hToS(2));
  // The divert at 2.84 s, then 3 min of divert: the CIP from 182.84 s.
  const cipStartS = 2.84 + plantConfig.uht.divertBeforeCleaningS;

  it('walks the six steps from 182.84 s, each at its offset into the 80 min (at ×10, seen at the next whole second)', () => {
    expect(seen.map((each) => each.cleaning.step)).toEqual(['preRinse', 'lye', 'rinse', 'acid', 'postRinse', 'cooling']);
    const offsetsMin = [0, 10, 40, 45, 65, 72];
    seen.forEach((each, i) => expectWithin(each.atS, Math.ceil(cipStartS + minToS(offsetsMin[i])), 1e-6));
    for (const each of seen) expect(each.cleaning).toMatchObject({ program: 'cip', stepCount: 6, flowLph: cleaning.circulateLph });
  });

  it('runs the holding-tube outlet at each step’s temperature, and the preheater follows with its 30 s lag', () => {
    expect(seen.map((each) => each.stage4C)).toEqual([45, 75, 45, 70, 20, 20]);
    // At the start of each step the preheater is still near the step before's temperature …
    expectWithin(seen[1]?.preheatC ?? Number.NaN, 45, 0.5);
    expectWithin(seen[3]?.preheatC ?? Number.NaN, 45, 0.5);
  });

  it('… and is back in production at the H104 time, with no step left', () => {
    const end = run.sim.snapshot();
    expect(end.liquid.uhtMode).toBe('production');
    expect(end.liquid.cleaning).toBeNull();
  });
});

describe('H113: the first intermediate clean, after 10 h of production', () => {
  const run = startPacks(copyConfig());
  const seen = stepsSeen(run, hToS(10.6));

  it('starts at 16:00 (36,000 s after the opening) and walks water, lye and water to 16:30 (seen within a frame, 1 s at ×10)', () => {
    expect(seen.map((each) => [each.cleaning.step, each.cleaning.fluid])).toEqual([
      ['displace', 'water'],
      ['lye', 'lye'],
      ['rinse', 'water'],
    ]);
    [36_000, 36_300, 37_500].forEach((startS, i) => {
      expect(seen[i]?.atS).toBeGreaterThanOrEqual(startS);
      expect(seen[i]?.atS).toBeLessThanOrEqual(startS + 1);
    });
    expect(run.sim.snapshot().liquid.uhtMode).toBe('production');
  });

  it('holds the UHT set point all through, so the plant stays sterile (no temperature of its own)', () => {
    for (const each of seen) {
      expect(each.cleaning.tempC).toBeNull();
      expectWithin(each.stage4C, plantConfig.uht.setpointC, plantConfig.uht.displayNoiseC);
    }
  });
});

describe('H114: the circulation', () => {
  it('24,000 L/h is about 2.0 m/s in a 65 mm bore, inside the handbook’s 1.5–3.0 m/s', () => {
    const areaM2 = Math.PI * 0.0325 ** 2;
    const speedMps = lphToLps(cleaning.circulateLph) / 1_000 / areaM2;
    expectWithin(speedMps, 2.01, 0.01);
  });
});

// Phase 13 (D23, plan/hand-calculations.md H120–H121): the CIP station's chemicals, the return's conductivity as each
// step displaces the circuit, the change-overs at half the solution's conductivity, and what the cleans use.
describe('H120: the chemicals and the return’s conductivity', () => {
  const cip = programChemistry(plantConfig, cleaningSteps(plantConfig, 'cip'));
  const aic = programChemistry(plantConfig, cleaningSteps(plantConfig, 'aic'));
  const tauS = displacementS(plantConfig);

  it('circulates 1.5% NaOH and 0.8% HNO₃, conducting 70.9 and 45.0 mS/cm at 20 °C (the CRC table, taken linearly)', () => {
    // CRC, 20 °C: NaOH 48.6 mS/cm at 1% and 93.1 at 2%; HNO₃ 28.4 at 0.5% and 56.1 at 1%.
    // plant.json keeps them to 0.1 mS/cm: 70.85 → 70.9, 45.02 → 45.0.
    expectWithin(48.6 + ((93.1 - 48.6) * (1.5 - 1)) / (2 - 1), cleaning.chemicals.lye.conductivityMsPerCm, 0.06);
    expectWithin(28.4 + ((56.1 - 28.4) * (0.8 - 0.5)) / (1 - 0.5), cleaning.chemicals.acid.conductivityMsPerCm, 0.06);
    expect(cip.map((step) => step.concentrationPct)).toEqual([null, 1.5, null, 0.8, null, null]);
    expect(aic.map((step) => step.concentrationPct)).toEqual([null, 1.5, null]);
  });

  it('turns the 600 L circuit over every 90 s at 24,000 L/h, 2.0 m/s in the 65 mm bore', () => {
    expect(tauS).toBe(90);
    expectWithin(circulationMps(plantConfig, cleaning.circulateLph), 2.009, 0.001);
  });

  it('starts each step from what the step before left on the return, the first from milk', () => {
    const starts = [4.8, 0.3057, 70.9, 2.8186, 45.0, 0.7203];
    cip.forEach((step, i) => expectWithin(step.startMsPerCm, starts[i] as number, 1e-4));
    // The AIC's lye runs 20 min, not 30: its rinse starts at 70.9 − 70.44 e^(−1,200/90) = 70.8999.
    [4.8, 0.4605, 70.8999].forEach((startMsPerCm, i) => expectWithin((aic[i] as StepChemistry).startMsPerCm, startMsPerCm, 1e-4));
    // 60 s into the lye: 70.9 + (0.3057 − 70.9) e^(−60/90) = 34.66 mS/cm.
    expectWithin(returnMsPerCm(cip[1] as StepChemistry, 60, tauS), 34.66, 0.01);
  });

  it('sends the return to drain or back to its tank at half the solution’s conductivity', () => {
    const steps = cleaningSteps(plantConfig, 'cip');
    const where = (i: number, intoS: number) => {
      const step = cip[i] as StepChemistry;
      return returnTo(plantConfig, step, (steps[i] as (typeof steps)[number]).fluid, returnMsPerCm(step, intoS, tauS));
    };
    // The change-overs: lye at 61.99 s, the rinse after it at 62.77 s, acid at 56.56 s, the post-rinse at 62.99 s.
    expect([where(0, 0), where(0, 599)]).toEqual(['drain', 'drain']);
    expect([where(1, 61.9), where(1, 62.1), where(1, 1_799)]).toEqual(['drain', 'lyeTank', 'lyeTank']);
    expect([where(2, 62.7), where(2, 62.9), where(2, 299)]).toEqual(['lyeTank', 'drain', 'drain']);
    expect([where(3, 56.5), where(3, 56.7)]).toEqual(['drain', 'acidTank']);
    expect([where(4, 62.9), where(4, 63.1), where(4, 419)]).toEqual(['acidTank', 'waterTank', 'waterTank']);
    expect([where(5, 0), where(5, 479)]).toEqual(['waterTank', 'waterTank']);
  });
});

describe('H121: what the cleans use', () => {
  it('a CIP loses 6.20 kg of NaOH and 3.16 kg of HNO₃ at its interfaces, and sends 6,000 L of rinse water to drain', () => {
    const use = programUse(programChemistry(plantConfig, cleaningSteps(plantConfig, 'cip')));
    expectWithin(use.lyeKg, 6.1998, 1e-4);
    expectWithin(use.acidKg, 3.1609, 1e-4);
    expectWithin(use.drainWaterL, 6_000, 1e-6);
  });

  it('an AIC loses 6.19 kg of NaOH and sends 4,000 L to drain', () => {
    const use = programUse(programChemistry(plantConfig, cleaningSteps(plantConfig, 'aic')));
    expectWithin(use.lyeKg, 6.19, 1e-4);
    expect(use.acidKg).toBe(0);
    expectWithin(use.drainWaterL, 4_000, 1e-6);
  });

  it('in the live sim, the CIP after a UHT temperature drop shows each step’s strength and change-overs, and its totals', () => {
    const run = startPacks(copyConfig());
    run.sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
    const routes: string[] = [];
    run.runTo(hToS(2), (snap: Snapshot) => {
      const now = snap.liquid.cleaning;
      if (!now) return;
      const key = `${now.step}:${now.concentrationPct ?? '-'}:${now.returnTo}`;
      if (routes.at(-1) !== key) routes.push(key);
    });
    expect(routes).toEqual([
      'preRinse:-:drain',
      'lye:1.5:drain',
      'lye:1.5:lyeTank',
      'rinse:-:lyeTank',
      'rinse:-:drain',
      'acid:0.8:drain',
      'acid:0.8:acidTank',
      'postRinse:-:acidTank',
      'postRinse:-:waterTank',
      'cooling:-:waterTank',
    ]);
    const use = run.sim.snapshot().liquid.cleaningUse;
    expectWithin(use?.lyeKg ?? Number.NaN, 6.1998, 1e-4);
    expectWithin(use?.acidKg ?? Number.NaN, 3.1609, 1e-4);
    expectWithin(use?.drainWaterL ?? Number.NaN, 6_000, 1e-6);
  });

  it('in the live sim, nothing is used before the first clean, and the first AIC uses its 6.19 kg and 4,000 L', () => {
    const run = startPacks(copyConfig());
    expect(run.runTo(hToS(9.9)).liquid.cleaningUse).toEqual({ lyeKg: 0, acidKg: 0, drainWaterL: 0 });
    const use = run.runTo(hToS(10.6)).liquid.cleaningUse;
    expectWithin(use?.lyeKg ?? Number.NaN, 6.19, 1e-4);
    expect(use?.acidKg).toBe(0);
    expectWithin(use?.drainWaterL ?? Number.NaN, 4_000, 1e-6);
  });
});
