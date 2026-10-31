// The factory floor's machines, belts and pipes (src/factory/scene/floor.ts, phase 10, D20), checked without
// WebGL: three.js objects work in Node. A machine per UHT and line where the layout puts it; lamps, belts and
// pipes that follow each line's status; the hero filler over its grey box; and everything freed on dispose.
// The main fixture is the real factory (tests/helpers/factory.ts).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorBays, layoutFactory, TOKEN_PITCH_M } from '../../src/factory/layout';
import { buildFloor, type Floor, type FloorState, type ReadColor } from '../../src/factory/scene/floor';
import type { FactoryView } from '../../src/factory/types';
import type { EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { LAMP_GLOW_HEX, type SceneColorVar } from '../../src/scene/theme';
import { factoryView, LINES, uhtLine, withLine } from '../helpers/factory';

const SHARED: readonly MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
const COLORS: Partial<Record<SceneColorVar, string>> = {
  '--t20': '#2aa0c0',
  '--clean-lye': '#7d5cc6',
  '--zone-proc': '#c1d3e2',
  '--zone-pack': '#d5d2c8',
  '--steel-dark': '#76858f',
};
const readColor: ReadColor = (name) => COLORS[name] ?? '#ffffff';
/** The dark control-room set (tokens.css, phase 11, D21), as far as the floor reads it. */
const DARK: Partial<Record<SceneColorVar, string>> = {
  ...COLORS,
  '--scene-bg': '#090e12',
  '--zone-proc': '#10263a',
  '--steel': '#7f8f9b',
  '--steel-dark': '#4b5862',
  '--accent': '#38bdf8',
  '--ok': '#22d37a',
  '--warn': '#f5b134',
  '--bad': '#ff5b4a',
  '--t80': '#ea8027',
  '--grid': 'rgba(56, 189, 248, 0.05)',
};
const LIGHT: Partial<Record<SceneColorVar, string>> = { ...COLORS, '--scene-bg': '#dde5ea', '--grid': 'rgba(19, 33, 43, 0.035)', '--ok': '#1f8f57' };

/** A hero filler with the nodes the swap needs, one mesh each, like the real GLB's. */
function heroFiller(): THREE.Object3D {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.56, 2.7), new THREE.MeshStandardMaterial({ name: 'aseptic_filler_paint' })));
  for (const name of ['reel', 'jaws']) {
    const node = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial());
    node.name = name;
    model.add(node);
  }
  return model;
}

type Context = EquipmentContext & { requested: string[] };

function makeContext(heroModels = false): Context {
  const materials = Object.fromEntries(SHARED.map((name) => [name, new THREE.MeshStandardMaterial({ name: `shared-${name}` })]));
  const requested: string[] = [];
  const hero = heroFiller();
  return {
    materials: materials as unknown as Record<MaterialName, THREE.Material>,
    heroModels,
    requested,
    loadModel(path) {
      requested.push(path);
      return path === 'hero/aseptic-filler.glb' ? Promise.resolve(hero.clone(true)) : Promise.reject(new Error(`no model ${path}`));
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function floorFor(view: FactoryView, ctx: Context = makeContext()): Floor {
  const floor = buildFloor(layoutFactory(view), ctx, readColor);
  floor.update(floorBays(view));
  return floor;
}

type MachineState = FloorState['machines'][number];
const machine = (floor: Floor, id: string): MachineState => {
  const found = floor.state().machines.find((one) => one.id === id);
  if (!found) throw new Error(`no machine ${id}`);
  return found;
};
const pipe = (floor: Floor, id: string): FloorState['pipes'][number] => {
  const found = floor.state().pipes.find((one) => one.id === id);
  if (!found) throw new Error(`no pipe ${id}`);
  return found;
};

/** The machines' ids by line name, from the layout: 'UHT-line 3' is 'line:1:1'. */
const LINE_IDS: Record<string, string> = {
  'UHT-line 1': 'line:0:0',
  'UHT-line 6': 'line:0:1',
  'UHT- line 2': 'line:1:0',
  'UHT-line 3': 'line:1:1',
  'UHT line 4': 'line:1:2',
  'UHT-line 7': 'line:2:0',
};

describe('the factory floor: a machine per UHT and line', () => {
  const view = factoryView();
  const floor = floorFor(view);

  it('builds the three UHTs and the six lines, named by place, and twelve pipes', () => {
    expect(floor.machines.map((one) => [one.id, one.kind])).toEqual([
      ['uht:0', 'uht'],
      ['uht:1', 'uht'],
      ['uht:2', 'uht'],
      ...Object.values(LINE_IDS)
        .sort()
        .map((id) => [id, 'line']),
    ]);
    for (const one of floor.machines) expect(one.object.parent).toBe(floor.root);
    expect(floor.state().pipes.map((one) => one.id)).toEqual(layoutFactory(view).bays.flatMap((bay) => bay.pipes.map((route) => route.id)));
  });

  it("stands each filler on its spot, at its model's size, facing its belt", () => {
    const layout = layoutFactory(view);
    for (const one of floor.machines.filter((candidate) => candidate.kind === 'line')) {
      const spot = layout.bays[one.bay].fillers[one.filler ?? -1];
      const filler = one.object.children[0];
      filler.updateWorldMatrix(true, true);
      // The grey box's cabinet, glass and reel, without the lamp above the roof.
      const box = new THREE.Box3();
      filler.traverse((node) => {
        if (node instanceof THREE.Mesh && !node.name.startsWith('lamp')) box.expandByObject(node);
      });
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      expect(Math.abs(centre.x - spot.centreM[0])).toBeLessThan(0.05);
      expect(Math.abs(centre.z - spot.centreM[2])).toBeLessThan(0.05);
      expect(size.x / spot.widthM).toBeCloseTo(1, 1);
      expect(size.z / spot.depthM).toBeCloseTo(1, 1);
      expect(box.max.z).toBeLessThanOrEqual(spot.belt.fromM[2] + 0.05);
    }
  });

  it('lights every lamp from the view: the factory running, every UHT producing with its plates aglow', () => {
    for (const one of floor.state().machines) expect(one.lamp).toBe('ok');
    expect(floor.state().machines.filter((one) => one.kind === 'uht').map((one) => one.glowing)).toEqual([true, true, true]);
  });

  it('runs every belt, full, at its line speed, and flows every pipe at what it carries', () => {
    const a3 = machine(floor, LINE_IDS['UHT-line 3']);
    expect(a3).toMatchObject({ belt: 'moving', tokens: 14 });
    expect(a3.beltMps).toBeCloseTo(1 / 3, 9);
    expect(machine(floor, LINE_IDS['UHT-line 1']).beltMps).toBeCloseTo(0.05, 9);
    expect(pipe(floor, 'uht:1')).toMatchObject({ flowLph: 5_550, cleaning: false, color: '#2aa0c0' });
    expect(pipe(floor, 'uht:1').stripeMps).toBeCloseTo(0.555, 9);
    expect(pipe(floor, 'line:0:0')).toMatchObject({ flowLph: 360, stripeMps: 0.08 });
  });
});

describe('the floor follows the lines', () => {
  it('moves the running belts, reels and pipes on each tick, a token pitch at most per quarter', () => {
    const floor = floorFor(factoryView());
    const before = machine(floor, LINE_IDS['UHT-line 3']).reelRad ?? NaN;
    floor.tick(0.3);
    const after = floor.state();
    expect(after.pipes.find((one) => one.id === 'uht:1')?.phaseM).toBeCloseTo(0.555 * 0.3, 9);
    const line = after.machines.find((one) => one.id === LINE_IDS['UHT-line 3']);
    expect(line?.reelRad).toBeCloseTo(before - 0.9 * 0.3, 9);
    // A long frame moves a belt no more than a quarter of its pitch, so its packs never seem to jump back.
    floor.tick(10);
    expect(pipe(floor, 'uht:1').phaseM).toBeLessThan(0.7);
    expect(machine(floor, LINE_IDS['UHT-line 3']).tokens).toBe(14);
  });

  it('stops a line that stops in Let Report: red lamp, packs standing, no flow; its UHT draws the rest', () => {
    const floor = floorFor(factoryView());
    const stopped = factoryView({ lines: withLine('UHT-line 3', { status: 'stopped' }) });
    floor.update(floorBays(stopped));
    const line = machine(floor, LINE_IDS['UHT-line 3']);
    expect(line).toMatchObject({ lamp: 'bad', belt: 'still', beltMps: 0, tokens: 14 });
    expect(pipe(floor, 'line:1:1')).toMatchObject({ flowLph: 0, stripeMps: 0 });
    expect(pipe(floor, 'uht:1').flowLph).toBe(3_150);
    const reel = line.reelRad;
    const phase = pipe(floor, 'line:1:1').phaseM;
    floor.tick(0.5);
    expect(machine(floor, LINE_IDS['UHT-line 3']).reelRad).toBe(reel);
    expect(pipe(floor, 'line:1:1').phaseM).toBe(phase);
  });

  it("empties a cleaning line's belt and colours its pipe, and the UHT's once all its lines clean", () => {
    const floor = floorFor(factoryView());
    const cip = factoryView({ lines: withLine('UHT-line 7', { status: 'cleaning', cip_until: '2026-10-29T09:10:00Z' }) });
    floor.update(floorBays(cip));
    expect(machine(floor, LINE_IDS['UHT-line 7'])).toMatchObject({ lamp: 'idle', belt: 'empty', tokens: 0 });
    expect(pipe(floor, 'line:2:0')).toMatchObject({ cleaning: true, color: '#7d5cc6', stripeMps: 0.5 });
    expect(pipe(floor, 'uht:2')).toMatchObject({ cleaning: true, color: '#7d5cc6' });
    expect(machine(floor, 'uht:2')).toMatchObject({ lamp: 'idle', glowing: false });
    // UHT 2 still produces: its pipe keeps the product's colour.
    expect(pipe(floor, 'uht:1').color).toBe('#2aa0c0');
  });

  it('refills a belt from its start once the line runs again', () => {
    const floor = floorFor(factoryView({ lines: withLine('UHT-line 3', { status: 'changeover' }) }));
    expect(machine(floor, LINE_IDS['UHT-line 3'])).toMatchObject({ lamp: 'warn', belt: 'empty', tokens: 0 });
    floor.update(floorBays(factoryView()));
    expect(machine(floor, LINE_IDS['UHT-line 3']).tokens).toBe(0);
    // 0.33 m/s: a token comes on at the belt's start every 1.5 s, one pitch, and the belt is full after 21 s.
    for (let i = 0; i < 20; i++) floor.tick(0.1);
    const early = machine(floor, LINE_IDS['UHT-line 3']).tokens ?? 0;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(4);
    for (let i = 0; i < 300; i++) floor.tick(0.1);
    expect(machine(floor, LINE_IDS['UHT-line 3']).tokens).toBe(Math.floor(7 / TOKEN_PITCH_M));
  });

  it('shows a line it no longer finds in the view as idle and empty', () => {
    const floor = floorFor(factoryView());
    floor.update([]);
    expect(machine(floor, LINE_IDS['UHT-line 3'])).toMatchObject({ lamp: 'idle', belt: 'empty', tokens: 0 });
    expect(pipe(floor, 'uht:1')).toMatchObject({ flowLph: 0, cleaning: false });
  });
});

describe('the bays the floor leaves out or adds', () => {
  it('builds the fillers of the lines no UHT claims, with no UHT machine and no pipe', () => {
    const view = factoryView({ lines: [...LINES, uhtLine('UHT line 8', 10, 'UHT 9', 'TBA/19', 7_500)] });
    const floor = floorFor(view);
    expect(floor.machines.filter((one) => one.bay === 3).map((one) => one.id)).toEqual(['line:3:0']);
    expect(floor.state().pipes.some((one) => one.id.endsWith(':3') || one.id.startsWith('line:3'))).toBe(false);
    expect(machine(floor, 'line:3:0')).toMatchObject({ lamp: 'ok', belt: 'moving' });
  });

  it('builds an empty floor for no UHT and no line', () => {
    const floor = floorFor(factoryView({ lines: [], settings: null }));
    expect(floor.machines).toEqual([]);
    expect(floor.root.children).toEqual([]);
    floor.tick(0.1);
    floor.dispose();
  });
});

describe('the hero filler', () => {
  it('stands in for the grey box once it loads, keeps the lamp, and its reel runs', async () => {
    const ctx = makeContext(true);
    const floor = floorFor(factoryView(), ctx);
    expect(ctx.requested).toEqual(Array(6).fill('hero/aseptic-filler.glb'));
    await settle();
    expect(floor.state().machines.filter((one) => one.kind === 'line').every((one) => one.hero)).toBe(true);
    const filler = floor.machines.find((one) => one.id === LINE_IDS['UHT-line 3'])?.object.children[0] as THREE.Object3D;
    const shown = filler.children.filter((child) => child.visible).map((child) => child.name);
    expect(shown).toEqual(['lamp-post', 'lamp', 'filler-hero']);
    const before = machine(floor, LINE_IDS['UHT-line 3']).reelRad ?? NaN;
    floor.tick(0.2);
    expect(machine(floor, LINE_IDS['UHT-line 3']).reelRad).toBeCloseTo(before - 0.18, 9);
  });

  it('is not put on a floor that has gone', async () => {
    const ctx = makeContext(true);
    const floor = floorFor(factoryView(), ctx);
    floor.dispose();
    await settle();
    expect(floor.state().machines.some((one) => one.hero)).toBe(false);
  });
});

describe('the floor in the scene', () => {
  it('stays within its draw budget: a dozen meshes a UHT and a dozen a line, and two more in the dark theme', () => {
    const draws = (colors: Partial<Record<SceneColorVar, string>>): number => {
      const view = factoryView();
      const floor = buildFloor(layoutFactory(view), makeContext(), (name) => colors[name] ?? '#ffffff');
      floor.update(floorBays(view));
      let count = 0;
      floor.root.traverseVisible((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.Points) count += 1;
      });
      return count;
    };
    // 3 UHTs × (skid 9 + tank 3) + 6 lines × (filler 9 + belt 3) + 12 pipes + the slabs: one mesh per
    // material and shadow setting per machine, and per moving part.
    const light = draws(LIGHT);
    expect(light).toBeLessThanOrEqual(3 * 12 + 6 * 12 + 12 + 1);
    // The dark theme adds the floor's grid and the lamps' halos, one draw each, and no shadow caster.
    expect(draws(DARK)).toBe(light + 2);
  });

  it('lights the control room in the dark theme, from the tokens, and puts it out in the light one', () => {
    const colors: Partial<Record<SceneColorVar, string>> = { ...DARK };
    const view = factoryView({
      lines: withLine('UHT-line 7', { status: 'cleaning', cip_until: '2026-10-29T09:10:00Z' }).map((line) =>
        line.name === 'UHT-line 3' ? { ...line, status: 'stopped' as const } : line,
      ),
    });
    const floor = buildFloor(layoutFactory(view), makeContext(), (name) => colors[name] ?? '#ffffff');
    floor.update(floorBays(view));
    const lampOf = (id: string): THREE.MeshStandardMaterial =>
      (floor.machines.find((one) => one.id === id)?.object.getObjectByName('lamp') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const hex = (color: THREE.Color): string => `#${color.getHexString()}`;
    const halos = floor.root.getObjectByName('lamp-halos') as THREE.Points;
    const grid = floor.root.getObjectByName('floor-grid') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const outlines = floor.root.getObjectByName('bay-outlines') as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    const pipeMaterial = (id: string): THREE.MeshStandardMaterial =>
      (floor.root.getObjectByName(`pipe:${id}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const beltOf = (id: string): THREE.MeshStandardMaterial =>
      (floor.machines.find((one) => one.id === id)?.object.getObjectByName('belt-rubber') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const litHalos = (): number => {
      const color = halos.geometry.getAttribute('color');
      let lit = 0;
      for (let i = 0; i < color.count; i++) if (color.getX(i) + color.getY(i) + color.getZ(i) > 0) lit += 1;
      return lit;
    };

    // Lamps in the board's lamp colours, giving them off; a halo round each lit one, none round UHT 3 and line 7.
    expect(hex(lampOf(LINE_IDS['UHT-line 1']).emissive)).toBe('#22d37a');
    expect(hex(lampOf(LINE_IDS['UHT-line 3']).color)).toBe('#ff5b4a');
    expect(hex(lampOf(LINE_IDS['UHT-line 7']).color)).toBe('#4b5862');
    expect(hex(lampOf(LINE_IDS['UHT-line 7']).emissive)).toBe('#000000');
    expect(halos.visible).toBe(true);
    expect(halos.geometry.getAttribute('color').count).toBe(9);
    expect(litHalos()).toBe(7);
    // The grid in the page grid's colour, the outlines in the accent's.
    expect(grid.visible).toBe(true);
    expect(`#${(grid.material.uniforms.uColor.value as THREE.Color).getHexString()}`).toBe('#38bdf8');
    expect(grid.material.uniforms.uMinor.value).toBeGreaterThan(0.05);
    expect(hex(outlines.material.color)).toBe('#38bdf8');
    // What runs gives off a little light: the flowing pipes more than the still ones, the running belts, not the stopped.
    expect(pipeMaterial('uht:1').emissiveIntensity).toBeGreaterThan(pipeMaterial('line:1:1').emissiveIntensity);
    expect(hex(pipeMaterial('uht:2').emissive)).toBe('#7d5cc6');
    expect(beltOf(LINE_IDS['UHT-line 1']).emissiveIntensity).toBeGreaterThan(0);
    expect(beltOf(LINE_IDS['UHT-line 3']).emissiveIntensity).toBe(0);

    // A line that runs again lights its lamp's halo.
    floor.update(floorBays(factoryView()));
    expect(litHalos()).toBe(9);

    // The light theme: the 3D plant's lamp colours, no halo, no grid, nothing aglow but the lamps and plates.
    Object.assign(colors, LIGHT);
    floor.applyTheme();
    expect(lampOf(LINE_IDS['UHT-line 1']).color.getHex()).toBe(new THREE.Color(LAMP_GLOW_HEX.ok).getHex());
    expect(halos.visible).toBe(false);
    expect(grid.visible).toBe(false);
    expect(hex(outlines.material.color)).toBe('#76858f');
    expect(pipeMaterial('uht:1').emissiveIntensity).toBe(0);
    expect(beltOf(LINE_IDS['UHT-line 1']).emissiveIntensity).toBe(0);
  });

  it('follows the theme: the slabs, outlines and pipes take the tokens again', () => {
    const view = factoryView();
    const colors: Partial<Record<SceneColorVar, string>> = { ...COLORS };
    const floor = buildFloor(layoutFactory(view), makeContext(), (name) => colors[name] ?? '#ffffff');
    floor.update(floorBays(view));
    colors['--zone-proc'] = '#1d3141';
    colors['--t20'] = '#00ff00';
    floor.applyTheme();
    const slabs = floor.root.getObjectByName('bay-slabs') as THREE.Mesh;
    const color = slabs.geometry.getAttribute('color');
    expect(`#${new THREE.Color(color.getX(0), color.getY(0), color.getZ(0)).getHexString()}`).toBe('#1d3141');
    expect(pipe(floor, 'uht:0').color).toBe('#00ff00');
  });

  it('frees what it made on dispose, never the shared materials, and leaves the scene', () => {
    const ctx = makeContext();
    const scene = new THREE.Scene();
    const floor = floorFor(factoryView(), ctx);
    scene.add(floor.root);
    const shared = new Set(Object.values(ctx.materials));
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    floor.root.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments || node instanceof THREE.Points) {
        geometries.add(node.geometry);
        for (const material of [node.material].flat()) if (!shared.has(material)) materials.add(material);
      }
    });
    const freed = new Set<object>();
    for (const thing of [...geometries, ...materials]) thing.addEventListener('dispose', () => freed.add(thing));
    const sharedFreed: THREE.Material[] = [];
    for (const material of shared) material.addEventListener('dispose', () => sharedFreed.push(material));

    floor.dispose();
    floor.dispose();
    expect(floor.root.parent).toBeNull();
    expect([...geometries].filter((geometry) => !freed.has(geometry))).toEqual([]);
    expect([...materials].filter((material) => !freed.has(material))).toEqual([]);
    expect(sharedFreed).toEqual([]);
  });
});
