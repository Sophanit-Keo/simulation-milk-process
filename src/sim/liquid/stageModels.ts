// The stage 1–6 physics as pure functions of plant.json and the live flows, shared by the live
// model (liquidLine.ts) and the ?mock sim. Litres are treated as kilograms throughout (sim
// assumption, as in H3), so L/h × kJ/(kg·K) × K gives kJ/h, and L/s gives kJ/s = kW.
import { lphToLps, type PlantConfig } from '../../contracts';
import { hydraulicPowerKw, surplusCreamFrac } from '../formulas';

/** Stage 1: the raw milk the separator needs for standardizedLph of target-fat milk, and the cream left over (H3, H4). */
export function separatorFlows(config: PlantConfig, standardizedLph: number): { rawMilkLph: number; surplusCreamLph: number } {
  const { standardization: std, product } = config;
  const rawMilkLph = standardizedLph / (1 - surplusCreamFrac(std.rawMilkFatPct, product.fatPct, std.creamFatPct));
  return { rawMilkLph, surplusCreamLph: rawMilkLph - standardizedLph };
}

/**
 * Stage 2: heat the preheater puts into the milk, all of it recovered from the outgoing product and
 * the flash vapour (direct plants preheat regeneratively): Q = ṁ × cp × (T_preheat − T_feed), in kW.
 */
export function heatRecoveredKw(config: PlantConfig, flowLph: number, preheatTempC: number): number {
  return lphToLps(flowLph) * config.product.cpKjPerKgK * (preheatTempC - config.standardization.feedTankTempC);
}

/**
 * Stage 3: mean fat-globule size after homogenizing. It falls with the first-stage pressure as
 * d = d_ref × (p_ref ÷ p)^k, and can't exceed the raw milk's globules (no pressure, no homogenizing).
 */
export function globuleUm(config: PlantConfig, stage1Bar: number): number {
  const { rawGlobuleUm, globuleRefBar, globuleRefUm, globuleExponent } = config.homogenizer;
  if (!(stage1Bar > 0)) return rawGlobuleUm;
  return Math.min(rawGlobuleUm, globuleRefUm * (globuleRefBar / stage1Bar) ** globuleExponent);
}

/** Stage 3: a 0–100 creaming-risk score, 0 up to creamingOkUm and rising linearly to 100 at creamingFullUm. */
export function creamingRiskPct(config: PlantConfig, sizeUm: number): number {
  const { creamingOkUm, creamingFullUm } = config.homogenizer;
  return 100 * Math.min(1, Math.max(0, (sizeUm - creamingOkUm) / (creamingFullUm - creamingOkUm)));
}

/** Stage 3: power drawn = hydraulic power at the total pressure (both stages) ÷ efficiency (H8). */
export function homogenizerPowerKw(config: PlantConfig, flowLph: number, totalBar: number): number {
  return hydraulicPowerKw(flowLph, totalBar) / config.homogenizer.efficiencyFrac;
}

/**
 * Stage 4/5: steam the injector condenses into the milk to lift it from fromC to toC, in L/h (kg/h):
 * ṁ_steam × latent = ṁ_milk × cp × (toC − fromC). The flash vessel boils the same amount back off (D5).
 */
export function steamLph(config: PlantConfig, flowLph: number, fromC: number, toC: number): number {
  return (flowLph * config.product.cpKjPerKgK * Math.max(0, toC - fromC)) / config.uht.steamLatentKjPerKg;
}

/** Stage 5: heat the flash vapour gives up in the condenser, ṁ_vapour × latent, in kW. */
export function condenserKw(config: PlantConfig, vapourLph: number): number {
  return lphToLps(vapourLph) * config.uht.steamLatentKjPerKg;
}

/** Stage 6: sterile-air pressure over the milk, rising from headspaceMinBar when empty to maxHeadspaceBar when full. */
export function headspaceBar(config: PlantConfig, levelFrac: number): number {
  const { headspaceMinBar, maxHeadspaceBar } = config.asepticTank;
  return headspaceMinBar + (maxHeadspaceBar - headspaceMinBar) * Math.min(1, Math.max(0, levelFrac));
}
