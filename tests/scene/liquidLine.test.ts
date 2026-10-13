import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGE_IDS, type Snapshot, type StageId } from '../../src/contracts';
import { liquidLine } from '../../src/scene/equipment/liquidLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

// The liquid line's grey boxes (stages 1–6), checked without WebGL: three.js objects work in Node.

/** The module may add paint and gauge faces on top of the shared set, one material each. */
const MAX_OWN_MATERIALS = 2;
/** The lane's budget is about 120 draw calls for stages 1–6, shadow pass included. */
const DRAW_CALL_BUDGET = 120;

/**
 * The shared set as contracts v1 has it. Should scene-core add a name, the context here simply lacks it,
 * as an older host would, and the module must still build.
 */
const SHARED_NAMES = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack'] as const satisfies readonly MaterialName[];

function makeContext(): EquipmentContext & { materials: Record<MaterialName, THREE.Material> } {
  const materials = Object.fromEntries(SHARED_NAMES.map((name) => [name, new THREE.MeshStandardMaterial()]));
  return {
    materials: materials as unknown as Record<MaterialName, THREE.Material>,
    loadModel: () => Promise.reject(new Error('no models in unit tests')),
  };
}

function build(): { ctx: ReturnType<typeof makeContext>; machines: Equipment[] } {
  const ctx = makeContext();
  return { ctx, machines: liquidLine(ctx) };
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

function worldBox(machine: Equipment): THREE.Box3 {
  machine.object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(machine.object);
}

describe('liquidLine', () => {
  it('builds at least one machine for each of stages 1–6 and none for 7–10', () => {
    const { machines } = build();
    const stages = new Set(machines.map((m) => m.stage));
    expect([...stages].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(STAGE_IDS.filter((id) => id > 6).some((id) => stages.has(id))).toBe(false);
  });

  it('gives every machine a unique kebab-case id, a label and something to click', () => {
    const { machines } = build();
    const ids = machines.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const machine of machines) {
      expect(machine.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(machine.label.trim()).not.toBe('');
      expect(meshesOf(machine.object).length, machine.id).toBeGreaterThan(0);
    }
  });

  it('has every Must item of the asset list for stages 1–6', () => {
    const { machines } = build();
    const expected: [string, StageId][] = [
      ['silo-a', 1], ['silo-b', 1], ['separator', 1], ['mixing-tank', 1],
      ['plate-heat-exchanger', 2], ['deaerator', 2],
      ['homogenizer', 3],
      ['steam-injector', 4], ['holding-tube', 4], ['divert-valve', 4], ['reject-tank', 4],
      ['flash-vessel', 5], ['tubular-cooler', 5],
      ['aseptic-tank', 6],
    ];
    for (const [id, stage] of expected) expect(byId(machines, id).stage, id).toBe(stage);
  });

  it('names the moving nodes the hero models keep', () => {
    const { machines } = build();
    expect(node(byId(machines, 'separator'), 'bowl')).toBeInstanceOf(THREE.Object3D);
    for (const name of ['piston_1', 'piston_2', 'piston_3']) expect(node(byId(machines, 'homogenizer'), name)).toBeInstanceOf(THREE.Mesh);
  });

  it('uses the shared materials, adding at most two of its own', () => {
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

  it('stays within its draw-call budget, counting the shadow pass', () => {
    const { machines } = build();
    const meshes = machines.flatMap((m) => meshesOf(m.object));
    const drawCalls = meshes.length + meshes.filter((mesh) => mesh.castShadow).length;
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    // The heat exchanger's plates are one instanced draw.
    const plates = node(byId(machines, 'plate-heat-exchanger'), 'plates');
    expect(plates).toBeInstanceOf(THREE.InstancedMesh);
    expect((plates as THREE.InstancedMesh).count).toBeGreaterThan(10);
  });

  it.each([
    ['silo-a', '4 °C'],
    ['separator', '60 °C'],
    ['standardization-skid', '3.5 % fat'],
    ['plate-heat-exchanger', '80 °C'],
    ['deaerator', '76 °C'],
    ['homogenizer', '200 bar'],
    ['holding-tube', '140.0 °C · B* 1.19'],
    ['divert-valve', 'forward'],
    ['reject-tank', '0 L'],
    ['flash-vessel', '80 °C'],
    ['tubular-cooler', '20 °C'],
    ['aseptic-tank', '50 %'],
  ])('labels %s "%s" on the static plant', (id, text) => {
    const { machines } = build();
    expect(byId(machines, id).labelText(staticSnapshot())).toBe(text);
  });

  it('shows no label value, rather than NaN, when the snapshot lacks it', () => {
    const { machines } = build();
    const snapshot = staticSnapshot();
    for (const stage of [1, 2, 3, 4, 5, 6] as const) snapshot.stages[stage].values = {};
    for (const machine of machines) expect(machine.labelText(snapshot), machine.id).not.toMatch(/NaN|undefined/);
    expect(byId(machines, 'homogenizer').labelText(snapshot)).toBe('');
  });

  // Points of the preview's pipe routes (uht-plant-preview.html PRE, PROD, DIV and the silo manifold)
  // where each machine takes or gives milk; scene-core draws the pipes along the same routes.
  it.each<[string, [number, number, number]]>([
    ['silo-a', [-56.85, 0.9, -18.5]],
    ['silo-b', [-56.85, 0.9, -9.5]],
    ['separator', [-51.5, 1.2, -14]],
    ['mixing-tank', [-42.4, 1.2, -14]],
    ['balance-tank', [-33, 0.7, -14]],
    ['plate-heat-exchanger', [-28.9, 1.7, -14]],
    ['deaerator', [-24.8, 2.0, -14]],
    ['homogenizer', [-20.5, 0.7, -14]],
    ['steam-injector', [-17, 0.9, -14]],
    ['divert-valve', [-12.6, 2.5, -14]],
    ['reject-tank', [-12.6, 0.6, -10.5]],
    ['flash-vessel', [-10, 2.5, -14]],
    ['tubular-cooler', [-9.3, 0.8, -11.6]],
    ['aseptic-tank', [4, 1.6, -14]],
  ])('stands %s where the pipe route meets it', (id, pointM) => {
    const { machines } = build();
    expect(worldBox(byId(machines, id)).containsPoint(new THREE.Vector3(...pointM))).toBe(true);
  });

  it('puts each label anchor just above its machine', () => {
    const { machines } = build();
    for (const machine of machines) {
      const box = worldBox(machine).expandByVector(new THREE.Vector3(0.5, 0, 0.5));
      const [xM, yM, zM] = machine.labelAnchorM;
      expect(yM, machine.id).toBeGreaterThan(box.max.y);
      expect(yM - box.max.y, machine.id).toBeLessThan(1);
      expect(xM >= box.min.x && xM <= box.max.x && zM >= box.min.z && zM <= box.max.z, machine.id).toBe(true);
    }
  });

  it('spins the separator bowl while running, and not while paused', () => {
    const { machines } = build();
    const separator = byId(machines, 'separator');
    const bowl = node(separator, 'bowl');
    const snapshot = staticSnapshot();
    separator.update(snapshot, 0.1);
    const turned = bowl.rotation.y;
    expect(turned).toBeGreaterThan(0);
    separator.update({ ...snapshot, paused: true }, 0.1);
    expect(bowl.rotation.y).toBe(turned);
  });

  it('strokes the pistons with the flow, a third of a turn apart', () => {
    const { machines } = build();
    const homogenizer = byId(machines, 'homogenizer');
    const pistons = ['piston_1', 'piston_2', 'piston_3'].map((name) => node(homogenizer, name));
    const snapshot = staticSnapshot();
    homogenizer.update(snapshot, 0.05);
    const zs = pistons.map((p) => p.position.z);
    expect(new Set(zs.map((z) => z.toFixed(4))).size).toBe(3);
    // No flow, no stroke.
    const still = structuredClone(snapshot);
    still.line.homogenizer.flowLph = 0;
    homogenizer.update(still, 0.05);
    expect(pistons.map((p) => p.position.z)).toEqual(zs);
  });

  it('fills the aseptic tank to the snapshot level', () => {
    const { machines } = build();
    const tank = byId(machines, 'aseptic-tank');
    const milk = node(tank, 'milk');
    const at = (levelPct: number): number => {
      const snapshot = staticSnapshot();
      snapshot.stages[6].values.levelPct = levelPct;
      tank.update(snapshot, 0.016);
      return milk.scale.y;
    };
    const quarter = at(25);
    const threeQuarters = at(75);
    expect(threeQuarters).toBeCloseTo(3 * quarter, 6);
    expect(at(100)).toBeGreaterThan(threeQuarters);
    expect(at(0)).toBeGreaterThan(0); // an empty tank keeps a sliver, never a zero scale
  });

  it('collects diverted milk in the reject tank and flips the valve', () => {
    const { machines } = build();
    const tank = byId(machines, 'reject-tank');
    const valve = byId(machines, 'divert-valve');
    const flag = node(valve, 'flag');
    const snapshot = staticSnapshot();
    tank.update(snapshot, 0.016);
    const diverting = structuredClone(snapshot);
    diverting.line.divert.flowLph = 16_000;
    diverting.timeS += 225; // 16,000 L/h for 225 s is 1,000 L
    tank.update(diverting, 0.016);
    expect(tank.labelText(diverting)).toBe('1,000 L');
    expect(valve.labelText(diverting)).toBe('diverting');
    for (let i = 0; i < 60; i++) valve.update(diverting, 0.05);
    expect(flag.rotation.y).toBeCloseTo(-Math.PI / 2, 2);
    // Back to forward flow: the valve flips back, and the tank empties at a full tank per re-sterilization.
    for (let i = 0; i < 60; i++) valve.update(snapshot, 0.05);
    expect(flag.rotation.y).toBeCloseTo(0, 2);
    const { rejectTankL, sterilizeS } = plantConfig.uht;
    const drainS = (500 / rejectTankL) * sterilizeS;
    tank.update({ ...snapshot, timeS: diverting.timeS + drainS }, 0.016);
    expect(tank.labelText(snapshot)).toBe('500 L');
    // A sim that starts again (time runs backwards) starts with an empty tank.
    tank.update({ ...snapshot, timeS: 0 }, 0.016);
    expect(tank.labelText(snapshot)).toBe('0 L');
  });

  it('disposes its own geometry and materials, never the shared materials', () => {
    const { ctx, machines } = build();
    let sharedDisposed = 0;
    for (const material of Object.values(ctx.materials)) material.addEventListener('dispose', () => sharedDisposed++);
    const geometries = new Set<THREE.BufferGeometry>();
    const own = new Set<THREE.Material>();
    const shared = new Set<THREE.Material>(Object.values(ctx.materials));
    for (const machine of machines) {
      for (const mesh of meshesOf(machine.object)) {
        geometries.add(mesh.geometry);
        for (const material of [mesh.material].flat()) if (!shared.has(material)) own.add(material);
      }
    }
    const disposed = new Set<THREE.EventDispatcher<object>>();
    for (const item of [...geometries, ...own]) item.addEventListener('dispose', () => disposed.add(item));

    machines.slice(0, -1).forEach((machine) => machine.dispose());
    // The unit shapes and own materials stay while one machine still uses them.
    expect([...own].some((material) => disposed.has(material))).toBe(false);
    machines.at(-1)?.dispose();
    machines.forEach((machine) => machine.dispose()); // a second dispose() is harmless

    expect(sharedDisposed).toBe(0);
    for (const item of [...geometries, ...own]) expect(disposed.has(item)).toBe(true);
  });
});
