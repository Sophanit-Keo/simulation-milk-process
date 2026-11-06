// The hero models (src/scene/equipment/heroes.ts), on by default since phase 5: with the flag off (?greybox)
// nothing loads and the grey boxes stay; with it on, each hero machine takes its model into its root, hides the grey parts the model
// replaces, keeps the ones it leaves out, and drives the model's moving nodes with the same writes.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { HERO_MODELS } from '../../src/scene/equipment/heroes';
import { liquidLine } from '../../src/scene/equipment/liquidLine';
import { packsLine } from '../../src/scene/equipment/packsLine';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

const NAMES: readonly MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];

/** The moving nodes of each model (assets/hero-specs.md), at the grey nodes' rest transforms. */
const MODEL_NODES: Record<string, readonly string[]> = {
  [HERO_MODELS.separator]: ['bowl'],
  [HERO_MODELS.homogenizer]: ['piston_1', 'piston_2', 'piston_3'],
  [HERO_MODELS.filler]: ['reel', 'jaws'],
  [HERO_MODELS.palletizer]: ['arm', 'arm_trolley', 'arm_lift', 'arm_wrist', 'arm_clamp_1', 'arm_clamp_2'],
  [HERO_MODELS.stretchWrapper]: ['turntable', 'carriage'],
  // The yogurt wing's (phase 20).
  [HERO_MODELS.p8Filler]: ['carrier', 'uv_tunnel', 'pistons', 'foil_pick', 'seal_heads', 'hood'],
  [HERO_MODELS.fermentTank]: ['agitator', 'ph_probe'],
};

/** A stand-in model: a static body, each moving node with a mesh in it, and glass on the filler. */
function fakeModel(path: string, without: readonly string[] = []): THREE.Object3D {
  const scene = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  scene.add(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ name: 'paint' })));
  if (path === HERO_MODELS.filler) scene.add(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ name: 'glass', transparent: true })));
  for (const name of MODEL_NODES[path] ?? []) {
    if (without.includes(name)) continue;
    const node = new THREE.Group();
    node.name = name;
    node.add(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ transparent: name === 'hood' })));
    scene.add(node);
  }
  return scene;
}

function makeContext(heroModels: boolean, without: readonly string[] = []): EquipmentContext & { requested: string[] } {
  const requested: string[] = [];
  return {
    materials: Object.fromEntries(NAMES.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
    requested,
    heroModels,
    loadModel(path) {
      requested.push(path);
      if (!path.startsWith('hero/')) return Promise.reject(new Error(`no model ${path} in unit tests`));
      return Promise.resolve(fakeModel(path, without));
    },
  };
}

const HERO_IDS = ['separator', 'homogenizer', 'filler-a', 'filler-b', 'palletizer', 'stretch-wrapper', 'p8-filler', 'ferment-tank-1', 'ferment-tank-2', 'ferment-tank-3'] as const;

/** What the scene hangs on a model's nodes: the palletizer's lift rod and the tray in its gripper (packsLine.ts). */
const RIDERS = new Set(['lift-rod', 'carried-tray']);

function build(ctx: EquipmentContext): Map<string, Equipment> {
  return new Map([...liquidLine(ctx), ...packsLine(ctx), ...yogurtLine(ctx)].map((item) => [item.id, item]));
}

/** Lets the loads' promises settle. */
const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));
const heroOf = (item: Equipment) => item.object.getObjectByName(`${item.object.name}-hero`);
const snapshot = (): Snapshot => createSim(plantConfig).snapshot();

afterEach(() => vi.restoreAllMocks());

describe('hero models (off with ?greybox)', () => {
  it('loads none without the flag: the grey boxes stay', async () => {
    const ctx = makeContext(false);
    const machines = build(ctx);
    await loaded();
    expect(ctx.requested.filter((path) => path.startsWith('hero/'))).toEqual([]);
    for (const id of HERO_IDS) expect(heroOf(machines.get(id) as Equipment), id).toBeUndefined();
  });

  it('puts each model in its machine, hides the grey parts and keeps what the model leaves out', async () => {
    const ctx = makeContext(true);
    const machines = build(ctx);
    await loaded();
    expect(new Set(ctx.requested.filter((path) => path.startsWith('hero/')))).toEqual(new Set(Object.values(HERO_MODELS)));
    const kept: Record<string, readonly string[]> = {
      homogenizer: ['needle_1', 'needle_2'],
      palletizer: ['stack', 'palletizer-wood', 'palletizer-marking'],
      // Line P8 keeps its UV glow and its HEPA lamp; each tank its gauge's level and its hold lamp (phase 20).
      'p8-filler': ['uvGlow', 'hepaLamp'],
      'ferment-tank-1': ['milk', 'heldLamp'],
      'ferment-tank-2': ['milk', 'heldLamp'],
      'ferment-tank-3': ['milk', 'heldLamp'],
    };
    for (const id of HERO_IDS) {
      const item = machines.get(id) as Equipment;
      const hero = heroOf(item);
      expect(hero, id).toBeDefined();
      expect(hero?.parent, id).toBe(item.object);
      // A lamp the scene shows only when it is lit counts as kept, shown or not.
      const shown = item.object.children.filter((child) => (child.visible || child.name === 'heldLamp') && child !== hero).map((child) => child.name);
      expect(shown.sort(), `${id}: grey parts still shown`).toEqual([...(kept[id] ?? [])].sort());
      expect(hero?.scale.z, `${id}: mirrored along z`).toBe(id === 'filler-b' ? -1 : 1);
    }
  });

  it('casts shadows from the model, except from the filler’s glass', async () => {
    const machines = build(makeContext(true));
    await loaded();
    for (const id of HERO_IDS) {
      heroOf(machines.get(id) as Equipment)?.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || RIDERS.has(object.name)) return;
        expect(object.castShadow, `${id} ${object.material.name}`).toBe(!object.material.transparent);
        expect(object.receiveShadow).toBe(true);
      });
    }
  });

  it('drives the model’s moving nodes as it drove the grey ones', async () => {
    const machines = build(makeContext(true));
    await loaded();
    const snap = snapshot();
    const node = (id: string, name: string) => heroOf(machines.get(id) as Equipment)?.getObjectByName(name) as THREE.Object3D;
    const before = {
      bowl: node('separator', 'bowl').rotation.y,
      piston: node('homogenizer', 'piston_1').position.z,
      reelA: node('filler-a', 'reel').rotation.z,
      reelB: node('filler-b', 'reel').rotation.z,
      jaws: node('filler-a', 'jaws').position.y,
      lift: node('palletizer', 'arm_lift').position.y,
    };
    for (const id of HERO_IDS) (machines.get(id) as Equipment).update(snap, 0.2);
    expect(node('separator', 'bowl').rotation.y).not.toBe(before.bowl);
    expect(node('homogenizer', 'piston_1').position.z).not.toBe(before.piston);
    expect(node('filler-a', 'reel').rotation.z).not.toBe(before.reelA);
    expect(node('filler-b', 'reel').rotation.z).not.toBe(before.reelB);
    expect(node('filler-a', 'jaws').position.y).toBeLessThan(before.jaws);
    // The palletizer starts parked over the pick point: its first move is the lift down to a tray.
    expect(node('palletizer', 'arm_lift').position.y).toBeLessThan(before.lift);
    // The debug hook reads the driven nodes too.
    expect((machines.get('separator') as Equipment).debugState?.().angleRad).toBe(node('separator', 'bowl').rotation.y);
  });

  it('drives Line P8’s stations, tints its hood while the cabin is under its limit, and lights a held tank’s lamp (phase 20)', async () => {
    const machines = build(makeContext(true));
    await loaded();
    const p8 = machines.get('p8-filler') as Equipment;
    const pistons = heroOf(p8)?.getObjectByName('pistons') as THREE.Object3D;
    const running = structuredClone(snapshot());
    Object.assign(running.yogurt.p8, { state: 'running', cyclesPerMin: 30, hepaPa: 25 });
    const heights: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      const snap = { ...running, timeS: running.timeS + frame * 0.1 };
      p8.update(snap, 0.1);
      heights.push(pistons.position.y);
    }
    // The model's pistons stroke as the grey ones did: down 0.12 m from the grey's rest, 1.39 m.
    expect(Math.max(...heights)).toBeCloseTo(1.39, 6);
    expect(Math.min(...heights)).toBeLessThan(1.39 - 0.05);
    expect(p8.debugState?.()).toMatchObject({ hero: true, hoodAlarm: false });
    const low = structuredClone(running);
    Object.assign(low.yogurt.p8, { state: 'stopped', stopReason: 'hepa', hepaPa: 5 });
    p8.update(low, 0.1);
    expect(p8.debugState?.()).toMatchObject({ lamp: 'bad', hoodAlarm: true });
    const tank = machines.get('ferment-tank-2') as Equipment;
    const held = structuredClone(snapshot());
    (held.yogurt.ferment.tanks[1] as { held?: boolean }).held = true;
    tank.update(held, 0.1);
    expect(tank.debugState?.()).toMatchObject({ held: true });
    expect(tank.object.getObjectByName('heldLamp')?.visible).toBe(true);
    tank.update(snapshot(), 0.1);
    expect(tank.object.getObjectByName('heldLamp')?.visible).toBe(false);
  });

  it('starts each model node where the grey node stood, so nothing jumps at the swap', async () => {
    const ctx = makeContext(true);
    const machines = build(ctx);
    const grey = (id: string, name: string) => (machines.get(id) as Equipment).object.getObjectByName(name) as THREE.Object3D;
    const armRad = grey('palletizer', 'arm').rotation.y;
    const liftAt = grey('palletizer', 'arm_lift').position.clone();
    const wristRad = grey('palletizer', 'arm_wrist').rotation.y;
    const pistonZ = grey('homogenizer', 'piston_2').position.z;
    await loaded();
    const hero = (id: string, name: string) => heroOf(machines.get(id) as Equipment)?.getObjectByName(name) as THREE.Object3D;
    expect(hero('palletizer', 'arm').rotation.y).toBe(armRad);
    expect(hero('palletizer', 'arm_lift').position.toArray()).toEqual(liftAt.toArray());
    expect(hero('palletizer', 'arm_wrist').rotation.y).toBe(wristRad);
    expect(hero('homogenizer', 'piston_2').position.z).toBe(pistonZ);
  });

  it('keeps the grey box, with a warning, for a model short of a moving node', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const machines = build(makeContext(true, ['jaws']));
    await loaded();
    expect(heroOf(machines.get('filler-a') as Equipment)).toBeUndefined();
    expect((machines.get('filler-a') as Equipment).object.children.every((child) => child.visible)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no node "jaws"'));
    // The other machines' models have all their nodes.
    expect(heroOf(machines.get('palletizer') as Equipment)).toBeDefined();
  });

  it('adds no model to a machine disposed before its model loads', async () => {
    const machines = build(makeContext(true));
    for (const item of machines.values()) item.dispose();
    await loaded();
    for (const id of HERO_IDS) expect(heroOf(machines.get(id) as Equipment), id).toBeUndefined();
  });
});
