import type { Speed } from './stages';

/** Set points the viewer may change (plan 08: UHT temperature, filler speed; plus homogenizer pressure). */
export type SetpointKey = 'uhtSetpointC' | 'homogenizerStage1Bar' | 'fillerRatePacksPerH';

/**
 * The range the sim accepts for each set point; it refuses a value outside it (the UI's sliders span the
 * same range). The filler rate's top is the machine maximum, fillers.maxRatePacksPerH in plant.json.
 */
export const SETPOINT_RANGES: Readonly<Record<Exclude<SetpointKey, 'fillerRatePacksPerH'>, { min: number; max: number }>> = {
  uhtSetpointC: { min: 130, max: 150 },
  homogenizerStage1Bar: { min: 100, max: 250 },
};

/** The six fault scenarios (plan 06). */
export type ScenarioId =
  | 'uhtTempDrop'
  | 'fillerBreakdown'
  | 'sterileAirFilterFailure'
  | 'failedIncubation'
  | 'homogenizerPressureLoss'
  | 'demandSpikeOrLateTruck';

/** The six, in the fault table's order (plan 06). */
export const SCENARIO_IDS: readonly ScenarioId[] = [
  'uhtTempDrop',
  'fillerBreakdown',
  'sterileAirFilterFailure',
  'failedIncubation',
  'homogenizerPressureLoss',
  'demandSpikeOrLateTruck',
];

/** The two forms of 'demandSpikeOrLateTruck' (contracts v4): extra trucks, or trucks held up that then come together. */
export type ScenarioVariant = 'demandSpike' | 'lateTrucks';

export const SCENARIO_VARIANTS: readonly ScenarioVariant[] = ['demandSpike', 'lateTrucks'];

/** UI → sim. The only way anything outside src/sim changes the model. */
export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'pause'; paused: boolean }
  | { type: 'nextEvent' }
  | { type: 'setSetpoint'; key: SetpointKey; value: number }
  /** `variant` picks the form of 'demandSpikeOrLateTruck' (a demand spike if left out); the others have none (contracts v4). */
  | { type: 'triggerScenario'; id: ScenarioId; variant?: ScenarioVariant }
  | { type: 'setQaResult'; batchId: number; result: 'pass' | 'fail' }
  /**
   * Ends every scenario still acting on the plant (contracts v4): steam, the sterile-air filter and the homogenizer
   * are put right, a filler under repair moves on to re-sterilizing, extra trucks are called off and held-up
   * trucks come now. What they already caused (a divert and its clean, a blocked batch) runs its course.
   */
  | { type: 'resetScenarios' };
