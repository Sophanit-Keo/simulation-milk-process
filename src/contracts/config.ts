import { isSpeed } from './stages';
import { dayToS } from './units';

/**
 * Shape of src/data/plant.json, the default settings (plan 06 and plan/DECISIONS.md).
 * Names follow the units rule in units.ts. Only `process` changes the values.
 */
export interface PlantConfig {
  /** Version of this file's layout; bump when keys are added, renamed or removed. */
  schemaVersion: number;
  /** Seed for every random draw, so demos and tests repeat (R2). */
  seed: number;
  clock: {
    /** Sim time when the app opens, seconds since day 1, 00:00. */
    startTimeS: number;
    /** One of the speed presets in SPEEDS. */
    defaultSpeed: number;
    /** Continuous-model step up to fastStepAboveSpeed (plan 06: every simulated second). */
    baseStepS: number;
    /** Step at speeds above fastStepAboveSpeed (plan 06: 10–60 s). */
    fastStepS: number;
    fastStepAboveSpeed: number;
    /** Most sim steps in one frame, so one slow frame can't snowball. */
    maxStepsPerFrame: number;
    /** Longest real frame the sim accepts; longer gaps (a hidden tab) are clamped to this. */
    maxFrameS: number;
  };
  product: {
    fatPct: number;
    packVolumeL: number;
    shelfLifeDays: number;
  };
  /** Stage 1. */
  standardization: {
    rawMilkFatPct: number;
    skimFatPct: number;
    creamFatPct: number;
    siloTempC: number;
    separatorTempC: number;
    feedTankTempC: number;
  };
  /** Stage 2. */
  preheating: {
    preheatTempC: number;
    /** Temperature lost in the deaerator's vacuum vessel (sources: 4–5 °C). */
    deaeratorDropC: number;
  };
  /** Stage 3. */
  homogenizer: {
    stage1Bar: number;
    stage2Bar: number;
    /** Pressure drop that adds 1 °C (sources: 40 bar), for the outlet temperature rise (R7). */
    barPerDegreeC: number;
  };
  /** Stage 4. */
  uht: {
    capacityLph: number;
    setpointC: number;
    /** Holding time at full capacity; the tube volume follows from it, and the live hold from the flow (R6). */
    holdAtCapacityS: number;
    /** Largest display noise on the UHT temperature, kept under the divert margin (R4). */
    displayNoiseC: number;
    /** Temperature the UHT temperature-drop scenario falls to (R2). */
    faultTempC: number;
    /** Time diverting before flushing and cleaning starts (R2). */
    divertBeforeCleaningS: number;
    rejectTankL: number;
    sterilizeTempC: number;
    sterilizeS: number;
  };
  /** Stage 5. */
  flashCooling: {
    flashTempC: number;
    coolerTempC: number;
  };
  /** Stage 6. */
  asepticTank: {
    capacityL: number;
    startFrac: number;
    /** Throttle the UHT plant above this level... */
    throttleAboveFrac: number;
    /** ...and return to full flow below this one; the gap stops flip-flopping (R2). */
    resumeBelowFrac: number;
    throttledFlowFrac: number;
    fillersStopBelowL: number;
    maxHeadspaceBar: number;
    tempC: number;
  };
  cleaning: {
    cipS: number;
    aicS: number;
    /** Production time between intermediate cleans (R2). */
    aicEveryProductionS: number;
    /** Full CIP runs only after a divert (R2). */
    cipAfterDivert: boolean;
  };
  /** Stage 7. */
  fillers: {
    count: number;
    ratePacksPerH: number;
    maxRatePacksPerH: number;
    /** Mean time between failures, exponential (R2). */
    mtbfMeanS: number;
    /** Repair time = fixed part + exponential random part (R2). */
    repairFixedS: number;
    repairRandomMeanS: number;
    tempC: number;
  };
  /** Stage 8. */
  packaging: {
    packsPerTray: number;
    traysPerPallet: number;
    /** Extra speed to clear a queue after a stop (sources: up to 30%). */
    catchUpFrac: number;
  };
  /** Stage 9. */
  quality: {
    /** One batch is one filler for this long (R1). */
    batchS: number;
    /** A shift, and with it a batch, starts here and every batchS before and after it (D1: 06:00, 14:00, 22:00). */
    firstShiftStartS: number;
    sampleEveryS: number;
    samplesAfterStop: number;
    incubationTempC: number;
    incubationDays: number;
    failurePerPack: number;
  };
  /** Stage 10. */
  warehouse: {
    tempC: number;
    palletsPerTruck: number;
    truckEveryS: number;
  };
}

// Durations, rates and sizes the model divides by or steps with; zero would stall or divide by zero.
const POSITIVE_KEYS = [
  'clock.baseStepS',
  'clock.fastStepS',
  'clock.maxStepsPerFrame',
  'clock.maxFrameS',
  'product.packVolumeL',
  'homogenizer.barPerDegreeC',
  'uht.capacityLph',
  'uht.holdAtCapacityS',
  'asepticTank.capacityL',
  'fillers.count',
  'fillers.ratePacksPerH',
  'fillers.mtbfMeanS',
  'packaging.packsPerTray',
  'packaging.traysPerPallet',
  'quality.batchS',
  'quality.sampleEveryS',
  'quality.incubationDays',
  'warehouse.palletsPerTruck',
  'warehouse.truckEveryS',
] as const;

// Floors and ceilings that keep the clock workable. "Next event" ignores the per-frame step cap, so a
// tiny step means millions of steps per jump, and far out in time a step stops moving the clock at all.
const MIN_BASE_STEP_S = 0.01;
const MAX_START_DAYS = 36_500;

const INTEGER_KEYS = [
  'seed',
  'fillers.count',
  'packaging.packsPerTray',
  'packaging.traysPerPallet',
  'quality.samplesAfterStop',
  'warehouse.palletsPerTruck',
  'clock.maxStepsPerFrame',
] as const;

/** Returns every problem found in a config; an empty list means it is usable. */
export function checkPlantConfig(config: PlantConfig): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);

  const walk = (value: unknown, path: string) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail(`${path} is not a finite number`);
      else if (value < 0) fail(`${path} is negative`);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(config, '');

  const at = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], config);
  for (const path of INTEGER_KEYS) {
    if (!Number.isInteger(at(path))) fail(`${path} must be a whole number`);
  }
  for (const path of POSITIVE_KEYS) {
    const value = at(path);
    if (!(typeof value === 'number' && value > 0)) fail(`${path} must be greater than 0`);
  }

  const { clock, product, standardization: std, asepticTank: tank, fillers, uht, quality } = config;
  if (!isSpeed(clock.defaultSpeed)) fail('clock.defaultSpeed must be one of the speed presets');
  if (clock.fastStepS < clock.baseStepS) fail('clock.fastStepS must be at least clock.baseStepS');
  if (clock.baseStepS < MIN_BASE_STEP_S) fail(`clock.baseStepS must be at least ${MIN_BASE_STEP_S} s`);
  if (clock.startTimeS > dayToS(MAX_START_DAYS)) fail(`clock.startTimeS must be at most ${MAX_START_DAYS} days`);
  // At most one shift change per step; a batch that rounds away to nothing would never stop changing shifts.
  if (quality.batchS < clock.fastStepS) fail('quality.batchS must be at least clock.fastStepS');
  if (!(std.skimFatPct < product.fatPct && product.fatPct < std.creamFatPct)) fail('product fat must lie between skim and cream fat');
  if (std.rawMilkFatPct < product.fatPct) fail('raw-milk fat must be at least the product fat, or there is no cream to remove');
  if (!(0 < tank.resumeBelowFrac && tank.resumeBelowFrac < tank.throttleAboveFrac && tank.throttleAboveFrac <= 1)) {
    fail('aseptic tank needs 0 < resumeBelowFrac < throttleAboveFrac ≤ 1');
  }
  if (tank.startFrac > 1 || tank.throttledFlowFrac <= 0 || tank.throttledFlowFrac > 1) fail('aseptic tank fractions must lie in 0–1');
  if (tank.fillersStopBelowL >= tank.capacityL) fail('fillersStopBelowL must be below the tank capacity');
  if (fillers.ratePacksPerH > fillers.maxRatePacksPerH) fail('filler rate exceeds the machine maximum');
  if (uht.faultTempC >= uht.setpointC) fail('uht.faultTempC must be below the set point');
  return problems;
}
