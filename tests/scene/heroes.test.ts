// The hero models (src/scene/equipment/heroes.ts), on by default since phase 5: with the flag off (?greybox)
// nothing loads and the grey boxes stay; with it on, each hero machine takes its model into its root, hides the grey parts the model
// replaces, keeps the ones it leaves out, and drives the model's moving nodes with the same writes.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { HERO_MODELS } from '../../src/scene/equipment/heroes';
import { liquidLine } from '../../src/scene/equipment/liquidLine';
import { packsLine } from '../../src/scene/equipment/packsLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

const NAMES: readonly MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];

/** The moving nodes of each model (assets/hero-specs.md), at the grey nodes' rest transforms. */
const MODEL_NODES: Record<string, readonly string[]> = {
  [HERO_MODELS.separator]: ['bowl'],
  [HERO_MODELS.homogenizer]: ['piston_1', 'piston_2', 'piston_3'],
  [HERO_MODELS.filler]: ['reel', 'jaws'],
  [HERO_MODELS.palletizer]: ['arm'],
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
    node.add(new THREE.Mesh(box, new THREE.MeshStandardMaterial()));
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

const HERO_IDS = ['separator', 'homogenizer', 'filler-a', 'filler-b', 'palletizer'] as const;

function build(ctx: EquipmentContext): Map<string, Equipment> {
  return new Map([...liquidLine(ctx), ...packsLine(ctx)].map((item) => [item.id, item]));
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
      palletizer: ['stack', 'palletizer-wood'],
    };
    for (const id of HERO_IDS) {
      const item = machines.get(id) as Equipment;
      const hero = heroOf(item);
      expect(hero, id).toBeDefined();
      expect(hero?.parent, id).toBe(item.object);
      const shown = item.object.children.filter((child) => child.visible && child !== hero).map((child) => child.name);
      expect(shown.sort(), `${id}: grey parts still shown`).toEqual([...(kept[id] ?? [])].sort());
      expect(hero?.scale.z, `${id}: mirrored along z`).toBe(id === 'filler-b' ? -1 : 1);
    }
  });

  it('casts shadows from the model, except from the filler’s glass', async () => {
    const machines = build(makeContext(true));
    await loaded();
    for (const id of HERO_IDS) {
      heroOf(machines.get(id) as Equipment)?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
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
      arm: node('palletizer', 'arm').rotation.y,
    };
    for (const id of HERO_IDS) (machines.get(id) as Equipment).update(snap, 0.2);
    expect(node('separator', 'bowl').rotation.y).not.toBe(before.bowl);
    expect(node('homogenizer', 'piston_1').position.z).not.toBe(before.piston);
    expect(node('filler-a', 'reel').rotation.z).not.toBe(before.reelA);
    expect(node('filler-b', 'reel').rotation.z).not.toBe(before.reelB);
    expect(node('filler-a', 'jaws').position.y).toBeLessThan(before.jaws);
    expect(node('palletizer', 'arm').rotation.y).not.toBe(before.arm);
    // The debug hook reads the driven nodes too.
    expect((machines.get('separator') as Equipment).debugState?.().angleRad).toBe(node('separator', 'bowl').rotation.y);
  });

  it('starts each model node where the grey node stood, so nothing jumps at the swap', async () => {
    const ctx = makeContext(true);
    const machines = build(ctx);
    const grey = (id: string, name: string) => (machines.get(id) as Equipment).object.getObjectByName(name) as THREE.Object3D;
    const armRad = grey('palletizer', 'arm').rotation.y;
    const pistonZ = grey('homogenizer', 'piston_2').position.z;
    await loaded();
    const hero = (id: string, name: string) => heroOf(machines.get(id) as Equipment)?.getObjectByName(name) as THREE.Object3D;
    expect(hero('palletizer', 'arm').rotation.y).toBe(armRad);
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
