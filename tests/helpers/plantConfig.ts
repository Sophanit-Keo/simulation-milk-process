import { hToS, type PlantConfig } from '../../src/contracts';
import plantJson from '../../src/data/plant.json';

/** The shipped defaults. Typing it here also makes `npm run typecheck` fail if plant.json lacks a key. */
export const plantConfig: PlantConfig = plantJson;

/** A deep copy that a test may change without touching the shipped config or other tests. */
export const copyConfig = (): PlantConfig => structuredClone(plantConfig);

/** A filler time between failures so long that no filler breaks down in any test's run. */
export const NO_BREAKDOWNS_MTBF_S = 1e12;

/**
 * The shipped config as the phase 3 acceptance runs ran it (plan/hand-calculations.md, H76–H96): the plant
 * opens on day 1 at 06:00 (D8) rather than day 8 (D11), and the fillers never break down, so both draw a
 * constant 2 × 7,500 L/h as phase 3's filler stub did. Phase 4 changed both; these runs check the liquid line.
 */
export function phase3Config(): PlantConfig {
  const config = copyConfig();
  config.clock.startTimeS = hToS(6);
  config.fillers.mtbfMeanS = NO_BREAKDOWNS_MTBF_S;
  return config;
}
