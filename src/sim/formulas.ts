// The core formulas of plan 06, as pure functions. Names carry their units (D6);
// every unit conversion here goes through units.ts.
import { lphToLps, sToMin } from '../contracts';

/** Share of cream to mix back into skim milk to reach the target fat. */
export function creamShareFrac(targetFatPct: number, skimFatPct: number, creamFatPct: number): number {
  return (targetFatPct - skimFatPct) / (creamFatPct - skimFatPct);
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
