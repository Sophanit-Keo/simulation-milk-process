import { describe, expect, it } from 'vitest';
import {
  bStar,
  creamShareFrac,
  divertLimitC,
  f0Min,
  holdTimeS,
  homogenizerOutletC,
  oeeFrac,
  tubeVolumeL,
} from '../../src/sim/formulas';
import { expectWithin } from '../helpers/expectWithin';

// Expected values are the hand calculations in plan/hand-calculations.md (H numbers) and the plan review's
// "Checked and correct" list, R4, R6 and R7. Each tolerance matches the precision of its hand value.
// Only `process` changes an expected value here, with a source (ownership rule 4).

describe('creamShareFrac', () => {
  it('needs 8.64% cream to make 3.5% milk from 0.05% skim and 40% cream (H1; review 0.0864)', () => {
    expectWithin(creamShareFrac(3.5, 0.05, 40), 0.08636, 0.00001);
  });

  it('is 0 at the skim fat and 1 at the cream fat', () => {
    expect(creamShareFrac(0.05, 0.05, 40)).toBe(0);
    expect(creamShareFrac(40, 0.05, 40)).toBe(1);
  });
});

describe('holding tube', () => {
  it('holds 17.78 L for 4 s at 16,000 L/h (H9, R6)', () => {
    expectWithin(tubeVolumeL(4, 16_000), 17.778, 0.001);
  });

  it('holds the same tube for 8 s at 8,000 L/h, half the flow (H10, R6)', () => {
    expectWithin(holdTimeS(tubeVolumeL(4, 16_000), 8_000), 8, 0.001);
  });

  it('gives back the hold it was sized for', () => {
    expect(holdTimeS(tubeVolumeL(4, 16_000), 16_000)).toBeCloseTo(4, 12);
  });

  it('converts L/h to L/s: 1 L/h for an hour is 1 L', () => {
    expect(tubeVolumeL(3_600, 1)).toBeCloseTo(1, 12);
    expect(holdTimeS(1, 1)).toBeCloseTo(3_600, 9);
  });

  it('is an infinite hold when nothing flows', () => {
    expect(holdTimeS(17.78, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('F0 and B* at the 140 °C set point', () => {
  it('F0 is 5.17 min at 140 °C for 4 s (H11; review 5.17, plan 5.2)', () => {
    expectWithin(f0Min(140, 4), 5.175, 0.001);
  });

  it('B* is 1.19 at 140 °C for 4 s (H12; review 1.19)', () => {
    expectWithin(bStar(140, 4), 1.1856, 0.0001);
  });

  it('F0 is 10.35 min at 140 °C for 8 s (H16; R6 10.3)', () => {
    expectWithin(f0Min(140, 8), 10.35, 0.001);
  });

  it('B* is 2.37 at 140 °C for 8 s (H15; R6 2.4)', () => {
    expectWithin(bStar(140, 8), 2.3712, 0.0001);
  });

  it('both are linear in the hold', () => {
    expect(f0Min(140, 8)).toBeCloseTo(2 * f0Min(140, 4), 12);
    expect(bStar(140, 8)).toBeCloseTo(2 * bStar(140, 4), 12);
  });
});

describe('the 140.5 °C alternative (R4)', () => {
  it('F0 is 5.81 min at 140.5 °C for 4 s (H19; review 5.8)', () => {
    expectWithin(f0Min(140.5, 4), 5.806, 0.001);
  });

  it('B* is 1.32 at 140.5 °C for 4 s (H18; review 1.32)', () => {
    expectWithin(bStar(140.5, 4), 1.323, 0.0001);
  });

  it('leaves 1.276 °C of margin above the divert limit at 4 s (H20; review 1.3)', () => {
    expectWithin(140.5 - divertLimitC(4), 1.276, 0.001);
  });
});

describe('the 5 min F0 target (D4)', () => {
  it('F0 reaches 5 min at 139.851 °C for 4 s (H23)', () => {
    expectWithin(f0Min(139.851, 4), 5, 0.002);
  });
});

describe('display noise and the fault temperature (D2, D4)', () => {
  it('B* stays above 1 at the lowest noisy reading, 139.7 °C for 4 s (H21)', () => {
    expectWithin(bStar(139.7, 4), 1.1101, 0.0001);
  });

  it('F0 spans 4.83 to 5.55 min across the ±0.3 °C noise band at 4 s (H22)', () => {
    expectWithin(f0Min(139.7, 4), 4.83, 0.001);
    expectWithin(f0Min(140.3, 4), 5.545, 0.001);
  });

  it('B* is below 1 at 135.5 °C for both 4 s and 8 s, so the fault diverts at either flow (H24)', () => {
    expectWithin(bStar(135.5, 4), 0.4419, 0.0001);
    expectWithin(bStar(135.5, 8), 0.8839, 0.0001);
  });

  it("B* at the preview's 137.6 °C is below 1 at 4 s but not at 8 s (H25)", () => {
    expectWithin(bStar(137.6, 4), 0.7004, 0.0001);
    expectWithin(bStar(137.6, 8), 1.4008, 0.0001);
  });
});

describe('divertLimitC', () => {
  it('is 139.22 °C for a 4 s hold (H13; review 139.22)', () => {
    expectWithin(divertLimitC(4), 139.224, 0.001);
  });

  it('leaves a 0.78 °C margin under the 140 °C set point (H14; R4 0.8)', () => {
    expectWithin(140 - divertLimitC(4), 0.776, 0.001);
  });

  it('drops to 136.06 °C for an 8 s hold (H17; R6 136.1)', () => {
    expectWithin(divertLimitC(8), 136.063, 0.001);
  });

  it('is 135 °C at a 10.1 s hold, where B* needs no extra heat', () => {
    expect(divertLimitC(10.1)).toBeCloseTo(135, 12);
  });

  it.each([1, 2, 4, 5, 6, 8, 10.1, 12, 30])('is where B* = 1, for a %s s hold', (holdS) => {
    expect(bStar(divertLimitC(holdS), holdS)).toBeCloseTo(1, 9);
  });

  it('falls as the hold grows', () => {
    const holds = [2, 4, 6, 8, 10];
    const limits = holds.map(divertLimitC);
    for (let i = 1; i < limits.length; i++) expect(limits[i]).toBeLessThan(limits[i - 1]);
  });
});

describe('homogenizerOutletC', () => {
  it('adds 1 °C per 40 bar: 76 °C in, 81.75 °C out at 200 + 30 bar (H7, R7)', () => {
    expect(homogenizerOutletC(76, 230, 40)).toBeCloseTo(81.75, 10);
  });

  it('adds nothing with no pressure drop', () => {
    expect(homogenizerOutletC(76, 0, 40)).toBe(76);
  });
});

describe('oeeFrac', () => {
  it('multiplies availability, performance and quality: 0.9 × 0.95 × 0.99 = 0.84645', () => {
    expect(oeeFrac(0.9, 0.95, 0.99)).toBeCloseTo(0.84645, 12);
  });

  it('gives 0.91016 for one 8 h shift with one 14 min stop at 7,500 of 8,000 packs/h (H51)', () => {
    expectWithin(oeeFrac((480 - 14) / 480, 7_500 / 8_000, 1), 0.91016, 0.00001);
  });

  it('is 1 only when all three are 1, and 0 when any is 0', () => {
    expect(oeeFrac(1, 1, 1)).toBe(1);
    expect(oeeFrac(0, 0.95, 0.99)).toBe(0);
    expect(oeeFrac(0.9, 0, 0.99)).toBe(0);
    expect(oeeFrac(0.9, 0.95, 0)).toBe(0);
  });
});
