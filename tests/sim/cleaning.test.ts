// The cleaning programmes (phase 7, plan/hand-calculations.md H111–H114): the full CIP walks the Dairy
// Processing Handbook's steps for circuits with heated surfaces, the intermediate clean (AIC) its own three,
// each step at its time and temperature, while the modes keep the times the scenario scripts expect.
import { describe, expect, it } from 'vitest';
import { checkPlantConfig, cleaningSteps, hToS, lphToLps, minToS, type CleaningSnapshot, type Snapshot } from '../../src/contracts';
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
