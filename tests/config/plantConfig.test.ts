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

  it('a full truck stays within its payload: 22 pallets × about 1.1 t ≤ 25 t (R3)', () => {
    expect(config.warehouse.palletsPerTruck * PALLET_T).toBeLessThanOrEqual(TRUCK_PAYLOAD_T);
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

  it('a value that is not finite', () => {
    expect(problemsWith((copy) => (copy.fillers.mtbfMeanS = Number.NaN)).join('\n')).toMatch(/fillers\.mtbfMeanS/);
  });

  it('leaves the shipped config untouched', () => {
    const before = JSON.stringify(config);
    problemsWith((copy) => (copy.fillers.count = 2.5));
    expect(JSON.stringify(config)).toBe(before);
  });
});
