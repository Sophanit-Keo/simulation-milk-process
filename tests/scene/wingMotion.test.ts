// The yogurt machines in motion (phase 23, src/scene/equipment/yogurt/wingMotion.ts): every part belongs to a machine
// of the wing, all are one InstancedMesh that casts no shadow and takes no clicks, and each moves, stands or changes
// colour with the live sim: the mix line's rotors while it mixes, the homogenizer's pistons in production, the tanks'
// sight glasses with their pH, P8's flashes while it fills, the cold room's fans until its cooling fails. Phase 25 adds
// the process hall's gauges, valves, pumps and the CCP recorder (stages 12–14); phase 26 its fittings in colour.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sim, Snapshot } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import { DOCK_DOORS_X_M } from '../../src/scene/equipment/yogurt/layout';
import { wingSphere } from '../../src/scene/equipment/yogurt/coldChainScene';
import { jacketWater } from '../../src/scene/equipment/yogurt/hallDetail';
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
    for (const id of ['powder-station', 'high-shear-mixer', 'stabilizer-skid', 'yogurt-deaerator', 'yogurt-homogenizer', 'yogurt-phe', 'holding-cell', 'reprocess-tank', 'culture-pump', 'ferment-tank-1', 'smoothing-valve', 'yogurt-cooler', 'fruit-tank', 'p8-buffer', 'p8-filler', 'p8-vision', 'blast-chiller', 'cold-room']) {
      expect(Object.keys(w.state(id)).some((key) => key.endsWith('Turns')), id).toBe(true);
    }
  });

  it('stand inside the mesh\'s bounding sphere, every one, so the camera never culls them at a stage\'s stop (phase 25)', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    w.frames(5);
    const boxes = w.items.get('yogurt-pallets')?.object.getObjectByName('coldChainBoxes') as THREE.InstancedMesh;
    const sphere = boxes.boundingSphere ?? expect.fail('no bounding sphere');
    expect(sphere).toEqual(wingSphere());
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    let shown = 0;
    for (let i = 0; i < boxes.count; i++) {
      boxes.getMatrixAt(i, matrix);
      // A part not in use now (a pallet line's empty slot) is put away at no size.
      if (Math.abs(matrix.determinant()) < 1e-15) continue;
      at.setFromMatrixPosition(matrix);
      shown++;
      expect(sphere.distanceToPoint(at), `instance ${i} at ${at.toArray().map((n) => n.toFixed(1)).join(', ')}`).toBeLessThan(-1);
    }
    expect(shown).toBeGreaterThan(80);
    // The silo's corner and the far reefer's tractor too.
    expect(sphere.containsPoint(new THREE.Vector3(-58, 4, -46))).toBe(true);
    expect(sphere.containsPoint(new THREE.Vector3(32.5, 3, -82))).toBe(true);
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

describe('the process hall\'s gauges, valves and pumps (phase 25)', () => {
  const OPEN = '#34c759';
  const CLEAN = '#ffd84a';
  const SHUT = '#30363c';
  const num = (w: Wing, id: string, key: string): number => Number(w.state(id)[key]);

  it('as the plant opens: tank 1 empties through its open outlet valve, the buffer\'s valve opens while P8 runs, the heat treatment\'s gauges rest', () => {
    const w = wing();
    const snap = w.frames(20);
    expect(snap.yogurt.ferment.tanks.map((tank) => tank.state)).toEqual(['emptying', 'ready', 'fermenting']);
    expect(w.state('ferment-tank-1')).toMatchObject({ outletValveLift: 1, outletValveColor: OPEN, inletValveLift: 0, inletValveColor: SHUT });
    for (const id of ['ferment-tank-2', 'ferment-tank-3']) expect(w.state(id), id).toMatchObject({ outletValveLift: 0, inletValveLift: 0, outletValveColor: SHUT });
    expect(w.state('p8-buffer')).toMatchObject({ outletValveLift: 1, outletValveColor: OPEN });
    // Nothing is heated yet: no vacuum, no pressure, no steam.
    expect(w.state('yogurt-deaerator')).toMatchObject({ vacuumGaugeReading: 0, vacuumGaugeLift: 0 });
    expect(w.state('yogurt-homogenizer')).toMatchObject({ stage1GaugeReading: 0, flywheelMoving: false });
    expect(w.state('yogurt-phe')).toMatchObject({ hotWaterPumpMoving: false, steamValveLift: 0, steamValveReading: 0 });
    // The cooler cools what tank 1 sends to the buffer.
    expect(w.state('yogurt-cooler')).toMatchObject({ iceWaterPumpMoving: true });
    // Once tank 1 is emptied its clean opens both its valves, amber.
    runUntil(w, (each) => each.yogurt.ferment.tanks[0]?.state === 'cleaning');
    w.frames(20);
    expect(w.state('ferment-tank-1')).toMatchObject({ outletValveLift: 1, inletValveLift: 1, outletValveColor: CLEAN, inletValveColor: CLEAN });
  });

  it('in production: the gauges read the vacuum and both stages, the flywheel turns with the pistons, steam lifts its valve, the pen writes 92 °C', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0 && each.yogurt.ferment.tanks.some((tank) => tank.state === 'filling'));
    const snap = w.frames(30);
    expect(w.state('yogurt-deaerator')).toMatchObject({ vacuumGaugeReading: 0.8, vacuumGaugeLift: 0.8, vacuumGaugeMoving: false, vacuumGaugeColor: '#c8352a' });
    // 180 bar on a 250 bar scale; the second stage at the UHT's share of the first (30 of 200 bar).
    expect(w.state('yogurt-homogenizer')).toMatchObject({ stage1GaugeReading: 180, stage1GaugeLift: 0.72, stage2GaugeReading: 27, stage2GaugeLift: 0.108 });
    expect(w.state('yogurt-homogenizer')).toMatchObject({ flywheelMoving: true });
    expect(num(w, 'yogurt-homogenizer', 'flywheelTurns')).toBe(num(w, 'yogurt-homogenizer', 'piston1Turns'));
    const steamKgPerH = snap.yogurt.energy?.steamKgPerH ?? 0;
    expect(steamKgPerH).toBeGreaterThan(200);
    expect(w.state('yogurt-phe')).toMatchObject({ hotWaterPumpMoving: true, steamValveColor: CLEAN });
    expect(num(w, 'yogurt-phe', 'steamValveReading')).toBeCloseTo(steamKgPerH, 0);
    // About 255 kg/h lifts the stem all the way: 6,000 L/h from 68 to 92 °C.
    expect(num(w, 'yogurt-phe', 'steamValveLift')).toBeCloseTo(steamKgPerH / 255.3, 2);
    // The chart spans 80–95 °C: 92 °C writes four fifths across, in blue.
    expect(w.state('holding-cell')).toMatchObject({ recorderPenReading: 92, recorderPenLift: 0.8, recorderPenColor: '#2b5fa8', chartLine1Moving: true });
    // The tank that fills has its inlet valve open.
    const filling = snap.yogurt.ferment.tanks.findIndex((tank) => tank.state === 'filling');
    expect(w.state(`ferment-tank-${filling + 1}`)).toMatchObject({ inletValveLift: 1, inletValveColor: OPEN, outletValveLift: 0 });
  });

  it('in an under-temperature divert the pen falls under the limit, in red; the clean then pumps the reprocess tank out', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    w.sim.dispatch({ type: 'triggerScenario', id: 'yogurtHeatUnderTemp' });
    runUntil(w, (each) => each.yogurt.heat.mode === 'divert' && each.yogurt.heat.outletC < 84);
    const snap = w.frames(20);
    expect(w.state('holding-cell').recorderPenColor).toBe('#d63b26');
    expect(num(w, 'holding-cell', 'recorderPenReading')).toBeCloseTo(snap.yogurt.heat.outletC, 1);
    expect(num(w, 'holding-cell', 'recorderPenLift')).toBeLessThan((85 - 80) / 15);
    expect(w.state('reprocess-tank')).toMatchObject({ reprocessPumpMoving: false });
    runUntil(w, (each) => each.yogurt.heat.mode === 'cleaning' && each.yogurt.heat.reprocessTank.levelL > 0);
    w.frames(5);
    expect(w.state('reprocess-tank')).toMatchObject({ reprocessPumpMoving: true });
    expect(num(w, 'reprocess-tank', 'reprocessPumpTurns')).toBeGreaterThan(0);
  });

  it('stands every needle, stem and pen where it is while paused, half way if it was moving', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    w.frames(3);
    const lift = num(w, 'yogurt-homogenizer', 'stage1GaugeLift');
    expect(lift).toBeGreaterThan(0);
    expect(lift).toBeLessThan(0.72);
    w.sim.dispatch({ type: 'pause', paused: true });
    w.frames(10);
    expect(num(w, 'yogurt-homogenizer', 'stage1GaugeLift')).toBe(lift);
    expect(w.state('yogurt-homogenizer')).toMatchObject({ stage1GaugeMoving: false });
    w.sim.dispatch({ type: 'pause', paused: false });
    w.frames(30);
    expect(num(w, 'yogurt-homogenizer', 'stage1GaugeLift')).toBe(0.72);
  });
});

describe('the process hall\'s fittings in colour (phase 26)', () => {
  const DARK = '#1d2328';
  const OFF = '#30363c';
  const WARM = '#ea8027';
  const CHILLED = '#2b7bd0';

  it('gives each machine of stages 12–14 its fittings', () => {
    const w = wing();
    w.frames(1);
    const expected: Readonly<Record<string, readonly string[]>> = {
      'yogurt-deaerator': ['sightGlass'],
      'yogurt-homogenizer': ['screen', 'runLamp', 'cleanLamp', 'stopPlate', 'stopButton', 'oilGlass'],
      'yogurt-phe': ['nameplate', 'hotWaterDisplay'],
      'culture-pump': ['display', 'freezerDisplay'],
      'ferment-tank-1': ['jacketSupply', 'jacketReturn', 'jacketValve', 'cipDrop', 'sampleHandle', 'cipPost'],
      'ferment-tank-2': ['jacketValve', 'cipHeader'],
      'ferment-tank-3': ['jacketValve', 'cipPost'],
      'smoothing-valve': ['gaugeFace'],
      'yogurt-cooler': ['nameplate', 'iceValve'],
      'p8-buffer': ['sampleHandle'],
    };
    for (const [id, names] of Object.entries(expected)) {
      const state = w.state(id);
      for (const name of names) expect(`${name}Color` in state, `${id} ${name}`).toBe(true);
    }
    expect(w.state('yogurt-homogenizer')).toMatchObject({ stopButtonColor: '#d63b26', stopPlateColor: '#ffd84a', oilGlassColor: '#d9a441' });
    expect(w.state('p8-buffer').sampleHandleColor).toBe('#c8352a');
  });

  it('puts warm water in a fermenting tank\'s jacket and chilled in a ready or emptying one, and none in an empty one', () => {
    expect(jacketWater('fermenting')).toBe('warm');
    expect(jacketWater('ready')).toBe('chilled');
    expect(jacketWater('emptying')).toBe('chilled');
    for (const state of ['empty', 'filling', 'cleaning', undefined]) expect(jacketWater(state)).toBeNull();
  });

  it('as the plant opens: the jackets chill tanks 1 and 2 and warm tank 3, the ice water cools, the heat treatment\'s screens are dark', () => {
    const w = wing();
    w.frames(20);
    expect(w.state('ferment-tank-1')).toMatchObject({ jacketValveColor: CHILLED, jacketValveLift: 1 });
    expect(w.state('ferment-tank-2')).toMatchObject({ jacketValveColor: CHILLED, jacketValveLift: 1 });
    expect(w.state('ferment-tank-3')).toMatchObject({ jacketValveColor: WARM, jacketValveLift: 1 });
    expect(w.state('yogurt-cooler')).toMatchObject({ iceValveColor: CHILLED, iceValveLift: 1 });
    expect(w.state('yogurt-homogenizer')).toMatchObject({ screenColor: DARK, runLampColor: OFF, cleanLampColor: OFF });
    expect(w.state('yogurt-deaerator').sightGlassColor).toBe('#2a3036');
    expect(w.state('yogurt-phe').hotWaterDisplayColor).toBe(DARK);
    expect(w.state('culture-pump').displayColor).toBe(DARK);
    // A tank that is emptied and cleans takes no jacket water: its valve closes.
    runUntil(w, (each) => each.yogurt.ferment.tanks[0]?.state === 'cleaning');
    w.frames(20);
    expect(w.state('ferment-tank-1')).toMatchObject({ jacketValveColor: OFF, jacketValveLift: 0 });
  });

  it('in production: the homogenizer\'s screen and green lamp lit, the mix in the deaerator\'s glass, the hot water\'s display at 92 °C, the culture dosing', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    const snap = w.frames(5);
    expect(w.state('yogurt-homogenizer')).toMatchObject({ screenColor: '#4aa3ff', runLampColor: '#34c759', cleanLampColor: OFF });
    expect(w.state('yogurt-deaerator').sightGlassColor).toBe('#f3f1ea');
    expect(w.state('yogurt-phe').hotWaterDisplayColor).toBe(hex(wingTempColor(snap.yogurt.heat.outletC, new THREE.Color())));
    expect(w.state('culture-pump').displayColor).toBe('#34c759');
  });

  it('in the clean after a divert: the homogenizer\'s screen and its other lamp amber', () => {
    const w = wing();
    runUntil(w, (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    w.sim.dispatch({ type: 'triggerScenario', id: 'yogurtHeatUnderTemp' });
    runUntil(w, (each) => each.yogurt.heat.mode === 'cleaning');
    w.frames(2);
    expect(w.state('yogurt-homogenizer')).toMatchObject({ screenColor: '#ffd84a', runLampColor: OFF, cleanLampColor: '#ffd84a' });
  });
});
