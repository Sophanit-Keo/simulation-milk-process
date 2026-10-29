// The boiler house (src/scene/equipment/utilities.ts), live since phase 8: its label reads the steam it raises
// for the injector, and its chimney's plume grows with the gas it burns (contracts v6, liquid.energy).
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnergySnapshot, Snapshot } from '../../src/contracts';
import { boilerPlumeFrac, PLUME_FULL_GAS_KW } from '../../src/scene/equipment/liquid/visuals';
import type { EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { utilities } from '../../src/scene/equipment/utilities';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

afterEach(() => vi.unstubAllGlobals());

const materials = new Proxy({}, { get: () => new THREE.MeshStandardMaterial() }) as Record<MaterialName, THREE.Material>;

function boilerHouse() {
  stubTheme();
  const ctx: EquipmentContext = { materials, loadModel: () => Promise.reject(new Error('no models in unit tests')) };
  const item = utilities(ctx).find((each) => each.id === 'boiler-house');
  if (!item) throw new Error('no boiler-house');
  return item;
}

const base = createSim(plantConfig).snapshot();
const withEnergy = (energy: Partial<EnergySnapshot> | undefined): Snapshot => ({
  ...base,
  liquid: { ...base.liquid, energy: energy && { ...(base.liquid.energy as EnergySnapshot), ...energy } },
});

describe('the boiler house', () => {
  it('is a stage 4 building with its chimney and a plume, which stays hidden until it is fed', () => {
    const item = boilerHouse();
    expect(item.stage).toBe(4);
    expect(item.label).toBe('Boiler house');
    expect(item.object.userData).toEqual({ equipmentId: 'boiler-house', stage: 4 });
    expect(item.object.getObjectByName('boiler-house-shell')).toBeDefined();
    expect(item.object.getObjectByName('chimney')).toBeDefined();
    expect(item.object.getObjectByName('boiler-plume')?.visible).toBe(false);
    item.dispose();
  });

  it('labels the steam it raises, 1,652 kg/h as the plant opens (H116); nothing from an older snapshot', () => {
    const item = boilerHouse();
    expect(item.labelText(base)).toBe('1,652 kg/h');
    expect(item.labelText(withEnergy({ steamKgPerH: 0, steamUse: null }))).toBe('0 kg/h');
    expect(item.labelText(withEnergy(undefined))).toBe('');
    item.dispose();
  });

  it('sizes the plume from the gas, full at an AIC’s 2,110 kW and over, and moves it only while time runs', () => {
    const item = boilerHouse();
    item.update(base, 0.1);
    const opening = item.debugState?.();
    expect(opening?.plumeFrac).toBeCloseTo(1_280.49 / PLUME_FULL_GAS_KW, 4);
    expect(item.object.getObjectByName('boiler-plume')?.visible).toBe(true);
    item.update({ ...base, paused: true }, 0.1);
    expect(item.debugState?.().phase).toBe(opening?.phase);
    item.update(withEnergy({ gasKw: 0 }), 0.1);
    expect(item.debugState?.().plumeFrac).toBe(0);
    expect(item.object.getObjectByName('boiler-plume')?.visible).toBe(false);
    item.dispose();
  });
});

describe('boilerPlumeFrac', () => {
  it('is the gas over 2,200 kW, clamped to 0–1; 0 from a snapshot without energy', () => {
    expect(boilerPlumeFrac(withEnergy({ gasKw: 1_100 }))).toBe(0.5);
    expect(boilerPlumeFrac(withEnergy({ gasKw: 2_110.34 }))).toBeCloseTo(0.959, 3);
    expect(boilerPlumeFrac(withEnergy({ gasKw: 5_000 }))).toBe(1);
    expect(boilerPlumeFrac(withEnergy({ gasKw: Number.NaN }))).toBe(0);
    expect(boilerPlumeFrac(withEnergy(undefined))).toBe(0);
  });
});
