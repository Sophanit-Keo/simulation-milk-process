import { CLEANING_FLUIDS, CLEANING_STEP_IDS, type CleaningFluid, type CleaningStepId } from './snapshot';
import { MAX_PALLETS_PER_BATCH } from './sscc';
import { isSpeed } from './stages';
import { dayToS, sToH } from './units';

/**
 * One step of a cleaning programme (phase 7, D16). JSON gives `step` and `fluid` as plain strings:
 * checkPlantConfig refuses any but CLEANING_STEP_IDS and CLEANING_FLUIDS, and cleaningSteps() narrows them.
 */
export interface CleaningStepConfig {
  step: string;
  fluid: string;
  durationS: number;
}

/** A CIP step runs at its own temperature; an AIC step has none, as it holds the UHT set point so the plant stays sterile. */
export interface CipStepConfig extends CleaningStepConfig {
  tempC: number;
}

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
    /** Sim time when the app opens, seconds since day 1, 00:00 (D11: day 8, 06:00, after a week of history). */
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
    /** Specific heat of milk, for heat recovered, steam injected and condenser load; litres count as kilograms (sim assumption, phase 3, between whole milk's 3.77 and skim's 3.98–4.02). */
    cpKjPerKgK: number;
  };
  /** Stage 1. */
  standardization: {
    rawMilkFatPct: number;
    skimFatPct: number;
    creamFatPct: number;
    siloTempC: number;
    separatorTempC: number;
    feedTankTempC: number;
    /** Raw-milk silo (sources: 30,000–250,000 L) and its level when the app opens (sim assumption, phase 3). */
    siloCapacityL: number;
    siloStartFrac: number;
    /** Mixing tank after standardization, which feeds the UHT plant (sources: batch tanks up to 10,000 kg). */
    mixTankCapacityL: number;
    /** Level the mixing tank opens at, and holds by level control while the UHT plant draws from it. */
    mixTankStartFrac: number;
    /** Level the separator fills the mixing tank to while the UHT plant stops for a clean (sim assumption, phase 3). */
    mixTankIdleFrac: number;
    /** Time constant of the mixing tank's level control (sim assumption, phase 3). */
    mixTankLagS: number;
    /** Raw milk one tanker unloads into the silo (sim assumption, phase 3; road tankers carry about 25,000–30,000 L). */
    tankerL: number;
    /** Unloading rate of a tanker; above the raw milk drawn at full UHT flow (H3), so the silo never runs dry (sim assumption, phase 3). */
    tankerUnloadLph: number;
    /** A tanker starts unloading when the silo falls below this share of its capacity (sim assumption, phase 3). */
    tankerBelowFrac: number;
  };
  /** Stage 2. */
  preheating: {
    preheatTempC: number;
    /** Temperature lost in the deaerator's vacuum vessel (sources: 4–5 °C). */
    deaeratorDropC: number;
    /** Time constant of the preheater outlet and of the deaerator's air content, a first-order lag (sim assumption, phase 3). */
    lagS: number;
    /** Air in the milk before the deaerator, % by volume (sim assumption, phase 3). */
    rawAirPct: number;
    /** Air left after the deaerator while it runs, % by volume (sim assumption, phase 3). */
    deaeratedAirPct: number;
  };
  /** Stage 3. */
  homogenizer: {
    stage1Bar: number;
    stage2Bar: number;
    /** Pressure drop that adds 1 °C (sources: 40 bar), for the outlet temperature rise (R7). */
    barPerDegreeC: number;
    /** Hydraulic power ÷ power drawn (H8: 55.556 kW hydraulic for 68 kW drawn in the handbook example, about 82%). */
    efficiencyFrac: number;
    /** Mean fat-globule size before homogenizing (sources: about 3.5 µm). */
    rawGlobuleUm: number;
    /** The globule size after homogenizing is globuleRefUm at a stage 1 pressure of globuleRefBar... */
    globuleRefBar: number;
    /** ...(sources: under 1 µm at 180–250 bar; sim assumption, phase 3)... */
    globuleRefUm: number;
    /** ...and scales as (globuleRefBar ÷ stage 1 pressure) to this power, up to rawGlobuleUm (sim assumption, phase 3). */
    globuleExponent: number;
    /** No creaming risk at or below this globule size (sources: under 1 µm, no cream layer forms)... */
    creamingOkUm: number;
    /** ...rising linearly to a 100% creaming-risk score at this size (sim assumption, phase 3). */
    creamingFullUm: number;
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
    /** Stage 4 turns amber when B* falls below this, a thin margin above the divert at 1 (sim assumption, phase 3; noise alone keeps B* ≥ 1.11 at 140 °C, H21). */
    bStarWarnBelow: number;
    /** Heat one kilogram of steam gives up as it condenses in the injector, and takes as it flashes off (sim assumption, phase 3; steam tables give about 2,150–2,300 kJ/kg at 140–80 °C). */
    steamLatentKjPerKg: number;
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
    /** Starved fillers start again once the level is back above this, a margin over fillersStopBelowL (sim assumption, phase 3). */
    fillersRestartAboveL: number;
    /** Sterile-air pressure over an empty tank; it rises with the level to maxHeadspaceBar when full (sim assumption, phase 3). */
    headspaceMinBar: number;
  };
  cleaning: {
    cipS: number;
    aicS: number;
    /** Production time between intermediate cleans (R2). */
    aicEveryProductionS: number;
    /** Full CIP runs only after a divert (R2). */
    cipAfterDivert: boolean;
    /** Temperature of the lye circulating through the UHT plant during a full CIP (sim assumption, phase 3). */
    cipTempC: number;
    /** What the CIP station circulates through the UHT plant in either programme (sim assumption, phase 7, D16). */
    circulateLph: number;
    /** The full CIP's steps in order, adding up to cipS (Dairy Processing Handbook, phase 7, D16). */
    cipSteps: CipStepConfig[];
    /** The intermediate clean's steps in order, adding up to aicS (sim assumption, phase 7, D16). */
    aicSteps: CleaningStepConfig[];
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
    /** Share of the packs formed that the seal check rejects, whole packs counted evenly (sim assumption, phase 4). */
    rejectFrac: number;
  };
  /** Stage 8. */
  packaging: {
    packsPerTray: number;
    traysPerPallet: number;
    /** Extra speed to clear a queue after a stop (sources: up to 30%). */
    catchUpFrac: number;
    /**
     * The tray packer stops this long at each shift change, to close the old batch's last tray and pallet and
     * code the new batch; packs queue on the accumulation table meanwhile (sim assumption, phase 4).
     */
    batchChangeS: number;
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
    /** Days of batches already made when the app opens, on hold in quarantine (D11). */
    historyDays: number;
    /** A blocked batch's pallets stay in quarantine this long, lamps red, before they leave for destruction (sim assumption, phase 4). */
    blockedHoldS: number;
  };
  /** Stage 10. */
  warehouse: {
    tempC: number;
    palletsPerTruck: number;
    truckEveryS: number;
    /** Released pallets in stock when the app opens, from batches before the history (D11). */
    startStockPallets: number;
    /** Time to load a truck at the dock (sim assumption, phase 4). */
    truckLoadS: number;
    /** Dock doors; a truck that finds them all taken waits in the yard (the layout has three). */
    dockDoors: number;
  };
  /** How each fault scenario plays out once triggered (phase 5, D15; plan 06, fault scenarios). */
  scenarios: {
    /** UHT temperature drop: the outlet falls from the set point toward uht.faultTempC with this time constant (sim assumption, the preview's 15 s). */
    steamFaultLagS: number;
    /** Filler breakdown: the repair a triggered breakdown takes, before re-sterilizing (fillers.repairFixedS) (sim assumption). */
    fillerRepairS: number;
    /** Sterile-air filter failure: the deviation lasts until the filter is replaced (sim assumption). */
    filterReplaceS: number;
    /** Chance per sample that a batch filled during the deviation spoils in incubation (sim assumption, R10's clusters). */
    filterFailurePerPack: number;
    /** Homogenizer pressure loss: stage 1 falls to this until repaired (D13: globules 1.84 µm, creaming risk 84%). */
    homogenizerFaultBar: number;
    homogenizerRepairS: number;
    /** A batch filled from milk at this creaming risk or more fails the sensory check when its incubation ends (sim assumption). */
    sensoryFailAbovePct: number;
    /** Demand spike: extra trucks, the first at the trigger and then one every spikeEveryS (sim assumption). */
    spikeTrucks: number;
    spikeEveryS: number;
    /** Late trucks: no truck comes for this long after the trigger; the ones due meanwhile then arrive together (sim assumption). */
    lateTruckDelayS: number;
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
  'homogenizer.efficiencyFrac',
  'homogenizer.rawGlobuleUm',
  'homogenizer.globuleRefBar',
  'homogenizer.globuleRefUm',
  'product.cpKjPerKgK',
  'preheating.lagS',
  'uht.capacityLph',
  'uht.steamLatentKjPerKg',
  'uht.holdAtCapacityS',
  'uht.rejectTankL',
  'standardization.siloCapacityL',
  'standardization.mixTankCapacityL',
  'standardization.mixTankLagS',
  'standardization.tankerL',
  'standardization.tankerUnloadLph',
  'standardization.tankerBelowFrac',
  'cleaning.aicEveryProductionS',
  'cleaning.cipS',
  'cleaning.aicS',
  'cleaning.circulateLph',
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
  'warehouse.dockDoors',
  'scenarios.steamFaultLagS',
  'scenarios.fillerRepairS',
  'scenarios.filterReplaceS',
  'scenarios.homogenizerRepairS',
  'scenarios.spikeTrucks',
  'scenarios.spikeEveryS',
  'scenarios.lateTruckDelayS',
] as const;

// Floors and ceilings that keep the clock workable. "Next event" ignores the per-frame step cap, so a
// tiny step means millions of steps per jump, and far out in time a step stops moving the clock at all.
const MIN_BASE_STEP_S = 0.01;
const MAX_START_DAYS = 36_500;
// Plan 06 and D8: the fast step is 10–60 s. Much longer steps can drain the silo inside one cut of the liquid line.
const MAX_FAST_STEP_S = 60;

const INTEGER_KEYS = [
  'seed',
  'fillers.count',
  'packaging.packsPerTray',
  'packaging.traysPerPallet',
  'quality.samplesAfterStop',
  'quality.historyDays',
  'warehouse.palletsPerTruck',
  'warehouse.startStockPallets',
  'warehouse.dockDoors',
  'scenarios.spikeTrucks',
  'clock.maxStepsPerFrame',
] as const;

/** A cleaning step with its step and fluid narrowed: what cleaningSteps() returns. */
export interface CleaningStep {
  step: CleaningStepId;
  fluid: CleaningFluid;
  durationS: number;
  tempC: number | null;
}

/** A programme's steps from a config checkPlantConfig passed, narrowed to the cleaning types. */
export function cleaningSteps(config: PlantConfig, program: 'cip' | 'aic'): CleaningStep[] {
  return config.cleaning[program === 'cip' ? 'cipSteps' : 'aicSteps'].map((step) => ({
    step: step.step as CleaningStepId,
    fluid: step.fluid as CleaningFluid,
    durationS: step.durationS,
    tempC: 'tempC' in step ? (step as CipStepConfig).tempC : null,
  }));
}

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

  const { clock, product, standardization: std, asepticTank: tank, fillers, uht, quality, homogenizer } = config;
  if (!isSpeed(clock.defaultSpeed)) fail('clock.defaultSpeed must be one of the speed presets');
  if (clock.fastStepS < clock.baseStepS) fail('clock.fastStepS must be at least clock.baseStepS');
  if (clock.baseStepS < MIN_BASE_STEP_S) fail(`clock.baseStepS must be at least ${MIN_BASE_STEP_S} s`);
  if (clock.fastStepS > MAX_FAST_STEP_S) fail(`clock.fastStepS must be at most ${MAX_FAST_STEP_S} s`);
  if (clock.startTimeS > dayToS(MAX_START_DAYS)) fail(`clock.startTimeS must be at most ${MAX_START_DAYS} days`);
  // At most one shift change per step; a batch that rounds away to nothing would never stop changing shifts.
  if (quality.batchS < clock.fastStepS) fail('quality.batchS must be at least clock.fastStepS');
  if (!(std.skimFatPct < product.fatPct && product.fatPct < std.creamFatPct)) fail('product fat must lie between skim and cream fat');
  if (std.rawMilkFatPct < product.fatPct) fail('raw-milk fat must be at least the product fat, or there is no cream to remove');
  // At or above the cream fat the separator would need endless (or negative) raw milk.
  if (!(std.rawMilkFatPct < std.creamFatPct)) fail('raw-milk fat must be below the cream fat');
  if (!(0 < tank.resumeBelowFrac && tank.resumeBelowFrac < tank.throttleAboveFrac && tank.throttleAboveFrac <= 1)) {
    fail('aseptic tank needs 0 < resumeBelowFrac < throttleAboveFrac ≤ 1');
  }
  if (std.siloStartFrac > 1 || std.mixTankStartFrac > 1 || std.mixTankIdleFrac > 1) {
    fail('silo and mixing-tank start and idle fractions must lie in 0–1');
  }
  // A tanker arriving at the threshold must fit, and must outpace the raw milk drawn at full UHT flow, or the silo runs dry.
  if (std.tankerBelowFrac * std.siloCapacityL + std.tankerL > std.siloCapacityL) {
    fail('standardization: a tanker unloading at tankerBelowFrac would overfill the silo');
  }
  if (std.rawMilkFatPct < std.creamFatPct && product.fatPct < std.creamFatPct) {
    const surplusFrac = (std.rawMilkFatPct - product.fatPct) / (std.creamFatPct - product.fatPct);
    if (!(std.tankerUnloadLph > uht.capacityLph / (1 - surplusFrac))) {
      fail('standardization.tankerUnloadLph must exceed the raw milk drawn at full UHT flow, or the silo runs dry');
    }
  }
  if (tank.startFrac > 1 || tank.throttledFlowFrac <= 0 || tank.throttledFlowFrac > 1) fail('aseptic tank fractions must lie in 0–1');
  if (tank.fillersStopBelowL >= tank.capacityL) fail('fillersStopBelowL must be below the tank capacity');
  if (!(tank.fillersStopBelowL < tank.fillersRestartAboveL && tank.fillersRestartAboveL < tank.resumeBelowFrac * tank.capacityL)) {
    fail('aseptic tank needs fillersStopBelowL < fillersRestartAboveL < resumeBelowFrac × capacityL');
  }
  if (tank.headspaceMinBar > tank.maxHeadspaceBar) fail('asepticTank.headspaceMinBar must not exceed maxHeadspaceBar');
  if (homogenizer.efficiencyFrac > 1) fail('homogenizer.efficiencyFrac must lie in 0–1');
  if (homogenizer.globuleRefUm > homogenizer.rawGlobuleUm) fail('homogenizer.globuleRefUm must not exceed rawGlobuleUm');
  if (!(homogenizer.creamingOkUm < homogenizer.creamingFullUm)) fail('homogenizer needs creamingOkUm < creamingFullUm');
  if (uht.bStarWarnBelow < 1) fail('uht.bStarWarnBelow must be at least 1, the divert level');
  if (fillers.ratePacksPerH > fillers.maxRatePacksPerH) fail('filler rate exceeds the machine maximum');
  if (uht.faultTempC >= uht.setpointC) fail('uht.faultTempC must be below the set point');
  // Phase 4: rules that keep the discrete model working.
  if (!(fillers.rejectFrac < 1)) fail('fillers.rejectFrac must be below 1, or no pack is ever good');
  if (!(quality.failurePerPack <= 1)) fail('quality.failurePerPack must lie in 0–1');
  if (!(config.packaging.batchChangeS < quality.batchS)) fail('packaging.batchChangeS must be shorter than a batch (quality.batchS)');
  // A queue that builds in a changeover must clear before the next one, so the packer needs some catch-up speed.
  if (config.packaging.batchChangeS > 0 && !(config.packaging.catchUpFrac > 0)) fail('packaging.catchUpFrac must be greater than 0 when batchChangeS is');
  // History older than one incubation would already be released: that is the opening stock's part (D11).
  if (quality.historyDays > quality.incubationDays) fail('quality.historyDays must not exceed quality.incubationDays');
  const packsPerPallet = config.packaging.packsPerTray * config.packaging.traysPerPallet;
  if (sToH(quality.batchS) * fillers.maxRatePacksPerH > MAX_PALLETS_PER_BATCH * packsPerPallet) {
    fail(`a batch at the machine maximum must fit ${MAX_PALLETS_PER_BATCH} pallets, the SSCC serial range per batch`);
  }
  // Phase 5: the scenarios must be faults, and their chances real chances.
  const { scenarios } = config;
  if (!(scenarios.homogenizerFaultBar < homogenizer.stage1Bar)) fail('scenarios.homogenizerFaultBar must be below homogenizer.stage1Bar');
  if (!(scenarios.filterFailurePerPack <= 1)) fail('scenarios.filterFailurePerPack must lie in 0–1');
  if (!(scenarios.sensoryFailAbovePct <= 100)) fail('scenarios.sensoryFailAbovePct must lie in 0–100');
  // Phase 7: each cleaning programme is a list of known steps that fills its time exactly.
  const { cleaning } = config;
  const checkSteps = (name: 'cipSteps' | 'aicSteps', totalKey: 'cipS' | 'aicS'): void => {
    const list: unknown = cleaning[name];
    if (!Array.isArray(list) || list.length === 0) {
      fail(`cleaning.${name} must list at least one step`);
      return;
    }
    let sumS = 0;
    for (const [i, step] of (list as (CleaningStepConfig & { tempC?: unknown })[]).entries()) {
      const where = `cleaning.${name}[${i}]`;
      if (!CLEANING_STEP_IDS.includes(step.step as CleaningStepId)) fail(`${where}.step must be one of ${CLEANING_STEP_IDS.join(', ')}`);
      if (!CLEANING_FLUIDS.includes(step.fluid as CleaningFluid)) fail(`${where}.fluid must be one of ${CLEANING_FLUIDS.join(', ')}`);
      if (!(typeof step.durationS === 'number' && step.durationS > 0)) fail(`${where}.durationS must be greater than 0`);
      else sumS += step.durationS;
      if (name === 'cipSteps' && typeof step.tempC !== 'number') fail(`${where}.tempC is needed: each CIP step runs at its own temperature`);
      if (name === 'aicSteps' && step.tempC !== undefined) fail(`${where}.tempC must be left out: an AIC step holds the UHT set point`);
      if (name === 'cipSteps' && step.fluid === 'lye' && step.tempC !== cleaning.cipTempC) fail(`${where}: the lye runs at cleaning.cipTempC`);
    }
    if (Math.abs(sumS - cleaning[totalKey]) > 1e-6) fail(`cleaning.${name} must add up to cleaning.${totalKey} (${cleaning[totalKey]} s), not ${sumS} s`);
  };
  checkSteps('cipSteps', 'cipS');
  checkSteps('aicSteps', 'aicS');
  return problems;
}
