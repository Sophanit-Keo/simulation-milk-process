// The panel's set-point sliders (src/ui/setpointSlider.ts): their ranges and steps, and the values they send.
import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim';
import { SETPOINT_SLIDERS, setpointText, snapToStep } from '../../src/ui/setpointSlider';
import { plantConfig } from '../helpers/plantConfig';

const uht = SETPOINT_SLIDERS[4];
const homogenizer = SETPOINT_SLIDERS[3];
const filler = SETPOINT_SLIDERS[7];
const yogurtHeat = SETPOINT_SLIDERS[12];
const ferment = SETPOINT_SLIDERS[13];
const p8 = SETPOINT_SLIDERS[15];
if (!uht || !homogenizer || !filler) throw new Error('stages 4, 3 and 7 need their sliders');
if (!yogurtHeat || !ferment || !p8) throw new Error('stages 12, 13 and 15 need their sliders (phase 17)');

describe('SETPOINT_SLIDERS', () => {
  it('puts the UHT set point in stage 4: 130–150 °C in 0.1 °C steps, following the sim', () => {
    expect(uht).toMatchObject({ key: 'uhtSetpointC', unit: '°C', min: 130, max: 150, step: 0.1, decimals: 1, follow: 'setpointC' });
  });

  it('puts the homogenizer first-stage pressure in stage 3: 100–250 bar in 5 bar steps', () => {
    expect(homogenizer).toMatchObject({ key: 'homogenizerStage1Bar', unit: 'bar', min: 100, max: 250, step: 5, decimals: 0 });
  });

  it('puts the filler rate in stage 7 (plan 08: filler speed): 0, a stop, to the 8,000 packs/h machine maximum, following the sim', () => {
    expect(filler).toMatchObject({ key: 'fillerRatePacksPerH', unit: 'packs/h', min: 0, max: plantConfig.fillers.maxRatePacksPerH, step: 100, decimals: 0, follow: 'ratePacksPerH' });
  });

  it('puts the yogurt line\'s set points in stages 12, 13 and 15 (phase 17), each following the sim', () => {
    // The heat treatment's slider reaches under the CCP's 85 °C, so the divert can be shown, as the UHT's does.
    expect(yogurtHeat).toMatchObject({ key: 'yogurtHeatC', unit: '°C', min: 80, max: 95, step: 0.5, decimals: 1, follow: 'setpointC' });
    expect(yogurtHeat.min).toBeLessThan(plantConfig.yogurt.heat.divertBelowC);
    expect(ferment).toMatchObject({ key: 'fermentTempC', unit: '°C', min: 37, max: 45, step: 0.5, decimals: 1, follow: 'setpointC' });
    expect(p8).toMatchObject({ key: 'p8RateCupsPerH', unit: 'cups/h', min: 10_800, max: 25_200, step: 360, decimals: 0, follow: 'setRateCupsPerH' });
  });

  it('has no other sliders', () => {
    expect(Object.keys(SETPOINT_SLIDERS).sort((a, b) => Number(a) - Number(b))).toEqual(['3', '4', '7', '12', '13', '15']);
  });

  it("covers plant.json's set points, on a step", () => {
    expect(snapToStep(plantConfig.uht.setpointC, uht)).toBe(plantConfig.uht.setpointC);
    expect(snapToStep(plantConfig.homogenizer.stage1Bar, homogenizer)).toBe(plantConfig.homogenizer.stage1Bar);
    expect(snapToStep(plantConfig.fillers.ratePacksPerH, filler)).toBe(plantConfig.fillers.ratePacksPerH);
    expect(snapToStep(plantConfig.yogurt.heat.setpointC, yogurtHeat)).toBe(plantConfig.yogurt.heat.setpointC);
    expect(snapToStep(plantConfig.yogurt.ferment.tempC, ferment)).toBe(plantConfig.yogurt.ferment.tempC);
    expect(snapToStep(plantConfig.yogurt.p8.rateCupsPerH, p8)).toBe(plantConfig.yogurt.p8.rateCupsPerH);
    // Each yogurt range ends on a step.
    for (const spec of [yogurtHeat, ferment, p8]) expect(snapToStep(spec.max, spec), spec.key).toBe(spec.max);
  });

  it('follows a stage value the sim reports', () => {
    const { stages } = createSim(plantConfig).snapshot();
    expect(stages[4].values[uht.follow ?? '']).toBe(plantConfig.uht.setpointC);
    expect(stages[7].values[filler.follow ?? '']).toBe(plantConfig.fillers.ratePacksPerH);
    expect(stages[12].values[yogurtHeat.follow ?? '']).toBe(plantConfig.yogurt.heat.setpointC);
    expect(stages[13].values[ferment.follow ?? '']).toBe(plantConfig.yogurt.ferment.tempC);
    expect(stages[15].values[p8.follow ?? '']).toBe(plantConfig.yogurt.p8.rateCupsPerH);
  });
});

describe('snapToStep', () => {
  it.each([
    [139.04, 139],
    [139.06, 139.1],
    [139.9, 139.9],
    [129, 130],
    [151.3, 150],
  ])('UHT %s °C sends %s', (value, sent) => {
    expect(snapToStep(value, uht)).toBe(sent);
  });

  it('never sends float dust, at any step of the UHT range', () => {
    for (let index = 0; index <= 200; index++) {
      const value = snapToStep(130 + index * 0.1, uht);
      expect(String(value), `step ${index}`).toMatch(/^1[345]\d(\.\d)?$/);
    }
  });

  it.each([
    [212, 210],
    [213, 215],
    [90, 100],
    [300, 250],
  ])('homogenizer %s bar sends %s', (value, sent) => {
    expect(snapToStep(value, homogenizer)).toBe(sent);
  });

  it('falls back to the bottom of the range for a value that is not a number', () => {
    expect(snapToStep(Number.NaN, uht)).toBe(130);
  });
});

describe('setpointText', () => {
  it('shows the value with its decimals and unit', () => {
    expect(setpointText(140, uht)).toBe('140.0 °C');
    expect(setpointText(139.2, uht)).toBe('139.2 °C');
    expect(setpointText(200, homogenizer)).toBe('200 bar');
    expect(setpointText(92, yogurtHeat)).toBe('92.0 °C');
    expect(setpointText(21_600, p8)).toBe('21,600 cups/h');
  });
});
