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

/** The six fault scenarios of the UHT line (plan 06). */
export type UhtScenarioId =
  | 'uhtTempDrop'
  | 'fillerBreakdown'
  | 'sterileAirFilterFailure'
  | 'failedIncubation'
  | 'homogenizerPressureLoss'
  | 'demandSpikeOrLateTruck';

/**
 * The yogurt line's five (contracts v12, phase 20, D30): a bacteriophage stalls a tank's fermentation, the heat
 * treatment runs under temperature, P8's seal heads drift cool, the HEPA cabin loses its overpressure, the cold room
 * warms past its limit.
 */
export type YogurtScenarioId =
  | 'yogurtSlowFermentation'
  | 'yogurtHeatUnderTemp'
  | 'yogurtSealDrift'
  | 'yogurtHepaLoss'
  | 'yogurtColdRoomExcursion';

export type ScenarioId = UhtScenarioId | YogurtScenarioId;

/** The UHT line's six, in the fault table's order (plan 06). */
export const UHT_SCENARIO_IDS: readonly UhtScenarioId[] = [
  'uhtTempDrop',
  'fillerBreakdown',
  'sterileAirFilterFailure',
  'failedIncubation',
  'homogenizerPressureLoss',
  'demandSpikeOrLateTruck',
];

/** The yogurt line's five, in the order of the line (phase 20): stages 13, 12, 15, 15, 16. */
export const YOGURT_SCENARIO_IDS: readonly YogurtScenarioId[] = [
  'yogurtSlowFermentation',
  'yogurtHeatUnderTemp',
  'yogurtSealDrift',
  'yogurtHepaLoss',
  'yogurtColdRoomExcursion',
];

/** Every scenario: the UHT line's six, then the yogurt line's five (contracts v12). */
export const SCENARIO_IDS: readonly ScenarioId[] = [...UHT_SCENARIO_IDS, ...YOGURT_SCENARIO_IDS];

export const isYogurtScenario = (id: ScenarioId): id is YogurtScenarioId => (YOGURT_SCENARIO_IDS as readonly ScenarioId[]).includes(id);

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
