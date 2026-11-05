import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Snapshot, Speed, TruckSnapshot } from '../../src/contracts';
import { AISLE_Z_M, FORKLIFT_MOTION, PALLET_AHEAD_M, PIVOT_BACK_M, STEER_MAX_RAD, STEER_RAD_PER_S, STEER_WHEELS_M, wheelSteerRad } from '../../src/scene/equipment/packs/forkliftJobs';
import * as at from '../../src/scene/equipment/packs/layout';
import { MAX_ARTICULATION_RAD, STOP_M, TURN_END_M, articulationRad, arrivalPose, arriveS, pullOutPose, type TruckPose } from '../../src/scene/equipment/packs/truckMoves';
import { DOOR_OPEN_RAD, STEER_M, TRAILER_DECK_M } from '../../src/scene/equipment/packs/vehicles';
import { forkliftWords, packsLine, rackLoadsShown } from '../../src/scene/equipment/packsLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

// Phase 12, stage 10 (D22): the forklifts' jobs and the trucks' docking, driven frame by frame from snapshots
// without WebGL. The grey boxes carry the models' node names, so the same checks hold for both.

const SHARED = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'] as const;
const STAGE_10 = ['racks', 'docks', 'forklift-1', 'forklift-2', 'truck'];
const LOAD_S = plantConfig.warehouse.truckLoadS;
const PER_TRUCK = plantConfig.warehouse.palletsPerTruck;

function makeContext(models: Record<string, () => THREE.Object3D> = {}): EquipmentContext {
  const materials = Object.fromEntries(SHARED.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>;
  const cache = new Map<string, THREE.Object3D>();
  return {
    materials,
    loadModel(path) {
      const make = models[path];
      if (!make) return Promise.reject(new Error(`no model ${path} in unit tests`));
      let model = cache.get(path);
      if (!model) {
        model = make();
        cache.set(path, model);
      }
      return Promise.resolve(model.clone(true));
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Stand-ins shaped like assets' models: the truck's 7 meshes, the forklift's 5, with their node names and origins. */
function stubTruck(nodes: readonly string[] = ['tractor', 'door_left', 'door_right']): THREE.Object3D {
  const scene = new THREE.Group();
  const mesh = (name: string, size: [number, number, number], atM: [number, number, number]): THREE.Mesh => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
    part.name = name;
    part.position.set(...atM);
    return part;
  };
  scene.add(mesh('body_matte', [2.55, 0.4, 13.6], [0, 1.0, -1.45]), mesh('body_paint', [2.55, 2.7, 13.6], [0, 2.65, -1.45]));
  if (nodes.includes('tractor')) {
    const tractor = new THREE.Group();
    tractor.name = 'tractor';
    tractor.position.set(0, 1.3, 3.7);
    tractor.add(mesh('tractor_matte', [2.4, 1.0, 5], [0, -0.8, 2]), mesh('tractor_paint', [2.4, 2.4, 2.2], [0, 0.9, 3.45]), mesh('tractor_glass', [2.0, 0.9, 0.05], [0, 1.4, 4.54]));
    scene.add(tractor);
  }
  for (const [name, x] of [['door_left', -1.275], ['door_right', 1.275]] as const) {
    if (!nodes.includes(name)) continue;
    const door = mesh(name, [1.27, 2.6, 0.04], [x, 1.3, -8.25]);
    door.geometry.translate(-Math.sign(x) * 0.635, 1.3, 0.02);
    scene.add(door);
  }
  // Without a tractor, its parts at the root keep the model at the truck's size.
  if (!nodes.includes('tractor')) scene.add(mesh('cab', [2.4, 3.0, 2.3], [0, 2.15, 7.1]));
  return scene;
}

function stubForklift(nodes: readonly string[] = ['mast', 'forks', 'mast_inner', 'beacon', 'steer_left', 'steer_right']): THREE.Object3D {
  const scene = new THREE.Group();
  const mesh = (name: string, size: [number, number, number], atM: [number, number, number]): THREE.Mesh => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
    part.name = name;
    part.position.set(...atM);
    return part;
  };
  scene.add(mesh('body_paint', [1.2, 0.9, 2.3], [0, 0.7, -0.6]), mesh('body_matte', [0.8, 2.2, 0.1], [0, 1.1, 0.63]));
  // Each node's geometry hangs from its origin, as in assets' model: the mast on its pivot (phase 14) with the inner
  // mast standing on its foot and the forks in it, each at its rest place taken from the pivot.
  const pivot: [number, number, number] = [0, 0.32, 0.61];
  const outer = nodes.includes('mast') ? mesh('mast', [0.76, 2.14, 0.1], pivot) : null;
  if (outer) {
    outer.geometry.translate(0, 0.81, 0);
    scene.add(outer);
  }
  const holder: THREE.Object3D = outer ?? scene;
  const from = outer ? pivot : [0, 0, 0];
  if (nodes.includes('mast_inner')) {
    const mast = mesh('mast_inner', [0.6, 2.1, 0.07], [0, 0.1 - from[1], 0.64 - from[2]]);
    mast.geometry.translate(0, 1.05, 0);
    holder.add(mast);
  }
  if (nodes.includes('forks')) {
    const forks = mesh('forks', [0.6, 0.05, 1.0], [0, 0.03 - from[1], 0.75 - from[2]]);
    forks.geometry.translate(0, 0.025, 0.5);
    holder.add(forks);
  }
  for (const [name, x] of [['steer_left', -0.45], ['steer_right', 0.45]] as const) {
    if (nodes.includes(name)) scene.add(mesh(name, [0.2, 0.48, 0.48], [x, 0.24, -1.3]));
  }
  if (nodes.includes('beacon')) {
    const beacon = mesh('beacon', [0.16, 0.05, 0.16], [0, 2.15, -0.95]);
    beacon.geometry.translate(0, 0.025, 0);
    scene.add(beacon);
  }
  scene.add(mesh('front', [0.2, 0.1, 0.1], [0, 0.05, 1.7]));
  return scene;
}

const byId = (machines: Equipment[], id: string): Equipment => {
  const machine = machines.find((m) => m.id === id);
  if (!machine) throw new Error(`no machine ${id}`);
  return machine;
};

function snapshotAt(stock: number, trucks: TruckSnapshot[] = [], speed: Speed = 1): Snapshot {
  const snapshot = createSim(plantConfig).snapshot();
  snapshot.kpis = { ...snapshot.kpis, palletsInStock: stock };
  if (!snapshot.packs) throw new Error('the sim has no packs model');
  snapshot.packs.warehouse.trucks = trucks;
  snapshot.speed = speed;
  snapshot.paused = false;
  return snapshot;
}

const loadingTruck = (id: number, door: number, remainingS: number): TruckSnapshot => ({ id, door, state: 'loading', arrivedS: 0, remainingS, pallets: PER_TRUCK });

/** Debug state of a fixture, as the ?debug hook reads it. */
const state = (machines: Equipment[], id: string): Readonly<Record<string, number | string | boolean>> => byId(machines, id).debugState?.() ?? {};

/** Updates stage 10's fixtures for `seconds` of real time, `frameS` at a time, calling `each` after every frame. */
function play(machines: Equipment[], snapshot: Snapshot | ((tS: number) => Snapshot), seconds: number, each?: (tS: number) => boolean | void, frameS = 1 / 20): void {
  const fixtures = STAGE_10.map((id) => byId(machines, id));
  for (let tS = 0; tS < seconds; tS += frameS) {
    const s = typeof snapshot === 'function' ? snapshot(tS) : snapshot;
    for (const fixture of fixtures) fixture.update(s, frameS);
    if (each?.(tS + frameS) === true) return;
  }
}

/** A forklift's moving nodes, grey or model: lift = forks above rest. */
function forkliftNodes(machine: Equipment): { forks: THREE.Object3D; mast: THREE.Object3D } {
  const forks = machine.object.getObjectByName('forks');
  const mast = machine.object.getObjectByName('mast_inner');
  if (!forks || !mast) throw new Error(`${machine.id} lacks its forks or inner mast`);
  return { forks, mast };
}

interface Trace {
  jobs: string[];
  /** Jobs in which it carried a pallet, and the most it lifted. */
  carryingIn: Set<string>;
  maxLiftM: number;
  /** The fastest it moved along the floor in a frame in which its forks moved. */
  fastestLiftMps: number;
  grabs: number;
  releases: number;
}

function tracer(machines: Equipment[], id: string, frameS = 1 / 20): { trace: Trace; observe: () => void } {
  const trace: Trace = { jobs: [], carryingIn: new Set(), maxLiftM: 0, fastestLiftMps: 0, grabs: 0, releases: 0 };
  let last: Readonly<Record<string, number | string | boolean>> | null = null;
  return {
    trace,
    observe() {
      const now = state(machines, id);
      const job = String(now.job);
      if (trace.jobs.at(-1) !== job) trace.jobs.push(job);
      if (now.carrying === true) trace.carryingIn.add(job);
      trace.maxLiftM = Math.max(trace.maxLiftM, Number(now.liftM));
      if (last) {
        if (now.carrying === true && last.carrying !== true) trace.grabs += 1;
        if (now.carrying !== true && last.carrying === true) trace.releases += 1;
        if (Math.abs(Number(now.liftM) - Number(last.liftM)) > 1e-9) {
          const movedM = Math.hypot(Number(now.xM) - Number(last.xM), Number(now.zM) - Number(last.zM));
          // Turning on the spot swings the footprint centre round the middle of the body: that is not driving.
          trace.fastestLiftMps = Math.max(trace.fastestLiftMps, movedM / frameS);
        }
      }
      last = now;
    },
  };
}

describe('forklifts (stage 10)', () => {
  it('forklift-1 puts pallets away into the racks when stock rises, carrying one only between pick and drop', () => {
    const machines = packsLine(makeContext());
    const f1 = byId(machines, 'forklift-1');
    play(machines, snapshotAt(634), 1);
    expect(state(machines, 'forklift-1')).toMatchObject({ job: 'parked', carrying: false, beacon: false, liftM: 0 });
    const parkedAt = { xM: state(machines, 'forklift-1').xM, zM: state(machines, 'forklift-1').zM };

    // A batch is released: the racks show 140 places, so the next free one is 140, on the first beam level.
    const placesBefore = rackLoadsShown(634, at.rackSlots().length);
    const risen = snapshotAt(700);
    const target = rackLoadsShown(700, at.rackSlots().length);
    expect(target).toBeGreaterThan(placesBefore);
    const slot = at.rackSlots()[target] as at.RackSlotM;
    expect(slot.yM).toBeGreaterThan(1.5);
    const { trace, observe } = tracer(machines, 'forklift-1');
    const pallets = f1.object.getObjectByName('forklift-loads') as THREE.InstancedMesh;
    // Parked with no pallet anywhere, the forklifts' pallets draw nothing.
    expect(pallets.visible).toBe(false);
    let setDownSeen = false;
    let carriedWhileShown = true;
    play(machines, risen, 600, () => {
      observe();
      const now = state(machines, 'forklift-1');
      // The pallet on the forks shows exactly while the forklift carries one.
      const matrix = new THREE.Matrix4();
      pallets.getMatrixAt(0, matrix);
      const shown = new THREE.Vector3().setFromMatrixScale(matrix).x > 0;
      if (shown !== (now.carrying === true)) carriedWhileShown = false;
      // Set down, the pallet stands in the place it was taken to.
      pallets.getMatrixAt(2, matrix);
      const placed = new THREE.Vector3().setFromMatrixPosition(matrix);
      if (new THREE.Vector3().setFromMatrixScale(matrix).x > 0 && Math.hypot(placed.x - slot.xM, placed.z - slot.zM) < 1e-3) setDownSeen = true;
      return trace.jobs.length > 3 && now.job === 'parked';
    });
    // It sets off at once: to the quarantine's edge, back with the pallet to the racks, and on.
    expect(trace.jobs.slice(0, 4)).toEqual(['pick', 'toDrop', 'drop', expect.stringMatching(/toPick|home/)]);
    expect(trace.jobs.at(-1)).toBe('parked');
    // Three trips queue at most; each picks once and sets down once.
    expect(trace.grabs).toBe(3);
    expect(trace.releases).toBe(3);
    expect([...trace.carryingIn].sort()).toEqual(['drop', 'pick', 'toDrop']);
    expect(carriedWhileShown).toBe(true);
    expect(setDownSeen).toBe(true);
    // It lifted the pallet to the place's level, and only while standing (or creeping in, at most 0.6 m/s).
    expect(trace.maxLiftM).toBeGreaterThanOrEqual(slot.yM);
    expect(trace.maxLiftM).toBeLessThanOrEqual(FORKLIFT_MOTION.maxLiftM);
    expect(trace.fastestLiftMps).toBeLessThanOrEqual(FORKLIFT_MOTION.slowMps);
    // Parked again at its spot, beacon dark, forks down.
    expect(state(machines, 'forklift-1')).toMatchObject({ job: 'parked', carrying: false, beacon: false, liftM: 0 });
    expect(Number(state(machines, 'forklift-1').xM)).toBeCloseTo(Number(parkedAt.xM), 6);
    expect(Number(state(machines, 'forklift-1').zM)).toBeCloseTo(Number(parkedAt.zM), 6);
  });

  it('forklift-2 takes pallets from the racks to a loading truck, lifting them to the trailer deck', () => {
    const machines = packsLine(makeContext());
    const stock = 634 - PER_TRUCK;
    let remainingS = LOAD_S;
    const snapshot = (): Snapshot => snapshotAt(stock, [loadingTruck(7, 0, remainingS)]);
    const { trace, observe } = tracer(machines, 'forklift-2');
    const f1 = byId(machines, 'forklift-1');
    const pallets = f1.object.getObjectByName('forklift-loads') as THREE.InstancedMesh;
    let onTrailer: THREE.Vector3 | null = null;
    let docked = false;
    play(
      machines,
      snapshot,
      400,
      (tS) => {
        remainingS = Math.max(1, LOAD_S - tS);
        observe();
        // Forklift-2 sets off only once the truck is docked with its roller door up.
        if (state(machines, 'docks').doorsUp === 1) docked = true;
        if (!docked) expect(state(machines, 'forklift-2').job).toBe('parked');
        const matrix = new THREE.Matrix4();
        pallets.getMatrixAt(3, matrix);
        if (new THREE.Vector3().setFromMatrixScale(matrix).x > 0) onTrailer = new THREE.Vector3().setFromMatrixPosition(matrix);
        return trace.releases >= 2;
      },
    );
    expect(trace.jobs.slice(0, 5)).toEqual(['parked', 'toPick', 'pick', 'toDrop', 'drop']);
    expect(trace.jobs.slice(5, 7)).toEqual(['toPick', 'pick']);
    expect(trace.grabs).toBeGreaterThanOrEqual(2);
    expect([...trace.carryingIn].sort()).toEqual(['drop', 'pick', 'toDrop']);
    expect(trace.maxLiftM).toBeGreaterThanOrEqual(TRAILER_DECK_M);
    expect(trace.fastestLiftMps).toBeLessThanOrEqual(FORKLIFT_MOTION.slowMps);
    // The pallet it set down stands on the trailer's tail, at door 1, on the deck.
    expect(onTrailer).not.toBeNull();
    const placed = onTrailer as unknown as THREE.Vector3;
    expect(placed.x).toBeCloseTo(at.DOOR_X_M[0], 3);
    expect(placed.z - at.RACK_PALLET.depthM / 2).toBeGreaterThan(at.DOCKED_TAIL_Z_M);
    // (the load's centre: the deck, the pallet and half the load above it)
    expect(placed.y).toBeCloseTo(TRAILER_DECK_M + at.RACK_PALLET.heightM + at.RACK_PALLET.loadHeightM / 2, 3);

    // The truck leaves: forklift-2 goes home and parks.
    remainingS = 0;
    const gone = snapshotAt(stock, []);
    play(machines, gone, 300, () => state(machines, 'forklift-2').job === 'parked');
    expect(state(machines, 'forklift-2')).toMatchObject({ job: 'parked', carrying: false, beacon: false });
  });

  it('lifts the inner mast by half the forks’ lift, grey or model, and flashes the beacon only while working', async () => {
    const cases: Record<string, () => THREE.Object3D>[] = [{}, { 'vehicles/forklift.glb': () => stubForklift() }];
    for (const models of cases) {
      const machines = packsLine(makeContext(models));
      await settle();
      const f1 = byId(machines, 'forklift-1');
      const modelIn = state(machines, 'forklift-1').model;
      expect(modelIn).toBe(Object.keys(models).length > 0);
      const { forks, mast } = forkliftNodes(f1);
      // Along the mast, which tilts since phase 14: each node's height in the mast's frame, in metres.
      const tilting = f1.object.getObjectByName('mast') as THREE.Object3D;
      const worldY = (node: THREE.Object3D): number => tilting.worldToLocal(node.getWorldPosition(new THREE.Vector3())).y * tilting.getWorldScale(new THREE.Vector3()).y;
      const rest = { forks: worldY(forks), mast: worldY(mast) };
      play(machines, snapshotAt(634), 0.5);
      let checked = 0;
      let lit = 0;
      let dark = 0;
      play(machines, snapshotAt(700), 200, () => {
        const now = state(machines, 'forklift-1');
        const liftM = Number(now.liftM);
        f1.object.updateMatrixWorld(true);
        expect(worldY(forks) - rest.forks).toBeCloseTo(liftM, 6);
        expect(worldY(mast) - rest.mast).toBeCloseTo(liftM / 2, 6);
        if (liftM > 1) checked += 1;
        if (now.job !== 'parked') {
          if (now.beacon === true) lit += 1;
          else dark += 1;
        }
        // The beacon's own material shows only while it is lit.
        const beacon = f1.object.getObjectByName('beacon');
        let litMaterial = false;
        beacon?.traverse((child) => {
          if (child instanceof THREE.Mesh && (child.material as THREE.Material).name === 'forklift-beacon-lit') litMaterial = true;
        });
        expect(litMaterial).toBe(now.beacon === true);
        return checked > 20;
      });
      expect(checked).toBeGreaterThan(20);
      // About 1.5 Hz: lit half the time while it works.
      expect(lit).toBeGreaterThan(0);
      expect(dark).toBeGreaterThan(0);
    }
  });

  it('keeps the grey forklift when its model lacks a node', async () => {
    const machines = packsLine(makeContext({ 'vehicles/forklift.glb': () => stubForklift(['forks', 'mast_inner']), 'vehicles/truck.glb': () => stubTruck(['door_left', 'door_right']) }));
    await settle();
    for (const id of ['forklift-1', 'forklift-2']) expect(byId(machines, id).object.getObjectByName('grey-box'), id).toBeDefined();
    for (const name of ['truck-1', 'truck-2', 'truck-3']) expect(byId(machines, 'truck').object.getObjectByName(name)?.getObjectByName('grey-box'), name).toBeDefined();
  });

  it('stands still while paused', () => {
    const machines = packsLine(makeContext());
    play(machines, snapshotAt(634, [loadingTruck(3, 0, LOAD_S)]), 1);
    play(machines, snapshotAt(700, [loadingTruck(3, 0, LOAD_S - 40)]), 40);
    const before = STAGE_10.map((id) => JSON.stringify(state(machines, id)));
    const truck = byId(machines, 'truck').object.getObjectByName('truck-1') as THREE.Object3D;
    const truckAt = truck.position.clone();
    const paused = { ...snapshotAt(700, [loadingTruck(3, 0, LOAD_S - 40)]), paused: true };
    play(machines, paused, 5);
    expect(STAGE_10.map((id) => JSON.stringify(state(machines, id)))).toEqual(before);
    expect(truck.position.equals(truckAt)).toBe(true);
  });
});

describe('trucks and docks (stage 10)', () => {
  it('drives in past its door, opens up, backs in articulated within 0.6 rad, loads from the front and leaves', async () => {
    const cases: Record<string, () => THREE.Object3D>[] = [{}, { 'vehicles/truck.glb': () => stubTruck() }];
    for (const models of cases) {
      const machines = packsLine(makeContext(models));
      await settle();
      const trucks = byId(machines, 'truck');
      const vehicle = trucks.object.getObjectByName('truck-2') as THREE.Object3D;
      expect(vehicle.getObjectByName('grey-box') === undefined).toBe(Object.keys(models).length > 0);
      const tractor = vehicle.getObjectByName('tractor') as THREE.Object3D;
      const doorLeft = vehicle.getObjectByName('door_left') as THREE.Object3D;
      const doorRight = vehicle.getObjectByName('door_right') as THREE.Object3D;
      let remainingS = LOAD_S;
      let present = true;
      const snapshot = (): Snapshot => snapshotAt(612, present ? [loadingTruck(11, 1, remainingS)] : []);
      const phases: string[] = [];
      let maxTurn = 0;
      let passedDoor = false;
      const loads: [number, number][] = [];
      play(machines, snapshot, 2000, (tS) => {
        // The count the trailer shows is the one of the snapshot this frame was given.
        const givenS = remainingS;
        remainingS = Math.max(0, LOAD_S - tS);
        if (remainingS === 0) present = false;
        const now = state(machines, 'truck');
        const phase = String(now.phases).split(',')[1] as string;
        if (phases.at(-1) !== phase) phases.push(phase);
        maxTurn = Math.max(maxTurn, Math.abs(tractor.rotation.y));
        if (phase === 'arriving' && vehicle.position.x > at.DOOR_X_M[1] + 5) passedDoor = true;
        if (phase === 'docked') {
          expect(doorLeft.rotation.y).toBeCloseTo(DOOR_OPEN_RAD.door_left, 6);
          expect(doorRight.rotation.y).toBeCloseTo(DOOR_OPEN_RAD.door_right, 6);
          expect(now.doorsOpen).toBe(1);
          expect(vehicle.position.z).toBeCloseTo(at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM / 2, 6);
          if (Math.round(tS) % 100 === 0) loads.push([givenS, Number(String(now.loaded).split(',')[1])]);
        }
        return phases.length > 1 && phase === 'away';
      }, 1 / 8);
      expect(phases).toEqual(['arriving', 'opening', 'reversing', 'docked', 'closing', 'leaving', 'away']);
      expect(passedDoor).toBe(true);
      expect(maxTurn).toBeGreaterThan(0.3);
      expect(maxTurn).toBeLessThanOrEqual(MAX_ARTICULATION_RAD);
      // The trailer shows the sim's own count, 22 pallets over truckLoadS.
      expect(loads.length).toBeGreaterThan(3);
      for (const [left, shown] of loads) expect(shown).toBe(Math.round(PER_TRUCK * (1 - left / LOAD_S)));
      // Doors shut, the truck gone.
      expect(doorLeft.rotation.y).toBeCloseTo(0, 6);
      expect(vehicle.visible).toBe(false);
    }
  }, 30_000);

  it('fills the trailer from the front, two by two, as one instanced draw, and hides it once the doors are shut', () => {
    const machines = packsLine(makeContext());
    const trucks = byId(machines, 'truck');
    const bases = trucks.object.getObjectByName('trailer-pallets') as THREE.InstancedMesh;
    let remainingS = LOAD_S;
    play(machines, () => snapshotAt(612, [loadingTruck(4, 2, remainingS)]), 120, () => state(machines, 'truck').phases === 'away,away,docked');
    remainingS = LOAD_S * (1 - 5 / PER_TRUCK);
    play(machines, () => snapshotAt(612, [loadingTruck(4, 2, remainingS)]), 0.1);
    expect(state(machines, 'truck').loaded).toBe('-,-,5');
    expect(bases.count).toBe(5);
    const z = (i: number): number => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(bases.instanceMatrix.array, i * 16)).z;
    const x = (i: number): number => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(bases.instanceMatrix.array, i * 16)).x;
    // The first two stand side by side at the front (toward the cab, +z), the next row behind them.
    expect(z(0)).toBeCloseTo(z(1), 6);
    expect(x(0)).toBeLessThan(at.DOOR_X_M[2]);
    expect(x(1)).toBeGreaterThan(at.DOOR_X_M[2]);
    expect(z(2)).toBeLessThan(z(0));
    expect(z(4)).toBeLessThan(z(2));
    // The sim sends it away: it closes (full), and once its doors are shut the load is no longer drawn.
    let closingFull = false;
    play(machines, () => snapshotAt(612, []), 60, () => {
      const now = state(machines, 'truck');
      if (String(now.phases).endsWith('closing') && bases.count === PER_TRUCK) closingFull = true;
      return String(now.phases).endsWith('leaving');
    });
    expect(closingFull).toBe(true);
    expect(bases.visible).toBe(false);
    expect(state(machines, 'truck').loaded).toBe(`-,-,${PER_TRUCK}`);
  });

  it('fits its moves into the sim’s time at ×1,000: it has closed up by the time the sim sends it away', () => {
    for (const speed of [1_000, 10_000] as const) {
      const machines = packsLine(makeContext());
      let simS = 0;
      let removedPhase: string | null = null;
      let dockedAfterRemoval = false;
      const frameS = 1 / 60;
      play(
        machines,
        (tS) => {
          simS = tS * speed;
          return snapshotAt(612, simS < LOAD_S ? [loadingTruck(21, 0, LOAD_S - simS)] : []);
        },
        20,
        () => {
          const phase = String(state(machines, 'truck').phases).split(',')[0] as string;
          if (simS >= LOAD_S) {
            removedPhase ??= phase;
            if (phase === 'docked') dockedAfterRemoval = true;
          }
          return removedPhase !== null && phase === 'away';
        },
        frameS,
      );
      expect(removedPhase, `×${speed}`).not.toBeNull();
      expect(['closing', 'leaving', 'away'], `×${speed}`).toContain(removedPhase);
      expect(dockedAfterRemoval, `×${speed}`).toBe(false);
    }
  });

  it('opens up again when the sim slows down while the truck closes up, and loads on', () => {
    const machines = packsLine(makeContext());
    let simS = 0;
    let speed: Speed = 1_000;
    play(
      machines,
      () => {
        simS += speed / 20;
        return snapshotAt(612, [loadingTruck(31, 0, LOAD_S - simS)], speed);
      },
      5,
      () => {
        if (String(state(machines, 'truck').phases).startsWith('closing')) speed = 1;
        return speed === 1;
      },
    );
    expect(String(state(machines, 'truck').phases)).toMatch(/^closing/);
    play(machines, () => snapshotAt(612, [loadingTruck(31, 0, LOAD_S - simS)], 1), 10);
    expect(state(machines, 'truck')).toMatchObject({ phases: 'docked,away,away', doorsOpen: 1 });
  });

  it('plays every move in full at ×1 and ×10', () => {
    for (const speed of [1, 10] as const) {
      const machines = packsLine(makeContext());
      let maxRate = 0;
      play(machines, (tS) => snapshotAt(612, [loadingTruck(5, 1, LOAD_S - tS * speed)]), 40, () => {
        maxRate = Math.max(maxRate, Number(state(machines, 'truck').playRate ?? 1));
        return state(machines, 'truck').phases === 'away,docked,away';
      });
      expect(state(machines, 'truck').phases, `×${speed}`).toBe('away,docked,away');
      expect(maxRate, `×${speed}`).toBe(1);
    }
  });

  it('raises the roller door and lights the lamp red while a truck is docked, down and green otherwise', () => {
    const machines = packsLine(makeContext());
    const docks = byId(machines, 'docks');
    const rollers = docks.object.getObjectByName('roller-doors') as THREE.InstancedMesh;
    const lamps = docks.object.getObjectByName('dock-lamps') as THREE.InstancedMesh;
    const height = (door: number): number => new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().fromArray(rollers.instanceMatrix.array, door * 16)).y;
    const lampColor = (door: number): number => {
      const color = new THREE.Color();
      lamps.getColorAt(door, color);
      return color.getHex();
    };
    play(machines, snapshotAt(612), 0.2);
    expect(state(machines, 'docks')).toEqual({ doorsUp: 0, lamps: 'green,green,green' });
    const green = lampColor(0);
    let present = true;
    const snapshot = (): Snapshot => snapshotAt(612, present ? [loadingTruck(8, 0, LOAD_S)] : []);
    // While the truck drives in the door stays down.
    play(machines, snapshot, 5);
    expect(state(machines, 'truck').phases).toBe('arriving,away,away');
    expect(state(machines, 'docks')).toEqual({ doorsUp: 0, lamps: 'green,green,green' });
    expect(height(0)).toBeCloseTo(3.4, 6);
    play(machines, snapshot, 60, () => state(machines, 'docks').doorsUp === 1);
    expect(state(machines, 'docks')).toEqual({ doorsUp: 1, lamps: 'red,green,green' });
    expect(height(0)).toBeLessThan(0.01);
    expect(lampColor(0)).not.toBe(green);
    expect(lampColor(1)).toBe(green);
    present = false;
    play(machines, snapshot, 20, () => String(state(machines, 'truck').phases).startsWith('leaving'));
    expect(state(machines, 'docks')).toEqual({ doorsUp: 0, lamps: 'green,green,green' });
    expect(height(0)).toBeCloseTo(3.4, 6);
  });

  it('draws no truck while none is shown: the docked trucks, the yard and the trailers’ loads are all hidden', () => {
    const machines = packsLine(makeContext());
    play(machines, snapshotAt(612), 0.5);
    const drawn: string[] = [];
    byId(machines, 'truck').object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (let node: THREE.Object3D | null = child; node; node = node.parent) if (!node.visible) return;
      drawn.push(child.name);
    });
    expect(drawn).toEqual([]);
  });

  it('waits docked with its doors open and its trailer empty while there is no stock', () => {
    const machines = packsLine(makeContext());
    const waiting: TruckSnapshot = { id: 2, door: 0, state: 'waiting', arrivedS: 0, remainingS: 0, pallets: 0 };
    play(machines, snapshotAt(3, [waiting]), 120);
    expect(state(machines, 'truck')).toMatchObject({ phases: 'docked,away,away', docked: 1, doorsOpen: 1, loaded: '0,-,-' });
    expect(state(machines, 'forklift-2').job).toBe('parked');
  });

  it('keeps its trucks on their path: articulation under 0.6 rad all the way, and the arrival ends where the reverse starts', () => {
    for (let s = 0; s < TURN_END_M + 5; s += 0.05) expect(Math.abs(articulationRad(s))).toBeLessThanOrEqual(MAX_ARTICULATION_RAD);
    for (const doorXM of at.DOOR_X_M) {
      const end = arrivalPose(doorXM, arriveS(doorXM), {} as TruckPose);
      const start = pullOutPose(doorXM, STOP_M, {} as TruckPose);
      expect(end.xM).toBeCloseTo(start.xM, 6);
      expect(end.zM).toBeCloseTo(start.zM, 6);
      expect(end.headingRad).toBeCloseTo(start.headingRad, 6);
      // Docked: tail at the bumpers, facing out.
      const docked = pullOutPose(doorXM, 0, {} as TruckPose);
      expect(docked).toEqual({ xM: doorXM, zM: at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM / 2, headingRad: 0, tractorRad: 0 });
      // It drives in from beyond the floor's west edge, past its door.
      expect(arrivalPose(doorXM, 0, {} as TruckPose).xM).toBeLessThan(-75);
      expect(end.xM).toBeGreaterThan(doorXM);
    }
  });
});

/** A forklift's body on the floor (counterweight to mast, 2.43 × 1.15 m), from its debug state, as four corners. */
function bodyCorners(now: Readonly<Record<string, number | string | boolean>>): [number, number][] {
  const heading = Number(now.headingRad);
  const [hx, hz] = [Math.sin(heading), Math.cos(heading)];
  const [sx, sz] = [hz, -hx];
  const cx = Number(now.xM) - 0.535 * hx;
  const cz = Number(now.zM) - 0.535 * hz;
  return [[-1.215, -0.575], [-1.215, 0.575], [1.215, 0.575], [1.215, -0.575]].map(([along, side]) => [cx + hx * (along as number) + sx * (side as number), cz + hz * (along as number) + sz * (side as number)]);
}

/** How deep two convex polygons overlap (0 if they don't): the least overlap along their edges' normals. */
function overlapM(a: [number, number][], b: [number, number][]): number {
  let least = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i] as [number, number];
      const [x2, z2] = poly[(i + 1) % poly.length] as [number, number];
      const length = Math.hypot(x2 - x1, z2 - z1);
      const [nx, nz] = [(z2 - z1) / length, -(x2 - x1) / length];
      const project = (p: [number, number][]): [number, number] => {
        const d = p.map(([x, z]) => x * nx + z * nz);
        return [Math.min(...d), Math.max(...d)];
      };
      const [aMin, aMax] = project(a);
      const [bMin, bMax] = project(b);
      least = Math.min(least, Math.min(aMax, bMax) - Math.max(aMin, bMin));
      if (least <= 0) return 0;
    }
  }
  return least;
}

describe('forklift routes', () => {
  it('never cross each other, and drive past the racks, not through them, while both work at once', () => {
    const machines = packsLine(makeContext());
    const rows = at.RACK_Z_M.map((zM): [number, number][] => {
      const [x0, x1] = [at.RACK_X0_M, at.RACK_X0_M + at.RACK_BAYS * at.RACK_BAY_M];
      const [z0, z1] = [zM - at.RACK_PALLET.depthM / 2, zM + at.RACK_PALLET.depthM / 2];
      return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    });
    let deepestRackM = 0;
    let closest = Infinity;
    let busyTogether = 0;
    const trips = { f1: new Set<string>(), f2: new Set<string>() };
    // Batches keep coming while trucks load one after the other at the first door.
    play(
      machines,
      (tS) => {
        const stock = 600 + 60 * Math.floor(tS / 150);
        const truckNo = Math.floor(tS / 400);
        return snapshotAt(stock, [loadingTruck(100 + truckNo, 0, LOAD_S - (tS % 400))]);
      },
      1600,
      () => {
        const f1 = state(machines, 'forklift-1');
        const f2 = state(machines, 'forklift-2');
        const a = bodyCorners(f1);
        const b = bodyCorners(f2);
        for (const row of rows) deepestRackM = Math.max(deepestRackM, overlapM(a, row), overlapM(b, row));
        closest = Math.min(closest, overlapM(a, b) > 0 ? -overlapM(a, b) : Math.min(...a.flatMap(([x, z]) => b.map(([u, v]) => Math.hypot(x - u, z - v)))));
        if (f1.job !== 'parked' && f2.job !== 'parked') busyTogether += 1;
        trips.f1.add(String(f1.job));
        trips.f2.add(String(f2.job));
      },
      1 / 10,
    );
    expect(busyTogether).toBeGreaterThan(100);
    expect([...trips.f1]).toEqual(expect.arrayContaining(['pick', 'toDrop', 'drop', 'toPick']));
    expect([...trips.f2]).toEqual(expect.arrayContaining(['toPick', 'pick', 'toDrop', 'drop']));
    // Clipping a pallet's edge by a few centimetres in a tight turn is accepted; driving through a rack is not.
    expect(deepestRackM).toBeLessThan(0.06);
    expect(closest).toBeGreaterThan(0);
  }, 30_000);
});

describe('forklift aisles', () => {
  it('turns between the racks without reaching into them: each aisle is wide enough for the body to turn on the spot', () => {
    // The body (counterweight to mast) is 2.43 m long and 1.15 m wide; it turns about its middle.
    const turnRadiusM = Math.hypot(2.43 / 2, 1.15 / 2);
    const faces = at.RACK_Z_M.flatMap((zM) => [zM - at.RACK_PALLET.depthM / 2, zM + at.RACK_PALLET.depthM / 2]);
    for (const aisleZ of AISLE_Z_M) {
      const nearest = Math.min(...faces.map((face) => Math.abs(face - aisleZ)));
      // Clipping a pallet's edge by a few centimetres in a turn is accepted (phase-12 card).
      expect(turnRadiusM - nearest, `aisle at z ${aisleZ}`).toBeLessThan(0.05);
    }
    // The turn on the spot leaves the pallet within a few centimetres of its place's centre.
    for (const zM of at.RACK_Z_M) {
      const reach = Math.min(...AISLE_Z_M.map((aisleZ) => Math.abs(Math.abs(zM - aisleZ) - PALLET_AHEAD_M)));
      expect(reach).toBeLessThan(0.1);
    }
  });
});

// Phase 14 (D24): the forklifts as a 2 t electric counterbalance truck after the Linde E20's VDI 2198 sheet. The mast
// tilts back 8° for the trip with a pallet and stands level to pick up, lift and set down; the forks lift at the
// sheet's speeds; the rear wheels steer along the rear axle's motion; a blue spot leads it on the floor; the pallet
// on the forks tilts with the mast; the label says what it does.
describe('forklift details (phase 14)', () => {
  const DEG = Math.PI / 180;

  /** Every frame of a put-away of the opening's first release: forklift-1's state and its pallet's and spot's matrices. */
  function putAway(): { frames: Record<string, number | string | boolean>[]; palletUp: number[]; spotAt: (THREE.Vector3 | null)[] } {
    const machines = packsLine(makeContext());
    const f1 = byId(machines, 'forklift-1');
    const bases = f1.object.getObjectByName('forklift-pallets') as THREE.InstancedMesh;
    const spots = f1.object.getObjectByName('forklift-blue-spots') as THREE.InstancedMesh;
    const frames: Record<string, number | string | boolean>[] = [];
    const palletUp: number[] = [];
    const spotAt: (THREE.Vector3 | null)[] = [];
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const where = new THREE.Vector3();
    play(machines, snapshotAt(634), 0.5);
    play(machines, snapshotAt(700), 220, () => {
      frames.push({ ...state(machines, 'forklift-1') });
      bases.getMatrixAt(0, matrix);
      matrix.decompose(where, q, scale);
      palletUp.push(new THREE.Vector3(0, 1, 0).applyQuaternion(q).angleTo(new THREE.Vector3(0, 1, 0)));
      spots.getMatrixAt(0, matrix);
      // decompose() reads a zero-scale matrix as scale 1, so the scale comes from its columns.
      spotAt.push(new THREE.Vector3().setFromMatrixScale(matrix).x > 0 ? new THREE.Vector3().setFromMatrixPosition(matrix) : null);
      return frames.length > 10 && frames.at(-1)?.job === 'parked' && frames.some((f) => f.job === 'drop');
    });
    return { frames, palletUp, spotAt };
  }
  const run = putAway();

  it('tilts the mast back 8° for the trip with a pallet, never past the sheet’s 8°, at 4° a second', () => {
    const tilts = run.frames.map((f) => Number(f.tiltRad));
    for (const t of tilts) expect(t).toBeGreaterThanOrEqual(-8 * DEG - 1e-9);
    for (const t of tilts) expect(t).toBeLessThanOrEqual(1e-9);
    const back = run.frames.filter((f) => f.carrying === true && f.job === 'toDrop' && Number(f.tiltRad) <= -8 * DEG + 1e-6);
    expect(back.length, 'tilted fully back on the trip').toBeGreaterThan(10);
    // 4° a second at ×1 (the frames are 1/20 s of motion).
    for (let i = 1; i < tilts.length; i++) expect(Math.abs((tilts[i] as number) - (tilts[i - 1] as number))).toBeLessThanOrEqual(4 * DEG * (1 / 20) + 1e-9);
  });

  it('stands the mast level to pick up, to lift high at the rack, and to set down', () => {
    for (const f of run.frames) {
      if (f.job === 'pick' && f.carrying === false) expect(f.tiltRad, 'picking up').toBe(0);
      if (Number(f.liftM) > 1.4) expect(f.tiltRad, `lifted to ${Number(f.liftM).toFixed(2)} m`).toBe(0);
    }
    expect(run.frames.some((f) => Number(f.liftM) > 1.4) || run.frames.some((f) => f.job === 'drop')).toBe(true);
  });

  it('lifts the pallet at 0.56 m/s and lowers the forks at 0.57 m/s, the Linde E20’s figures', () => {
    let upLaden = 0;
    let down = 0;
    for (let i = 1; i < run.frames.length; i++) {
      const rate = (Number(run.frames[i]?.liftM) - Number(run.frames[i - 1]?.liftM)) * 20;
      if (rate > 0 && run.frames[i]?.carrying === true) upLaden = Math.max(upLaden, rate);
      if (rate < 0) down = Math.max(down, -rate);
    }
    expect(FORKLIFT_MOTION).toMatchObject({ liftLadenMps: 0.56, liftEmptyMps: 0.64, lowerMps: 0.57 });
    expect(upLaden).toBeLessThanOrEqual(0.56 + 1e-9);
    expect(upLaden).toBeGreaterThan(0.5);
    expect(down).toBeLessThanOrEqual(0.57 + 1e-9);
    expect(down).toBeGreaterThan(0.5);
  });

  /** The turning point (the middle of the body) of a frame, and how far it turned and moved since another. */
  const turningPoint = (f: Record<string, number | string | boolean>): [number, number] => [
    Number(f.xM) - Math.sin(Number(f.headingRad)) * PIVOT_BACK_M,
    Number(f.zM) - Math.cos(Number(f.headingRad)) * PIVOT_BACK_M,
  ];
  const turned = (a: Record<string, number | string | boolean>, b: Record<string, number | string | boolean>): number =>
    Math.abs(Math.atan2(Math.sin(Number(b.headingRad) - Number(a.headingRad)), Math.cos(Number(b.headingRad) - Number(a.headingRad))));
  const moved = (a: Record<string, number | string | boolean>, b: Record<string, number | string | boolean>): number => {
    const [ax, az] = turningPoint(a);
    const [bx, bz] = turningPoint(b);
    return Math.hypot(bx - ax, bz - az);
  };

  it('turns on the spot only with each rear wheel square to the middle of the body, splayed at 59.5°', () => {
    const pivotL = wheelSteerRad(...STEER_WHEELS_M.left, 0, -PIVOT_BACK_M);
    const pivotR = wheelSteerRad(...STEER_WHEELS_M.right, 0, -PIVOT_BACK_M);
    expect(pivotL).toBeCloseTo(-Math.atan2(1.3 - PIVOT_BACK_M, 0.45), 9);
    expect(pivotR).toBeCloseTo(-pivotL, 9);
    let pivoting = 0;
    for (let i = 1; i + 1 < run.frames.length; i++) {
      const [before, now, after] = [run.frames[i - 1], run.frames[i], run.frames[i + 1]] as Record<string, number | string | boolean>[];
      // Mid-turn on the spot: the heading turns into and out of this frame, the turning point stays.
      if (!(turned(before, now) > 1e-6 && turned(now, after) > 1e-6 && moved(before, now) < 1e-9 && moved(now, after) < 1e-9)) continue;
      pivoting += 1;
      expect(now.steerLeftRad, `frame ${i}`).toBeCloseTo(pivotL, 9);
      expect(now.steerRightRad, `frame ${i}`).toBeCloseTo(pivotR, 9);
    }
    expect(pivoting, 'frames turning on the spot').toBeGreaterThan(20);
  });

  it('sets off from a stand only with its wheels already where the move needs them: straight to drive straight', () => {
    let setOff = 0;
    for (let i = 2; i < run.frames.length; i++) {
      const [stood, before, now] = [run.frames[i - 2], run.frames[i - 1], run.frames[i]] as Record<string, number | string | boolean>[];
      if (!(moved(stood, before) < 1e-9 && turned(stood, before) < 1e-9 && moved(before, now) > 1e-6 && turned(before, now) < 1e-9)) continue;
      setOff += 1;
      expect(now.steerLeftRad, `frame ${i}`).toBe(0);
      expect(now.steerRightRad, `frame ${i}`).toBe(0);
    }
    expect(setOff, 'drives off straight from a stand').toBeGreaterThan(2);
  });

  it('steers each wheel up to 85° at the power steering’s rate, the inner wheel further on a curve', () => {
    for (const [i, f] of run.frames.entries()) {
      for (const key of ['steerLeftRad', 'steerRightRad']) {
        expect(Math.abs(Number(f[key]))).toBeLessThanOrEqual(STEER_MAX_RAD + 1e-9);
        // 2 rad a second at ×1 (the frames are 1/20 s of motion).
        if (i > 0) expect(Math.abs(Number(f[key]) - Number(run.frames[i - 1]?.[key]))).toBeLessThanOrEqual(STEER_RAD_PER_S / 20 + 1e-9);
      }
    }
    const left = run.frames.map((f) => Number(f.steerLeftRad));
    const right = run.frames.map((f) => Number(f.steerRightRad));
    expect(left.some((l, i) => Math.abs(l) < 1e-9 && Math.abs(right[i] as number) < 1e-9), 'straight on a straight run').toBe(true);
    // On a curve both turn the same way, the one nearer the curve's centre further (a steer axle's geometry).
    expect(left.some((l, i) => Math.sign(l) === Math.sign(right[i] as number) && Math.abs(l) > 0.1 && Math.abs(Math.abs(l) - Math.abs(right[i] as number)) > 0.05)).toBe(true);
  });

  it('leads with a blue spot 4.75 m from its middle, ahead or behind as it drives, and none while it stands', () => {
    // Standing to lift: no spot.
    const standing = run.frames.flatMap((f, i) => (i > 0 && Number(f.liftM) !== Number(run.frames[i - 1]?.liftM) && f.xM === run.frames[i - 1]?.xM && f.zM === run.frames[i - 1]?.zM ? [i] : []));
    expect(standing.length).toBeGreaterThan(5);
    for (const i of standing) {
      expect(run.frames[i]?.blueSpot, `frame ${i}`).toBe(false);
      expect(run.spotAt[i], `frame ${i}`).toBeNull();
    }
    const shown = run.frames.flatMap((f, i) => (f.blueSpot === true ? [i] : []));
    expect(shown.length).toBeGreaterThan(20);
    for (const i of shown) {
      const f = run.frames[i] as Record<string, number>;
      const at_ = run.spotAt[i] as THREE.Vector3;
      // Instance matrices are 32-bit floats: to a tenth of a millimetre.
      expect(at_.y).toBeCloseTo(0.06, 4);
      const off = Math.hypot(at_.x - f.xM, at_.z - f.zM);
      expect(off).toBeCloseTo(at.FORKLIFT_SIZE_M.lengthM / 2 + 3, 4);
      // On the forklift's own line, ahead (forks first) or behind.
      const across = (at_.x - f.xM) * Math.cos(f.headingRad) - (at_.z - f.zM) * Math.sin(f.headingRad);
      expect(Math.abs(across)).toBeLessThan(1e-4);
    }
  });

  it('tilts the pallet on the forks with the mast', () => {
    let checked = 0;
    run.frames.forEach((f, i) => {
      if (f.carrying !== true) return;
      expect(run.palletUp[i]).toBeCloseTo(Math.abs(Number(f.tiltRad)), 4);
      if (Math.abs(Number(f.tiltRad)) > 7 * DEG) checked += 1;
    });
    expect(checked).toBeGreaterThan(10);
  });

  it('turns the model’s or the grey box’s mast and steer wheels as its debug state says', async () => {
    const cases: Record<string, () => THREE.Object3D>[] = [{}, { 'vehicles/forklift.glb': () => stubForklift() }];
    for (const models of cases) {
      const machines = packsLine(makeContext(models));
      await settle();
      play(machines, snapshotAt(634), 0.5);
      play(machines, snapshotAt(700), 120, () => {
        const now = state(machines, 'forklift-1');
        return Number(now.tiltRad) < -4 * DEG && Math.abs(Number(now.steerLeftRad)) > 0.1 && Number(now.steerLeftRad) !== Number(now.steerRightRad);
      });
      const f1 = byId(machines, 'forklift-1');
      const now = state(machines, 'forklift-1');
      expect(Number(now.tiltRad)).toBeLessThan(-4 * DEG);
      expect(Math.abs(Number(now.steerLeftRad))).toBeGreaterThan(0.1);
      const mast = f1.object.getObjectByName('mast') as THREE.Object3D;
      expect(mast.rotation.x).toBeCloseTo(Number(now.tiltRad), 9);
      expect(f1.object.getObjectByName('forks')?.parent).toBe(mast);
      expect(f1.object.getObjectByName('mast_inner')?.parent).toBe(mast);
      expect(f1.object.getObjectByName('steer_left')?.rotation.y).toBeCloseTo(Number(now.steerLeftRad), 9);
      expect(f1.object.getObjectByName('steer_right')?.rotation.y).toBeCloseTo(Number(now.steerRightRad), 9);
    }
  });
});

describe('wheelSteerRad (phase 14)', () => {
  const [lx, lz] = STEER_WHEELS_M.left;
  const [rx, rz] = STEER_WHEELS_M.right;

  it('has the wheels where the grey box and the model steer them', () => {
    expect([lx, lz]).toEqual([STEER_M.steer_left[0], STEER_M.steer_left[2]]);
    expect([rx, rz]).toEqual([STEER_M.steer_right[0], STEER_M.steer_right[2]]);
    expect(STEER_MAX_RAD).toBeCloseTo((85 * Math.PI) / 180, 12);
  });

  it('stands each wheel square to the line from the turning centre: straight for a far one, splayed about the body', () => {
    // A centre far to the side: a straight run.
    expect(wheelSteerRad(lx, lz, 1e6, -PIVOT_BACK_M)).toBeCloseTo(0, 5);
    expect(wheelSteerRad(rx, rz, -1e6, -PIVOT_BACK_M)).toBeCloseTo(0, 5);
    // On the spot about the middle of the body, and about the drive axle's middle (0.2 m ahead of the footprint centre).
    expect(wheelSteerRad(lx, lz, 0, -PIVOT_BACK_M)).toBeCloseTo(-Math.atan2(1.3 - PIVOT_BACK_M, 0.45), 9);
    expect(wheelSteerRad(rx, rz, 0, -PIVOT_BACK_M)).toBeCloseTo(Math.atan2(1.3 - PIVOT_BACK_M, 0.45), 9);
    expect(wheelSteerRad(lx, lz, 0, 0.2)).toBeCloseTo(-Math.atan2(1.5, 0.45), 9);
    // A 1.5 m curve to the right side (+x): both turn the same way, the nearer wheel further.
    const near = wheelSteerRad(rx, rz, 1.5, -PIVOT_BACK_M);
    const far = wheelSteerRad(lx, lz, 1.5, -PIVOT_BACK_M);
    expect(Math.sign(near)).toBe(Math.sign(far));
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far));
    // Mirrored: a curve to the other side turns them the other way.
    expect(wheelSteerRad(lx, lz, -1.5, -PIVOT_BACK_M)).toBeCloseTo(-near, 9);
  });

  it('holds a wheel that would stand crosswise to 85°', () => {
    // The centre straight ahead of the wheel: it would roll sideways.
    expect(Math.abs(wheelSteerRad(lx, lz, lx, 0.2))).toBeCloseTo(STEER_MAX_RAD, 9);
    expect(Math.abs(wheelSteerRad(rx, rz, rx, -3))).toBeCloseTo(STEER_MAX_RAD, 9);
  });
});

describe('forkliftWords (phase 14)', () => {
  it('says what each forklift does, as a dispatcher would, and the forks’ height once they are up', () => {
    expect(forkliftWords({ role: 'putAway', job: 'parked', liftM: 0 })).toBe('parked');
    expect(forkliftWords({ role: 'putAway', job: 'toPick', liftM: 0 })).toBe('to the pallet');
    expect(forkliftWords({ role: 'putAway', job: 'toDrop', liftM: 0.15 })).toBe('to the racks');
    expect(forkliftWords({ role: 'putAway', job: 'drop', liftM: 1.62 })).toBe('putting away · forks 1.6 m');
    expect(forkliftWords({ role: 'loading', job: 'toPick', liftM: 0 })).toBe('to the racks');
    expect(forkliftWords({ role: 'loading', job: 'toDrop', liftM: 0.15 })).toBe('to the truck');
    expect(forkliftWords({ role: 'loading', job: 'drop', liftM: 1.36 })).toBe('loading the truck · forks 1.4 m');
    expect(forkliftWords({ role: 'loading', job: 'home', liftM: 0 })).toBe('back to its spot');
  });
});
