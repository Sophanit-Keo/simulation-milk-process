import type { PlantConfig } from '../../src/contracts';
import plantJson from '../../src/data/plant.json';

/** The shipped defaults. Typing it here also makes `npm run typecheck` fail if plant.json lacks a key. */
export const plantConfig: PlantConfig = plantJson;

/** A deep copy that a test may change without touching the shipped config or other tests. */
export const copyConfig = (): PlantConfig => structuredClone(plantConfig);
