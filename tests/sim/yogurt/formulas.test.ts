// The yogurt formulas (src/sim/yogurt/formulas.ts) against the hand calculations H122–H125
// (plan/hand-calculations.md, "Phase 15: the yogurt line"). Each expected value is worked by hand; the test never
// recomputes it with the same formula. Only `process` changes an expected value here, with a source.
import { describe, expect, it } from 'vitest';
import { hToS } from '../../../src/contracts';
import { holdTimeS, tubeVolumeL } from '../../../src/sim/formulas';
import {
  betaLgDenaturedPct,
  betaLgRateConstant,
  cardinalFactor,
  fermentPh,
  mixMilkKgPerT,
  p8DrawLph,
  phRatePerS,
  powderKgPerT,
  standardizedMilkFatPct,
  timeToPhS,
  titratableAcidityPct,
} from '../../../src/sim/yogurt/formulas';
import { expectWithin } from '../../helpers/expectWithin';
import { plantConfig } from '../../helpers/plantConfig';

const { mix, heat, ferment, p8 } = plantConfig.yogurt;
const { minC, optC, maxC } = ferment;

describe('H122: the powder dose', () => {
  it('26.95 kg of 95% skim-milk powder a tonne of mix raises 970.05 kg of 8.7% milk to 11% SNF, with 3 kg of stabilizer', () => {
    expectWithin(powderKgPerT(mix), 26.9537, 1e-4);
    expectWithin(mixMilkKgPerT(mix), 970.0463, 1e-4);
  });

  it('the skid standardizes the milk to 3.0926% fat, so the mix has 3.0%', () => {
    expectWithin(standardizedMilkFatPct(mix), 3.09264, 1e-5);
  });

  it('at 6,000 L/h the station doses 161.72 kg/h of powder', () => {
    expectWithin((powderKgPerT(mix) * mix.capacityLph) / 1_000, 161.722, 1e-3);
  });
});

describe('H123: the holding cell', () => {
  it('holds 500 L: 6,000 L/h for 300 s', () => {
    expectWithin(tubeVolumeL(heat.holdS, mix.capacityLph), 500, 1e-9);
  });

  it('gives 600 s at half flow, and the CCP\'s 180 s only above 10,000 L/h, 1.67 times the line\'s capacity', () => {
    const cellL = tubeVolumeL(heat.holdS, mix.capacityLph);
    expectWithin(holdTimeS(cellL, 3_000), 600, 1e-9);
    expectWithin(holdTimeS(cellL, 10_000), 180, 1e-9);
  });
});

describe('H124: β-lactoglobulin denaturation (Dannenberg & Kessler 1988)', () => {
  it('k at 92 °C is 3.3358 × 10⁻² (g/L)^−0.5 s⁻¹ (ln k = −3.4005), and at 85 °C, below the break, 7.3975 × 10⁻³', () => {
    expectWithin(betaLgRateConstant(92), 3.3358e-2, 1e-6);
    expectWithin(betaLgRateConstant(85), 7.3975e-3, 1e-7);
  });

  it('92 °C for 300 s at 4.0 g/L denatures 99.17%, above the 85% target', () => {
    const pct = betaLgDenaturedPct(heat.setpointC, heat.holdS, heat.betaLgGPerL);
    expectWithin(pct, 99.175, 1e-3);
    expect(pct).toBeGreaterThan(heat.denatTargetPct);
  });

  it('at the CCP\'s limits, 85 °C for 180 s, only 81.60%: below the target', () => {
    const pct = betaLgDenaturedPct(heat.divertBelowC, heat.minHoldS, heat.betaLgGPerL);
    expectWithin(pct, 81.605, 1e-3);
    expect(pct).toBeLessThan(heat.denatTargetPct);
  });

  it('92 °C for 180 s 97.96%; 80 °C for 300 s 62.31%; no hold, none', () => {
    expectWithin(betaLgDenaturedPct(92, 180, heat.betaLgGPerL), 97.962, 1e-3);
    expectWithin(betaLgDenaturedPct(80, 300, heat.betaLgGPerL), 62.309, 1e-3);
    expect(betaLgDenaturedPct(92, 0, heat.betaLgGPerL)).toBe(0);
  });
});

describe('H125: the pH curve', () => {
  it('the culture\'s rate is 1 at 43 °C, 0.93788 at 40 °C, 0.80255 at 37 °C, and none at 15 °C or 50 °C', () => {
    expect(cardinalFactor(43, minC, optC, maxC)).toBe(1);
    expectWithin(cardinalFactor(40, minC, optC, maxC), 0.93788, 1e-5);
    expectWithin(cardinalFactor(37, minC, optC, maxC), 0.80255, 1e-5);
    expect(cardinalFactor(15, minC, optC, maxC)).toBe(0);
    expect(cardinalFactor(50, minC, optC, maxC)).toBe(0);
    expect(cardinalFactor(4, minC, optC, maxC)).toBe(0);
  });

  it('k = 2 ln(2.4 ÷ 0.35) ÷ 4 h = 0.96265 per hour', () => {
    expectWithin(hToS(phRatePerS(ferment)), 0.96265, 1e-5);
  });

  it('at 43 °C: 6.60, 6.19 at 1 h, 5.575 at 2 h, 4.96 at 3 h and 4.55 at 4 h', () => {
    expect(fermentPh(ferment, 0, 43)).toBe(6.6);
    expectWithin(fermentPh(ferment, hToS(1), 43), 6.19, 1e-3);
    expectWithin(fermentPh(ferment, hToS(2), 43), 5.575, 1e-3);
    expectWithin(fermentPh(ferment, hToS(3), 43), 4.96, 1e-3);
    expectWithin(fermentPh(ferment, hToS(4), 43), 4.55, 1e-9);
  });

  it('pH 4.55 at 14,400 s at 43 °C and at 15,353.9 s (4 h 16 min) at 40 °C; pH 4.60 at 13,821.9 s at 43 °C', () => {
    expectWithin(timeToPhS(ferment, ferment.endPh, 43), 14_400, 1e-6);
    expectWithin(timeToPhS(ferment, ferment.endPh, 40), 15_353.9, 0.1);
    expectWithin(timeToPhS(ferment, 4.6, 43), 13_821.9, 0.1);
    expectWithin(fermentPh(ferment, timeToPhS(ferment, ferment.endPh, 40), 40), ferment.endPh, 1e-9);
  });

  it('never reaches the floor, and does not acidify in the cold room', () => {
    expect(timeToPhS(ferment, ferment.floorPh, 43)).toBe(Infinity);
    expect(fermentPh(ferment, hToS(48), 4)).toBe(6.6);
  });

  it('titratable acidity 0.19% at pH 6.6, 0.90% at 4.55, 0.545% at 5.575', () => {
    expectWithin(titratableAcidityPct(ferment, 6.6), 0.19, 1e-12);
    expectWithin(titratableAcidityPct(ferment, 4.55), 0.9, 1e-12);
    expectWithin(titratableAcidityPct(ferment, 5.575), 0.545, 1e-12);
  });
});

describe('P8\'s draw on the buffer', () => {
  it('21,600 cups/h of 127 g is 2,743.2 L/h (litres counted as kilograms)', () => {
    expectWithin(p8DrawLph(p8.rateCupsPerH, p8.fill.targetG), 2_743.2, 1e-9);
  });
});
