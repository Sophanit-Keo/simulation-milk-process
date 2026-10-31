// Phase 10: the factory floor's machines, belts and pipes (D20), built from its layout (layout.ts) and moved
// on by the board's view. Each UHT is one skid with its aseptic tank; each line is one filler, the 3D plant's
// hero filler once it loads (heroes.ts), over a grey box of the same shape, with its outfeed belt. The pipes
// flow as the 3D plant's do. No DOM: the labels, the camera and the renderer are scene.ts's, so Vitest builds
// this module in Node.
//
// Every machine is placed by the layout and matched to the view by its place on the floor (floorBays), never
// by a name. The floor is built for one layout; scene.ts builds a new one when the layout's key changes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Status } from '../../contracts';
import { HERO_MODELS, swapInHero } from '../../scene/equipment/heroes';
import { MachineBuilder } from '../../scene/equipment/liquid/builder';
import { createKit, type Kit } from '../../scene/equipment/liquid/kit';
import type { EquipmentContext } from '../../scene/equipment/types';
import type { PointM } from '../../scene/layout';
import { advancePhase } from '../../scene/motion';
import { LAMP_GLOW_HEX, type LampStatus, type SceneColorVar } from '../../scene/theme';
import { BELT_LENGTH_M, beltSpeedMps, beltState, pipeFlow, pipeStripeMps, TOKEN_PITCH_M } from '../layout';
import type {
  BayLayout,
  BeltState,
  CameraStopM,
  FactoryLayout,
  FillerSpot,
  FloorBay,
  FloorPointM,
  FloorRectM,
  PipeFlow,
  PipeRoute,
  TankSpot,
  UhtSpot,
} from '../view';

// ───── Looks ─────
//
// Every colour that stands for a theme colour is a token (tokens.css), read again when the theme changes. The
// dark theme is the control room (phase 11, D21): lit lamps glow, a fine grid lies on the floor, the bays are
// outlined in a faint cyan, and what runs (belts, flowing pipes, a producing UHT's plates) gives off a little light.

/** An unlit lamp: the dark steel of the 3D plant's frames. */
const UNLIT_LAMP_VAR: SceneColorVar = '--steel-dark';
/** A lit lamp's colour in the dark theme: the board's lamp tokens. The light theme keeps the 3D plant's (theme.ts). */
const LAMP_VARS: Readonly<Record<LampStatus, SceneColorVar>> = { ok: '--ok', warn: '--warn', bad: '--bad' };
/** The plate pack while its UHT produces: the 3D plant's preheat orange (80 °C), given off at this strength. */
const GLOW_VAR: SceneColorVar = '--t80';
const GLOW_INTENSITY = { light: 0.35, dark: 0.45 } as const;
/** The plate pack's own colour: the stainless steel's. */
const PLATES_VAR: SceneColorVar = '--steel';
/** The pipes carry the product's colour (the 3D plant's 20 °C), and the lye's while they clean (D20). */
const MILK_COLOR_VAR: SceneColorVar = '--t20';
const CLEAN_COLOR_VAR: SceneColorVar = '--clean-lye';
/** In the dark theme a pipe gives off its own colour, through its stripes, so the flow reads: more while it flows. */
const PIPE_GLOW = { flowing: 0.45, still: 0.12 } as const;
/** In the dark theme a running belt's rubber shows a touch of the steel's light, and the packs a little of their own. */
const BELT_GLOW_VAR: SceneColorVar = '--steel';
const BELT_GLOW_INTENSITY = 0.28;
const PACK_GLOW_INTENSITY = 0.22;

/** The bay outlines: the dark steel in light; in dark, the accent's cyan, faint. */
const OUTLINE_OPACITY = { light: 0.7, dark: 0.32 } as const;

/**
 * A lit lamp's halo in the dark theme: a soft disc about this wide around the lamp, added to what is behind it.
 * A point's size is in pixels at one unit from a 2-unit-high view; the floor's camera has a 40° field (scene.ts).
 */
const HALO_DIAMETER_M = 1.8;
const HALO_POINT_SIZE = HALO_DIAMETER_M / Math.tan(THREE.MathUtils.degToRad(40) / 2);
/** How bright a halo's middle is, as a share of its lamp's colour. */
const HALO_STRENGTH = 0.85;
const HALO_TEXTURE_PX = 64;

/** The floor's grid in the dark theme: lines a metre apart, stronger every 5 m, over the bays and a margin round them. */
const GRID_MINOR_M = 1;
const GRID_MAJOR_M = 5;
const GRID_MARGIN_M = 24;
/** The grid fades out over this much of its edge, so it melts into the floor rather than stopping. */
const GRID_EDGE_FADE_M = 16;
/** Just above the slabs (SLAB_HEIGHT_M), under the outlines (OUTLINE_Y_M). */
const GRID_Y_M = 0.05;
/** The page grid's alpha (--grid, made for a flat backdrop) times these, for the minor and the major lines on the floor. */
const GRID_GAIN = { minor: 1.8, major: 3.6 } as const;

/** Below this relative luminance the scene's background (--scene-bg) is dark: light's #dde5ea is 0.77, dark's #090e12 0.004. */
const DARK_BACKGROUND_LUMINANCE = 0.2;

/** One stripe and its gap along a pipe, as in the 3D plant. */
const STRIPE_M = 0.7;
/** The stripes move at most a quarter of a stripe in one frame, so on a slow frame they never seem to run backwards. */
const MAX_STRIPE_STEP_M = STRIPE_M / 4;
const PIPE_SIDES = 10;
/** Balls at the bends, a shade fatter than the pipe so they hide the seams. */
const JOINT_SCALE = 1.08;

/** Slab thickness under each bay, and the outline just above it (as the 3D plant's zones). */
const SLAB_HEIGHT_M = 0.04;
const OUTLINE_Y_M = 0.06;

/** A token on a belt: a group of packs, drawn far larger than one 100 ml pack so it reads (D20). */
const TOKEN_SIZE_M = [0.32, 0.24, 0.32] as const;
/** A token moves at most a quarter of the pitch in one frame. */
const MAX_TOKEN_STEP_M = TOKEN_PITCH_M / 4;

/** The filler's moving parts, at the teaching filler's rates (src/scene/equipment/packsLine.ts). */
const REEL_RAD_PER_S = 0.9;
const JAW_RAD_PER_S = 2.4;
const JAW_TRAVEL_M = 0.12;
const JAWS_TOP_M = 2.6;
const FULL_TURN_RAD = 2 * Math.PI;

/**
 * The hero filler's footprint centre in its own frame (assets/hero-specs.md: x −1.63…1.90, z −1.60…1.135).
 * Turned to face +z, its frame's x runs along world z and its z along world −x.
 */
const HERO_FOOTPRINT_CENTRE = { xM: 0.135, zM: -0.2325 } as const;
const FACE_PLUS_Z_RAD = -Math.PI / 2;

// ───── The floor's contract with scene.ts ─────

/** One thing on the floor a click can pick: a UHT (its skid and tank), or a line (its filler and belt). */
export interface FloorMachine {
  /** 'uht:<bay>' or 'line:<bay>:<filler>', by place on the floor, as the pipes are named. */
  readonly id: string;
  readonly kind: 'uht' | 'line';
  /** Its bay's index in the layout, and for a line its filler's index in the bay. */
  readonly bay: number;
  readonly filler: number | null;
  readonly object: THREE.Object3D;
  readonly labelM: FloorPointM;
  readonly camera: CameraStopM;
}

/** What the floor shows now, for the tests and the ?debug hook. */
export interface FloorState {
  machines: {
    id: string;
    kind: 'uht' | 'line';
    lamp: Status;
    /** A UHT's plates glow while it produces. */
    glowing?: boolean;
    belt?: BeltState;
    beltMps?: number;
    /** Tokens shown on the belt. */
    tokens?: number;
    /** The hero filler has replaced the grey box. */
    hero?: boolean;
    reelRad?: number;
  }[];
  pipes: { id: string; flowLph: number; cleaning: boolean; stripeMps: number; phaseM: number; color: string }[];
}

export interface Floor {
  readonly layout: FactoryLayout;
  /** Everything on the floor; scene.ts adds it to the scene. */
  readonly root: THREE.Group;
  readonly machines: readonly FloorMachine[];
  /** The view's bays (floorBays), in the layout's order: lamps, glows, belts and pipes follow them. */
  update(bays: readonly FloorBay[]): void;
  /** Every frame: belts, fillers and pipes move on by `dtS` real seconds. */
  tick(dtS: number): void;
  state(): FloorState;
  applyTheme(): void;
  /** Frees what the floor made, never the shared materials or the host's models, and takes it off the scene. */
  dispose(): void;
}

/** A scene colour token's value now (theme.ts readSceneColor in the page). */
export type ReadColor = (name: SceneColorVar) => string;

// ───── Helpers ─────

/** Whether the tokens are the dark theme's: the scene's background is dark. */
export function themeIsDark(readColor: ReadColor): boolean {
  // THREE.Color holds linear values, so this is the WCAG relative luminance of the sRGB token.
  const background = new THREE.Color(readColor('--scene-bg'));
  return 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b < DARK_BACKGROUND_LUMINANCE;
}

/**
 * A colour token that may carry an alpha, such as --grid's rgba(56, 189, 248, 0.05): the colour into `target`, and
 * the alpha returned. Read here rather than by THREE.Color, which warns of an alpha it drops.
 */
function readRgba(value: string, target: THREE.Color): number {
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value);
  if (!rgba) {
    target.set(value);
    return 1;
  }
  const [, r, g, b, alpha, percent] = rgba;
  target.setRGB(Number(r) / 255, Number(g) / 255, Number(b) / 255, THREE.SRGBColorSpace);
  return alpha === undefined ? 1 : THREE.MathUtils.clamp(Number(alpha) / (percent ? 100 : 1), 0, 1);
}

/** The theme's colours for the lamps, read again on each change of theme. */
interface LampLooks {
  dark: boolean;
  unlit: THREE.Color;
  lit: Record<LampStatus, THREE.Color>;
}

function lampMaterial(looks: LampLooks): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: looks.unlit, roughness: 0.3, emissiveIntensity: 1 });
}

/** Lit in the lamp's colour for ok, warn and bad, and giving it off; unlit, in the dark steel, for idle. */
function setLamp(material: THREE.MeshStandardMaterial, status: Status, looks: LampLooks): void {
  if (status === 'idle') {
    material.color.copy(looks.unlit);
    material.emissive.setHex(0x000000);
  } else {
    material.color.copy(looks.lit[status]);
    material.emissive.copy(looks.lit[status]);
  }
}

/** A round soft spot, white, fading from its middle: the halo's shape. */
function createHaloTexture(): THREE.DataTexture {
  const size = HALO_TEXTURE_PX;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2; // 0 in the middle, 1 at the edge
      // A bright core and a long soft tail, nothing at the square's edge.
      const alpha = r >= 1 ? 0 : Math.exp(-r * r * 9) * 0.75 + Math.exp(-r * r * 2.6) * 0.25 * (1 - r);
      data.set([255, 255, 255, Math.round(255 * Math.min(1, alpha))], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The floor's grid: fine lines a metre apart and stronger ones every 5 m, drawn from the floor's own x and z, so they
 * stay one pixel wide at any distance; they fade where the cells grow too small to read, and toward the grid's edge.
 */
function createGridMaterial(rect: FloorRectM): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'floor-grid',
    uniforms: {
      uColor: { value: new THREE.Color() },
      uMinor: { value: 0 },
      uMajor: { value: 0 },
      uRect: { value: new THREE.Vector4(rect.xMinM, rect.zMinM, rect.xMaxM, rect.zMaxM) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vFloorM;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vFloorM = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uMinor;
      uniform float uMajor;
      uniform vec4 uRect;
      varying vec2 vFloorM;
      float gridLine(float cellM) {
        vec2 coord = vFloorM / cellM;
        vec2 perPx = fwidth(coord);
        vec2 off = abs(fract(coord - 0.5) - 0.5) / max(perPx, vec2(1e-4));
        float line = 1.0 - min(min(off.x, off.y), 1.0);
        // Cells under a few pixels would shimmer into a haze: they fade out first.
        return line * smoothstep(3.0, 9.0, 1.0 / max(max(perPx.x, perPx.y), 1e-4));
      }
      void main() {
        vec2 inside = min(vFloorM - uRect.xy, uRect.zw - vFloorM);
        float edge = smoothstep(0.0, ${GRID_EDGE_FADE_M.toFixed(1)}, min(inside.x, inside.y));
        float alpha = max(gridLine(${GRID_MINOR_M.toFixed(1)}) * uMinor, gridLine(${GRID_MAJOR_M.toFixed(1)}) * uMajor) * edge;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    // Pulled toward the camera, so it never fights the slabs a few millimetres under it.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}

const toPoint = (point: FloorPointM): PointM => [point[0], point[1], point[2]];

/** A copy of a shared material the floor can light on its own (the host's are all MeshStandardMaterial). */
function standardCopy(shared: THREE.Material): THREE.MeshStandardMaterial {
  return shared instanceof THREE.MeshStandardMaterial ? shared.clone() : new THREE.MeshStandardMaterial({ roughness: 0.8 });
}

/** The same stripe as the 3D plant's pipes: a light pipe with a darker band, repeating along it. */
function createStripeTexture(): THREE.DataTexture {
  const widthPx = 64;
  const data = new Uint8Array(widthPx * 4);
  for (let i = 0; i < widthPx; i++) {
    const u = (i + 0.5) / widthPx;
    const band = 1 - THREE.MathUtils.smoothstep(Math.abs(u - 0.75), 0.1, 0.2);
    const value = Math.round(255 * (1 - 0.3 * band));
    data.set([value, value, value, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, widthPx, 1, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const _up = new THREE.Vector3(0, 1, 0);
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3(1, 1, 1);

/** Sets every vertex's u to the stripe coordinate at `arcM` + its share of `lengthM` along the piece (v along y). */
function setArcUv(geometry: THREE.BufferGeometry, arcM: number, lengthM: number): void {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const along = lengthM > 0 ? position.getY(i) / lengthM + 0.5 : 0;
    uv.setXY(i, (arcM + along * lengthM) / STRIPE_M, 0.5);
  }
}

/** A pipe route as one mesh: a cylinder per straight piece and a ball at each bend and tee. */
function pipeGeometry(route: PipeRoute): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // The header's arms leave its tee where its trunk ends, so their stripes carry on from the trunk's.
  const trunkM = route.paths[0].slice(1).reduce((sum, point, i) => sum + Math.hypot(...point.map((value, axis) => value - route.paths[0][i][axis])), 0);
  route.paths.forEach((path, pathIndex) => {
    let arcM = pathIndex === 0 ? 0 : trunkM;
    path.slice(1).forEach((point, i) => {
      _from.set(...path[i]);
      _to.set(...point);
      const lengthM = _from.distanceTo(_to);
      if (lengthM <= 0) return;
      const piece = new THREE.CylinderGeometry(route.radiusM, route.radiusM, lengthM, PIPE_SIDES, 1, true);
      setArcUv(piece, arcM, lengthM);
      _direction.subVectors(_to, _from).normalize();
      _quaternion.setFromUnitVectors(_up, _direction);
      piece.applyMatrix4(_matrix.compose(_from.clone().add(_to).multiplyScalar(0.5), _quaternion, _scale));
      parts.push(piece);
      arcM += lengthM;
      // A ball at the bend this piece ends on, or at the tee an arm starts from.
      const bend = i + 1 < path.length - 1;
      if (bend || (pathIndex > 0 && i === 0)) {
        const at = bend ? _to : _from;
        const ball = new THREE.SphereGeometry(route.radiusM * JOINT_SCALE, PIPE_SIDES, 6);
        setArcUv(ball, bend ? arcM : arcM - lengthM, 0);
        ball.translate(at.x, at.y, at.z);
        parts.push(ball);
      }
    });
  });
  const merged = parts.length > 0 ? mergeGeometries(parts, false) : new THREE.BufferGeometry();
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`factory floor: the pipe ${route.id} could not be merged`);
  return merged;
}

// ───── Machines ─────

interface Built {
  object: THREE.Object3D;
  dispose(): void;
}

/** The UHT plant as one skid: plate heat exchanger, homogenizer, holding tube, steam injector, control cabinet. */
function buildUht(kit: Kit, uht: UhtSpot, lamp: THREE.Material, glow: THREE.Material): Built & { plates: THREE.Mesh; lamp: THREE.Mesh } {
  const [cx, , cz] = uht.centreM;
  const L = uht.lengthM;
  const D = uht.depthM;
  const at = (dx: number, y: number, dz: number): PointM => [cx + dx, y, cz + dz];
  const b = new MachineBuilder(kit, 'uht-skid', toPoint(uht.centreM));
  b.part('box', 'concrete', at(0, 0.075, 0), [L, 0.15, D]);
  b.part('box', 'steelDark', at(0, 0.25, 0), [L - 0.3, 0.2, D - 0.3]);

  // The plate heat exchanger at the left end: two frame plates, a bar along the top, the plate pack between.
  const packM = 0.28 * L;
  const left = -L / 2 + 0.5;
  b.part('box', 'steelDark', at(left + 0.1, 1.45, -0.6), [0.2, 2.2, 1.1], { castShadow: true });
  b.part('box', 'steelDark', at(left + 0.4 + packM, 1.45, -0.6), [0.2, 2.2, 1.1], { castShadow: true });
  b.part('box', 'steelDark', at(left + 0.25 + packM / 2, 2.6, -0.6), [packM + 0.5, 0.1, 0.12]);
  const plates = b.mesh('plates', 'box', 'steel', at(left + 0.25 + packM / 2, 1.4, -0.6), [packM, 1.9, 0.9], { castShadow: true });
  plates.material = glow;

  // The homogenizer, its motor and its liquid end.
  const hx = 0.12 * L;
  b.part('box', 'paint', at(hx, 0.95, -0.55), [1.7, 1.2, 1.2], { castShadow: true });
  b.part('box', 'steel', at(hx + 1.05, 0.85, -0.55), [0.4, 0.6, 0.8]);
  b.part('cylLo', 'paint', at(hx - 1.25, 0.8, -0.55), [0.32, 0.8, 0.32], { rotationRad: [0, 0, Math.PI / 2] });

  // The holding tube: three runs lying along the front, on two posts, and the steam injector before them.
  const tubeM = 0.38 * L;
  for (const y of [0.75, 1.05, 1.35]) b.part('cylLo', 'steel', at(0.05 * L, y, 0.95), [0.07, tubeM, 0.07], { rotationRad: [0, 0, Math.PI / 2] });
  for (const dx of [-tubeM / 2, tubeM / 2]) b.part('box', 'steelDark', at(0.05 * L + dx, 0.8, 0.95), [0.08, 1.1, 0.12]);
  b.part('cylLo', 'steel', at(-0.12 * L, 1.0, 0.95), [0.18, 1.3, 0.18], { castShadow: true });

  // The control cabinet at the front right, with the plant's lamp on a post on top.
  b.part('box', 'paint', at(L / 2 - 0.75, 1.2, 1.15), [1.0, 2.1, 0.6], { castShadow: true });
  b.part('cylLo', 'steelDark', at(L / 2 - 0.75, 2.45, 1.15), [0.035, 0.4, 0.035]);
  const lampMesh = b.mesh('lamp', 'cylLo', 'steelDark', at(L / 2 - 0.75, 2.76, 1.15), [0.1, 0.22, 0.1]);
  lampMesh.material = lamp;

  // The outlet to the aseptic tank, on the front face.
  const [ox, oy, oz] = uht.outletM;
  b.part('cylLo', 'steel', [ox, oy, oz - 0.15], [0.15, 0.3, 0.15], { rotationRad: [Math.PI / 2, 0, 0] });
  b.part('box', 'steelDark', [ox, oy / 2, oz - 0.2], [0.1, oy, 0.1]);

  const { object, dispose } = b.build();
  return { object, dispose, plates, lamp: lampMesh };
}

/** The aseptic tank: on legs, with a cone below, a dome above and its sterile-air filter; closed (D20). */
function buildTank(kit: Kit, tank: TankSpot): Built {
  const [cx, , cz] = tank.centreM;
  const r = tank.radiusM;
  const bottomM = tank.outletM[1];
  const coneTopM = bottomM + 0.6;
  const domeM = 0.6;
  const shellTopM = tank.heightM - domeM;
  const b = new MachineBuilder(kit, 'aseptic-tank', toPoint(tank.centreM));
  b.legs([cx, cz], r * 0.92, coneTopM, 4, 0.08);
  b.part('coneDown', 'steel', [cx, (bottomM + coneTopM) / 2, cz], [r, coneTopM - bottomM, r], { castShadow: true });
  b.part('cyl', 'steel', [cx, (coneTopM + shellTopM) / 2, cz], [r, shellTopM - coneTopM, r], { castShadow: true });
  b.part('dome', 'steel', [cx, shellTopM, cz], [r, domeM, r], { castShadow: true });
  b.part('cylLo', 'steelDark', [cx + 0.6, tank.heightM + 0.15, cz], [0.12, 0.5, 0.12]); // sterile-air filter
  b.part('box', 'steelDark', [cx, (coneTopM + shellTopM) / 2, cz - r - 0.05], [0.5, shellTopM - coneTopM, 0.06]); // ladder
  const [ix, iy, iz] = tank.inletM;
  b.part('cylLo', 'steel', [ix, iy, iz + 0.05], [0.15, 0.2, 0.15], { rotationRad: [Math.PI / 2, 0, 0] });
  return b.build();
}

interface BuiltFiller extends Built {
  /** The lamp on its post, which stays when the hero model swaps in. */
  lamp: THREE.Mesh;
  reel: THREE.Object3D;
  jaws: THREE.Object3D;
  hero: boolean;
}

/**
 * A roll-fed aseptic filler, built in the hero model's own frame (the teaching filler's grey box, about its
 * origin) and then turned to face its belt and scaled to its model (D20). The lamp stands on its roof and
 * stays when the hero model swaps in.
 */
function buildFiller(kit: Kit, ctx: EquipmentContext, spot: FillerSpot, lamp: THREE.Material, isAlive: () => boolean): BuiltFiller {
  const b = new MachineBuilder(kit, 'filler', [0, 0, 0]);
  b.part('box', 'steel', [0, 1.2, 0], [3.2, 2.4, 2.2], { castShadow: true }); // cabinet
  b.part('box', 'glass', [0, 2.95, 0], [2.0, 1.1, 1.6]); // aseptic zone
  b.part('cylLo', 'milk', [-0.3, 2.95, 0], [0.13, 1.0, 0.13]); // the paper tube, full of milk
  b.part('box', 'steelDark', [0, 3.53, 0], [2.1, 0.06, 1.7], { castShadow: true });
  b.part('box', 'steel', [1.75, 1.2, 0], [0.3, 0.6, 0.8], { castShadow: true }); // outfeed hood
  b.part('cylLo', 'steelDark', [-0.8, 1.0, -1.2], [0.08, 0.2, 0.08], { rotationRad: [Math.PI / 2, 0, 0], castShadow: true });
  const greyReel = b.pivot('reel', [-0.8, 1.0, -1.42]);
  b.part('cyl', 'carton', [0, 0, 0], [0.78, 0.34, 0.78], { parent: greyReel, rotationRad: [Math.PI / 2, 0, 0], castShadow: true });
  b.part('box', 'steelDark', [0, 0, 0], [1.2, 0.1, 0.36], { parent: greyReel });
  const greyJaws = b.pivot('jaws', [-0.3, JAWS_TOP_M, 0]);
  for (const side of [-1, 1]) b.part('box', 'steelDark', [0, 0, side * 0.18], [0.34, 0.1, 0.08], { parent: greyJaws });
  // The lamp on a post above the roof, toward the operator's side: kept when the hero model swaps in.
  const post = b.mesh('lamp-post', 'cylLo', 'steelDark', [0.9, 3.78, 0.55], [0.035, 0.44, 0.035]);
  const lampMesh = b.mesh('lamp', 'cylLo', 'steelDark', [0.9, 4.1, 0.55], [0.1, 0.24, 0.1]);
  lampMesh.material = lamp;

  const { object, dispose } = b.build();
  const { centreM, scale } = spot;
  // The footprint centre turned to face +z lies at (−z, x) of the frame's, times the scale.
  object.position.set(centreM[0] + HERO_FOOTPRINT_CENTRE.zM * scale, 0, centreM[2] - HERO_FOOTPRINT_CENTRE.xM * scale);
  object.rotation.y = FACE_PLUS_Z_RAD;
  object.scale.setScalar(scale);

  const built: BuiltFiller = { object, dispose, lamp: lampMesh, reel: greyReel, jaws: greyJaws, hero: false };
  swapInHero(
    ctx,
    object,
    { path: HERO_MODELS.filler, nodes: ['reel', 'jaws'] as const, keep: [post, lampMesh] },
    (nodes) => {
      nodes.reel.rotation.z = built.reel.rotation.z;
      nodes.jaws.position.y = built.jaws.position.y;
      built.reel = nodes.reel;
      built.jaws = nodes.jaws;
      built.hero = true;
    },
    isAlive,
  );
  return built;
}

/** The outfeed belt on its legs and the tokens riding it. */
interface BuiltBelt extends Built {
  tokens: THREE.InstancedMesh;
  /** The belt's own rubber, which gives off a little light while it runs in the dark theme. */
  surface: THREE.MeshStandardMaterial;
  /** Where the first token stands, in [0, TOKEN_PITCH_M). */
  phaseM: number;
  /** How far along the belt the tokens reach after it emptied; the belt's length once full. */
  filledM: number;
  readonly slots: number;
}

function buildBelt(kit: Kit, ctx: EquipmentContext, spot: FillerSpot, packs: THREE.Material): BuiltBelt {
  const { fromM, toM, widthM } = spot.belt;
  const [x, top, z0] = fromM;
  const lengthM = toM[2] - z0;
  const midZ = z0 + lengthM / 2;
  const b = new MachineBuilder(kit, 'belt', [x, 0, midZ]);
  b.part('box', 'rubber', [x, top - 0.025, midZ], [widthM, 0.05, lengthM]);
  for (const side of [-1, 1]) {
    b.part('box', 'steelDark', [x + side * (widthM / 2 + 0.03), top - 0.03, midZ], [0.06, 0.12, lengthM]);
    for (const legZ of [z0 + 0.4, midZ, toM[2] - 0.4]) b.part('box', 'steelDark', [x + side * (widthM / 2), (top - 0.08) / 2, legZ], [0.06, top - 0.08, 0.06]);
  }
  const { object, dispose } = b.build();
  // The rubber is the belt's only part of its material, so its own copy costs no draw call.
  const surface = standardCopy(ctx.materials.rubber);
  const rubber = object.getObjectByName('belt-rubber');
  if (rubber instanceof THREE.Mesh) rubber.material = surface;

  const slots = Math.max(1, Math.floor(lengthM / TOKEN_PITCH_M));
  // Too small for the floor's shadow map: the tokens receive shadows only, and cost no shadow-pass draw.
  const tokens = new THREE.InstancedMesh(kit.shape('box'), packs, slots);
  tokens.name = 'packs';
  tokens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tokens.receiveShadow = true;
  tokens.count = 0;
  // Bounds for picking and culling: the whole belt, whatever tokens show.
  tokens.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, top, 0), lengthM / 2 + 1);
  object.add(tokens);
  return {
    object,
    tokens,
    surface,
    phaseM: 0,
    filledM: lengthM,
    slots,
    dispose() {
      tokens.dispose();
      surface.dispose();
      dispose();
    },
  };
}

const _tokenPosition = new THREE.Vector3();
const _tokenScale = new THREE.Vector3(...TOKEN_SIZE_M);
const _noTurn = new THREE.Quaternion();

/** Places the tokens that have come onto the belt: slot i at phase + i × pitch from its start, short of filledM. */
function placeTokens(belt: BuiltBelt, spot: FillerSpot): void {
  const { fromM, toM } = spot.belt;
  const lengthM = toM[2] - fromM[2];
  const midZ = fromM[2] + lengthM / 2;
  let shown = 0;
  for (let i = 0; i < belt.slots; i++) {
    const alongM = belt.phaseM + i * TOKEN_PITCH_M;
    // A token shows once the packs reach it: on a belt that is filling, only short of how far they have come.
    if (alongM > lengthM || (belt.filledM < lengthM && alongM >= belt.filledM)) continue;
    // In the belt's frame: its root stands at the belt's middle, on the floor.
    _tokenPosition.set(0, fromM[1] + TOKEN_SIZE_M[1] / 2, fromM[2] + alongM - midZ);
    belt.tokens.setMatrixAt(shown, _matrix.compose(_tokenPosition, _noTurn, _tokenScale));
    shown += 1;
  }
  belt.tokens.count = shown;
  belt.tokens.instanceMatrix.needsUpdate = true;
}

// ───── The floor ─────

interface UhtMachine {
  machine: FloorMachine;
  lamp: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  /** Its lamp's point in the halos. */
  halo: number;
  status: Status;
  glowing: boolean;
}

interface LineMachine {
  machine: FloorMachine;
  spot: FillerSpot;
  filler: BuiltFiller;
  belt: BuiltBelt;
  lamp: THREE.MeshStandardMaterial;
  /** Its lamp's point in the halos. */
  halo: number;
  status: Status;
  beltState: BeltState;
  beltMps: number;
  jawRad: number;
  /** Not yet updated: a line already running or stopped when the floor first shows has a full belt. */
  fresh: boolean;
}

interface PipeMesh {
  route: PipeRoute;
  bay: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  texture: THREE.Texture;
  flow: PipeFlow;
  stripeMps: number;
  phaseM: number;
}

/** The bays' slabs as one mesh, a colour per vertex, and their outlines as one line set (as the 3D plant's zones). */
function buildSlabs(
  bays: readonly BayLayout[],
): { slabs: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; outlines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; counts: number[] } | null {
  if (bays.length === 0) return null;
  const parts = bays.map(({ rect }) => {
    const box = new THREE.BoxGeometry(rect.xMaxM - rect.xMinM, SLAB_HEIGHT_M, rect.zMaxM - rect.zMinM);
    box.translate((rect.xMinM + rect.xMaxM) / 2, SLAB_HEIGHT_M / 2, (rect.zMinM + rect.zMaxM) / 2);
    return box;
  });
  const counts = parts.map((part) => part.getAttribute('position').count);
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('factory floor: the bay slabs could not be merged');
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3));
  const slabs = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  slabs.name = 'bay-slabs';
  slabs.receiveShadow = true;
  const corners = (rect: FloorRectM): THREE.Vector3[] => {
    const points = [
      new THREE.Vector3(rect.xMinM, OUTLINE_Y_M, rect.zMinM),
      new THREE.Vector3(rect.xMaxM, OUTLINE_Y_M, rect.zMinM),
      new THREE.Vector3(rect.xMaxM, OUTLINE_Y_M, rect.zMaxM),
      new THREE.Vector3(rect.xMinM, OUTLINE_Y_M, rect.zMaxM),
    ];
    return points.flatMap((point, i) => [point, points[(i + 1) % points.length]]);
  };
  const outlines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(bays.flatMap((bay) => corners(bay.rect))),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 }),
  );
  outlines.name = 'bay-outlines';
  return { slabs, outlines, counts };
}

/** The lit lamps' halos in the dark theme: one point per lamp, all in one draw call, each in its lamp's colour. */
function buildHalos(positions: readonly THREE.Vector3[]): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null {
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry().setFromPoints([...positions]);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length * 3), 3));
  const material = new THREE.PointsMaterial({
    size: HALO_POINT_SIZE,
    sizeAttenuation: true,
    map: createHaloTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    // Added to what is behind it, as light is: an unlit lamp's black halo adds nothing.
    blending: THREE.AdditiveBlending,
  });
  const halos = new THREE.Points(geometry, material);
  halos.name = 'lamp-halos';
  halos.visible = false;
  return halos;
}

/** The grid over the bays and a margin round them, flat on the floor. Shown in the dark theme only. */
function buildGrid(bounds: FloorRectM): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const rect: FloorRectM = {
    xMinM: bounds.xMinM - GRID_MARGIN_M,
    xMaxM: bounds.xMaxM + GRID_MARGIN_M,
    zMinM: bounds.zMinM - GRID_MARGIN_M,
    zMaxM: bounds.zMaxM + GRID_MARGIN_M,
  };
  const geometry = new THREE.PlaneGeometry(rect.xMaxM - rect.xMinM, rect.zMaxM - rect.zMinM);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((rect.xMinM + rect.xMaxM) / 2, GRID_Y_M, (rect.zMinM + rect.zMaxM) / 2);
  const grid = new THREE.Mesh(geometry, createGridMaterial(rect));
  grid.name = 'floor-grid';
  // Before the other see-through things (the fillers' glass), which then show the grid behind them.
  grid.renderOrder = -1;
  grid.visible = false;
  return grid;
}

const LAMP_STATUSES: readonly LampStatus[] = ['ok', 'warn', 'bad'];

/**
 * Builds the floor for `layout` on the host's shared materials and model loader (equipmentHost.ts `context`).
 * The machines show idle until the first update().
 */
export function buildFloor(layout: FactoryLayout, ctx: EquipmentContext, readColor: ReadColor): Floor {
  const root = new THREE.Group();
  root.name = 'factory-floor';
  const kit = createKit(ctx);
  let alive = true;
  const isAlive = (): boolean => alive;
  const disposers: (() => void)[] = [];
  const looks: LampLooks = { dark: false, unlit: new THREE.Color(), lit: { ok: new THREE.Color(), warn: new THREE.Color(), bad: new THREE.Color() } };

  const slabParts = buildSlabs(layout.bays);
  if (slabParts) {
    root.add(slabParts.slabs, slabParts.outlines);
    disposers.push(() => {
      slabParts.slabs.geometry.dispose();
      slabParts.slabs.material.dispose();
      slabParts.outlines.geometry.dispose();
      slabParts.outlines.material.dispose();
    });
  }
  const grid = layout.bays.length > 0 ? buildGrid(layout.bounds) : null;
  if (grid) {
    root.add(grid);
    disposers.push(() => {
      grid.geometry.dispose();
      grid.material.dispose();
    });
  }

  const uhts: UhtMachine[] = [];
  const lines: LineMachine[] = [];
  const pipes: PipeMesh[] = [];
  const stripe = createStripeTexture();
  disposers.push(() => stripe.dispose());
  /** Where each lamp stands, in the order of the halos' points. */
  const lampPoints: THREE.Vector3[] = [];
  const lampPoint = (mesh: THREE.Mesh): number => {
    lampPoints.push(mesh.getWorldPosition(new THREE.Vector3()));
    return lampPoints.length - 1;
  };
  // The packs on every belt: one material of the floor's, so they can give off a little light in the dark theme.
  const packs = standardCopy(ctx.materials.carton);
  disposers.push(() => packs.dispose());

  layout.bays.forEach((bay, bayIndex) => {
    if (bay.uht && bay.tank) {
      const group = new THREE.Group();
      group.name = `uht:${bayIndex}`;
      const lamp = lampMaterial(looks);
      const glow = new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.35, emissiveIntensity: 0 });
      const skid = buildUht(kit, bay.uht, lamp, glow);
      const tank = buildTank(kit, bay.tank);
      group.add(skid.object, tank.object);
      root.add(group);
      disposers.push(() => {
        skid.dispose();
        tank.dispose();
        lamp.dispose();
        glow.dispose();
      });
      uhts.push({
        machine: { id: group.name, kind: 'uht', bay: bayIndex, filler: null, object: group, labelM: bay.uht.labelM, camera: bay.uht.camera },
        lamp,
        glow,
        halo: lampPoint(skid.lamp),
        status: 'idle',
        glowing: false,
      });
    }

    bay.fillers.forEach((spot, fillerIndex) => {
      const group = new THREE.Group();
      group.name = `line:${bayIndex}:${fillerIndex}`;
      const lamp = lampMaterial(looks);
      const filler = buildFiller(kit, ctx, spot, lamp, isAlive);
      const belt = buildBelt(kit, ctx, spot, packs);
      group.add(filler.object, belt.object);
      root.add(group);
      disposers.push(() => {
        filler.dispose();
        belt.dispose();
        lamp.dispose();
      });
      lines.push({
        machine: { id: group.name, kind: 'line', bay: bayIndex, filler: fillerIndex, object: group, labelM: spot.labelM, camera: spot.camera },
        spot,
        filler,
        belt,
        lamp,
        halo: lampPoint(filler.lamp),
        status: 'idle',
        beltState: 'empty',
        beltMps: 0,
        jawRad: 0,
        fresh: true,
      });
      belt.filledM = 0;
      placeTokens(belt, spot);
    });

    for (const route of bay.pipes) {
      const texture = stripe.clone();
      texture.needsUpdate = true;
      // The stripes light the pipe too (the dark theme's glow), so they show as they move.
      const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissiveIntensity: 0, roughness: 0.35, metalness: 0.2 });
      const mesh = new THREE.Mesh(pipeGeometry(route), material);
      mesh.name = `pipe:${route.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      disposers.push(() => {
        mesh.geometry.dispose();
        material.dispose();
        texture.dispose();
      });
      pipes.push({ route, bay: bayIndex, mesh, material, texture, flow: { flowLph: 0, cleaning: false }, stripeMps: 0, phaseM: 0 });
    }
  });

  const halos = buildHalos(lampPoints);
  if (halos) {
    root.add(halos);
    disposers.push(() => {
      halos.geometry.dispose();
      halos.material.map?.dispose();
      halos.material.dispose();
    });
  }

  const milkColor = new THREE.Color();
  const cleanColor = new THREE.Color();
  const beltGlow = new THREE.Color();
  const gridColor = new THREE.Color();
  const slabColor = new THREE.Color();

  /** A lamp's halo: its lit colour in the dark theme, nothing in the light one or while it is unlit. */
  const lightHalo = (index: number, status: Status): void => {
    if (!halos) return;
    const colors = halos.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (looks.dark && status !== 'idle') {
      const lit = looks.lit[status];
      colors.setXYZ(index, lit.r * HALO_STRENGTH, lit.g * HALO_STRENGTH, lit.b * HALO_STRENGTH);
    } else {
      colors.setXYZ(index, 0, 0, 0);
    }
    colors.needsUpdate = true;
  };
  const lightUht = (uht: UhtMachine): void => {
    setLamp(uht.lamp, uht.status, looks);
    lightHalo(uht.halo, uht.status);
    uht.glow.emissiveIntensity = uht.glowing ? GLOW_INTENSITY[looks.dark ? 'dark' : 'light'] : 0;
  };
  const lightLine = (line: LineMachine): void => {
    setLamp(line.lamp, line.status, looks);
    lightHalo(line.halo, line.status);
    line.belt.surface.emissiveIntensity = looks.dark && line.beltState === 'moving' ? BELT_GLOW_INTENSITY : 0;
  };
  const colorPipe = (pipe: PipeMesh): void => {
    const color = pipe.flow.cleaning ? cleanColor : milkColor;
    pipe.material.color.copy(color);
    pipe.material.emissive.copy(color);
    pipe.material.emissiveIntensity = looks.dark ? (pipe.stripeMps > 0 ? PIPE_GLOW.flowing : PIPE_GLOW.still) : 0;
  };

  const applyTheme = (): void => {
    looks.dark = themeIsDark(readColor);
    looks.unlit.set(readColor(UNLIT_LAMP_VAR));
    for (const status of LAMP_STATUSES) {
      if (looks.dark) looks.lit[status].set(readColor(LAMP_VARS[status]));
      else looks.lit[status].setHex(LAMP_GLOW_HEX[status]);
    }
    milkColor.set(readColor(MILK_COLOR_VAR));
    cleanColor.set(readColor(CLEAN_COLOR_VAR));
    beltGlow.set(readColor(BELT_GLOW_VAR));
    for (const uht of uhts) {
      uht.glow.color.set(readColor(PLATES_VAR));
      uht.glow.emissive.set(readColor(GLOW_VAR));
      lightUht(uht);
    }
    for (const line of lines) {
      line.belt.surface.emissive.copy(beltGlow);
      lightLine(line);
    }
    packs.emissive.copy(packs.color);
    packs.emissiveIntensity = looks.dark ? PACK_GLOW_INTENSITY : 0;
    for (const pipe of pipes) colorPipe(pipe);
    if (halos) halos.visible = looks.dark;
    if (grid) {
      const alpha = readRgba(readColor('--grid'), gridColor);
      grid.material.uniforms.uColor.value.copy(gridColor);
      grid.material.uniforms.uMinor.value = alpha * GRID_GAIN.minor;
      grid.material.uniforms.uMajor.value = alpha * GRID_GAIN.major;
      grid.visible = looks.dark && alpha > 0;
    }
    if (!slabParts) return;
    const colors = slabParts.slabs.geometry.getAttribute('color') as THREE.BufferAttribute;
    let offset = 0;
    layout.bays.forEach((bay, i) => {
      // The bay of the lines no UHT claims takes the packing hall's tint, so it reads apart.
      slabColor.set(readColor(bay.uht ? '--zone-proc' : '--zone-pack'));
      for (let k = offset; k < offset + slabParts.counts[i]; k++) colors.setXYZ(k, slabColor.r, slabColor.g, slabColor.b);
      offset += slabParts.counts[i];
    });
    colors.needsUpdate = true;
    slabParts.outlines.material.color.set(readColor(looks.dark ? '--accent' : '--steel-dark'));
    slabParts.outlines.material.opacity = OUTLINE_OPACITY[looks.dark ? 'dark' : 'light'];
  };
  applyTheme();

  const machines: FloorMachine[] = [...uhts.map((uht) => uht.machine), ...lines.map((line) => line.machine)];
  for (const machine of machines) machine.object.userData = { floorMachine: machine.id };

  return {
    layout,
    root,
    machines,
    update(bays) {
      for (const uht of uhts) {
        const view = bays[uht.machine.bay]?.uht ?? null;
        const status = view?.lamp ?? 'idle';
        const glowing = view?.state === 'producing';
        if (status !== uht.status || glowing !== uht.glowing) {
          uht.status = status;
          uht.glowing = glowing;
          lightUht(uht);
        }
      }
      for (const line of lines) {
        const view = bays[line.machine.bay]?.lines[line.machine.filler ?? -1];
        const status = view?.lamp ?? 'idle';
        const state = view ? beltState(view.status) : 'empty';
        const relight = status !== line.status || state !== line.beltState;
        line.status = status;
        if (line.fresh) {
          line.fresh = false;
          line.belt.filledM = state === 'empty' ? 0 : BELT_LENGTH_M;
          line.beltState = state;
          placeTokens(line.belt, line.spot);
        } else if (state !== line.beltState) {
          // A belt that empties starts again from its start: the tokens come on one by one as it runs.
          if (state === 'empty') line.belt.filledM = 0;
          line.beltState = state;
          placeTokens(line.belt, line.spot);
        }
        if (relight) lightLine(line);
        line.beltMps = state === 'moving' ? beltSpeedMps(view?.packsPerH ?? null) : 0;
      }
      for (const pipe of pipes) {
        const bay = bays[pipe.bay];
        pipe.flow = bay ? pipeFlow(pipe.route, bay) : { flowLph: 0, cleaning: false };
        pipe.stripeMps = pipeStripeMps(pipe.flow);
        colorPipe(pipe);
      }
    },
    tick(dtS) {
      if (!(dtS > 0)) return;
      for (const line of lines) {
        if (line.beltState !== 'moving') continue;
        const { belt } = line;
        const stepM = Math.min(line.beltMps * dtS, MAX_TOKEN_STEP_M);
        if (stepM > 0) {
          belt.phaseM = advancePhase(belt.phaseM, stepM, MAX_TOKEN_STEP_M, TOKEN_PITCH_M);
          belt.filledM = Math.min(BELT_LENGTH_M, belt.filledM + stepM);
          placeTokens(belt, line.spot);
        }
        // The filler runs while its belt does: the paper unwinds off the top, the jaws ride down and back.
        line.filler.reel.rotation.z = (line.filler.reel.rotation.z - REEL_RAD_PER_S * dtS) % FULL_TURN_RAD;
        line.jawRad = (line.jawRad + JAW_RAD_PER_S * dtS) % FULL_TURN_RAD;
        line.filler.jaws.position.y = JAWS_TOP_M - JAW_TRAVEL_M * (0.5 - 0.5 * Math.cos(line.jawRad));
      }
      for (const pipe of pipes) {
        if (pipe.stripeMps <= 0) continue;
        pipe.phaseM = advancePhase(pipe.phaseM, pipe.stripeMps * dtS, MAX_STRIPE_STEP_M, STRIPE_M);
        pipe.texture.offset.x = -pipe.phaseM / STRIPE_M;
      }
    },
    state() {
      return {
        machines: [
          ...uhts.map((uht) => ({ id: uht.machine.id, kind: 'uht' as const, lamp: uht.status, glowing: uht.glowing })),
          ...lines.map((line) => ({
            id: line.machine.id,
            kind: 'line' as const,
            lamp: line.status,
            belt: line.beltState,
            beltMps: line.beltMps,
            tokens: line.belt.tokens.count,
            hero: line.filler.hero,
            reelRad: line.filler.reel.rotation.z,
          })),
        ],
        pipes: pipes.map((pipe) => ({
          id: pipe.route.id,
          flowLph: pipe.flow.flowLph,
          cleaning: pipe.flow.cleaning,
          stripeMps: pipe.stripeMps,
          phaseM: pipe.phaseM,
          color: `#${pipe.material.color.getHexString()}`,
        })),
      };
    },
    applyTheme,
    dispose() {
      if (!alive) return;
      alive = false;
      root.removeFromParent();
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    },
  };
}
