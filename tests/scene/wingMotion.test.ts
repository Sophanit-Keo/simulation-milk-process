// The yogurt machines in motion (phase 23, src/scene/equipment/yogurt/wingMotion.ts): every part belongs to a machine
// of the wing, all are one InstancedMesh that casts no shadow and takes no clicks, and each moves, stands or changes
// colour with the live sim: the mix line's rotors while it mixes, the homogenizer's pistons in production, the tanks'
// sight glasses with their pH, P8's flashes while it fills, the cold room's fans until its cooling fails.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sim, Snapshot } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import { DOCK_DOORS_X_M } from '../../src/scene/equipment/yogurt/layout';
import { contentColor, evaporatorXs, wingTempColor } from '../../src/scene/equipment/yogurt/wingMotion';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

afterEach(() => vi.unstubAllGlobals());

function makeContext(): EquipmentContext {
  const names: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
  return {
    materials: Object.fromEntries(names.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
    loadModel: () => Promise.reject(new Error('no models in unit tests')),
  };
}

const hex = (color: THREE.Color): string => `#${color.getHexString()}`;

interface Wing {
  sim: Sim;
  items: Map<string, Equipment>;
  /** Frames of `realDtS` at the sim's speed, each updating every machine, as the host does. */
  frames(count: number, realDtS?: number): Snapshot;
  state(id: string): Record<string, number | string | boolean>;
}

function wing(): Wing {
  stubTheme();
  const sim = createSim(plantConfig);
  const items = new Map(yogurtLine(makeContext()).map((item) => [item.id, item]));
  return {
    sim,
    items,
    frames(count, realDtS = 0.1) {
      let snap = sim.snapshot();
      for (let i = 0; i < count; i++) {
        sim.step(realDtS);
        snap = sim.snapshot();
        for (const item of items.values()) item.update(snap, realDtS);
      }
      return snap;
    },
    state: (id) => ({ ...(items.get(id)?.debugState?.() ?? {}) }),
  };
}

/** Runs at ×1,000 until `until` holds, then sets ×1 again so the parts move at their own pace. */
function runUntil(w: Wing, until: (snap: Snapshot) => boolean, maxFrames = 20_000): Snapshot {
  w.sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  let snap = w.sim.snapshot();
  for (let i = 0; i < maxFrames && !until(snap); i++) {
    w.sim.step(0.1);
    snap = w.sim.snapshot();
  }
  w.sim.dispatch({ type: 'setSpeed', speed: 1 });
  return snap;
}

describe('the wing\'s moving parts (phase 23)', () => {
  it('are instances of the cold chain\'s box mesh, ahead of its pallets: no draw call of their own, no shadow, no clicks', () => {
    const w = wing();
    const tokens = w.items.get('yogurt-pallets');
    const meshes: THREE.InstancedMesh[] = [];
    tokens?.object.traverse((node) => node instanceof THREE.InstancedMesh && meshes.push(node));
    // Still the cold chain's two draw calls (phase 19): its boxes and its lamps.
    expect(meshes.map((mesh) => mesh.name)).toEqual(['coldChainBoxes', 'roomGlows']);
    const [boxes] = meshes;
    const opening = w.frames(1);
    const pallets = Number(tokens?.debugState?.().cold ?? 0);
    expect(pallets).toBeGreaterThan(0);
    // The motion's parts come first: the mixer's rotor turns where the first instances stand.
    const first = new THREE.Matrix4();
    boxes?.getMatrixAt(1, first);
    const at = new THREE.Vector3().setFromMatrixPosition(first);
    expect(at.x).toBeCloseTo(-52, 6);
    expect(boxes?.count).toBeGreaterThan(30);
    expect(boxes?.castShadow).toBe(false);
    expect(new THREE.Raycaster(new THREE.Vector3(-52, 10, -46), new THREE.Vector3(0, -1, 0)).intersectObject(boxes as THREE.Object3D)).toEqual([]);
    expect(opening.yogurt).toBeDefined();
    // Every machine with parts reports them.
    for (const id of ['powder-station', 'high-shear-mixer', 'stabilizer-skid', 'yogurt-deaerator', 'yogurt-homogenizer', 'yogurt-phe', 'culture-pump', 'ferment-tank-1', 'smoothing-valve', 'yogurt-cooler', 'fruit-tank', 'p8-filler', 'p8-vision', 'blast-chiller', 'cold-room']) {
      expect(Object.keys(w.state(id)).some((key) => key.endsWith('Turns')), id).toBe(true);
    }
  });

  it('as the plant opens: the mixer\'s rotors spin, the chiller\'s and the cold room\'s fans turn, the homogenizer stands; nothing moves while paused', () => {
    const w = wing();
    w.frames(10);
    expect(w.state('high-shear-mixer')).toMatchObject({ rotor1Moving: true, rotor2Moving: true });
    expect(Number(w.state('high-shear-mixer').rotor1Turns)).toBeGreaterThan(0);
    expect(w.state('yogurt-homogenizer')).toMatchObject({ piston1Moving: false, piston2Turns: 0 });
    expect(w.state('blast-chiller')).toMatchObject({ fan1Moving: true });
    expect(w.state('cold-room')).toMatchObject({ fan1Moving: true, evaporator1Moving: false });
    const before = w.state('high-shear-mixer').rotor1Turns;
    w.sim.dispatch({ type: 'pause', paused: true });
    w.frames(10);
    expect(w.state('high-shear-mixer').rotor1Turns).toBe(before);
  });

  it('shows each tank\'s contents through its sight glass: cream yogurt at the end pH, still white-ish half way, dark when empty', () => {
    const w = wing();
    const snap = w.frames(2);
    const color = new THREE.Color();
    // Tank 1 empties, nearly full at pH 4.55; tank 3 ferments at pH 5.57.
    expect(w.state('ferment-tank-1').sightGlassColor).toBe(hex(contentColor(4.55, color)));
    expect(w.state('ferment-tank-3').sightGlassColor).toBe(hex(contentColor(snap.yogurt.ferment.tanks[2]?.ph ?? 0, color)));
    expect(hex(contentColor(6.6, color))).toBe('#f3f1ea');
    expect(hex(contentColor(4.55, color))).toBe('#e9dcb2');
    // Once tank 1 is empty its glass shows the empty tank.
    runUntil(w, (each) => each.yogurt.ferment.tanks[0]?.state === 'cleaning');
    w.frames(1);
    expect(w.state('ferment-tank-1').sightGlassColor).toBe('#2a3036');
  });

  it('in production: the homogenizer\'s pistons stroke, the heat exchanger\'s strips show the regeneration, 92 °C and 43 °C', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    const snap = w.frames(10);
    expect(w.state('yogurt-homogenizer')).toMatchObject({ piston1Moving: true, piston3Moving: true });
    expect(w.state('culture-pump')).toMatchObject({ plungerMoving: true });
    const color = new THREE.Color();
    expect(w.state('yogurt-phe')).toMatchObject({
      regenerationStripColor: hex(wingTempColor(68, color)),
      heatingStripColor: hex(wingTempColor(snap.yogurt.heat.outletC, color)),
      coolingStripColor: hex(wingTempColor(43, color)),
    });
  });

  it('flashes P8\'s coder and its gates once a cycle while it fills, each gate in its turn', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.p8.state === 'running');
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      w.frames(1, 0.1);
      seen.add(`${w.state('p8-filler').coderFlashColor}`);
    }
    expect(seen).toEqual(new Set(['#ffd84a', '#30363c']));
    expect(w.state('p8-vision')).toMatchObject({ checkFlashMoving: true });
  });

  it('hangs the cold room\'s evaporators between its dock doors, clear of every door', () => {
    expect(evaporatorXs()).toEqual([25.75, 30.25, 35.15]);
    // Each casing is 1.0 m wide; each door 2.8 m.
    for (const xM of evaporatorXs()) for (const doorXM of DOCK_DOORS_X_M) expect(Math.abs(xM - doorXM), `${xM} by the door at ${doorXM}`).toBeGreaterThanOrEqual(1.4 + 0.5);
  });

  it('stands the cold room\'s fans still while its cooling is down, and turns them again once it is repaired', () => {
    const w = wing();
    w.frames(2);
    w.sim.dispatch({ type: 'triggerScenario', id: 'yogurtColdRoomExcursion' });
    w.frames(3);
    expect(w.state('cold-room')).toMatchObject({ fan1Moving: false, fan2Moving: false, fan3Moving: false });
    w.sim.dispatch({ type: 'resetScenarios' });
    w.frames(3);
    expect(w.state('cold-room')).toMatchObject({ fan1Moving: true });
  });
});
