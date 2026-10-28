// The CIP station (src/scene/equipment/utilities.ts, phase 7): a tank per cleaning fluid behind the flash
// vessel, whose lamp lights while its fluid circulates, and the CIP lines (src/scene/pipes.ts) that meet it.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CleaningSnapshot, Snapshot } from '../../src/contracts';
import { utilities, CIP_STATION } from '../../src/scene/equipment/utilities';
import type { EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { ZONES } from '../../src/scene/layout';
import { CIP_CIRCUIT, CIP_LINES } from '../../src/scene/pipes';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

afterEach(() => vi.unstubAllGlobals());

const materials = new Proxy({}, { get: () => new THREE.MeshStandardMaterial() }) as Record<MaterialName, THREE.Material>;

function station() {
  stubTheme();
  const ctx: EquipmentContext = { materials, loadModel: () => Promise.reject(new Error('no models in unit tests')) };
  const item = utilities(ctx).find((each) => each.id === 'cip-station');
  if (!item) throw new Error('no cip-station');
  return item;
}

const base = createSim(plantConfig).snapshot();
const withCleaning = (cleaning: CleaningSnapshot | null): Snapshot => ({ ...base, liquid: { ...base.liquid, cleaning } });
const step = (fluid: CleaningSnapshot['fluid'], tempC: number | null): CleaningSnapshot => ({
  program: tempC === null ? 'aic' : 'cip',
  step: fluid === 'lye' ? 'lye' : fluid === 'acid' ? 'acid' : 'rinse',
  fluid,
  stepIndex: 1,
  stepCount: 6,
  stepRemainingS: 600,
  tempC,
  flowLph: plantConfig.cleaning.circulateLph,
});

describe('the CIP station', () => {
  it('is a stage 4 machine with a tank, a band and a lamp per fluid', () => {
    const item = station();
    expect(item.stage).toBe(4);
    expect(item.label).toBe('CIP station');
    for (const fluid of ['water', 'lye', 'acid']) {
      expect(item.object.getObjectByName(`cip-station-band-${fluid}`), fluid).toBeDefined();
      expect(item.object.getObjectByName(`cip-station-lamp-${fluid}`), fluid).toBeDefined();
    }
    item.dispose();
  });

  it('lights the lamp of the fluid that circulates, and none while the plant makes product', () => {
    const item = station();
    const intensity = (fluid: string): number =>
      ((item.object.getObjectByName(`cip-station-lamp-${fluid}`) as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity;
    item.update(withCleaning(null), 0.016);
    expect(item.debugState?.()).toEqual({ lit: 'none' });
    expect(['water', 'lye', 'acid'].map(intensity)).toEqual([0, 0, 0]);
    item.update(withCleaning(step('lye', 75)), 0.016);
    expect(item.debugState?.()).toEqual({ lit: 'lye' });
    expect(intensity('lye')).toBeGreaterThan(0);
    expect(intensity('water') + intensity('acid')).toBe(0);
    item.update(withCleaning(step('acid', 70)), 0.016);
    expect(intensity('acid')).toBeGreaterThan(0);
    expect(intensity('lye')).toBe(0);
    item.dispose();
  });

  it('labels the fluid, with a CIP step’s temperature; nothing while it stands', () => {
    const item = station();
    expect(item.labelText(withCleaning(null))).toBe('');
    expect(item.labelText(withCleaning(step('lye', 75)))).toBe('lye · 75 °C');
    expect(item.labelText(withCleaning(step('water', null)))).toBe('water');
    item.dispose();
  });

  it('stands in the UHT process zone, clear of the boiler house, and the CIP lines meet its pump, its header and the circuit', () => {
    const process = ZONES.find((zone) => zone.id === 'process')?.rect;
    const box = new THREE.Box3().setFromObject(station().object);
    expect(box.min.x >= (process?.xMinM ?? NaN) && box.max.x <= (process?.xMaxM ?? NaN)).toBe(true);
    expect(box.min.z >= (process?.zMinM ?? NaN) && box.max.z <= (process?.zMaxM ?? NaN)).toBe(true);
    // The boiler house spans x −18.6 to −15.4.
    expect(box.min.x).toBeGreaterThan(-15.4);
    const supply = CIP_LINES.find((line) => line.id === 'cip-supply')?.pointsM ?? [];
    const ret = CIP_LINES.find((line) => line.id === 'cip-return')?.pointsM ?? [];
    // The supply leaves the pump's front face; the return ends at the header's +x end.
    const { pump, header, tankXM } = CIP_STATION;
    expect(supply[0]).toEqual([pump.atM[0], 0.3, pump.atM[2] + pump.sizeM[2] / 2]);
    expect(ret.at(-1)).toEqual([tankXM.acid, header.yM, header.zM]);
    // The supply reaches the balance tank (x −33) at the circuit's start; the return leaves the tee at its end.
    expect(supply.at(-1)?.[0]).toBe(-33);
    expect(CIP_CIRCUIT.fromXM).toBeLessThan(-33);
    expect(ret[0]?.[0]).toBe(CIP_CIRCUIT.toXM);
  });
});
