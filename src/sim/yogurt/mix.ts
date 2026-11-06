// Stage 11 (phase 17, D27): what a litre of yogurt mix takes from the yogurt silo and the powder station, by the
// mass balance of H122, and the silo's own tankers. Litres count as kilograms (D13).
import { pctToFrac, type PlantConfig } from '../../contracts';
import { surplusCreamFrac } from '../formulas';
import { mixMilkKgPerT, powderKgPerT, standardizedMilkFatPct } from './formulas';

/** A tonne of mix, in kilograms. */
const KG_PER_T = 1_000;

/** Per litre of mix: the raw milk the skid draws, the cream it takes off, and the powder and stabilizer dosed. */
export interface MixRecipe {
  rawPerMix: number;
  milkPerMix: number;
  creamPerMix: number;
  powderPerMix: number;
  stabilizerPerMix: number;
}

/**
 * The recipe from plant.json (H122): the standardized milk, powder and stabilizer of a tonne of mix, and the raw milk
 * whose surplus cream the skid takes off at standardization.creamFatPct to bring it to the milk's fat.
 */
export function mixRecipe(config: PlantConfig): MixRecipe {
  const { mix } = config.yogurt;
  const milkPerMix = mixMilkKgPerT(mix) / KG_PER_T;
  const creamFrac = surplusCreamFrac(config.standardization.rawMilkFatPct, standardizedMilkFatPct(mix), config.standardization.creamFatPct);
  const rawPerMix = milkPerMix / (1 - creamFrac);
  return {
    rawPerMix,
    milkPerMix,
    creamPerMix: rawPerMix - milkPerMix,
    powderPerMix: powderKgPerT(mix) / KG_PER_T,
    stabilizerPerMix: pctToFrac(mix.stabilizerPct),
  };
}
