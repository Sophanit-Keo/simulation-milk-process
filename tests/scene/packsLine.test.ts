import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGE_IDS, type Snapshot, type StageId } from '../../src/contracts';
import * as at from '../../src/scene/equipment/packs/layout';
import type { VehicleSizeM } from '../../src/scene/equipment/packs/vehicles';
import { packsLine } from '../../src/scene/equipment/packsLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

// The packs line's grey boxes (stages 7–10), checked without WebGL: three.js objects work in Node.

/** The module adds light panels and amber floor markings to the shared set, and the QA lab its lamp. */
const MAX_OWN_MATERIALS = 3;
/** The lane's budget is about 150 draw calls for stages 7–10, shadow pass included. */
const DRAW_CALL_BUDGET = 150;

/**
 * The shared set as contracts v1 has it. Should scene-core add a name, the context here simply lacks it,
 * as an older host would, and the module must still build.
 */
const SHARED_NAMES = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'] as const satisfies readonly MaterialName[];

type Context = EquipmentContext & { materials: Record<MaterialName, THREE.Material>; requested: string[] };

/** A host whose models never load (missing files, as in a fresh worktree), or load from `models`. */
function makeContext(models: Record<string, () => THREE.Object3D> = {}, shared: readonly MaterialName[] = SHARED_NAMES): Context {
  const materials = Object.fromEntries(shared.map((name) => [name, new THREE.MeshStandardMaterial()]));
  const requested: string[] = [];
  // Like the host: one load per file, a clone per call that shares the file's geometry and material.
  const cache = new Map<string, THREE.Object3D>();
  return {
    materials: materials as unknown as Record<MaterialName, THREE.Material>,
    requested,
    loadModel(path) {
      requested.push(path);
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

/**
 * A stand-in kit piece: one mesh with its own palette material, like every file of the Factory Kit, as
 * tall as the real piece's belt or rollers (0.4 m for belts, 0.34 for the corner, 0.25 and 0.35 for rollers).
 */
const kitPiece = (topM: number) => (): THREE.Object3D => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, topM, 1).translate(0, topM / 2, 0), new THREE.MeshStandardMaterial({ name: 'colormap' })));
  return scene;
};

const KIT_FILES: Record<string, number> = {
  'conveyor-long-sides-part-end': 0.4,
  'conveyor-long-sides-part-middle': 0.4,
  'conveyor-corner': 0.34,
  'conveyor-sides': 0.4,
  'conveyor-bars': 0.25,
  'conveyor-bars-high': 0.35,
};
const kitModels = Object.fromEntries(Object.entries(KIT_FILES).map(([name, topM]) => [`kenney/${name}.glb`, kitPiece(topM)]));

/** Lets the model loads and the swaps that follow them settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function build(ctx: Context = makeContext()): { ctx: Context; machines: Equipment[] } {
  return { ctx, machines: packsLine(ctx) };
}

const staticSnapshot = (): Snapshot => createSim(plantConfig).snapshot();

const byId = (machines: Equipment[], id: string): Equipment => {
  const machine = machines.find((m) => m.id === id);
  if (!machine) throw new Error(`no machine ${id}`);
  return machine;
};

const node = (machine: Equipment, name: string): THREE.Object3D => {
  const found = machine.object.getObjectByName(name);
  if (!found) throw new Error(`${machine.id} has no node ${name}`);
  return found;
};

function meshesOf(object: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  return meshes;
}

/** Each mesh is one draw, plus one more in the shadow pass if it casts a shadow. */
function drawCalls(machines: Equipment[]): number {
  const meshes = machines.flatMap((m) => meshesOf(m.object));
  return meshes.length + meshes.filter((mesh) => mesh.castShadow).length;
}

function worldBox(machine: Equipment): THREE.Box3 {
  machine.object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(machine.object);
}

/** A point on a line's floor plan and the line's direction there. */
interface LinePoint {
  xM: number;
  zM: number;
  dir: [number, number];
}

/**
 * What a pack or tray at this point would rest on: the highest of a few rays straight down within
 * 0.1 m along the line, so a ray falling between two rollers doesn't count as a gap. Which fixture, at what height.
 */
function surfaceBelow(machines: Equipment[], { xM, zM, dir }: LinePoint): { id: string; yM: number } | null {
  const scene = new THREE.Scene();
  for (const machine of machines) scene.add(machine.object);
  scene.updateMatrixWorld(true);
  let best: THREE.Intersection | undefined;
  for (const offM of [-0.1, -0.05, 0, 0.05, 0.1]) {
    const from = new THREE.Vector3(xM + dir[0] * offM, 20, zM + dir[1] * offM);
    const hit = new THREE.Raycaster(from, new THREE.Vector3(0, -1, 0)).intersectObject(scene, true)[0];
    if (hit && (!best || hit.point.y > best.point.y)) best = hit;
  }
  for (const machine of machines) scene.remove(machine.object);
  if (!best) return null;
  let owner: THREE.Object3D | null = best.object;
  while (owner && owner.userData.equipmentId === undefined) owner = owner.parent;
  return { id: String(owner?.userData.equipmentId), yM: best.point.y };
}

/** Points every `stepM` along a polyline of world points, on the floor plan. */
function along(points: readonly (readonly [number, number, number])[], stepM: number): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, , az] = points[i - 1] as readonly [number, number, number];
    const [bx, , bz] = points[i] as readonly [number, number, number];
    const lengthM = Math.hypot(bx - ax, bz - az);
    const dir: [number, number] = [(bx - ax) / lengthM, (bz - az) / lengthM];
    for (let s = 0; s < lengthM; s += stepM) out.push({ xM: ax + dir[0] * s, zM: az + dir[1] * s, dir });
  }
  return out;
}

describe('packsLine', () => {
  it('builds at least one fixture for each of stages 7–10 and none for 1–6', () => {
    const { machines } = build();
    const stages = new Set(machines.map((m) => m.stage));
    expect([...stages].sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
    expect(STAGE_IDS.filter((id) => id < 7).some((id) => stages.has(id))).toBe(false);
  });

  it('gives every fixture a unique kebab-case id, a label, something to click and its stage for picking', () => {
    const { machines } = build();
    const ids = machines.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const machine of machines) {
      expect(machine.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(machine.label.trim()).not.toBe('');
      expect(meshesOf(machine.object).length, machine.id).toBeGreaterThan(0);
      expect(machine.object.userData, machine.id).toEqual({ equipmentId: machine.id, stage: machine.stage });
    }
  });

  it('has every Must item of the asset list for stages 7–10, and the Should items', () => {
    const { machines } = build();
    const expected: [string, StageId][] = [
      ['filler-a', 7], ['filler-b', 7], ['pack-conveyors', 7], ['accumulation-table', 7],
      ['tray-shrink-tunnel', 8], ['tray-conveyor', 8], ['palletizer', 8], ['pallet-conveyor', 8],
      ['quarantine', 9], ['qa-lab', 9],
      ['racks', 10], ['docks', 10], ['forklift-1', 10], ['forklift-2', 10], ['truck', 10],
    ];
    for (const [id, stage] of expected) expect(byId(machines, id).stage, id).toBe(stage);
  });

  it('names the moving nodes the hero models keep', () => {
    const { machines } = build();
    for (const id of ['filler-a', 'filler-b']) {
      expect(node(byId(machines, id), 'reel')).toBeInstanceOf(THREE.Group);
      expect(node(byId(machines, id), 'jaws')).toBeInstanceOf(THREE.Group);
    }
    expect(node(byId(machines, 'palletizer'), 'arm')).toBeInstanceOf(THREE.Group);
  });

  it('uses the shared materials, adding at most three of its own', () => {
    const { ctx, machines } = build();
    const shared = new Set<THREE.Material>(Object.values(ctx.materials));
    const own = new Set<THREE.Material>();
    for (const machine of machines) {
      for (const mesh of meshesOf(machine.object)) {
        for (const material of [mesh.material].flat()) if (!shared.has(material)) own.add(material);
      }
    }
    expect(own.size).toBeLessThanOrEqual(MAX_OWN_MATERIALS);
  });

  it('still builds on a host without the paint and gauge materials', () => {
    const ctx = makeContext({}, SHARED_NAMES.filter((name) => name !== 'paint' && name !== 'gauge'));
    expect(() => packsLine(ctx)).not.toThrow();
  });

  it('stays within its draw-call budget, counting the shadow pass, with grey boxes and with the kit', async () => {
    expect(drawCalls(build().machines)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    const { machines } = build(makeContext(kitModels));
    await settle();
    expect(drawCalls(machines)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  });

  it('instances the racks and a static sample of pallet loads in them', () => {
    const { machines } = build();
    const racks = byId(machines, 'racks');
    const uprights = node(racks, 'uprights') as THREE.InstancedMesh;
    expect(uprights).toBeInstanceOf(THREE.InstancedMesh);
    expect(uprights.count).toBe((at.RACK_BAYS + 1) * at.RACK_Z_M.length * 2);
    expect(node(racks, 'beams')).toBeInstanceOf(THREE.InstancedMesh);
    const loads = node(racks, 'loads') as THREE.InstancedMesh;
    const pallets = node(racks, 'pallets') as THREE.InstancedMesh;
    const places = at.rackSlots().length;
    for (const mesh of [loads, pallets]) {
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.instanceMatrix.count).toBe(places); // room for a full warehouse in phase 4
      expect(mesh.count).toBeGreaterThan(places / 4);
      expect(mesh.count).toBeLessThan(places);
    }
    expect(loads.count).toBe(pallets.count);
  });

  it('builds the conveyors as grey boxes first and keeps them when the kit cannot load', async () => {
    const { ctx, machines } = build();
    await settle();
    expect(ctx.requested).toEqual(expect.arrayContaining(['kenney/conveyor-long-sides-part-middle.glb', 'kenney/conveyor-corner.glb']));
    for (const id of ['pack-conveyors', 'accumulation-table', 'tray-conveyor', 'pallet-conveyor']) {
      const machine = byId(machines, id);
      expect(machine.object.getObjectByName('grey-box'), id).toBeDefined();
      expect(machine.object.getObjectByName('kit'), id).toBeUndefined();
    }
    expect(node(byId(machines, 'tray-conveyor'), 'rollers')).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('swaps in instanced kit pieces that all share one material once the kit loads', async () => {
    const { machines } = build(makeContext(kitModels));
    await settle();
    const kitMaterials = new Set<THREE.Material>();
    for (const id of ['pack-conveyors', 'accumulation-table', 'tray-conveyor', 'pallet-conveyor']) {
      const machine = byId(machines, id);
      expect(machine.object.getObjectByName('grey-box'), id).toBeUndefined();
      const kit = node(machine, 'kit');
      const pieces = meshesOf(kit);
      expect(pieces.length, id).toBeGreaterThan(0);
      for (const piece of pieces) {
        expect(piece, `${id} ${piece.name}`).toBeInstanceOf(THREE.InstancedMesh);
        kitMaterials.add(piece.material as THREE.Material);
      }
    }
    // The palette texture reaches the GPU once (assets/README.md, "Texture copies").
    expect(kitMaterials.size).toBe(1);
    // Many pieces, few draws: the pack lines are three instanced meshes (ends, middles, corners).
    const packPieces = meshesOf(node(byId(machines, 'pack-conveyors'), 'kit')) as THREE.InstancedMesh[];
    expect(packPieces.length).toBe(3);
    expect(packPieces.reduce((sum, mesh) => sum + mesh.count, 0)).toBeGreaterThan(100);
  });

  it('carries the packs and trays at belt height along the preview lines', async () => {
    for (const ctx of [makeContext(), makeContext(kitModels)]) {
      const { machines } = build(ctx);
      await settle();
      // A grey belt's top or a stand-in kit piece scaled to the belt: either way the surface is at BELT_M.
      const tunnel = at.TUNNEL;
      const inTunnel = (p: LinePoint): boolean => Math.abs(p.zM - tunnel.centreM[2]) < tunnel.sizeM[2] / 2 + 0.15;
      const lines: [readonly (readonly [number, number, number])[], string[]][] = [
        [at.LINE_A, ['pack-conveyors', 'accumulation-table']],
        [at.LINE_B, ['pack-conveyors', 'accumulation-table']],
        [at.TRAY_LINE, ['tray-conveyor']],
      ];
      for (const [line, owners] of lines) {
        // Past the filler's outfeed hood over the start of the belt, and clear of the gripper over the pick point.
        const clear = (p: LinePoint): boolean =>
          !inTunnel(p) && p.xM > at.FILLER_FACE_X_M + 0.4 && Math.hypot(p.xM - at.PICK_M[0], p.zM - at.PICK_M[1]) > 0.6;
        for (const point of along(line, 0.5).filter(clear)) {
          const where = `${point.xM}, ${point.zM}`;
          const hit = surfaceBelow(machines, point);
          expect(hit, where).not.toBeNull();
          expect(owners, where).toContain(hit?.id);
          expect(hit?.yM, where).toBeCloseTo(at.BELT_M, 1);
        }
      }
    }
  });

  it('keeps the grey vehicles when their models are missing, and fits the models when they load', async () => {
    const empty = build();
    await settle();
    expect(empty.ctx.requested).toEqual(expect.arrayContaining(['vehicles/truck.glb', 'vehicles/forklift.glb']));
    for (const id of ['truck', 'forklift-1', 'forklift-2']) expect(node(byId(empty.machines, id), 'grey-box')).toBeDefined();

    // Stand-ins that lie along x, at a different scale and off-centre, as a downloaded model might.
    const box = (x: number, y: number, z: number) => () =>
      new THREE.Mesh(new THREE.BoxGeometry(x, y, z).translate(5, 3, -2), new THREE.MeshStandardMaterial());
    const { machines } = build(makeContext({ 'vehicles/truck.glb': box(33, 8, 5), 'vehicles/forklift.glb': box(70, 50, 30) }));
    await settle();
    const fits: [string, at.FloorPointM, VehicleSizeM][] = [
      ['truck', [at.DOOR_X_M[1], at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM / 2], at.TRUCK_SIZE_M],
      ['forklift-1', [-30, 10.6], at.FORKLIFT_SIZE_M],
    ];
    for (const [id, centreM, size] of fits) {
      const machine = byId(machines, id);
      expect(machine.object.getObjectByName('grey-box'), id).toBeUndefined();
      const bounds = worldBox(machine);
      const sizeM = bounds.getSize(new THREE.Vector3());
      const centre = bounds.getCenter(new THREE.Vector3());
      expect(bounds.min.y, id).toBeCloseTo(0, 6);
      expect(centre.x, id).toBeCloseTo(centreM[0], 6);
      expect(centre.z, id).toBeCloseTo(centreM[1], 6);
      expect(sizeM.y, id).toBeLessThanOrEqual(size.heightM + 1e-6);
      // The truck faces +z (its length along z); the forklift drives along x.
      const [lengthM, widthM] = id === 'truck' ? [sizeM.z, sizeM.x] : [sizeM.x, sizeM.z];
      expect(lengthM, id).toBeLessThanOrEqual(size.lengthM + 1e-6);
      expect(widthM, id).toBeLessThanOrEqual(size.widthM + 1e-6);
      // Uniform scale, as large as the box allows: one of the three sides touches it.
      expect(Math.max(lengthM / size.lengthM, sizeM.y / size.heightM, widthM / size.widthM), id).toBeCloseTo(1, 6);
    }
  });

  it('sizes the grey vehicles to the boxes their models are fitted to', () => {
    const { machines } = build();
    const truck = worldBox(byId(machines, 'truck')).getSize(new THREE.Vector3());
    expect(truck.z).toBeCloseTo(at.TRUCK_SIZE_M.lengthM, 1);
    expect(truck.y).toBeCloseTo(at.TRUCK_SIZE_M.heightM, 1);
    expect(truck.x).toBeLessThanOrEqual(at.TRUCK_SIZE_M.widthM + 1e-6);
    const forklift = worldBox(byId(machines, 'forklift-1')).getSize(new THREE.Vector3());
    expect(forklift.x).toBeCloseTo(at.FORKLIFT_SIZE_M.lengthM, 1);
    expect(forklift.y).toBeCloseTo(at.FORKLIFT_SIZE_M.heightM, 1);
    expect(forklift.z).toBeLessThanOrEqual(at.FORKLIFT_SIZE_M.widthM + 1e-6);
  });

  it.each([
    ['filler-a', 'running · 7,500/h'],
    ['filler-b', 'running · 7,500/h'],
    ['pack-conveyors', '15,000 packs/h'],
    ['tray-shrink-tunnel', '12 per tray'],
    ['tray-conveyor', '1,250 trays/h'],
    ['palletizer', '84 trays/pallet'],
    ['pallet-conveyor', '0 pallets'],
    ['quarantine', 'hold 7 d'],
    ['qa-lab', '55 °C'],
    ['racks', '22 per truck'],
    ['docks', '0 trucks out'],
  ])('labels %s "%s" on the static plant', (id, text) => {
    const { machines } = build();
    expect(byId(machines, id).labelText(staticSnapshot())).toBe(text);
  });

  it('shows no label value, rather than NaN, when the snapshot lacks it', () => {
    const { machines } = build();
    const snapshot = staticSnapshot();
    for (const stage of [7, 8, 9, 10] as const) snapshot.stages[stage].values = {};
    const partial = { ...snapshot, kpis: {} } as unknown as Snapshot;
    for (const machine of machines) {
      expect(machine.labelText(partial), machine.id).not.toMatch(/NaN|undefined/);
      expect(() => machine.update(partial, 0.016), machine.id).not.toThrow();
    }
    expect(byId(machines, 'filler-a').labelText(partial)).toBe('');
    expect(byId(machines, 'quarantine').labelText(partial)).toBe('');
  });

  it('stands each filler where the product pipe from the aseptic tank ends', () => {
    const { machines } = build();
    for (const [id, zM] of [['filler-a', at.FILLER_Z_M.a], ['filler-b', at.FILLER_Z_M.b]] as const) {
      // uht-plant-preview.html OUT_A and OUT_B end here; scene-core draws the pipes along the same routes.
      expect(worldBox(byId(machines, id)).containsPoint(new THREE.Vector3(at.FILLER_INLET_M.xM, at.FILLER_INLET_M.yM, zM)), id).toBe(true);
    }
  });

  it('puts each label anchor just above its fixture', () => {
    const { machines } = build();
    for (const machine of machines) {
      const box = worldBox(machine).expandByVector(new THREE.Vector3(0.5, 0, 0.5));
      const [xM, yM, zM] = machine.labelAnchorM;
      expect(yM, machine.id).toBeGreaterThan(box.max.y);
      expect(yM - box.max.y, machine.id).toBeLessThan(1);
      expect(xM >= box.min.x && xM <= box.max.x && zM >= box.min.z && zM <= box.max.z, machine.id).toBe(true);
    }
  });

  it('turns the reels and works the jaws of running fillers, and not while paused', () => {
    const { machines } = build();
    const snapshot = staticSnapshot();
    for (const id of ['filler-a', 'filler-b']) {
      const filler = byId(machines, id);
      const reel = node(filler, 'reel');
      const jaws = node(filler, 'jaws');
      const jawsY = jaws.position.y;
      filler.update(snapshot, 0.2);
      const turned = reel.rotation.z;
      expect(turned, id).not.toBe(0);
      expect(jaws.position.y, id).toBeLessThan(jawsY);
      filler.update({ ...snapshot, paused: true }, 0.2);
      expect(reel.rotation.z, id).toBe(turned);
    }
  });

  it('stops filler B, and only B, when the fillers draw one filler’s worth of milk', () => {
    const { machines } = build();
    const snapshot = staticSnapshot();
    const oneDown = structuredClone(snapshot);
    oneDown.line.filler.flowLph /= 2;
    const [a, b] = [byId(machines, 'filler-a'), byId(machines, 'filler-b')];
    expect(a.labelText(oneDown)).toBe('running · 7,500/h');
    expect(b.labelText(oneDown)).toBe('stopped');
    b.update(oneDown, 0.2);
    expect(node(b, 'reel').rotation.z).toBe(0);
    // No milk drawn at all: both stand.
    oneDown.line.filler.flowLph = 0;
    expect(a.labelText(oneDown)).toBe('stopped');
  });

  it('swings the palletizer arm between the pick and place points, and not while paused', () => {
    const { machines } = build();
    const palletizer = byId(machines, 'palletizer');
    const arm = node(palletizer, 'arm');
    const pointing = (): [number, number] => [Math.cos(arm.rotation.y), -Math.sin(arm.rotation.y)];
    const towards = ([xM, zM]: at.FloorPointM): [number, number] => {
      const dx = xM - at.PALLETIZER_M[0];
      const dz = zM - at.PALLETIZER_M[2];
      const lengthM = Math.hypot(dx, dz);
      return [dx / lengthM, dz / lengthM];
    };
    const [pickX, pickZ] = towards(at.PICK_M);
    expect(pointing()[0]).toBeCloseTo(pickX, 6);
    expect(pointing()[1]).toBeCloseTo(pickZ, 6);
    const snapshot = staticSnapshot();
    // Half a swing (π at 0.5 rad/s) reaches the place point.
    for (let i = 0; i < 100; i++) palletizer.update(snapshot, Math.PI / 0.5 / 100);
    const [placeX, placeZ] = towards(at.PLACE_M);
    expect(pointing()[0]).toBeCloseTo(placeX, 6);
    expect(pointing()[1]).toBeCloseTo(placeZ, 6);
    const held = arm.rotation.y;
    palletizer.update({ ...snapshot, paused: true }, 1);
    expect(arm.rotation.y).toBe(held);
  });

  it('lights the incubator lamps by the QA stage status', () => {
    const { machines } = build();
    const lab = byId(machines, 'qa-lab');
    const lamps = node(lab, 'lamps') as THREE.InstancedMesh;
    const material = lamps.material as THREE.MeshStandardMaterial;
    const snapshot = staticSnapshot();
    lab.update(snapshot, 0.016);
    const ok = material.emissive.getHex();
    snapshot.stages[9].status = 'bad';
    lab.update(snapshot, 0.016);
    expect(material.emissive.getHex()).not.toBe(ok);
    snapshot.stages[9].status = 'idle';
    lab.update(snapshot, 0.016);
    expect(material.emissiveIntensity).toBe(0);
  });

  it('disposes its own geometry and materials, never the shared or the loaded ones', async () => {
    const ctx = makeContext(kitModels);
    const { machines } = build(ctx);
    await settle();
    const shared = new Set<THREE.Material>(Object.values(ctx.materials));
    let sharedDisposed = 0;
    for (const material of shared) material.addEventListener('dispose', () => sharedDisposed++);
    const kitMeshes = machines.flatMap((m) => {
      const kit = m.object.getObjectByName('kit');
      return kit ? meshesOf(kit) : [];
    });
    const loadedGeometries = new Set(kitMeshes.map((mesh) => mesh.geometry));
    const loadedMaterials = new Set(kitMeshes.map((mesh) => mesh.material as THREE.Material));
    let loadedDisposed = 0;
    for (const item of [...loadedGeometries, ...loadedMaterials]) item.addEventListener('dispose', () => loadedDisposed++);

    const geometries = new Set<THREE.BufferGeometry>();
    const own = new Set<THREE.Material>();
    const instanced = new Set<THREE.InstancedMesh>();
    for (const machine of machines) {
      for (const mesh of meshesOf(machine.object)) {
        if (mesh instanceof THREE.InstancedMesh) instanced.add(mesh);
        if (!loadedGeometries.has(mesh.geometry)) geometries.add(mesh.geometry);
        for (const material of [mesh.material].flat()) if (!shared.has(material) && !loadedMaterials.has(material)) own.add(material);
      }
    }
    const disposed = new Set<object>();
    for (const item of [...geometries, ...own]) item.addEventListener('dispose', () => disposed.add(item));
    // An instanced mesh frees its instance buffers on dispose().
    for (const mesh of instanced) mesh.addEventListener('dispose', () => disposed.add(mesh));

    machines.slice(0, -1).forEach((machine) => machine.dispose());
    // The unit shapes and the module's materials stay while one fixture still uses them (the QA lab's
    // lamp material is its own, and goes with it).
    const lampMaterial = (node(byId(machines, 'qa-lab'), 'lamps') as THREE.Mesh).material;
    expect([...own].some((material) => material !== lampMaterial && disposed.has(material))).toBe(false);
    machines.at(-1)?.dispose();
    machines.forEach((machine) => machine.dispose()); // a second dispose() is harmless

    expect(sharedDisposed).toBe(0);
    expect(loadedDisposed).toBe(0);
    for (const item of [...geometries, ...own, ...instanced]) expect(disposed.has(item)).toBe(true);
  });

  it('leaves a fixture alone if its kit pieces arrive after it was disposed', async () => {
    const { machines } = build(makeContext(kitModels));
    const conveyors = byId(machines, 'pack-conveyors');
    conveyors.dispose();
    await settle();
    expect(conveyors.object.getObjectByName('kit')).toBeUndefined();
  });
});
