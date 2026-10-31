import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createQuarantineBlocks } from '../../src/scene/equipment/packs/quarantineBlocks';
import { liquidLine } from '../../src/scene/equipment/liquidLine';
import { packsLine } from '../../src/scene/equipment/packsLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { utilities } from '../../src/scene/equipment/utilities';
import { createFloorGrid } from '../../src/scene/floorGrid';
import { DARK_LAMP_BODY_HEX, DARK_LAMP_GLOW, createLampPalette } from '../../src/scene/lamps';
import { createPipes } from '../../src/scene/pipes';
import { LAMP_GLOW_HEX, readSceneRgba, sceneIsDark } from '../../src/scene/theme';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

// The control-room look of the 3D view (phase 11, D21): in the dark theme the lamps glow in the theme's lamp colours,
// the floor carries a fine grid and its margin fades into the room, and the milk in the pipes lights itself a little.
// The light theme keeps the plant as it was. Checked on tokens.css's two colour sets, without WebGL or a DOM.

afterEach(() => vi.unstubAllGlobals());

const TOKENS_CSS = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const start = TOKENS_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
  const body = TOKENS_CSS.slice(start + selector.length + 2, TOKENS_CSS.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const LIGHT = block(':root');
const DARK = { ...LIGHT, ...block(':root[data-theme="dark"]') };

/** The page in a theme: its tokens as getComputedStyle gives them; change the record to switch theme. */
const showTheme = (theme: Record<string, string>): Record<string, string> => stubTheme({ ...theme });
const switchTo = (page: Record<string, string>, theme: Record<string, string>): void => void Object.assign(page, theme);

const hex = (value: string): number => new THREE.Color(value).getHex();

/** The host's shared set (equipmentHost.ts); a module's own materials, such as the liquid line's lamp, are not in it. */
const SHARED_NAMES: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
const context = (): EquipmentContext => ({
  materials: Object.fromEntries(SHARED_NAMES.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
  loadModel: () => Promise.reject(new Error('no models in unit tests')),
});

function machine(machines: Equipment[], id: string): Equipment {
  const found = machines.find((each) => each.id === id);
  if (!found) throw new Error(`no machine ${id}`);
  return found;
}

function material(item: Equipment, name: string): THREE.MeshStandardMaterial {
  const mesh = item.object.getObjectByName(name);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`${item.id} has no mesh ${name}`);
  return mesh.material as THREE.MeshStandardMaterial;
}

const staticSnapshot = (): Snapshot => createSim(plantConfig).snapshot();

describe('the theme the scene shows', () => {
  it('is dark when the scene background is', () => {
    showTheme(DARK);
    expect(sceneIsDark()).toBe(true);
    showTheme(LIGHT);
    expect(sceneIsDark()).toBe(false);
    // Before tokens.css loads: the light fallbacks.
    stubTheme();
    expect(sceneIsDark()).toBe(false);
  });

  it('reads a colour token with its alpha', () => {
    const color = new THREE.Color();
    stubTheme({ '--grid': 'rgba(56, 189, 248, 0.05)' });
    expect(readSceneRgba('--grid', color)).toBeCloseTo(0.05, 9);
    expect(color.getHex()).toBe(0x38bdf8);
    stubTheme({ '--grid': '#38bdf8' });
    expect(readSceneRgba('--grid', color)).toBe(1);
    expect(color.getHex()).toBe(0x38bdf8);
  });
});

describe('lamp palettes', () => {
  it('start in the light colours without a page, and follow the theme', () => {
    const palette = createLampPalette(LAMP_GLOW_HEX, { ok: '--ok', warn: '--warn', bad: '--bad' });
    expect(palette.dark).toBe(false);
    expect(palette.color('bad').getHex()).toBe(LAMP_GLOW_HEX.bad);
    const page = showTheme(DARK);
    palette.applyTheme();
    expect(palette.dark).toBe(true);
    for (const status of ['ok', 'warn', 'bad'] as const) expect(palette.color(status).getHex(), status).toBe(hex(DARK[`--${status}`]));
    switchTo(page, LIGHT);
    palette.applyTheme();
    expect(palette.dark).toBe(false);
    expect(palette.color('ok').getHex()).toBe(LAMP_GLOW_HEX.ok);
  });
});

describe('the 3D lamps in the dark theme', () => {
  it('light the divert valve’s lamp in the dark lamp colours, glowing, and as before in the light theme', () => {
    const page = showTheme(DARK);
    const valve = machine(liquidLine(context()), 'divert-valve');
    const lamp = material(valve, 'lamp');
    valve.applyTheme?.();
    const snapshot = staticSnapshot();
    snapshot.liquid.uhtMode = 'divert';
    valve.update(snapshot, 0.016);
    expect(lamp.emissive.getHex()).toBe(hex(DARK['--bad']));
    expect(lamp.emissiveIntensity).toBe(DARK_LAMP_GLOW);
    expect(lamp.color.getHex()).toBe(DARK_LAMP_BODY_HEX);
    switchTo(page, LIGHT);
    valve.applyTheme?.();
    expect(lamp.emissive.getHex()).toBe(LAMP_GLOW_HEX.bad);
    expect(lamp.emissiveIntensity).toBe(1);
    valve.dispose();
  });

  it('light the QA lab’s incubator lamps on a black body in the dark theme; idle stays unlit', () => {
    const page = showTheme(DARK);
    const lab = machine(packsLine(context()), 'qa-lab');
    lab.applyTheme?.();
    const lamps = lab.object.getObjectByName('lamps') as THREE.InstancedMesh;
    const lampMaterial = lamps.material as THREE.MeshStandardMaterial;
    const snapshot = staticSnapshot();
    for (const status of ['ok', 'warn', 'bad'] as const) {
      snapshot.stages[9].status = status;
      lab.update(snapshot, 0.016);
      expect(lampMaterial.emissive.getHex(), status).toBe(hex(DARK[`--${status}`]));
      expect(lampMaterial.emissiveIntensity, status).toBe(DARK_LAMP_GLOW);
      expect(lampMaterial.color.getHex(), status).toBe(DARK_LAMP_BODY_HEX);
    }
    snapshot.stages[9].status = 'idle';
    lab.update(snapshot, 0.016);
    expect(lampMaterial.emissiveIntensity).toBe(0);
    expect(lampMaterial.color.getHex()).toBe(hex(DARK['--steel-dark']));
    // Back to light: the light tokens, as the lamp was.
    switchTo(page, LIGHT);
    snapshot.stages[9].status = 'warn';
    lab.update(snapshot, 0.016);
    lab.applyTheme?.();
    expect(lampMaterial.color.getHex()).toBe(hex(LIGHT['--warn']));
    expect(lampMaterial.emissiveIntensity).toBeLessThan(1);
    lab.dispose();
  });

  it('glow the CIP station’s lit lamp harder on black glass in the dark theme', () => {
    const page = showTheme(DARK);
    const station = machine(utilities(context()), 'cip-station');
    station.applyTheme?.();
    const base = staticSnapshot();
    const lye = { program: 'cip', step: 'lye', fluid: 'lye', stepIndex: 1, stepCount: 6, stepRemainingS: 600, tempC: 75, flowLph: 24_000 } as const;
    station.update({ ...base, liquid: { ...base.liquid, cleaning: lye } }, 0.016);
    expect(material(station, 'cip-station-lamp-lye').emissiveIntensity).toBe(DARK_LAMP_GLOW);
    expect(material(station, 'cip-station-lamp-lye').color.getHex()).toBe(DARK_LAMP_BODY_HEX);
    expect(material(station, 'cip-station-lamp-acid').emissiveIntensity).toBe(0);
    switchTo(page, LIGHT);
    station.applyTheme?.();
    const lit = material(station, 'cip-station-lamp-lye').emissiveIntensity;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(DARK_LAMP_GLOW);
    station.dispose();
  });

  it('colour the quarantine’s block lamps in the dark lamp colours, and its mark in the accent', () => {
    const page = showTheme(DARK);
    const blocks = createQuarantineBlocks(new THREE.BoxGeometry(), new THREE.SphereGeometry(), new THREE.MeshStandardMaterial());
    blocks.update([{ id: 1, filler: 'a', status: 'hold', pallets: 30, releaseAtS: 0, flags: [] } as unknown as Snapshot['packs']['batches'][number]]);
    const lampColor = (): number => new THREE.Color().fromBufferAttribute(blocks.lamps.instanceColor as THREE.BufferAttribute, 0).getHex();
    expect(lampColor(), 'light until the theme is read').toBe(hex(LIGHT['--warn']));
    blocks.applyTheme();
    expect(lampColor()).toBe(hex(DARK['--warn']));
    expect((blocks.mark.material as THREE.MeshStandardMaterial).color.getHex()).toBe(hex(DARK['--accent']));
    switchTo(page, LIGHT);
    blocks.applyTheme();
    expect(lampColor()).toBe(hex(LIGHT['--warn']));
    expect((blocks.mark.material as THREE.MeshStandardMaterial).color.getHex()).toBe(hex(LIGHT['--accent']));
    blocks.dispose();
  });
});

describe('the pipes in the dark theme', () => {
  it('light the milk a little in its own colour, and the divert route in the dark --bad', () => {
    const page = showTheme(LIGHT);
    const scene = new THREE.Scene();
    const pipes = createPipes(scene, new THREE.MeshStandardMaterial());
    const milk = (scene.getObjectByName('pipe-holding-tube') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const divert = [...scene.children].find((child) => child instanceof THREE.Mesh && (child.material as THREE.Material).name === 'milk-pipe-divert') as THREE.Mesh;
    const shader = { ...THREE.ShaderLib.standard, uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
    milk.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += diffuseColor.rgb * pipeGlow;');
    expect(shader.uniforms.pipeGlow.value).toBe(0);
    switchTo(page, DARK);
    pipes.applyTheme();
    expect(shader.uniforms.pipeGlow.value).toBeGreaterThan(0);
    expect((divert.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(hex(DARK['--bad']));
    switchTo(page, LIGHT);
    pipes.applyTheme();
    expect(shader.uniforms.pipeGlow.value).toBe(0);
    expect((divert.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(LAMP_GLOW_HEX.bad);
    pipes.dispose();
  });
});

describe('the floor grid', () => {
  /** The standard material's shaders as three.js hands them to onBeforeCompile. */
  function compile(material: THREE.MeshStandardMaterial): THREE.WebGLProgramParametersWithUniforms {
    const shader = { ...THREE.ShaderLib.standard, uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
    return shader;
  }

  it('draws in the floor’s and the slabs’ own shaders, the margin’s fade on the floor only', () => {
    const grid = createFloorGrid();
    const floor = new THREE.MeshStandardMaterial();
    const slabs = new THREE.MeshStandardMaterial({ vertexColors: true });
    grid.add(floor, { fadeEdges: true });
    grid.add(slabs);
    const floorShader = compile(floor);
    const slabShader = compile(slabs);
    for (const shader of [floorShader, slabShader]) {
      // Every hook found its chunk: a three.js upgrade that renames one would leave the grid out silently.
      expect(shader.vertexShader).toContain('vFloorGridM = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix( diffuseColor.rgb, floorGridColor');
      expect(shader.uniforms.floorGridStrength).toBeDefined();
    }
    expect(floorShader.fragmentShader).toContain('outgoingLight = mix( outgoingLight, floorFadeColor');
    expect(slabShader.fragmentShader).not.toContain('floorFadeColor, floorEdgeFade');
    // Two programs, not one: the floor's has the fade.
    expect(floor.customProgramCacheKey()).not.toBe(slabs.customProgramCacheKey());
  });

  it('shows a faint grid and fades the margin in the dark theme only, in --grid’s colour', () => {
    const grid = createFloorGrid();
    const floor = new THREE.MeshStandardMaterial();
    grid.add(floor, { fadeEdges: true });
    const shader = compile(floor);
    const page = showTheme(DARK);
    grid.applyTheme();
    const { strength, edgeFade } = grid.state();
    expect(strength).toBeGreaterThan(0);
    expect(strength, 'low contrast').toBeLessThanOrEqual(0.1);
    expect(edgeFade).toBe(1);
    const gridColor = new THREE.Color();
    readSceneRgba('--grid', gridColor);
    expect((shader.uniforms.floorGridColor.value as THREE.Color).getHex()).toBe(gridColor.getHex());
    expect((shader.uniforms.floorFadeColor.value as THREE.Color).getHex()).toBe(hex(DARK['--scene-bg']));
    switchTo(page, LIGHT);
    grid.applyTheme();
    expect(grid.state()).toEqual({ strength: 0, edgeFade: 0 });
  });
});
