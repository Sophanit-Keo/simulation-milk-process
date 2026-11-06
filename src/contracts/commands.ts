import type { Speed } from './stages';
import type { YogurtProductId } from './yogurt';

/**
 * Set points the viewer may change (plan 08: UHT temperature, filler speed; plus homogenizer pressure), and from
 * contracts v8 the yogurt line's (D25): its heat treatment, its fermentation temperature and P8's rate.
 */
export type SetpointKey =
  | 'uhtSetpointC'
  | 'homogenizerStage1Bar'
  | 'fillerRatePacksPerH'
  | 'yogurtHeatC'
  | 'fermentTempC'
  | 'p8RateCupsPerH';

/**
 * The range the sim accepts for each set point; it refuses a value outside it (the UI's sliders span the
 * same range). The filler rate's top is the machine maximum, fillers.maxRatePacksPerH in plant.json.
 * The yogurt line's (D26, phase 15): the heat treatment reaches below the 85 °C divert limit, as the UHT slider
 * reaches below its own, so the CCP can be shown; the fermentation temperature spans 37–45 °C around the SOP's
 * 41–43 °C; P8 runs 15–35 cycles a minute of its 12 lanes.
 */
export const SETPOINT_RANGES: Readonly<Record<Exclude<SetpointKey, 'fillerRatePacksPerH'>, { min: number; max: number }>> = {
  uhtSetpointC: { min: 130, max: 150 },
  homogenizerStage1Bar: { min: 100, max: 250 },
  yogurtHeatC: { min: 80, max: 95 },
  fermentTempC: { min: 37, max: 45 },
  p8RateCupsPerH: { min: 10_800, max: 25_200 },
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
  /** The product the yogurt line's next shift makes (contracts v8, D25); the shift after it goes back to the product day. */
  | { type: 'setYogurtProduct'; product: YogurtProductId }
  /**
   * Ends every scenario still acting on the plant (contracts v4): steam, the sterile-air filter and the homogenizer
   * are put right, a filler under repair moves on to re-sterilizing, extra trucks are called off and held-up
   * trucks come now. What they already caused (a divert and its clean, a blocked batch) runs its course.
   */
  | { type: 'resetScenarios' };
