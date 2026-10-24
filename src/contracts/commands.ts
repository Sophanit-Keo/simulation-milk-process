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

/** UI → sim. The only way anything outside src/sim changes the model. */
export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'pause'; paused: boolean }
  | { type: 'nextEvent' }
  | { type: 'setSetpoint'; key: SetpointKey; value: number }
  | { type: 'triggerScenario'; id: ScenarioId }
  | { type: 'setQaResult'; batchId: number; result: 'pass' | 'fail' };
