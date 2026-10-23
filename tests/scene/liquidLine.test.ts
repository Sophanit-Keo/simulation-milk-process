import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGE_IDS, type Snapshot, type StageId } from '../../src/contracts';
import { GAUGE_FULL_SCALE_BAR, needleAngleRad, VAPOUR_FULL_LPH } from '../../src/scene/equipment/liquid/visuals';
import { liquidLine } from '../../src/scene/equipment/liquidLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { LAMP_GLOW_HEX } from '../../src/scene/theme';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

// The liquid line's grey boxes (stages 1–6), checked without WebGL: three.js objects work in Node.

/**
 * The module's own materials: paint and gauge faces (only while the host's shared set lacks them, as it
 * does here), see-through steam, the divert valve's lamp and the plate heat exchanger's glowing steel.
 */
const MAX_OWN_MATERIALS = 5;
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

  it('uses the shared materials, adding at most five of its own', () => {
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

  it('fills each tank from contracts v2’s liquid.tanks: inside the see-through ones, on a level gauge on the opaque ones', () => {
    const { machines } = build();
    const cases: [id: string, tank: keyof Snapshot['liquid']['tanks']][] = [
      ['silo-a', 'silo'],
      ['silo-b', 'silo'],
      ['mixing-tank', 'mixTank'],
      ['reject-tank', 'rejectTank'],
      ['aseptic-tank', 'asepticTank'],
    ];
    for (const [id, tank] of cases) {
      const machine = byId(machines, id);
      const milk = node(machine, 'milk');
      const at = (fillFrac: number): number => {
        const snapshot = staticSnapshot();
        const { capacityL } = snapshot.liquid.tanks[tank];
        snapshot.liquid.tanks[tank].levelL = fillFrac * capacityL;
        machine.update(snapshot, 0.016);
        expect(machine.debugState?.().fillFrac, `${id} at ${fillFrac}`).toBeCloseTo(fillFrac, 9);
        return milk.scale.y;
      };
      const quarter = at(0.25);
      const threeQuarters = at(0.75);
      expect(threeQuarters, id).toBeCloseTo(3 * quarter, 6);
      expect(at(1), id).toBeGreaterThan(threeQuarters);
      // The bar stands on the tank's floor: its bottom stays put as it rises.
      const bottomAtFull = milk.position.y - milk.scale.y / 2;
      at(0.5);
      expect(milk.position.y - milk.scale.y / 2, id).toBeCloseTo(bottomAtFull, 9);
      expect(at(0), id).toBeGreaterThan(0); // an empty tank keeps a sliver, never a zero scale
    }
  });

  it('opens on plant.json’s tank levels on the static plant', () => {
    const { machines } = build();
    const snapshot = staticSnapshot();
    const fill = (id: string): unknown => {
      const machine = byId(machines, id);
      machine.update(snapshot, 0.016);
      return machine.debugState?.().fillFrac;
    };
    expect(fill('silo-a')).toBeCloseTo(plantConfig.standardization.siloStartFrac, 9);
    expect(fill('mixing-tank')).toBeCloseTo(plantConfig.standardization.mixTankStartFrac, 9);
    expect(fill('aseptic-tank')).toBeCloseTo(plantConfig.asepticTank.startFrac, 9);
    expect(fill('reject-tank')).toBe(0);
  });

  it('fills the aseptic tank from stage 6’s levelPct when the snapshot has no liquid part, and holds a missing level', () => {
    const { machines } = build();
    const tank = byId(machines, 'aseptic-tank');
    const older = staticSnapshot() as Partial<Snapshot>;
    delete older.liquid;
    (older as Snapshot).stages[6].values.levelPct = 30;
    tank.update(older as Snapshot, 0.016);
    expect(tank.debugState?.().fillFrac).toBeCloseTo(0.3, 9);
    const reject = byId(machines, 'reject-tank');
    const snapshot = staticSnapshot();
    snapshot.liquid.tanks.rejectTank.levelL = 1_500;
    reject.update(snapshot, 0.016);
    reject.update(older as Snapshot, 0.016);
    expect(reject.debugState?.().fillFrac).toBeCloseTo(0.25, 9);
  });

  it('labels the reject tank with its contents', () => {
    const { machines } = build();
    const snapshot = staticSnapshot();
    snapshot.liquid.tanks.rejectTank.levelL = 1_000;
    expect(byId(machines, 'reject-tank').labelText(snapshot)).toBe('1,000 L');
  });

  it.each(['separator', 'mixing-tank'])('turns the %s with the flow through the separator, and stands it still at no flow', (id) => {
    const { machines } = build();
    const machine = byId(machines, id);
    const angle = (): number => machine.debugState?.().angleRad as number;
    const flowing = staticSnapshot();
    machine.update(flowing, 0.05);
    const first = angle();
    machine.update(flowing, 0.05);
    expect(angle()).not.toBe(first);
    // No flow: it spins down and comes to rest, then stays put.
    const still = structuredClone(flowing);
    still.line.separator.flowLph = 0;
    for (let i = 0; i < 200; i++) machine.update(still, 0.05);
    expect(machine.debugState?.().spinRadPerS).toBe(0);
    const rest = angle();
    machine.update(still, 0.05);
    expect(angle()).toBe(rest);
    // Flowing again, it spins up.
    for (let i = 0; i < 5; i++) machine.update(flowing, 0.05);
    expect(angle()).not.toBe(rest);
  });

  it('spins faster at a higher sim speed, but never more than a set step per frame', () => {
    const turnIn = (speed: Snapshot['speed'], dtS: number): number => {
      const { machines } = build();
      const separator = byId(machines, 'separator');
      separator.update({ ...staticSnapshot(), speed }, dtS);
      return separator.debugState?.().angleRad as number;
    };
    expect(turnIn(1_000, 0.016)).toBeCloseTo(2.5 * turnIn(1, 0.016), 9);
    // ×10,000 on a slow frame (main.ts's 0.1 s cap) would be 1.2 rad: capped under half a facet of the bowl.
    expect(turnIn(10_000, 0.1)).toBeLessThan((2 * Math.PI) / 8 / 2);
  });

  it('glows the plate heat exchanger with the preheater temperature, on a copy of the themed steel', () => {
    const { ctx, machines } = build();
    const exchanger = byId(machines, 'plate-heat-exchanger');
    const plates = node(exchanger, 'plates') as THREE.InstancedMesh;
    const glow = plates.material as THREE.MeshStandardMaterial;
    expect(glow).not.toBe(ctx.materials.steel);
    const at = (tempC: number): number => {
      const snapshot = staticSnapshot();
      snapshot.line.preheater.tempC = tempC;
      exchanger.update(snapshot, 0.016);
      return glow.emissiveIntensity;
    };
    expect(at(4)).toBe(0);
    const half = at(55);
    expect(half).toBeGreaterThan(0);
    expect(at(80)).toBeCloseTo(2 * half, 9);
    expect(exchanger.debugState?.().glowFrac).toBe(1);
    // A theme change re-colours the shared steel; the glowing plates follow it on the next frame.
    (ctx.materials.steel as THREE.MeshStandardMaterial).color.set('#123456');
    at(80);
    expect(glow.color.getHexString()).toBe('123456');
  });

  it('bubbles in the deaerator’s sight glass while milk flows, and hides them at no flow', () => {
    const { machines } = build();
    const deaerator = byId(machines, 'deaerator');
    const bubbles = node(deaerator, 'bubbles') as THREE.InstancedMesh;
    const snapshot = staticSnapshot();
    deaerator.update(snapshot, 0.05);
    const phase = deaerator.debugState?.().phase;
    deaerator.update(snapshot, 0.05);
    expect(bubbles.visible).toBe(true);
    expect(deaerator.debugState?.().phase).not.toBe(phase);
    const still = structuredClone(snapshot);
    still.line.deaerator.flowLph = 0;
    deaerator.update(still, 0.05);
    expect(bubbles.visible).toBe(false);
    const stopped = deaerator.debugState?.().phase;
    deaerator.update(still, 0.05);
    expect(deaerator.debugState?.().phase).toBe(stopped);
  });

  it('sets the homogenizer’s two gauge needles from stage1Bar and stage2Bar', () => {
    const { machines } = build();
    const homogenizer = byId(machines, 'homogenizer');
    const [needle1, needle2] = ['needle_1', 'needle_2'].map((name) => node(homogenizer, name));
    const snapshot = staticSnapshot();
    homogenizer.update(snapshot, 0.016);
    expect(needle1.rotation.y).toBeCloseTo(needleAngleRad(200, GAUGE_FULL_SCALE_BAR.stage1), 9);
    expect(needle2.rotation.y).toBeCloseTo(needleAngleRad(30, GAUGE_FULL_SCALE_BAR.stage2), 9);
    // A pressure loss drops the stage 1 needle, even while paused; stage 2 stays.
    const lost = structuredClone(snapshot);
    lost.paused = true;
    lost.stages[3].values.stage1Bar = 100;
    homogenizer.update(lost, 0.016);
    expect(needle1.rotation.y).toBeCloseTo(needleAngleRad(100, GAUGE_FULL_SCALE_BAR.stage1), 9);
    expect(needle1.rotation.y).toBeGreaterThan(needleAngleRad(200, GAUGE_FULL_SCALE_BAR.stage1));
    expect(needle2.rotation.y).toBeCloseTo(needleAngleRad(30, GAUGE_FULL_SCALE_BAR.stage2), 9);
    // A missing value leaves the needle where it was.
    delete lost.stages[3].values.stage1Bar;
    homogenizer.update(lost, 0.016);
    expect(needle1.rotation.y).toBeCloseTo(needleAngleRad(100, GAUGE_FULL_SCALE_BAR.stage1), 9);
  });

  it('puffs steam at the injector while heating milk (producing or diverting), and none in a clean', () => {
    const { machines } = build();
    const injector = byId(machines, 'steam-injector');
    const steam = node(injector, 'steam') as THREE.InstancedMesh;
    const snapshot = staticSnapshot();
    injector.update(snapshot, 0.05);
    expect(steam.visible).toBe(true);
    expect(injector.debugState?.().steamFrac).toBe(1);
    // Paused, the puffs hold still.
    const phase = injector.debugState?.().phase;
    injector.update({ ...snapshot, paused: true }, 0.05);
    expect(injector.debugState?.().phase).toBe(phase);
    const diverting = structuredClone(snapshot);
    diverting.liquid.uhtMode = 'divert';
    injector.update(diverting, 0.05);
    expect(steam.visible, 'divert').toBe(true);
    for (const mode of ['cip', 'sterilize', 'aic'] as const) {
      const other = structuredClone(snapshot);
      other.liquid.uhtMode = mode;
      injector.update(other, 0.05);
      expect(steam.visible, mode).toBe(false);
    }
  });

  it('never steps the steam or bubbles by half their copy spacing, so a slow frame at ×10,000 neither freezes nor reverses them', () => {
    const { machines } = build();
    const snapshot = { ...staticSnapshot(), speed: 10_000 as const };
    for (const [id, name] of [
      ['steam-injector', 'steam'],
      ['deaerator', 'bubbles'],
    ] as const) {
      const machine = byId(machines, id);
      const spacing = 1 / (node(machine, name) as THREE.InstancedMesh).count;
      // 0.1 s is the longest frame main.ts passes on (10 fps or slower).
      for (const frameS of [0.1, 1 / 15, 0.05]) {
        machine.update(snapshot, frameS);
        const before = Number(machine.debugState?.().phase);
        machine.update(snapshot, frameS);
        const stepFrac = (Number(machine.debugState?.().phase) - before + 1) % 1;
        expect(stepFrac, `${name} at ${frameS} s frames`).toBeGreaterThan(0);
        expect(stepFrac, `${name} at ${frameS} s frames`).toBeLessThan(spacing / 2);
      }
    }
  });

  it('sizes the flash vessel’s vapour from waterRemovedLph, or the flow without it', () => {
    const { machines } = build();
    const vessel = byId(machines, 'flash-vessel');
    const vapour = node(vessel, 'vapour') as THREE.InstancedMesh;
    const snapshot = staticSnapshot();
    snapshot.stages[5].values.waterRemovedLph = VAPOUR_FULL_LPH / 2;
    vessel.update(snapshot, 0.05);
    expect(vessel.debugState?.().vapourFrac).toBeCloseTo(0.5, 9);
    expect(vapour.visible).toBe(true);
    delete snapshot.stages[5].values.waterRemovedLph;
    vessel.update(snapshot, 0.05);
    expect(vessel.debugState?.().vapourFrac).toBe(1);
    snapshot.line.flashVessel.flowLph = 0;
    vessel.update(snapshot, 0.05);
    expect(vapour.visible).toBe(false);
  });

  it('flips the divert valve and lights its lamp red while diverting, amber while cleaning, green in production', () => {
    const { machines } = build();
    const valve = byId(machines, 'divert-valve');
    const flag = node(valve, 'flag');
    const lamp = node(valve, 'lamp') as THREE.Mesh;
    const lampHex = (): number => (lamp.material as THREE.MeshStandardMaterial).emissive.getHex();
    const inMode = (mode: Snapshot['liquid']['uhtMode']): Snapshot => {
      const snapshot = staticSnapshot();
      snapshot.liquid.uhtMode = mode;
      return snapshot;
    };
    valve.update(inMode('production'), 0.016);
    expect(lampHex()).toBe(LAMP_GLOW_HEX.ok);
    expect(valve.labelText(inMode('production'))).toBe('forward');

    // Paused or not, the flip and the lamp follow the mode.
    const diverting = { ...inMode('divert'), paused: true };
    for (let i = 0; i < 60; i++) valve.update(diverting, 0.05);
    expect(flag.rotation.y).toBeCloseTo(-Math.PI / 2, 2);
    expect(lampHex()).toBe(LAMP_GLOW_HEX.bad);
    expect(valve.debugState?.()).toMatchObject({ diverting: true, lamp: 'bad' });
    expect(valve.labelText(diverting)).toBe('diverting');

    for (const mode of ['cip', 'sterilize', 'aic'] as const) {
      for (let i = 0; i < 60; i++) valve.update(inMode(mode), 0.05);
      expect(flag.rotation.y, mode).toBeCloseTo(0, 2);
      expect(lampHex(), mode).toBe(LAMP_GLOW_HEX.warn);
      expect(valve.debugState?.(), mode).toMatchObject({ diverting: false, lamp: 'warn' });
    }
    expect(valve.labelText(inMode('cip'))).toBe('cleaning');
    expect(valve.labelText(inMode('sterilize'))).toBe('sterilizing');
    expect(valve.labelText(inMode('aic'))).toBe('intermediate clean');

    valve.update(inMode('production'), 0.016);
    expect(lampHex()).toBe(LAMP_GLOW_HEX.ok);
  });

  it('disposes its own geometry, materials and instance buffers, never the shared materials', () => {
    const { ctx, machines } = build();
    let sharedDisposed = 0;
    for (const material of Object.values(ctx.materials)) material.addEventListener('dispose', () => sharedDisposed++);
    const geometries = new Set<THREE.BufferGeometry>();
    const own = new Set<THREE.Material>();
    const instanced = new Set<THREE.InstancedMesh>();
    const shared = new Set<THREE.Material>(Object.values(ctx.materials));
    for (const machine of machines) {
      for (const mesh of meshesOf(machine.object)) {
        geometries.add(mesh.geometry);
        for (const material of [mesh.material].flat()) if (!shared.has(material)) own.add(material);
        if (mesh instanceof THREE.InstancedMesh) instanced.add(mesh);
      }
    }
    expect(instanced.size, 'the heat exchanger’s plates are instanced').toBeGreaterThan(0);
    const disposed = new Set<THREE.EventDispatcher<object>>();
    for (const item of [...geometries, ...own]) item.addEventListener('dispose', () => disposed.add(item));
    for (const mesh of instanced) mesh.addEventListener('dispose', () => disposed.add(mesh));

    machines.slice(0, -1).forEach((machine) => machine.dispose());
    // The unit shapes and the kit's materials stay while one machine still uses them. The heat exchanger's
    // glowing plates are its alone, and go with it.
    expect([...own].some((material) => material.name !== 'plate-glow' && disposed.has(material))).toBe(false);
    machines.at(-1)?.dispose();
    machines.forEach((machine) => machine.dispose()); // a second dispose() is harmless

    expect(sharedDisposed).toBe(0);
    for (const item of [...geometries, ...own]) expect(disposed.has(item)).toBe(true);
    // An instanced mesh's dispose() frees its instance matrices on the GPU.
    for (const mesh of instanced) expect(disposed.has(mesh), mesh.name).toBe(true);
  });
});
