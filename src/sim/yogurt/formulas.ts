// The yogurt line's formulas (phase 15, D26), as pure functions, with the expected values of H122–H125 in
// plan/hand-calculations.md. The live stages 11–14 (yogurtLine.ts, phase 17) and the mock build on them. Every unit conversion goes through units.ts (D6).
import { cToK, fracToPct, gToKg, pctToFrac, type YogurtConfig } from '../../contracts';

/** A tonne of mix, in kilograms. */
const KG_PER_T = 1_000;

/**
 * Skim-milk powder per tonne of mix (H122), by mass balance: milk, powder and stabilizer make up the tonne, and the
 * milk's SNF and the powder's together give the mix its SNF. The stabilizer carries no SNF; the powder's fat
 * (at most 1.5%) is left out.
 */
export function powderKgPerT(mix: YogurtConfig['mix']): number {
  const stabilizerKg = KG_PER_T * pctToFrac(mix.stabilizerPct);
  const milkSnf = pctToFrac(mix.milkSnfPct);
  return (KG_PER_T * pctToFrac(mix.snfPct) - milkSnf * (KG_PER_T - stabilizerKg)) / (pctToFrac(mix.powderSnfPct) - milkSnf);
}

/** Standardized milk per tonne of mix (H122): what the powder and the stabilizer leave of the tonne. */
export function mixMilkKgPerT(mix: YogurtConfig['mix']): number {
  return KG_PER_T - powderKgPerT(mix) - KG_PER_T * pctToFrac(mix.stabilizerPct);
}

/** The fat the skid standardizes the milk to (H122), so the mix has its fat once the powder and stabilizer are in. */
export function standardizedMilkFatPct(mix: YogurtConfig['mix']): number {
  return fracToPct((KG_PER_T * pctToFrac(mix.fatPct)) / mixMilkKgPerT(mix));
}

/** The gas constant, J/(mol·K). */
const GAS_J_PER_MOL_K = 8.314;

/**
 * β-lactoglobulin's denaturation in milk (H124): Dannenberg & Kessler (1988), J. Food Sci. 53, 258–263, for
 * β-lactoglobulin A as Kessler's Food and Bio Process Engineering (2002) reproduces it. The reaction is of order 1.5,
 * and its Arrhenius line breaks at 90 °C: unfolding limits it below, aggregation above.
 */
const BETA_LG = {
  order: 1.5,
  breakC: 90,
  /** ln k0, with k0 in (g/L)^(1 − n) per second, and the activation energy in J/mol; below and from the break. */
  low: { lnK0: 84.16, eaJPerMol: 265_210 },
  high: { lnK0: 14.41, eaJPerMol: 54_070 },
} as const;

/** β-lactoglobulin's rate constant at tempC, in (g/L)^−0.5 per second (H124). */
export function betaLgRateConstant(tempC: number): number {
  const { lnK0, eaJPerMol } = tempC >= BETA_LG.breakC ? BETA_LG.high : BETA_LG.low;
  return Math.exp(lnK0 - eaJPerMol / (GAS_J_PER_MOL_K * cToK(tempC)));
}

/**
 * Share of the β-lactoglobulin denatured after holdS at tempC (H124), from a native c0GPerL: the order-n integral,
 * C ÷ C0 = (1 + (n − 1) k C0^(n − 1) t)^(1 ÷ (1 − n)). Only the hold counts; the come-up and the cooling are left out.
 */
export function betaLgDenaturedPct(tempC: number, holdS: number, c0GPerL: number): number {
  if (!(holdS > 0)) return 0;
  const n = BETA_LG.order;
  const remainingFrac = (1 + (n - 1) * betaLgRateConstant(tempC) * c0GPerL ** (n - 1) * holdS) ** (1 / (1 - n));
  return 100 * (1 - remainingFrac);
}

/**
 * The culture's rate at tempC against its rate at the optimum (H125): Rosso et al.'s cardinal temperature model with
 * inflection (1993), 1 at optC, 0 at or outside minC and maxC.
 */
export function cardinalFactor(tempC: number, minC: number, optC: number, maxC: number): number {
  if (!(tempC > minC && tempC < maxC)) return 0;
  const numerator = (tempC - maxC) * (tempC - minC) ** 2;
  const denominator = (optC - minC) * ((optC - minC) * (tempC - optC) - (optC - maxC) * (optC + minC - 2 * tempC));
  return numerator / denominator;
}

type Ferment = YogurtConfig['ferment'];

/**
 * The pH curve's rate at the optimum, per second (H125): a logistic from startPh toward floorPh whose fastest drop
 * comes halfway to the end pH, so it passes endPh at endAtOptS.
 */
export const phRatePerS = (ferment: Ferment): number =>
  (2 / ferment.endAtOptS) * Math.log((ferment.startPh - ferment.floorPh) / (ferment.endPh - ferment.floorPh));

/**
 * pH elapsedS into a fermentation at tempC (H125): at the optimum
 *   pH(t) = floor + (start − floor) (1 + e^(−k t_m)) ÷ (1 + e^(k (t − t_m))),  t_m = endAtOptS ÷ 2,
 * and at another temperature the same curve on a clock slowed by the cardinal factor: pH_T(t) = pH(γ(T) t).
 */
export function fermentPh(ferment: Ferment, elapsedS: number, tempC: number): number {
  const k = phRatePerS(ferment);
  const midS = ferment.endAtOptS / 2;
  const curveS = cardinalFactor(tempC, ferment.minC, ferment.optC, ferment.maxC) * Math.max(0, elapsedS);
  return ferment.floorPh + ((ferment.startPh - ferment.floorPh) * (1 + Math.exp(-k * midS))) / (1 + Math.exp(k * (curveS - midS)));
}

/**
 * Time from the start of a fermentation at tempC until the pH falls to ph (H125): the curve's inverse; Infinity for a
 * pH at or below the floor, or a temperature the culture does not acidify at.
 */
export function timeToPhS(ferment: Ferment, ph: number, tempC: number): number {
  if (ph >= ferment.startPh) return 0;
  const factor = cardinalFactor(tempC, ferment.minC, ferment.optC, ferment.maxC);
  if (!(ph > ferment.floorPh) || !(factor > 0)) return Infinity;
  const k = phRatePerS(ferment);
  const midS = ferment.endAtOptS / 2;
  const ratio = ((1 + Math.exp(-k * midS)) * (ferment.startPh - ferment.floorPh)) / (ph - ferment.floorPh);
  return (midS + Math.log(ratio - 1) / k) / factor;
}

/** Titratable acidity at a pH (D26): linear in the pH between the start's and the end's. */
export function titratableAcidityPct(ferment: Ferment, ph: number): number {
  return ferment.startTaPct + ((ferment.startPh - ph) / (ferment.startPh - ferment.endPh)) * (ferment.endTaPct - ferment.startTaPct);
}

/** Yogurt P8 draws from the buffer at a cup rate and fill weight: litres count as kilograms (D13). */
export const p8DrawLph = (cupsPerH: number, fillG: number): number => cupsPerH * gToKg(fillG);
