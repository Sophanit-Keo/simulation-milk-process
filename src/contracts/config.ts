import { SETPOINT_RANGES } from './commands';
import { CLEANING_FLUIDS, CLEANING_STEP_IDS, type CleaningFluid, type CleaningStepId } from './snapshot';
import { MAX_PALLETS_PER_BATCH } from './sscc';
import { isSpeed } from './stages';
import { dayToS, sToH } from './units';
import { YOGURT_PRODUCT_IDS, YOGURT_ROUTES, type YogurtProductId, type YogurtRoute } from './yogurt';

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

/** A cleaning chemical (phase 13, D23): its strength by weight, and what a conductivity transmitter reads in it at 20 °C. */
export interface CleaningChemicalConfig {
  concentrationPct: number;
  conductivityMsPerCm: number;
}

/**
 * One of the yogurt line's products (D26). JSON gives `id` and `route` as plain strings: checkPlantConfig refuses
 * any but YOGURT_PRODUCT_IDS and YOGURT_ROUTES, and yogurtProducts() narrows them.
 */
export interface YogurtProductConfig {
  id: string;
  name: string;
  route: string;
  /** True when fruit preparation is dosed in-line (fruit.dosePct). */
  fruit: boolean;
}

/**
 * The yogurt line, Line P8 (phase 15, D26; plan 12): stages 11–16, in a wing with its own raw-milk silo. Every key
 * here is the yogurt line's own; the UHT line's keys outside this block keep their values.
 */
export interface YogurtConfig {
  /**
   * The wing's own raw-milk silo, filled from the shared tanker bay (D25): a tanker of tankerL starts unloading, at
   * standardization.tankerUnloadLph, when the silo falls below tankerBelowFrac and the bay's UHT lane is free (D27).
   */
  silo: { capacityL: number; startFrac: number; tempC: number; tankerL: number; tankerBelowFrac: number };
  /** Stage 11: standardized milk, fortified with skim-milk powder to the SNF target, then stabilizer (H122). */
  mix: {
    capacityLph: number;
    fatPct: number;
    snfPct: number;
    /** The standardized milk's own solids-not-fat, before the powder. */
    milkSnfPct: number;
    powderSnfPct: number;
    stabilizerPct: number;
    /** The mix tank after the powder station, which feeds the heat treatment. */
    tankL: number;
    /** Its level when the plant opens (D27). */
    tankStartFrac: number;
  };
  /** Stage 12. */
  homogenizer: { bar: number; tempC: number };
  /** Stage 12: the heat treatment and its holding cell, sized for holdS at mix.capacityLph (H123). */
  heat: {
    setpointC: number;
    holdS: number;
    /** The CCP: the mix is diverted below this at the holding-cell outlet... */
    divertBelowC: number;
    /** ...or with a hold shorter than this. */
    minHoldS: number;
    /** β-lactoglobulin denaturation the heat treatment aims for (H124). */
    denatTargetPct: number;
    /** Native β-lactoglobulin in the mix before heating, for the 1.5-order kinetics (H124). */
    betaLgGPerL: number;
    reprocessTankL: number;
    /** The heater outlet follows its set point with this time constant (D27, as the UHT's preheater). */
    lagS: number;
    /** A divert runs this long before the wing's CIP starts (D27, as the UHT's 3 min). */
    divertS: number;
  };
  /** Stage 13: the pH curve (H125) falls from startPh toward floorPh, reaching endPh at endAtOptS at the optimum, optC. */
  ferment: {
    tempC: number;
    tanks: number;
    tankL: number;
    startPh: number;
    endPh: number;
    floorPh: number;
    endAtOptS: number;
    /** The culture's cardinal temperatures (Rosso's model): no acidification at or below minC or at or above maxC. */
    minC: number;
    optC: number;
    maxC: number;
    /** Titratable acidity at startPh and at endPh, % lactic acid; linear in the pH between them. */
    startTaPct: number;
    endTaPct: number;
    /** A tank's clean after it is emptied, before it may fill again (D27). */
    tankCleanS: number;
  };
  /** Stage 14: the plate cooler after the stirred tanks, and the transfer pump that empties a tank through it. */
  cooling: { outletC: number; flowLph: number };
  /**
   * Stage 14: the P8 buffer; set mix may wait in it at most setMaxWaitS before it starts to set. A stirred tank fills it
   * to highFrac; set mix is held at setHighFrac, by a level control with the time constant levelLagS (D27).
   */
  buffer: { capacityL: number; setMaxWaitS: number; highFrac: number; setHighFrac: number; levelLagS: number };
  /** Between two products on P8: a rinse before a stirred product; before set yogurt the wing's CIP and P8's SIP (D27). */
  changeover: { rinseS: number };
  fruit: { dosePct: number };
  /** Stage 15: Line P8. */
  p8: {
    cupG: number;
    lanes: number;
    rateCupsPerH: number;
    /** Fill weight, normal around targetG; the checkweigher rejects below underBelowG and above overAboveG. */
    fill: { targetG: number; sigmaG: number; underBelowG: number; overAboveG: number };
    /** The sealing heads' set points and their window (SOP P8 step 5). */
    seal: {
      tempC: number;
      timeS: number;
      bar: number;
      minTempC: number;
      maxTempC: number;
      minTimeS: number;
      maxTimeS: number;
      minBar: number;
      maxBar: number;
    };
    sealTest: { cups: number; everyS: number };
    hepa: { minPa: number; normalPa: number };
    sip: { tempC: number; holdS: number };
    atpMaxRlu: number;
  };
  /**
   * The wing's CIP, on D23's model at the SOP's strengths: the solutions' conductivities at 20 °C, and its own
   * circulation and circuit (D27). Its steps and times are the UHT CIP's (cleaning.cipSteps).
   */
  cip: {
    lyePct: number;
    lyeTempC: number;
    acidPct: number;
    acidTempC: number;
    lyeConductivityMsPerCm: number;
    acidConductivityMsPerCm: number;
    circulateLph: number;
    circuitL: number;
  };
  /** Stage 16. */
  coldChain: {
    cupsPerTray: number;
    traysPerPallet: number;
    warmRoomC: number;
    /** Set yogurt leaves the warm room at or below this pH. */
    releasePh: number;
    chillToC: number;
    roomC: number;
    roomMinC: number;
    roomMaxC: number;
    minHoldS: number;
    maxHoldS: number;
    shelfLifeDays: number;
    palletsPerTruck: number;
  };
  products: YogurtProductConfig[];
  /** The product of each shift of a day, from the first shift (quality.firstShiftStartS: 06:00, 14:00, 22:00). */
  shiftProducts: string[];
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
    /**
     * What circulates (phase 13, D23): the lye is sodium hydroxide and the acid nitric acid, each at its strength by
     * weight (Dairy Processing Handbook), and the rinse water softened to hardnessDh; each with its conductivity at 20 °C
     * (CRC Handbook).
     */
    chemicals: {
      lye: CleaningChemicalConfig;
      acid: CleaningChemicalConfig;
      water: { hardnessDh: number; conductivityMsPerCm: number };
    };
    /** What the return reads while the circuit still holds milk, before the first step pushes it out (phase 13, D23). */
    milkConductivityMsPerCm: number;
    /** The circuit's volume, from the balance tank to the cooler outlet and back (sim assumption, D23); the return is displaced through it. */
    circuitL: number;
    /** The circuit's pipe bore, for the circulation's velocity (D16, D23). */
    pipeBoreMm: number;
    /** The change-over valve sends the return back to its solution's tank above this share of the solution's conductivity, to drain below (sim assumption, D23). */
    changeOverFrac: number;
    /** Water steps whose return is recovered to the water tank for the next pre-rinse; the other water steps go to drain (D23). */
    recoverSteps: string[];
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
  /** The boiler house (phase 8, D17): what raising the injector's steam costs in gas. */
  energy: {
    /** Heat to raise 1 kg of saturated steam from the feedwater (US DOE Steam Tip Sheet #15: 150 psig from 200 °F). */
    boilerHeatKjPerKg: number;
    /** Share of the gas's heat that reaches the steam (the same tip sheet: natural gas, with an economizer). */
    boilerEfficiencyFrac: number;
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
  /** The yogurt line, stages 11–16 (schema 10, D26). */
  yogurt: YogurtConfig;
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
  'cleaning.chemicals.lye.concentrationPct',
  'cleaning.chemicals.lye.conductivityMsPerCm',
  'cleaning.chemicals.acid.concentrationPct',
  'cleaning.chemicals.acid.conductivityMsPerCm',
  'cleaning.chemicals.water.conductivityMsPerCm',
  'cleaning.milkConductivityMsPerCm',
  'cleaning.circuitL',
  'cleaning.pipeBoreMm',
  'cleaning.changeOverFrac',
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
  'energy.boilerHeatKjPerKg',
  'energy.boilerEfficiencyFrac',
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

/**
 * Every number of the yogurt block (schema 10, D26), each of which must be there and finite: the block is checked
 * key by key, so a missing one is named rather than read as 0.
 */
export const YOGURT_NUMBER_KEYS = [
  'silo.capacityL',
  'silo.startFrac',
  'silo.tempC',
  'silo.tankerL',
  'silo.tankerBelowFrac',
  'mix.capacityLph',
  'mix.fatPct',
  'mix.snfPct',
  'mix.milkSnfPct',
  'mix.powderSnfPct',
  'mix.stabilizerPct',
  'mix.tankL',
  'mix.tankStartFrac',
  'homogenizer.bar',
  'homogenizer.tempC',
  'heat.setpointC',
  'heat.holdS',
  'heat.divertBelowC',
  'heat.minHoldS',
  'heat.denatTargetPct',
  'heat.betaLgGPerL',
  'heat.reprocessTankL',
  'heat.lagS',
  'heat.divertS',
  'ferment.tempC',
  'ferment.tanks',
  'ferment.tankL',
  'ferment.startPh',
  'ferment.endPh',
  'ferment.floorPh',
  'ferment.endAtOptS',
  'ferment.minC',
  'ferment.optC',
  'ferment.maxC',
  'ferment.startTaPct',
  'ferment.endTaPct',
  'ferment.tankCleanS',
  'cooling.outletC',
  'cooling.flowLph',
  'buffer.capacityL',
  'buffer.setMaxWaitS',
  'buffer.highFrac',
  'buffer.setHighFrac',
  'buffer.levelLagS',
  'changeover.rinseS',
  'fruit.dosePct',
  'p8.cupG',
  'p8.lanes',
  'p8.rateCupsPerH',
  'p8.fill.targetG',
  'p8.fill.sigmaG',
  'p8.fill.underBelowG',
  'p8.fill.overAboveG',
  'p8.seal.tempC',
  'p8.seal.timeS',
  'p8.seal.bar',
  'p8.seal.minTempC',
  'p8.seal.maxTempC',
  'p8.seal.minTimeS',
  'p8.seal.maxTimeS',
  'p8.seal.minBar',
  'p8.seal.maxBar',
  'p8.sealTest.cups',
  'p8.sealTest.everyS',
  'p8.hepa.minPa',
  'p8.hepa.normalPa',
  'p8.sip.tempC',
  'p8.sip.holdS',
  'p8.atpMaxRlu',
  'cip.lyePct',
  'cip.lyeTempC',
  'cip.acidPct',
  'cip.acidTempC',
  'cip.lyeConductivityMsPerCm',
  'cip.acidConductivityMsPerCm',
  'cip.circulateLph',
  'cip.circuitL',
  'coldChain.cupsPerTray',
  'coldChain.traysPerPallet',
  'coldChain.warmRoomC',
  'coldChain.releasePh',
  'coldChain.chillToC',
  'coldChain.roomC',
  'coldChain.roomMinC',
  'coldChain.roomMaxC',
  'coldChain.minHoldS',
  'coldChain.maxHoldS',
  'coldChain.shelfLifeDays',
  'coldChain.palletsPerTruck',
] as const;

// The yogurt keys the model divides by or counts with; zero would stall or divide by zero.
const YOGURT_POSITIVE_KEYS = [
  'silo.capacityL',
  'mix.capacityLph',
  'mix.tankL',
  'mix.powderSnfPct',
  'heat.holdS',
  'heat.minHoldS',
  'heat.betaLgGPerL',
  'heat.reprocessTankL',
  'heat.lagS',
  'ferment.tanks',
  'ferment.tankL',
  'ferment.endAtOptS',
  'ferment.tankCleanS',
  'cooling.flowLph',
  'buffer.capacityL',
  'buffer.setMaxWaitS',
  'buffer.levelLagS',
  'silo.tankerL',
  'cip.circulateLph',
  'cip.circuitL',
  'p8.cupG',
  'p8.lanes',
  'p8.fill.sigmaG',
  'p8.sealTest.cups',
  'p8.sealTest.everyS',
  'p8.sip.holdS',
  'coldChain.cupsPerTray',
  'coldChain.traysPerPallet',
  'coldChain.minHoldS',
  'coldChain.shelfLifeDays',
  'coldChain.palletsPerTruck',
] as const;

const YOGURT_INTEGER_KEYS = [
  'ferment.tanks',
  'p8.lanes',
  'p8.sealTest.cups',
  'coldChain.cupsPerTray',
  'coldChain.traysPerPallet',
  'coldChain.palletsPerTruck',
] as const;

/** A yogurt product with its id and route narrowed: what yogurtProducts() returns. */
export interface YogurtProduct {
  id: YogurtProductId;
  name: string;
  route: YogurtRoute;
  fruit: boolean;
}

/** The yogurt products of a config checkPlantConfig passed, narrowed, keyed by id. */
export function yogurtProducts(config: PlantConfig): Readonly<Record<YogurtProductId, YogurtProduct>> {
  return Object.fromEntries(
    config.yogurt.products.map((product) => [product.id, { ...product, id: product.id as YogurtProductId, route: product.route as YogurtRoute }]),
  ) as Record<YogurtProductId, YogurtProduct>;
}

/** The product of each shift of a day, from the first, of a config checkPlantConfig passed. */
export const yogurtShiftProducts = (config: PlantConfig): readonly YogurtProductId[] => config.yogurt.shiftProducts as YogurtProductId[];

/** Every problem in the yogurt block (schema 10); `yogurt` is what plant.json gave, which may be partial. */
function checkYogurt(config: PlantConfig, fail: (message: string) => void): void {
  const given = (config as Partial<PlantConfig>).yogurt as unknown;
  if (given === null || typeof given !== 'object') {
    fail('yogurt is missing: plant.json schema 10 needs the yogurt line\'s block');
    return;
  }
  const at = (path: string): unknown => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], given);
  let complete = true;
  for (const path of YOGURT_NUMBER_KEYS) {
    const value = at(path);
    if (value === undefined) {
      fail(`yogurt.${path} is missing`);
      complete = false;
    } else if (!(typeof value === 'number' && Number.isFinite(value))) {
      fail(`yogurt.${path} must be a finite number`);
      complete = false;
    }
  }
  for (const path of YOGURT_POSITIVE_KEYS) {
    const value = at(path);
    if (typeof value === 'number' && !(value > 0)) fail(`yogurt.${path} must be greater than 0`);
  }
  for (const path of YOGURT_INTEGER_KEYS) {
    const value = at(path);
    if (typeof value === 'number' && !Number.isInteger(value)) fail(`yogurt.${path} must be a whole number`);
  }
  const yogurt = given as YogurtConfig;
  checkYogurtProducts(yogurt, config.quality.batchS, fail);
  if (!complete) return;

  const { silo, mix, homogenizer, heat, ferment, cooling, buffer, p8, cip, coldChain } = yogurt;
  const inRange = (value: number, key: keyof typeof SETPOINT_RANGES, path: string): void => {
    const { min, max } = SETPOINT_RANGES[key];
    if (!(value >= min && value <= max)) fail(`yogurt.${path} must lie in the ${key} set point's range, ${min}–${max}`);
  };
  const pct = (value: number, path: string): void => {
    if (!(value >= 0 && value <= 100)) fail(`yogurt.${path} must lie in 0–100`);
  };
  if (silo.startFrac > 1 || silo.tankerBelowFrac > 1 || mix.tankStartFrac > 1) fail('yogurt.silo.startFrac, silo.tankerBelowFrac and mix.tankStartFrac must lie in 0–1');
  // A tanker called at the threshold must fit, and unload faster than the mix line draws raw milk (D27, H125a).
  if (silo.tankerBelowFrac * silo.capacityL + silo.tankerL > silo.capacityL) fail('yogurt.silo: a tanker unloading at tankerBelowFrac would overfill the silo');
  if (!(config.standardization.tankerUnloadLph > mix.capacityLph)) fail('yogurt.mix.capacityLph must be below standardization.tankerUnloadLph, or the yogurt silo runs dry');
  for (const path of ['mix.fatPct', 'mix.snfPct', 'mix.milkSnfPct', 'mix.powderSnfPct', 'mix.stabilizerPct', 'heat.denatTargetPct', 'fruit.dosePct', 'cip.lyePct', 'cip.acidPct'] as const) {
    pct(at(path) as number, path);
  }
  // The powder raises the SNF from the milk's to the target, so the target lies between them; milk, powder and
  // stabilizer then make up the tonne, with room left for the milk's fat (H122).
  if (!(mix.milkSnfPct < mix.snfPct && mix.snfPct < mix.powderSnfPct)) fail('yogurt.mix needs milkSnfPct < snfPct < powderSnfPct: the powder raises the SNF to the target');
  if (!(mix.fatPct + mix.snfPct + mix.stabilizerPct < 100)) fail('yogurt.mix: fat, SNF and stabilizer must leave room for the water');
  if (!(mix.fatPct < config.standardization.rawMilkFatPct)) fail('yogurt.mix.fatPct must be below the raw milk\'s fat (standardization.rawMilkFatPct), which the skid takes cream from');
  if (!(homogenizer.bar > 0)) fail('yogurt.homogenizer.bar must be greater than 0');
  inRange(heat.setpointC, 'yogurtHeatC', 'heat.setpointC');
  // The set point must hold the mix forward, and the hold it is sized for must meet the CCP (H123).
  if (!(heat.divertBelowC < heat.setpointC)) fail('yogurt.heat.divertBelowC must be below heat.setpointC, or the mix is always diverted');
  if (!(heat.minHoldS <= heat.holdS)) fail('yogurt.heat.minHoldS must not exceed heat.holdS, or the holding cell is too small for the CCP');
  inRange(ferment.tempC, 'fermentTempC', 'ferment.tempC');
  if (!(ferment.minC < ferment.optC && ferment.optC < ferment.maxC)) fail('yogurt.ferment needs minC < optC < maxC');
  if (!(ferment.minC < ferment.tempC && ferment.tempC < ferment.maxC)) fail('yogurt.ferment.tempC must lie between minC and maxC, or the culture never acidifies');
  // Every temperature the slider can set must be one the culture acidifies at, or the time to the end pH is endless.
  const fermentRange = SETPOINT_RANGES.fermentTempC;
  if (!(ferment.minC < fermentRange.min && fermentRange.max < ferment.maxC)) {
    fail(`yogurt.ferment needs minC below and maxC above the fermentTempC set point's range, ${fermentRange.min}–${fermentRange.max}`);
  }
  // The curve falls from startPh toward floorPh and passes endPh on the way; set yogurt is released once it passes releasePh.
  if (!(ferment.floorPh < ferment.endPh && ferment.endPh < ferment.startPh)) fail('yogurt.ferment needs floorPh < endPh < startPh');
  if (!(ferment.floorPh < coldChain.releasePh && coldChain.releasePh < ferment.startPh)) fail('yogurt.coldChain.releasePh must lie between ferment.floorPh and ferment.startPh, or set yogurt never leaves the warm room');
  if (!(ferment.startTaPct < ferment.endTaPct)) fail('yogurt.ferment.startTaPct must be below endTaPct: the acidity rises as the pH falls');
  if (!(cooling.outletC < ferment.tempC)) fail('yogurt.cooling.outletC must be below ferment.tempC');
  if (!(buffer.setMaxWaitS > 0 && buffer.capacityL > 0)) fail('yogurt.buffer needs a capacity and a wait');
  if (!(buffer.setHighFrac < buffer.highFrac && buffer.highFrac <= 1)) fail('yogurt.buffer needs setHighFrac < highFrac ≤ 1');
  // Held at its set level, set mix must leave the buffer before it starts to set (D27, H125c).
  const p8DrawLph = (p8.rateCupsPerH * p8.fill.targetG) / 1_000;
  if (!((buffer.setHighFrac * buffer.capacityL) / p8DrawLph < sToH(buffer.setMaxWaitS))) {
    fail('yogurt.buffer.setHighFrac holds more set mix than P8 draws within buffer.setMaxWaitS');
  }
  if (!(cooling.flowLph > p8DrawLph)) fail('yogurt.cooling.flowLph must be above what P8 draws, or a tank cannot keep the buffer up');
  if (!(mix.capacityLph > p8DrawLph)) fail('yogurt.mix.capacityLph must be above what P8 draws');
  inRange(p8.rateCupsPerH, 'p8RateCupsPerH', 'p8.rateCupsPerH');
  const { fill, seal, hepa } = p8;
  if (!(fill.underBelowG < fill.targetG && fill.targetG < fill.overAboveG)) fail('yogurt.p8.fill needs underBelowG < targetG < overAboveG');
  if (!(fill.underBelowG <= p8.cupG)) fail('yogurt.p8.fill.underBelowG must not exceed the cup\'s nominal p8.cupG');
  if (!(seal.minTempC <= seal.tempC && seal.tempC <= seal.maxTempC)) fail('yogurt.p8.seal.tempC must lie in its window, minTempC–maxTempC');
  if (!(seal.minTimeS <= seal.timeS && seal.timeS <= seal.maxTimeS)) fail('yogurt.p8.seal.timeS must lie in its window, minTimeS–maxTimeS');
  if (!(seal.minBar <= seal.bar && seal.bar <= seal.maxBar)) fail('yogurt.p8.seal.bar must lie in its window, minBar–maxBar');
  if (!(hepa.minPa < hepa.normalPa)) fail('yogurt.p8.hepa.normalPa must be above minPa, or P8 never starts');
  if (!(cip.lyeTempC > 0 && cip.acidTempC > 0)) fail('yogurt.cip needs the lye\'s and the acid\'s temperatures');
  const waterMsPerCm = config.cleaning.chemicals?.water?.conductivityMsPerCm ?? 0;
  if (!(cip.lyeConductivityMsPerCm * config.cleaning.changeOverFrac > waterMsPerCm && cip.acidConductivityMsPerCm * config.cleaning.changeOverFrac > waterMsPerCm)) {
    fail('yogurt.cip: the solutions\' change-over must lie above the rinse water\'s conductivity');
  }
  if (!(coldChain.roomMinC <= coldChain.roomC && coldChain.roomC <= coldChain.roomMaxC)) fail('yogurt.coldChain.roomC must lie in roomMinC–roomMaxC');
  if (!(coldChain.chillToC < coldChain.warmRoomC)) fail('yogurt.coldChain.chillToC must be below warmRoomC');
  if (!(coldChain.minHoldS < coldChain.maxHoldS)) fail('yogurt.coldChain.minHoldS must be below maxHoldS');
  if (!(coldChain.maxHoldS < dayToS(coldChain.shelfLifeDays))) fail('yogurt.coldChain.maxHoldS must be shorter than the shelf life');
}

/** The products: each known id once, a known route, a name and a fruit flag; and one product a shift for a whole day. */
function checkYogurtProducts(yogurt: Partial<YogurtConfig>, batchS: number, fail: (message: string) => void): void {
  const products: unknown = yogurt.products;
  if (!Array.isArray(products)) fail('yogurt.products must list the products');
  else {
    const seen = new Set<string>();
    for (const [i, product] of (products as Partial<YogurtProductConfig>[]).entries()) {
      const where = `yogurt.products[${i}]`;
      if (!YOGURT_PRODUCT_IDS.includes(product.id as YogurtProductId)) fail(`${where}.id must be one of ${YOGURT_PRODUCT_IDS.join(', ')}`);
      else if (seen.has(product.id as string)) fail(`${where}.id ${String(product.id)} appears twice`);
      else seen.add(product.id as string);
      if (!(typeof product.name === 'string' && product.name.trim().length > 0)) fail(`${where}.name must be non-empty text`);
      if (!YOGURT_ROUTES.includes(product.route as YogurtRoute)) fail(`${where}.route must be one of ${YOGURT_ROUTES.join(', ')}`);
      if (typeof product.fruit !== 'boolean') fail(`${where}.fruit must be true or false`);
    }
    for (const id of YOGURT_PRODUCT_IDS) if (!seen.has(id)) fail(`yogurt.products has no ${id}`);
  }
  const shifts: unknown = yogurt.shiftProducts;
  const shiftsADay = dayToS(1) / batchS;
  if (!Array.isArray(shifts)) fail('yogurt.shiftProducts must list a product for each shift of a day');
  else {
    if (shifts.length !== shiftsADay) fail(`yogurt.shiftProducts must give ${shiftsADay} products, one for each shift of a day (quality.batchS)`);
    for (const [i, id] of (shifts as unknown[]).entries()) {
      if (!YOGURT_PRODUCT_IDS.includes(id as YogurtProductId)) fail(`yogurt.shiftProducts[${i}] must be one of ${YOGURT_PRODUCT_IDS.join(', ')}`);
    }
  }
}

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
  // Phase 13: a strength by weight, a change-over between the water's and the solution's conductivity, and recovered
  // rinses that are water steps of a programme.
  const given = cleaning.chemicals as Partial<PlantConfig['cleaning']['chemicals']> | undefined;
  if (!given?.lye || !given.acid || !given.water) fail('cleaning.chemicals must give the lye, the acid and the water');
  else {
    const chemicals = given as PlantConfig['cleaning']['chemicals'];
    for (const name of ['lye', 'acid'] as const) {
      if (!(chemicals[name].concentrationPct < 100)) fail(`cleaning.chemicals.${name}.concentrationPct must lie in 0–100`);
      if (!(chemicals[name].conductivityMsPerCm > chemicals.water.conductivityMsPerCm)) {
        fail(`cleaning.chemicals.${name}.conductivityMsPerCm must be above the water's, so the change-over can tell them apart`);
      }
    }
    if (!(cleaning.changeOverFrac < 1)) fail('cleaning.changeOverFrac must lie in 0–1');
    else {
      for (const name of ['lye', 'acid'] as const) {
        if (!(cleaning.changeOverFrac * chemicals[name].conductivityMsPerCm > chemicals.water.conductivityMsPerCm)) {
          fail(`cleaning.changeOverFrac must put the ${name}'s change-over above the water's conductivity`);
        }
      }
    }
  }
  const recover: unknown = cleaning.recoverSteps;
  if (!Array.isArray(recover)) fail('cleaning.recoverSteps must list steps');
  else {
    const waterSteps = new Set([...cleaning.cipSteps, ...cleaning.aicSteps].filter((step) => step.fluid === 'water').map((step) => step.step));
    for (const step of recover as unknown[]) {
      if (typeof step !== 'string' || !waterSteps.has(step)) fail(`cleaning.recoverSteps: ${String(step)} must be a water step of a programme`);
    }
  }
  // Phase 8: a boiler can't be more than all efficient, nor a kilogram of steam give the milk more than it took to raise.
  const { energy } = config;
  if (energy.boilerEfficiencyFrac > 1) fail('energy.boilerEfficiencyFrac must lie in 0–1');
  if (energy.boilerHeatKjPerKg < uht.steamLatentKjPerKg) fail('energy.boilerHeatKjPerKg must be at least uht.steamLatentKjPerKg, the heat a kilogram of steam gives the milk');
  // Phase 15: the yogurt line's block (schema 10), key by key.
  checkYogurt(config, fail);
  return problems;
}
