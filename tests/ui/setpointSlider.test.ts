// The panel's set-point sliders (src/ui/setpointSlider.ts): their ranges and steps, and the values they send.
import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim';
import { SETPOINT_SLIDERS, setpointText, snapToStep } from '../../src/ui/setpointSlider';
import { plantConfig } from '../helpers/plantConfig';

const uht = SETPOINT_SLIDERS[4];
const homogenizer = SETPOINT_SLIDERS[3];
const filler = SETPOINT_SLIDERS[7];
if (!uht || !homogenizer || !filler) throw new Error('stages 4, 3 and 7 need their sliders');

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

  it('has no other sliders', () => {
    expect(Object.keys(SETPOINT_SLIDERS).sort()).toEqual(['3', '4', '7']);
  });

  it("covers plant.json's set points, on a step", () => {
    expect(snapToStep(plantConfig.uht.setpointC, uht)).toBe(plantConfig.uht.setpointC);
    expect(snapToStep(plantConfig.homogenizer.stage1Bar, homogenizer)).toBe(plantConfig.homogenizer.stage1Bar);
    expect(snapToStep(plantConfig.fillers.ratePacksPerH, filler)).toBe(plantConfig.fillers.ratePacksPerH);
  });

  it('follows a stage value the sim reports', () => {
    const { stages } = createSim(plantConfig).snapshot();
    expect(stages[4].values[uht.follow ?? '']).toBe(plantConfig.uht.setpointC);
    expect(stages[7].values[filler.follow ?? '']).toBe(plantConfig.fillers.ratePacksPerH);
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
  });
});
