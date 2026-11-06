// plant.json schema 10 (phase 15, D26): the yogurt line's block, key by key. checkPlantConfig refuses a missing or
// out-of-range yogurt key, and the UHT keys keep their values (D25).
import { describe, expect, it } from 'vitest';
import {
  checkPlantConfig,
  SETPOINT_RANGES,
  YOGURT_NUMBER_KEYS,
  YOGURT_PRODUCT_IDS,
  yogurtProducts,
  yogurtShiftProducts,
  type PlantConfig,
} from '../../src/contracts';
import { copyConfig, plantConfig } from '../helpers/plantConfig';

/** Deletes or sets one dotted key under yogurt in a fresh copy of the shipped config. */
function withYogurt(path: string, value: unknown): PlantConfig {
  const config = copyConfig();
  const keys = path.split('.');
  const last = keys.pop() as string;
  const parent = keys.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, config.yogurt as unknown as Record<string, unknown>);
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return config;
}

const problemsWith = (path: string, value: unknown): string[] => checkPlantConfig(withYogurt(path, value));

describe('plant.json schema 12', () => {
  it('is at schema 12 (phase 18 added P8\'s keys) and passes checkPlantConfig', () => {
    expect(plantConfig.schemaVersion).toBe(12);
    expect(checkPlantConfig(plantConfig)).toEqual([]);
  });

  it('keeps the UHT line\'s numbers: the keys outside yogurt are those of schema 9 (D25)', () => {
    // A sample of the keys the phase 3–14 tests rest on; the fixtures' fingerprints check the rest.
    expect(plantConfig.uht.capacityLph).toBe(16_000);
    expect(plantConfig.standardization.siloCapacityL).toBe(100_000);
    expect(plantConfig.cleaning.chemicals.lye.concentrationPct).toBe(1.5);
    expect(plantConfig.warehouse.palletsPerTruck).toBe(22);
  });

  it('holds D26\'s defaults', () => {
    const { yogurt } = plantConfig;
    expect(yogurt.mix).toMatchObject({ capacityLph: 6_000, fatPct: 3, snfPct: 11, milkSnfPct: 8.7, powderSnfPct: 95, stabilizerPct: 0.3 });
    expect(yogurt.heat).toMatchObject({ setpointC: 92, holdS: 300, divertBelowC: 85, minHoldS: 180, denatTargetPct: 85 });
    expect(yogurt.ferment).toMatchObject({ tempC: 43, tanks: 3, tankL: 10_000, startPh: 6.6, endPh: 4.55, endAtOptS: 14_400 });
    expect(yogurt.p8).toMatchObject({ cupG: 125, lanes: 12, rateCupsPerH: 21_600, atpMaxRlu: 10 });
    // D28's (phase 18): the seal's leak chances, the SIP's run, the clean swab, the check rates and the magazines.
    expect(yogurt.p8.seal).toMatchObject({ leakInWindowFrac: 0.0001, leakAllBeyondFrac: 0.5 });
    expect(yogurt.p8).toMatchObject({ atpCleanRlu: 4, metalRejectFrac: 0.000005, visionRejectFrac: 0.00005 });
    expect(yogurt.p8.hepa).toEqual({ minPa: 15, normalPa: 25, swingPa: 1.5, swingS: 3_600 });
    expect(yogurt.p8.sip).toEqual({ tempC: 121, holdS: 1_200, runC: 123 });
    expect(yogurt.p8.magazines).toEqual({ cups: 7_200, foils: 12_000, refillBelowFrac: 0.25, refillS: 240 });
    expect(yogurt.p8.rateCupsPerH / yogurt.p8.lanes / 60).toBe(30); // 12 lanes × 30 cycles a minute
    expect(yogurt.coldChain).toMatchObject({ cupsPerTray: 24, traysPerPallet: 120, releasePh: 4.6, roomC: 3, minHoldS: 86_400, maxHoldS: 172_800 });
  });

  it('names each product once, with its route, and a product for each of the day\'s three shifts', () => {
    const products = yogurtProducts(plantConfig);
    expect(Object.keys(products).sort()).toEqual([...YOGURT_PRODUCT_IDS].sort());
    expect(products.strawberryStirred).toMatchObject({ route: 'stirred', fruit: true });
    expect(products.plainSet).toMatchObject({ route: 'set', fruit: false });
    expect(yogurtShiftProducts(plantConfig)).toEqual(['plainStirred', 'strawberryStirred', 'plainSet']);
  });

  it('puts every set point inside the range its slider and the sim accept', () => {
    const { heat, ferment, p8 } = plantConfig.yogurt;
    const inside = (value: number, { min, max }: { min: number; max: number }) => value >= min && value <= max;
    expect(inside(heat.setpointC, SETPOINT_RANGES.yogurtHeatC)).toBe(true);
    expect(inside(ferment.tempC, SETPOINT_RANGES.fermentTempC)).toBe(true);
    expect(inside(p8.rateCupsPerH, SETPOINT_RANGES.p8RateCupsPerH)).toBe(true);
    // The heat slider reaches under the CCP's limit, so the divert can be shown, as the UHT slider does.
    expect(SETPOINT_RANGES.yogurtHeatC.min).toBeLessThan(heat.divertBelowC);
  });
});

describe('checkPlantConfig refuses a yogurt block', () => {
  it('that is missing', () => {
    const config = copyConfig() as Partial<PlantConfig>;
    delete config.yogurt;
    expect(checkPlantConfig(config as PlantConfig)).toEqual([expect.stringMatching(/^yogurt is missing/)]);
  });

  it.each(YOGURT_NUMBER_KEYS.map((key) => [key]))('without yogurt.%s, naming the key', (key) => {
    expect(problemsWith(key, undefined)).toContain(`yogurt.${key} is missing`);
  });

  it.each([
    ['heat.setpointC', 97, /heat.setpointC must lie in the yogurtHeatC set point's range, 80–95/],
    ['heat.setpointC', 84, /divertBelowC must be below heat.setpointC/],
    ['heat.minHoldS', 301, /minHoldS must not exceed heat.holdS/],
    ['ferment.tempC', 47, /ferment.tempC must lie in the fermentTempC set point's range/],
    ['ferment.endPh', 4.1, /floorPh < endPh < startPh/],
    ['ferment.optC', 52, /minC < optC < maxC/],
    ['ferment.minC', 38, /minC below and maxC above the fermentTempC set point's range, 37–45/],
    ['ferment.tanks', 2.5, /ferment.tanks must be a whole number/],
    ['ferment.endAtOptS', 0, /ferment.endAtOptS must be greater than 0/],
    ['mix.snfPct', 8, /milkSnfPct < snfPct < powderSnfPct/],
    ['mix.fatPct', 4.5, /mix.fatPct must be below the raw milk's fat/],
    ['mix.stabilizerPct', 120, /stabilizerPct must lie in 0–100/],
    ['silo.startFrac', 1.2, /silo.startFrac, silo.tankerBelowFrac and mix.tankStartFrac must lie in 0–1/],
    ['silo.tankerBelowFrac', 0.5, /a tanker unloading at tankerBelowFrac would overfill the silo/],
    ['buffer.setHighFrac', 0.95, /setHighFrac < highFrac/],
    ['buffer.setHighFrac', 0.6, /holds more set mix than P8 draws within buffer.setMaxWaitS/],
    ['cooling.flowLph', 2_000, /cooling.flowLph must be above what P8 draws/],
    ['cip.lyeConductivityMsPerCm', 0.5, /change-over must lie above the rinse water/],
    ['p8.rateCupsPerH', 30_000, /p8RateCupsPerH set point's range/],
    ['p8.fill.underBelowG', 128, /underBelowG < targetG < overAboveG/],
    ['p8.seal.tempC', 230, /seal.tempC must lie in its window/],
    ['p8.seal.timeS', 0.5, /seal.timeS must lie in its window/],
    ['p8.seal.bar', 7, /seal.bar must lie in its window/],
    ['p8.hepa.normalPa', 10, /normalPa must be above minPa/],
    ['p8.hepa.swingPa', 12, /the cabin's swing stops P8/],
    ['p8.seal.leakInWindowFrac', 1, /leakInWindowFrac must lie in 0–1/],
    ['p8.visionRejectFrac', -0.1, /visionRejectFrac must lie in 0–1/],
    ['p8.sip.runC', 120, /every SIP fails/],
    ['p8.atpCleanRlu', 7, /a clean surface fails its swab/],
    ['p8.magazines.cups', 10, /at least a cycle's cups and foils/],
    ['p8.magazines.foils', 100.5, /p8.magazines.foils must be a whole number/],
    ['p8.magazines.refillBelowFrac', 1, /refillBelowFrac must lie between 0 and 1/],
    ['coldChain.roomC', 5, /roomC must lie in roomMinC–roomMaxC/],
    ['coldChain.releasePh', 4.1, /releasePh must lie between/],
    ['coldChain.maxHoldS', 80_000, /minHoldS must be below maxHoldS/],
    ['cooling.outletC', 45, /cooling.outletC must be below ferment.tempC/],
    ['heat.holdS', Number.NaN, /heat.holdS must be a finite number/],
  ])('with yogurt.%s at %s', (path, value, message) => {
    expect(problemsWith(path, value)).toContainEqual(expect.stringMatching(message));
  });

  it('whose products miss one, repeat one, or give an unknown route', () => {
    const missing = copyConfig();
    missing.yogurt.products.pop();
    expect(checkPlantConfig(missing)).toContain('yogurt.products has no plainSet');
    const twice = copyConfig();
    twice.yogurt.products.push({ ...twice.yogurt.products[0] });
    expect(checkPlantConfig(twice)).toContainEqual(expect.stringMatching(/appears twice/));
    const route = copyConfig();
    route.yogurt.products[0].route = 'drinking';
    expect(checkPlantConfig(route)).toContainEqual(expect.stringMatching(/route must be one of stirred, set/));
  });

  it('whose product day is not one known product a shift', () => {
    const short = copyConfig();
    short.yogurt.shiftProducts.pop();
    expect(checkPlantConfig(short)).toContainEqual(expect.stringMatching(/must give 3 products/));
    const unknown = copyConfig();
    unknown.yogurt.shiftProducts[1] = 'kefir';
    expect(checkPlantConfig(unknown)).toContainEqual(expect.stringMatching(/shiftProducts\[1\] must be one of/));
  });

  it('leaves the shipped config untouched', () => {
    problemsWith('heat.setpointC', 97);
    expect(plantConfig.yogurt.heat.setpointC).toBe(92);
  });
});
