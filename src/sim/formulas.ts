// The core formulas of plan 06, as pure functions. Names carry their units (D6);
// every unit conversion here goes through units.ts.
import { lphToLps, lpsBarToKw, sToMin } from '../contracts';

/** Share of cream to mix back into skim milk to reach the target fat. */
export function creamShareFrac(targetFatPct: number, skimFatPct: number, creamFatPct: number): number {
  return (targetFatPct - skimFatPct) / (creamFatPct - skimFatPct);
}

/**
 * Share of the raw milk that leaves the separator as surplus cream (H2): the fat above the target goes out
 * as cream, so x = (f_raw − f_target) ÷ (f_cream − f_target). Litres are treated as kilograms.
 */
export function surplusCreamFrac(rawFatPct: number, targetFatPct: number, creamFatPct: number): number {
  return (rawFatPct - targetFatPct) / (creamFatPct - targetFatPct);
}

/** Volume of a holding tube that holds the milk for holdS at flowLph. */
export function tubeVolumeL(holdS: number, flowLph: number): number {
  return lphToLps(flowLph) * holdS;
}

/** Holding time from tube volume and live flow (R6): halving the flow doubles the hold. */
export function holdTimeS(tubeVolumeL: number, flowLph: number): number {
  // No flow means the milk sits in the tube; treat that as an endless hold rather than dividing by zero.
  if (flowLph <= 0) return Infinity;
  return tubeVolumeL / lphToLps(flowLph);
}

/** Sterilizing effect in minutes at 121.1 °C (z = 10 °C). */
export function f0Min(tempC: number, holdS: number): number {
  return sToMin(holdS) * 10 ** ((tempC - 121.1) / 10);
}

/** Bacteriological effect B*; at least 1 means the product is commercially sterile. */
export function bStar(tempC: number, holdS: number): number {
  return (holdS / 10.1) * 10 ** ((tempC - 135) / 10.5);
}

/** Temperature where B* = 1 for this hold; below it the plant diverts (R4). */
export function divertLimitC(holdS: number): number {
  return 135 + 10.5 * Math.log10(10.1 / holdS);
}

/** Homogenizing turns pressure into heat: every barPerDegreeC of pressure drop adds 1 °C (R7). */
export function homogenizerOutletC(inletC: number, totalBar: number, barPerDegreeC: number): number {
  return inletC + totalBar / barPerDegreeC;
}

/** Overall equipment effectiveness (OEE.com). */
export function oeeFrac(availabilityFrac: number, performanceFrac: number, qualityFrac: number): number {
  return availabilityFrac * performanceFrac * qualityFrac;
}

/** Hydraulic power of a pump pushing flowLph against a pressure rise of bar (H8: 10,000 L/h at 200 bar is 55.556 kW). */
export function hydraulicPowerKw(flowLph: number, bar: number): number {
  return lpsBarToKw(lphToLps(flowLph), bar);
}

/**
 * One step of a first-order lag toward targetValue, integrated exactly: x += (target − x)(1 − e^(−dt/τ)).
 * Two half steps land where one whole step does, so the result does not depend on the step size.
 */
export function lagToward(value: number, targetValue: number, dtS: number, timeConstantS: number): number {
  return value + (targetValue - value) * (1 - Math.exp(-dtS / timeConstantS));
}
