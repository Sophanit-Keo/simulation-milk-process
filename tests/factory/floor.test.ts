// The factory floor's machines, belts and pipes (src/factory/scene/floor.ts, phase 10, D20), checked without
// WebGL: three.js objects work in Node. A machine per UHT and line where the layout puts it; lamps, belts and
// pipes that follow each line's status; the hero filler over its grey box; and everything freed on dispose.
// Phase 11 (D21) adds each line's story: the trouble markers and their colours, the CIP rings' shares, and the
// labels' words for how long a line has stood (scene/labelText.ts). The main fixture is the real factory
// (tests/helpers/factory.ts); the story's fields are set on its views directly.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorBays, layoutFactory, TOKEN_PITCH_M } from '../../src/factory/layout';
import { buildFloor, type Floor, type FloorOptions, type FloorState, type ReadColor } from '../../src/factory/scene/floor';
import { lineStatusText, lineTitleText } from '../../src/factory/scene/labelText';
import type { FactoryView, LineView } from '../../src/factory/types';
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

function floorFor(view: FactoryView, ctx: Context = makeContext(), options?: FloorOptions): Floor {
  const floor = buildFloor(layoutFactory(view), ctx, readColor, options);
  floor.update(floorBays(view));
  return floor;
}

/** The view with the named lines changed, as the model would give them: the story's fields set directly. */
function withLines(view: FactoryView, patches: Record<string, Partial<LineView>>): FactoryView {
  const patch = (line: LineView): LineView => ({ ...line, ...patches[line.name] });
  return { ...view, uhts: view.uhts.map((uht) => ({ ...uht, lines: uht.lines.map(patch) })), unassigned: view.unassigned.map(patch) };
}

/** A line cleaning with this share of its CIP done. */
const cleaning = (cipDoneFrac: number | null): Partial<LineView> => ({ status: 'cleaning', lamp: 'idle', statusText: 'CIP · 6 min left', cipDoneFrac });
/** A line with one open trouble of this severity. */
const troubled = (worstSev: number | null): Partial<LineView> => ({ openTroubles: 1, worstSev });

/** A line's part by its name in the scene graph: its 'trouble-marker', 'cip-ring' or 'lamp'. */
function partOf<T extends THREE.Object3D = THREE.Mesh>(floor: Floor, id: string, name: string): T {
  const part = floor.machines.find((one) => one.id === id)?.object.getObjectByName(name);
  if (!part) throw new Error(`no ${name} on ${id}`);
  return part as T;
}
type MarkerMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

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

describe("the trouble markers (D21)", () => {
  it('shows none while no line has an open trouble', () => {
    const floor = floorFor(factoryView());
    for (const id of Object.values(LINE_IDS)) {
      expect(machine(floor, id).trouble).toBeNull();
      expect(partOf(floor, id, 'trouble-marker').visible).toBe(false);
    }
  });

  it("lights a marker over each filler with open troubles: amber for low or medium, red for high or critical", () => {
    const view = factoryView({
      reports: [
        { id: 'r1', loc: 'UHT-line 3', sev: 3, status: 'open' },
        { id: 'r2', loc: 'UHT-line 3', sev: 0, status: 'action' },
        { id: 'r3', loc: 'UHT-line 1', sev: 1, status: 'verify' },
        { id: 'r4', loc: 'UHT- line 2', sev: 2, status: 'open' },
        { id: 'r5', loc: 'UHT-line 7', sev: 0, status: 'open' },
      ],
    });
    const floor = floorFor(view);
    const shown = { 'UHT-line 3': 3, 'UHT-line 1': 1, 'UHT- line 2': 2, 'UHT-line 7': 0 } as const;
    for (const [name, severity] of Object.entries(shown)) {
      expect(machine(floor, LINE_IDS[name]).trouble).toBe(severity);
      const marker = partOf<MarkerMesh>(floor, LINE_IDS[name], 'trouble-marker');
      expect(marker.visible).toBe(true);
      const glow = severity >= 2 ? LAMP_GLOW_HEX.bad : LAMP_GLOW_HEX.warn;
      expect(marker.material.emissive.getHex()).toBe(glow);
      expect(marker.material.color.getHex()).toBe(glow);
    }
    for (const name of ['UHT line 4', 'UHT-line 6']) {
      expect(machine(floor, LINE_IDS[name]).trouble).toBeNull();
      expect(partOf(floor, LINE_IDS[name], 'trouble-marker').visible).toBe(false);
    }

    // Line 3's high trouble closes: its low one keeps the marker, now amber. Then all close: no marker.
    floor.update(floorBays(withLines(view, { 'UHT-line 3': troubled(0) })));
    expect(machine(floor, LINE_IDS['UHT-line 3']).trouble).toBe(0);
    expect(partOf<MarkerMesh>(floor, LINE_IDS['UHT-line 3'], 'trouble-marker').material.emissive.getHex()).toBe(LAMP_GLOW_HEX.warn);
    floor.update(floorBays(factoryView()));
    expect(floor.state().machines.filter((one) => one.kind === 'line').map((one) => one.trouble)).toEqual(Array(6).fill(null));
    expect(partOf(floor, LINE_IDS['UHT-line 3'], 'trouble-marker').visible).toBe(false);
  });

  it('shows a severity out of range at its nearest end, and one that is not a number as the lowest', () => {
    const floor = floorFor(withLines(factoryView(), { 'UHT-line 3': troubled(7), 'UHT-line 1': troubled(-2), 'UHT-line 7': troubled(null), 'UHT-line 6': troubled(Number.NaN) }));
    expect(machine(floor, LINE_IDS['UHT-line 3']).trouble).toBe(3);
    expect(machine(floor, LINE_IDS['UHT-line 1']).trouble).toBe(0);
    expect(machine(floor, LINE_IDS['UHT-line 7']).trouble).toBe(0);
    expect(machine(floor, LINE_IDS['UHT-line 6']).trouble).toBe(0);
    // A worst severity with no open trouble shows none.
    floor.update(floorBays(withLines(factoryView(), { 'UHT-line 3': { openTroubles: 0, worstSev: 3 } })));
    expect(machine(floor, LINE_IDS['UHT-line 3']).trouble).toBeNull();
  });

  it("stands above the filler's roof beside its lamp, clear of the label's anchor at either end of its bob", () => {
    const view = factoryView();
    const layout = layoutFactory(view);
    const floor = floorFor(withLines(view, Object.fromEntries(Object.keys(LINE_IDS).map((name) => [name, troubled(1)]))));
    for (const one of floor.machines.filter((candidate) => candidate.kind === 'line')) {
      const spot = layout.bays[one.bay].fillers[one.filler ?? -1];
      const marker = partOf<MarkerMesh>(floor, one.id, 'trouble-marker');
      const lamp = partOf(floor, one.id, 'lamp');
      one.object.updateWorldMatrix(true, true);
      const lampM = lamp.getWorldPosition(new THREE.Vector3());
      const markerM = marker.getWorldPosition(new THREE.Vector3());
      // The diamond reaches its scale's height above and below its middle, and bobs 0.1 m either way.
      const halfHeightM = marker.scale.y;
      expect(markerM.y - halfHeightM - 0.1).toBeGreaterThan(spot.heightM);
      expect(markerM.y + halfHeightM + 0.1).toBeLessThan(spot.labelM[1]);
      expect(halfHeightM).toBeGreaterThan(0.15);
      // At the lamp's place along the filler, toward its outfeed and in front of the label's anchor, 0.5 m inboard.
      expect(markerM.z).toBeCloseTo(lampM.z, 6);
      expect(markerM.z).toBeGreaterThan(spot.labelM[2] + 0.5);
      expect(markerM.x - lampM.x).toBeCloseTo(0.5 * spot.scale, 6);
    }
  });

  it('bobs about ±0.1 m once a second, and holds still without motion', () => {
    let moving = true;
    const floor = floorFor(withLines(factoryView(), { 'UHT-line 3': troubled(3) }), makeContext(), { motion: () => moving });
    const marker = partOf(floor, LINE_IDS['UHT-line 3'], 'trouble-marker');
    const restM = marker.position.y;
    floor.tick(0.25);
    expect(marker.position.y).toBeCloseTo(restM + 0.1, 9);
    floor.tick(0.5);
    expect(marker.position.y).toBeCloseTo(restM - 0.1, 9);
    floor.tick(0.25);
    expect(marker.position.y).toBeCloseTo(restM, 9);
    floor.tick(0.25);
    expect(marker.position.y).toBeCloseTo(restM + 0.1, 9);
    // With reduced motion it comes to rest and stays there.
    moving = false;
    floor.tick(0.1);
    expect(marker.position.y).toBe(restM);
    floor.tick(0.3);
    expect(marker.position.y).toBe(restM);

    const still = floorFor(withLines(factoryView(), { 'UHT-line 3': troubled(3) }), makeContext(), { motion: () => false });
    const stillMarker = partOf(still, LINE_IDS['UHT-line 3'], 'trouble-marker');
    const stillRestM = stillMarker.position.y;
    for (let i = 0; i < 7; i++) still.tick(0.1);
    expect(stillMarker.position.y).toBe(stillRestM);
  });
});

describe('the CIP rings (D21)', () => {
  type RingMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const ring = (floor: Floor, name: string): RingMesh => partOf<RingMesh>(floor, LINE_IDS[name], 'cip-ring');

  it('shows none while no line cleans', () => {
    const floor = floorFor(factoryView());
    for (const name of Object.keys(LINE_IDS)) {
      expect(machine(floor, LINE_IDS[name]).cipRing).toBeNull();
      expect(ring(floor, name).visible).toBe(false);
    }
  });

  it("fills the ring round a cleaning filler with its CIP's share: none, a half, all of it", () => {
    const view = factoryView();
    const floor = floorFor(withLines(view, { 'UHT-line 7': cleaning(0) }));
    const mesh = ring(floor, 'UHT-line 7');
    const { geometry } = mesh;
    // The track's segments, then the fill's: the draw range is always one whole ring of segments.
    const ringVertices = geometry.getAttribute('position').count / 2;
    expect(ringVertices % 6).toBe(0);
    expect(mesh.visible).toBe(true);
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBe(0);
    expect(geometry.drawRange).toEqual({ start: 0, count: ringVertices });

    floor.update(floorBays(withLines(view, { 'UHT-line 7': cleaning(0.5) })));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBe(0.5);
    expect(geometry.drawRange).toEqual({ start: ringVertices / 2, count: ringVertices });

    floor.update(floorBays(withLines(view, { 'UHT-line 7': cleaning(1) })));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBe(1);
    expect(geometry.drawRange).toEqual({ start: ringVertices, count: ringVertices });
    // The same geometry throughout, only its draw range moved on.
    expect(ring(floor, 'UHT-line 7').geometry).toBe(geometry);

    // A share fills whole segments, rounded down, so the ring closes only once the CIP is done; past 1 is 1.
    floor.update(floorBays(withLines(view, { 'UHT-line 7': cleaning(0.999) })));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBeLessThan(1);
    // A share a hair under a whole segment in floating point (0.0999…98) still fills it.
    floor.update(floorBays(withLines(view, { 'UHT-line 7': cleaning(1 - 0.9) })));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBe(0.1);
    floor.update(floorBays(withLines(view, { 'UHT-line 7': cleaning(1.5) })));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBe(1);
  });

  it("draws the track faint and the fill in full, in the pipes' cleaning colour, facing up", () => {
    const floor = floorFor(withLines(factoryView(), { 'UHT-line 7': cleaning(0.25) }));
    const { geometry, material } = ring(floor, 'UHT-line 7');
    expect(`#${material.color.getHexString()}`).toBe(COLORS['--clean-lye']);
    expect(material.vertexColors).toBe(true);
    const colors = geometry.getAttribute('color');
    const half = colors.count / 2;
    expect(colors.itemSize).toBe(4);
    expect(colors.getW(0)).toBeGreaterThan(0.1);
    expect(colors.getW(0)).toBeLessThan(0.4);
    expect(colors.getW(half)).toBe(1);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 3) {
      const [a, b, c] = [i, i + 1, i + 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, k));
      expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
    }
  });

  it('rings the whole filler on the floor, and never meets the next filler or its ring', () => {
    const view = factoryView();
    const layout = layoutFactory(view);
    const floor = floorFor(view);
    for (const bay of layout.bays) {
      const extents = bay.fillers.map((spot, index) => {
        const mesh = partOf(floor, `line:${layout.bays.indexOf(bay)}:${index}`, 'cip-ring');
        const position = mesh.geometry.getAttribute('position');
        let reachXM = 0;
        // The inner edge's half widths, where it crosses the axes.
        let innerXM = Infinity;
        let innerZM = Infinity;
        for (let k = 0; k < position.count; k++) {
          const xM = position.getX(k);
          const zM = position.getZ(k);
          expect(Math.abs(xM) > spot.widthM / 2 || Math.abs(zM) > spot.depthM / 2).toBe(true);
          reachXM = Math.max(reachXM, Math.abs(xM));
          if (Math.abs(zM) < 1e-6) innerXM = Math.min(innerXM, Math.abs(xM));
          if (Math.abs(xM) < 1e-6) innerZM = Math.min(innerZM, Math.abs(zM));
        }
        // The footprint's corners lie inside the ring's inner edge.
        expect((spot.widthM / 2 / innerXM) ** 2 + (spot.depthM / 2 / innerZM) ** 2).toBeLessThan(1);
        expect(mesh.position.x).toBeCloseTo(spot.centreM[0], 9);
        expect(mesh.position.z).toBeCloseTo(spot.centreM[2], 9);
        expect(mesh.position.y).toBeGreaterThan(0.04); // above the slab
        return { xM: spot.centreM[0], reachXM };
      });
      for (let i = 1; i < extents.length; i++) {
        expect(extents[i - 1].xM + extents[i - 1].reachXM).toBeLessThan(extents[i].xM - extents[i].reachXM - 0.2);
      }
    }
  });

  it('hides the ring when the line is not cleaning, or cleans with no share', () => {
    const view = factoryView();
    const floor = floorFor(withLines(view, { 'UHT-line 7': cleaning(0.4), 'UHT-line 3': cleaning(null), 'UHT-line 1': { cipDoneFrac: 0.5 } }));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBeCloseTo(0.4, 9);
    expect(machine(floor, LINE_IDS['UHT-line 3']).cipRing).toBeNull();
    expect(ring(floor, 'UHT-line 3').visible).toBe(false);
    expect(machine(floor, LINE_IDS['UHT-line 1']).cipRing).toBeNull();
    expect(ring(floor, 'UHT-line 1').visible).toBe(false);
    // The CIP ends and the line runs again: its ring goes.
    floor.update(floorBays(view));
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBeNull();
    expect(ring(floor, 'UHT-line 7').visible).toBe(false);
  });

  it("fills from the model's own share of a CIP in Let Report's rows", () => {
    const view = factoryView({
      lines: withLine('UHT-line 7', { status: 'cleaning', cip_started_at: '2026-10-29T07:30:00Z', cip_until: '2026-10-29T08:30:00Z', cip_reason: 'standard' }),
    });
    const floor = floorFor(view);
    expect(machine(floor, LINE_IDS['UHT-line 7']).cipRing).toBe(0.5);
  });
});

describe("the labels' words for a line's story (D21)", () => {
  const line = (patch: Partial<LineView>): LineView => ({ ...factoryView().uhts[1].lines[1], ...patch });

  it('says how long a line has stood stopped, in maintenance or changing over, from a minute on', () => {
    expect(lineStatusText(line({ status: 'stopped', statusText: 'Stopped', statusForS: 0 }))).toBe('Stopped');
    expect(lineStatusText(line({ status: 'stopped', statusText: 'Stopped', statusForS: 59 }))).toBe('Stopped');
    expect(lineStatusText(line({ status: 'stopped', statusText: 'Stopped', statusForS: 60 }))).toBe('Stopped · 1 min 00 s');
    expect(lineStatusText(line({ status: 'stopped', statusText: 'Stopped', statusForS: 720 }))).toBe('Stopped · 12 min');
    expect(lineStatusText(line({ status: 'maintenance', statusText: 'Maintenance', statusForS: 3_900 }))).toBe('Maintenance · 1 h 05 min');
    expect(lineStatusText(line({ status: 'changeover', statusText: 'Changeover', statusForS: 245 }))).toBe('Changeover · 4 min 05 s');
    expect(lineStatusText(line({ status: 'stopped', statusText: 'Stopped', statusForS: null }))).toBe('Stopped');
  });

  it('gives a running, cleaning or idle line its status text as the board words it', () => {
    expect(lineStatusText(line({ status: 'running', statusText: 'Running', statusForS: 7_200 }))).toBe('Running');
    expect(lineStatusText(line({ status: 'cleaning', statusText: 'CIP · 1 h 10 min left', statusForS: 600 }))).toBe('CIP · 1 h 10 min left');
    expect(lineStatusText(line({ status: 'idle', statusText: 'Idle', statusForS: 600 }))).toBe('Idle');
  });

  it('adds the note and who changed the line to the tooltip, when there are any', () => {
    const words = 'UHT-line 3, A3/Speed · 24,000 packs/h · 100 ml: Stopped · 4 min 00 s, 1 open trouble · High';
    expect(lineTitleText(words, line({ note: 'Jaws not sealing', changedBy: 'Shift lead' }))).toBe(`${words}\nNote: Jaws not sealing\nChanged by Shift lead`);
    expect(lineTitleText(words, line({ note: '', changedBy: 'QA' }))).toBe(`${words}\nChanged by QA`);
    expect(lineTitleText(words, line({ note: 'Reel splice', changedBy: '' }))).toBe(`${words}\nNote: Reel splice`);
    expect(lineTitleText(words, line({ note: '', changedBy: '' }))).toBe(words);
  });
});

describe('the floor in the scene', () => {
  it('stays within its draw budget: a dozen meshes a UHT and fourteen a line, with every marker and ring shown', () => {
    const everything = Object.fromEntries(Object.keys(LINE_IDS).map((name) => [name, { ...cleaning(0.5), ...troubled(2) }]));
    const floor = floorFor(withLines(factoryView(), everything));
    let meshes = 0;
    floor.root.traverseVisible((node) => {
      if (node instanceof THREE.Mesh) meshes += 1;
    });
    // 3 UHTs × (skid 9 + tank 3) + 6 lines × (filler 9 + belt 3 + trouble marker 1 + CIP ring 1) + 12 pipes + the
    // slabs: one mesh per material and shadow setting per machine, and per moving part. A ring is one draw, its
    // track and fill together; a line without troubles or a CIP draws neither.
    expect(meshes).toBeLessThanOrEqual(3 * 12 + 6 * 14 + 12 + 1);
    expect(floor.state().machines.filter((one) => one.kind === 'line').every((one) => one.trouble === 2 && one.cipRing === 0.5)).toBe(true);
  });

  it('follows the theme: the slabs, outlines and pipes take the tokens again', () => {
    const view = factoryView();
    const colors: Partial<Record<SceneColorVar, string>> = { ...COLORS };
    const floor = buildFloor(layoutFactory(view), makeContext(), (name) => colors[name] ?? '#ffffff');
    floor.update(floorBays(view));
    colors['--zone-proc'] = '#1d3141';
    colors['--t20'] = '#00ff00';
    colors['--clean-lye'] = '#ff00ff';
    floor.applyTheme();
    const slabs = floor.root.getObjectByName('bay-slabs') as THREE.Mesh;
    const color = slabs.geometry.getAttribute('color');
    expect(`#${new THREE.Color(color.getX(0), color.getY(0), color.getZ(0)).getHexString()}`).toBe('#1d3141');
    expect(pipe(floor, 'uht:0').color).toBe('#00ff00');
    const ring = partOf<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(floor, LINE_IDS['UHT-line 7'], 'cip-ring');
    expect(`#${ring.material.color.getHexString()}`).toBe('#ff00ff');
  });

  it('frees what it made on dispose, its markers and rings too, never the shared materials, and leaves the scene', () => {
    const ctx = makeContext();
    const scene = new THREE.Scene();
    // A marker of each colour and a ring shown, so every material the floor made is on a mesh.
    const floor = floorFor(withLines(factoryView(), { 'UHT-line 3': troubled(3), 'UHT-line 1': troubled(0), 'UHT-line 7': cleaning(0.5) }), ctx);
    scene.add(floor.root);
    const shared = new Set(Object.values(ctx.materials));
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    floor.root.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
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
