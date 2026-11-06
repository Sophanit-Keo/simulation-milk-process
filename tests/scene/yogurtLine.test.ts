import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YOGURT_STAGE_IDS, type Snapshot } from '../../src/contracts';
import { EQUIPMENT_FACTORIES, type Equipment, type EquipmentContext, type MaterialName } from '../../src/scene/equipment';
import { OUTFEED } from '../../src/scene/equipment/yogurt/layout';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import { REEFER_YARD, STAGE_VIEWS, ZONES, type RectM } from '../../src/scene/layout';
import { YOGURT_RUNS } from '../../src/scene/yogurtPipes';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { heatValveLamp, phRingFrac, tankStirs } from '../../src/scene/equipment/yogurt/readings';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

// The yogurt wing in grey boxes (phase 16, gate Y1): every machine of the phase table stands in its stage's zone,
// none overlaps another, the pipes stay on the wing's floor, and the tank gauges follow the mock snapshot.

afterEach(() => vi.unstubAllGlobals());

function makeContext(): EquipmentContext {
  const names: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
  return {
    materials: Object.fromEntries(names.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
    loadModel: () => Promise.reject(new Error('no models in unit tests')),
  };
}

const boxOf = (item: Equipment): THREE.Box3 => {
  item.object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(item.object);
};
const inside = (box: THREE.Box3, rect: RectM, marginM = 1e-6): boolean =>
  box.min.x >= rect.xMinM - marginM && box.max.x <= rect.xMaxM + marginM && box.min.z >= rect.zMinM - marginM && box.max.z <= rect.zMaxM + marginM;

/** The phase 16 table's machines, by stage. */
const EXPECTED: Readonly<Record<number, readonly string[]>> = {
  11: ['yogurt-silo', 'powder-station', 'high-shear-mixer', 'stabilizer-skid', 'yogurt-mix-tank'],
  12: ['yogurt-deaerator', 'yogurt-homogenizer', 'yogurt-phe', 'holding-cell', 'yogurt-divert-valve', 'reprocess-tank'],
  13: ['culture-pump', 'ferment-tank-1', 'ferment-tank-2', 'ferment-tank-3'],
  14: ['smoothing-valve', 'yogurt-cooler', 'fruit-tank', 'p8-buffer'],
  15: ['p8-filler', 'p8-checkweigher', 'p8-metal-detector', 'p8-vision', 'p8-reject-bin'],
  16: ['p8-tray-packer', 'yogurt-palletizer', 'yogurt-wrapper', 'warm-room', 'blast-chiller', 'cold-room'],
};

describe('the yogurt wing in grey boxes', () => {
  stubTheme();
  const machines = yogurtLine(makeContext());

  it('has every machine of the phase 16 table, each tagged with its stage', () => {
    for (const stage of YOGURT_STAGE_IDS) {
      expect(machines.filter((item) => item.stage === stage).map((item) => item.id), `stage ${stage}`).toEqual(EXPECTED[stage]);
    }
  });

  it('has ids no other machine of the plant uses', () => {
    stubTheme();
    const all = EQUIPMENT_FACTORIES.flatMap((make) => make(makeContext()));
    const ids = all.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of all) item.dispose();
  });

  it('stands every machine inside the zone of its stage', () => {
    for (const item of machines) {
      const zone = ZONES.find((candidate) => candidate.stages.includes(item.stage));
      if (!zone) expect.fail(`${item.id}: no zone has stage ${item.stage}`);
      // The tray packer's belt starts just past P8's last gate, so it reaches back into the cup filling room; the
      // cold room's dock levellers stand outside its doors, on the reefer yard (1.2 m).
      let rect = zone.rect;
      if (item.id === 'p8-tray-packer') rect = { ...rect, xMinM: OUTFEED.xMinM };
      if (item.id === 'cold-room') rect = { ...rect, zMinM: rect.zMinM - 1.2 };
      expect(inside(boxOf(item), rect), `${item.id} in ${zone.id}`).toBe(true);
      // The camera stop looks at its stage's zone.
      const [fx, , fz] = STAGE_VIEWS[item.stage].focusM;
      expect(fx >= zone.rect.xMinM - 1 && fx <= zone.rect.xMaxM + 1 && fz >= zone.rect.zMinM && fz <= zone.rect.zMaxM, `stage ${item.stage} focus`).toBe(true);
    }
  });

  it('keeps every machine clear of every other', () => {
    const boxes = machines.map((item) => ({ id: item.id, box: boxOf(item).expandByScalar(-0.01) }));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(a.box.intersectsBox(b.box), `${a.id} and ${b.id}`).toBe(false);
    }
  });

  it('runs the pipes on the wing\'s floor, between its zones', () => {
    const wing = { xMinM: -61, xMaxM: 16, zMinM: -56, zMaxM: -32 };
    for (const run of YOGURT_RUNS) {
      for (const path of run.paths) {
        for (const [xM, yM, zM] of path.vertices) {
          expect(xM >= wing.xMinM && xM <= wing.xMaxM && zM >= wing.zMinM && zM <= wing.zMaxM, `${run.id} at ${xM}, ${zM}`).toBe(true);
          expect(yM > 0.1 && yM < 2, `${run.id} at height ${yM}`).toBe(true);
        }
      }
    }
  });

  it('keeps every pipe clear of every machine but where it meets a port, or passes through the in-line mixer or the holding cell', () => {
    // A ray along each segment's centre line against the machines' own triangles: a hit away from the path's ends
    // (its ports) is a pipe through a machine. The high-shear mixer is a pump in the line; the holding cell's frame
    // stands round its own serpentine.
    const passThrough = new Set(['high-shear-mixer', 'holding-cell']);
    const solids = machines.filter((item) => !passThrough.has(item.id));
    const scene = new THREE.Scene();
    for (const item of solids) scene.add(item.object);
    scene.updateMatrixWorld(true);
    const PORT_M = 0.25;
    const raycaster = new THREE.Raycaster();
    for (const run of YOGURT_RUNS) {
      for (const path of run.paths) {
        const vertices = path.vertices.map(([xM, yM, zM]) => new THREE.Vector3(xM, yM, zM));
        const lengthM = vertices.slice(1).reduce((sum, v, i) => sum + v.distanceTo(vertices[i]), 0);
        let walkedM = 0;
        for (let i = 1; i < vertices.length; i++) {
          const from = vertices[i - 1];
          const segmentM = from.distanceTo(vertices[i]);
          raycaster.set(from, vertices[i].clone().sub(from).normalize());
          raycaster.far = segmentM;
          for (const hit of raycaster.intersectObject(scene, true)) {
            const alongM = walkedM + hit.distance;
            if (alongM < PORT_M || alongM > lengthM - PORT_M) continue;
            let owner: THREE.Object3D | null = hit.object;
            while (owner && owner.userData.equipmentId === undefined) owner = owner.parent;
            expect.fail(`${run.id} meets ${String(owner?.userData.equipmentId)} at ${hit.point.toArray().map((n) => n.toFixed(2)).join(', ')}, ${alongM.toFixed(2)} m along its path`);
          }
          walkedM += segmentM;
        }
      }
    }
    for (const item of solids) scene.remove(item.object);
  });

  it('keeps the reefer yard north of the cold store, outside every zone', () => {
    const cold = ZONES.find((zone) => zone.id === 'coldChain')?.rect;
    expect(REEFER_YARD.rect.zMaxM).toBe(cold?.zMinM);
    expect(REEFER_YARD.rect.xMinM).toBe(cold?.xMinM);
    expect(REEFER_YARD.rect.xMaxM).toBe(cold?.xMaxM);
  });

  it('fills the tank gauges and writes the labels from the mock snapshot', () => {
    const sim = createMockSim(plantConfig);
    const snapshot: Snapshot = sim.snapshot();
    for (const item of machines) item.update(snapshot, 0.016);
    const fill = (id: string) => machines.find((item) => item.id === id)?.debugState?.().fillFrac;
    expect(fill('yogurt-silo')).toBeCloseTo(snapshot.yogurt.mix.tanks.silo.levelL / snapshot.yogurt.mix.tanks.silo.capacityL, 6);
    expect(fill('ferment-tank-3')).toBeCloseTo(snapshot.yogurt.ferment.tanks[2].levelL / snapshot.yogurt.ferment.tanks[2].capacityL, 6);
    expect(fill('p8-buffer')).toBeCloseTo(snapshot.yogurt.buffer.levelL / snapshot.yogurt.buffer.capacityL, 6);
    const label = (id: string) => machines.find((item) => item.id === id)?.labelText(snapshot);
    expect(label('ferment-tank-1')).toMatch(/^pH \d\.\d\d$/);
    expect(label('yogurt-divert-valve')).toBe('forward');
    expect(label('p8-filler')).toMatch(/cups\/h$/);
  });
});

// Phase 17: the live line moves the wing. The agitators turn while their tank stirs, the divert valve's flag points
// to the reprocess tank in a divert, and each fermentation tank's label carries a ring for its pH.
describe('the yogurt wing on the live line (phase 17)', () => {
  stubTheme();
  const machines = yogurtLine(makeContext());
  const byId = (id: string): Equipment => {
    const item = machines.find((candidate) => candidate.id === id);
    if (!item) expect.fail(`no ${id}`);
    return item;
  };
  /** Runs `seconds` of animation on the snapshot, one 60 Hz frame at a time. */
  const animate = (snapshot: Snapshot, seconds: number): void => {
    for (let frame = 0; frame < seconds * 60; frame++) for (const item of machines) item.update(snapshot, 1 / 60);
  };

  it('stirs a fermentation tank while it fills, and once ready while it empties; it stands still while the yogurt sets', () => {
    expect(['empty', 'filling', 'fermenting', 'ready', 'emptying', 'cleaning'].filter((state) => tankStirs({ state } as never))).toEqual(['filling', 'ready', 'emptying']);
    const sim = createSim(plantConfig);
    sim.step(0.1);
    const snapshot = sim.snapshot();
    expect(snapshot.yogurt.ferment.tanks.map((tank) => tank.state)).toEqual(['emptying', 'ready', 'fermenting']);
    animate(snapshot, 3);
    const state = (id: string) => byId(id).debugState?.() ?? {};
    expect(state('ferment-tank-1')).toMatchObject({ stirring: true });
    expect(state('ferment-tank-2')).toMatchObject({ stirring: true });
    expect(state('ferment-tank-3')).toMatchObject({ stirring: false, spinRadPerS: 0 });
    expect(Number(state('ferment-tank-1').spinRadPerS)).toBeGreaterThan(1);
    // The mix tank stirs while it holds mix; the fruit tank only while fruit is dosed (plain stirred has none).
    expect(state('yogurt-mix-tank').stirring).toBe(snapshot.yogurt.mix.tanks.mixTank.levelL > 0);
    expect(state('fruit-tank')).toMatchObject({ stirring: false, spinRadPerS: 0 });
  });

  it('stands every agitator still while the sim is paused', () => {
    const sim = createSim(plantConfig);
    sim.step(0.1);
    sim.dispatch({ type: 'pause', paused: true });
    const snapshot = sim.snapshot();
    const before = byId('ferment-tank-1').debugState?.().angleRad;
    animate(snapshot, 1);
    expect(byId('ferment-tank-1').debugState?.().angleRad).toBe(before);
  });

  it('flips the divert valve\'s flag to the reprocess tank and lights its lamp red in a divert, amber in the clean', () => {
    expect(heatValveLamp('production')).toBe('ok');
    expect(heatValveLamp('divert')).toBe('bad');
    expect(heatValveLamp('cleaning')).toBe('warn');
    expect(heatValveLamp('idle')).toBe('off');
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'yogurtHeatC', value: 84 });
    sim.dispatch({ type: 'setSpeed', speed: 100 });
    let snapshot = sim.snapshot();
    for (let frame = 0; frame < 2_000 && snapshot.yogurt.heat.mode !== 'divert'; frame++) {
      sim.step(0.1);
      snapshot = sim.snapshot();
    }
    expect(snapshot.yogurt.heat.mode).toBe('divert');
    const valve = byId('yogurt-divert-valve');
    animate(snapshot, 1);
    expect(valve.debugState?.()).toMatchObject({ diverting: true, lamp: 'bad' });
    expect(Number(valve.debugState?.().flagRad)).toBeCloseTo(Math.PI / 2, 3);
    expect(valve.labelText(snapshot)).toBe('diverting');
    snapshot = { ...snapshot, yogurt: { ...snapshot.yogurt, heat: { ...snapshot.yogurt.heat, mode: 'cleaning' } } };
    animate(snapshot, 1);
    expect(valve.debugState?.()).toMatchObject({ diverting: false, lamp: 'warn' });
    expect(Number(valve.debugState?.().flagRad)).toBeCloseTo(0, 3);
  });

  it('fills the pH ring from the start pH to the end pH, full once ready, hidden while a tank holds nothing', () => {
    const { startPh, endPh } = plantConfig.yogurt.ferment;
    expect(phRingFrac({ state: 'filling', ph: startPh })).toBe(0);
    expect(phRingFrac({ state: 'fermenting', ph: (startPh + endPh) / 2 })).toBeCloseTo(0.5, 9);
    expect(phRingFrac({ state: 'fermenting', ph: endPh - 0.1 })).toBe(1);
    expect(phRingFrac({ state: 'ready', ph: 4.5 })).toBe(1);
    expect(phRingFrac({ state: 'emptying', ph: 4.55 })).toBe(1);
    expect(phRingFrac({ state: 'empty', ph: startPh })).toBeNull();
    expect(phRingFrac({ state: 'cleaning', ph: startPh })).toBeNull();
    expect(phRingFrac(undefined)).toBeNull();
    const sim = createSim(plantConfig);
    sim.step(0.1);
    const snapshot = sim.snapshot();
    expect(byId('ferment-tank-3').labelRing?.(snapshot)).toBeCloseTo((startPh - snapshot.yogurt.ferment.tanks[2].ph) / (startPh - endPh), 9);
    // Only the fermentation tanks have a ring.
    expect(machines.filter((item) => item.labelRing).map((item) => item.id)).toEqual(['ferment-tank-1', 'ferment-tank-2', 'ferment-tank-3']);
  });
});
