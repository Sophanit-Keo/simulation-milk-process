import { describe, expect, expectTypeOf, it } from 'vitest';
import { checkPlantConfig, dayToS, hToS, SPEEDS, sToH, type PlantConfig } from '../../src/contracts';
import plantJson from '../../src/data/plant.json';
import { divertLimitC, holdTimeS, tubeVolumeL } from '../../src/sim/formulas';
import { expectWithin } from '../helpers/expectWithin';
import { copyConfig, plantConfig as config } from '../helpers/plantConfig';

// R3: a pallet of 1,008 × 1 L packs weighs about 1.1 t, and a 40 t articulated truck carries about 24–25 t.
const PALLET_T = 1.1;
const TRUCK_PAYLOAD_T = 25;

const packsPerPallet = config.packaging.packsPerTray * config.packaging.traysPerPallet;
const fillerDrawLph = config.fillers.count * config.fillers.ratePacksPerH * config.product.packVolumeL;
const tankStartL = config.asepticTank.capacityL * config.asepticTank.startFrac;
const tubeL = tubeVolumeL(config.uht.holdAtCapacityS, config.uht.capacityLph);
const holdThrottledS = holdTimeS(tubeL, config.uht.capacityLph * config.asepticTank.throttledFlowFrac);

describe('plant.json', () => {
  it('has exactly the keys and value types of PlantConfig', () => {
    // Checked by `npm run typecheck`: a missing key or a key the contract does not know fails the build.
    expectTypeOf(plantJson).toEqualTypeOf<PlantConfig>();
  });

  it('passes checkPlantConfig', () => {
    expect(checkPlantConfig(config)).toEqual([]);
  });
});

describe('numbers that follow from plant.json', () => {
  it('a pallet holds 1,008 packs (H26)', () => {
    expect(packsPerPallet).toBe(1_008);
  });

  it('a batch, one filler for 8 h, is 60,000 packs and 16 samples (R1, H27, H29)', () => {
    expect(config.fillers.ratePacksPerH * sToH(config.quality.batchS)).toBe(60_000);
    expect(config.quality.batchS / config.quality.sampleEveryS).toBe(16);
  });

  it('shifts, and with them batches, start at 06:00 on day 1 and every 8 h after: 06:00, 14:00 and 22:00 (D1)', () => {
    expect(config.quality.firstShiftStartS).toBe(hToS(6));
    expect(3 * config.quality.batchS).toBe(dayToS(1));
  });

  it('the UHT plant makes 1,000 L/h more than the fillers draw (H31)', () => {
    expect(config.uht.capacityLph - fillerDrawLph).toBe(1_000);
  });

  it('a 30 min intermediate clean draws 7,500 L, and the starting level covers it (H32)', () => {
    const cleanDrawL = fillerDrawLph * sToH(config.cleaning.aicS);
    expect(cleanDrawL).toBe(7_500);
    expect(tankStartL - cleanDrawL).toBeGreaterThan(config.asepticTank.fillersStopBelowL);
  });

  it('display noise stays inside the margin between set point and divert limit at full flow (R4, D4)', () => {
    const marginC = config.uht.setpointC - divertLimitC(config.uht.holdAtCapacityS);
    expect(config.uht.displayNoiseC).toBeLessThan(marginC);
  });

  it('the fault temperature is below the divert limit at full flow, so the fault scenario diverts', () => {
    expect(config.uht.faultTempC).toBeLessThan(divertLimitC(config.uht.holdAtCapacityS));
  });

  it('the fault temperature is also below the divert limit at throttled flow, where the hold is longer (R6, H24)', () => {
    expectWithin(holdThrottledS, 8, 0.001);
    expect(config.uht.faultTempC).toBeLessThan(divertLimitC(holdThrottledS));
  });

  it('7 days at x10,000 take about a minute of real time (H54)', () => {
    expectWithin(dayToS(7) / Math.max(...SPEEDS), 60.48, 0.01);
  });

  it('shipping, about 317 pallets a day, stays below the 357 a day the fillers can make (R3, D3, H38, H42)', () => {
    const shippedPalletsPerDay = (dayToS(1) / config.warehouse.truckEveryS) * config.warehouse.palletsPerTruck;
    const madePalletsPerDay = (config.fillers.count * config.fillers.ratePacksPerH * sToH(dayToS(1))) / packsPerPallet;
    expectWithin(shippedPalletsPerDay, 316.8, 1e-9);
    expectWithin(madePalletsPerDay, 357.14, 0.01);
    expect(shippedPalletsPerDay).toBeLessThanOrEqual(madePalletsPerDay);
  });

  it('with the D2 downtime, stock grows by about 30.22 pallet-loads a day (H40, H43)', () => {
    const { mtbfMeanS, repairFixedS, repairRandomMeanS } = config.fillers;
    const availabilityFrac = mtbfMeanS / (mtbfMeanS + repairFixedS + repairRandomMeanS);
    const madePalletLoadsPerDay =
      (config.fillers.count * config.fillers.ratePacksPerH * sToH(dayToS(1)) * availabilityFrac) / packsPerPallet;
    const shippedPalletsPerDay = (dayToS(1) / config.warehouse.truckEveryS) * config.warehouse.palletsPerTruck;
    expectWithin(madePalletLoadsPerDay, 347.02, 0.01);
    expectWithin(madePalletLoadsPerDay - shippedPalletsPerDay, 30.22, 0.01);
  });

  it('a full truck stays within its payload: 22 pallets × about 1.1 t ≤ 25 t (R3)', () => {
    expect(config.warehouse.palletsPerTruck * PALLET_T).toBeLessThanOrEqual(TRUCK_PAYLOAD_T);
  });

  it('the plant opens on day 8 at 06:00 after a week of batches, with two days of released stock (D11, H44)', () => {
    expect(config.clock.startTimeS).toBe(dayToS(7) + hToS(6));
    expect(config.quality.historyDays).toBe(config.quality.incubationDays);
    expectWithin(config.warehouse.startStockPallets / ((dayToS(1) / config.warehouse.truckEveryS) * config.warehouse.palletsPerTruck), 2.0, 0.01);
  });

  it('a batch change queues 250 packs a line at 7,500 packs/h, which the packer clears at up to 30% over 8,000/h in about 5 min (D9, D14)', () => {
    const queuedPacks = config.fillers.ratePacksPerH * sToH(config.packaging.batchChangeS);
    expect(queuedPacks).toBe(250);
    const clearH = queuedPacks / (config.fillers.maxRatePacksPerH * (1 + config.packaging.catchUpFrac) - config.fillers.ratePacksPerH);
    expectWithin(clearH * 60, 5.17, 0.01);
  });
});

describe('checkPlantConfig catches a broken copy', () => {
  const problemsWith = (breakIt: (copy: PlantConfig) => void): string[] => {
    const copy = copyConfig();
    breakIt(copy);
    return checkPlantConfig(copy);
  };

  it.each([
    ['equal to', 0.9],
    ['above', 0.95],
  ])('resumeBelowFrac %s throttleAboveFrac', (_label, resumeBelowFrac) => {
    const problems = problemsWith((copy) => {
      copy.asepticTank.throttleAboveFrac = 0.9;
      copy.asepticTank.resumeBelowFrac = resumeBelowFrac;
    });
    expect(problems.join('\n')).toMatch(/resumeBelowFrac/);
  });

  it('a default speed that is not a preset (7)', () => {
    expect(problemsWith((copy) => (copy.clock.defaultSpeed = 7)).join('\n')).toMatch(/defaultSpeed/);
  });

  it('a negative value', () => {
    expect(problemsWith((copy) => (copy.uht.rejectTankL = -1)).join('\n')).toMatch(/uht\.rejectTankL/);
  });

  it('a fractional filler count', () => {
    expect(problemsWith((copy) => (copy.fillers.count = 2.5)).join('\n')).toMatch(/fillers\.count/);
  });

  it('a fault temperature above the set point', () => {
    const problems = problemsWith((copy) => (copy.uht.faultTempC = copy.uht.setpointC + 1));
    expect(problems.join('\n')).toMatch(/faultTempC/);
  });

  it.each([
    ['quality.batchS', (copy: PlantConfig) => (copy.quality.batchS = 0)],
    ['quality.sampleEveryS', (copy: PlantConfig) => (copy.quality.sampleEveryS = 0)],
    ['warehouse.truckEveryS', (copy: PlantConfig) => (copy.warehouse.truckEveryS = 0)],
    ['uht.capacityLph', (copy: PlantConfig) => (copy.uht.capacityLph = 0)],
    ['clock.baseStepS', (copy: PlantConfig) => (copy.clock.baseStepS = 0)],
  ])('a zero %s, which the model divides by or steps with', (path, change) => {
    expect(problemsWith(change).join('\n')).toContain(`${path} must be greater than 0`);
  });

  it.each([
    ['a batch shorter than the fast step', (copy: PlantConfig) => (copy.quality.batchS = 5), 'quality.batchS must be at least clock.fastStepS'],
    ['a 1e-12 s batch', (copy: PlantConfig) => (copy.quality.batchS = 1e-12), 'quality.batchS must be at least clock.fastStepS'],
    [
      '1e-12 s clock steps',
      (copy: PlantConfig) => Object.assign(copy.clock, { baseStepS: 1e-12, fastStepS: 1e-12 }),
      'clock.baseStepS must be at least 0.01 s',
    ],
    ['a start time of 1e17 s', (copy: PlantConfig) => (copy.clock.startTimeS = 1e17), 'clock.startTimeS must be at most 36500 days'],
  ])('%s, which would hang the sim or make "next event" crawl', (_label, change, problem) => {
    expect(problemsWith(change)).toContain(problem);
  });

  // Phase 3: rules that keep the liquid-line model working.
  it.each([
    ['a tanker that would overfill the silo', (copy: PlantConfig) => (copy.standardization.tankerL = 70_000), /overfill the silo/],
    ['a tanker slower than the separator draws', (copy: PlantConfig) => (copy.standardization.tankerUnloadLph = 16_000), /tankerUnloadLph/],
    ['no tanker threshold, so the silo would run dry first', (copy: PlantConfig) => (copy.standardization.tankerBelowFrac = 0), /tankerBelowFrac must be greater than 0/],
    ['a mixing-tank idle level above full', (copy: PlantConfig) => (copy.standardization.mixTankIdleFrac = 1.2), /idle fractions/],
    ['a filler restart level at or below the stop level', (copy: PlantConfig) => (copy.asepticTank.fillersRestartAboveL = 150), /fillersRestartAboveL/],
    ['a filler restart level above the resume level', (copy: PlantConfig) => (copy.asepticTank.fillersRestartAboveL = 13_000), /fillersRestartAboveL/],
    ['a headspace minimum above the maximum', (copy: PlantConfig) => (copy.asepticTank.headspaceMinBar = 3.5), /headspaceMinBar/],
    ['a homogenizer more than 100% efficient', (copy: PlantConfig) => (copy.homogenizer.efficiencyFrac = 1.2), /efficiencyFrac/],
    ['a zero homogenizer efficiency', (copy: PlantConfig) => (copy.homogenizer.efficiencyFrac = 0), /efficiencyFrac must be greater than 0/],
    ['globules after homogenizing larger than before', (copy: PlantConfig) => (copy.homogenizer.globuleRefUm = 4), /globuleRefUm/],
    ['a creaming-risk band the wrong way round', (copy: PlantConfig) => (copy.homogenizer.creamingFullUm = 0.9), /creamingOkUm/],
    ['an amber B* level under the divert at 1', (copy: PlantConfig) => (copy.uht.bStarWarnBelow = 0.9), /bStarWarnBelow/],
    ['a zero lag', (copy: PlantConfig) => (copy.preheating.lagS = 0), /preheating\.lagS must be greater than 0/],
    ['a zero mixing-tank lag', (copy: PlantConfig) => (copy.standardization.mixTankLagS = 0), /mixTankLagS must be greater than 0/],
    ['a zero clean interval, which would clean forever', (copy: PlantConfig) => (copy.cleaning.aicEveryProductionS = 0), /aicEveryProductionS must be greater than 0/],
    ['a zero steam latent heat', (copy: PlantConfig) => (copy.uht.steamLatentKjPerKg = 0), /steamLatentKjPerKg must be greater than 0/],
    // Phase 4: rules that keep the discrete model working.
    ['a seal check that rejects every pack', (copy: PlantConfig) => (copy.fillers.rejectFrac = 1), /rejectFrac must be below 1/],
    ['a failure chance per pack above 1', (copy: PlantConfig) => (copy.quality.failurePerPack = 1.5), /failurePerPack must lie in 0–1/],
    ['a batch change as long as a batch', (copy: PlantConfig) => (copy.packaging.batchChangeS = copy.quality.batchS), /batchChangeS must be shorter/],
    ['a batch change with no catch-up speed to clear its queue', (copy: PlantConfig) => (copy.packaging.catchUpFrac = 0), /catchUpFrac must be greater than 0/],
    ['history older than one incubation', (copy: PlantConfig) => (copy.quality.historyDays = 8), /historyDays must not exceed/],
    ['a fractional day of history', (copy: PlantConfig) => (copy.quality.historyDays = 6.5), /historyDays must be a whole number/],
    ['a fractional opening stock', (copy: PlantConfig) => (copy.warehouse.startStockPallets = 633.5), /startStockPallets must be a whole number/],
    ['no dock doors', (copy: PlantConfig) => (copy.warehouse.dockDoors = 0), /dockDoors must be greater than 0/],
    ['a batch too big for its SSCC serials', (copy: PlantConfig) => (copy.quality.batchS = 500 * 3_600), /SSCC serial range/],
    // Phase 5: the scenarios must be faults, and their chances real chances.
    ['a homogenizer fault at the set pressure', (copy: PlantConfig) => (copy.scenarios.homogenizerFaultBar = 200), /homogenizerFaultBar must be below/],
    ['a filter-failure spoil chance above 1', (copy: PlantConfig) => (copy.scenarios.filterFailurePerPack = 1.2), /filterFailurePerPack must lie in 0–1/],
    ['a sensory limit above 100%', (copy: PlantConfig) => (copy.scenarios.sensoryFailAbovePct = 120), /sensoryFailAbovePct must lie in 0–100/],
    ['a fractional number of extra trucks', (copy: PlantConfig) => (copy.scenarios.spikeTrucks = 2.5), /spikeTrucks must be a whole number/],
    ['a zero steam lag', (copy: PlantConfig) => (copy.scenarios.steamFaultLagS = 0), /steamFaultLagS must be greater than 0/],
    ['a zero filler repair', (copy: PlantConfig) => (copy.scenarios.fillerRepairS = 0), /fillerRepairS must be greater than 0/],
  ])('%s', (_label, change, problem) => {
    expect(problemsWith(change).join('\n')).toMatch(problem);
  });

  it('a value that is not finite', () => {
    expect(problemsWith((copy) => (copy.fillers.mtbfMeanS = Number.NaN)).join('\n')).toMatch(/fillers\.mtbfMeanS/);
  });

  it('leaves the shipped config untouched', () => {
    const before = JSON.stringify(config);
    problemsWith((copy) => (copy.fillers.count = 2.5));
    expect(JSON.stringify(config)).toBe(before);
  });
});
