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
import { LAMP_GLOW_HEX, type SceneColorVar } from '../../scene/theme';
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

/** An unlit lamp: the dark steel of the 3D plant's frames. */
const UNLIT_LAMP_HEX = 0x56636d;
/** The plate pack's glow while its UHT produces: the 3D plant's preheat orange, given off at this strength. */
const GLOW_HEX = 0xea8027;
const GLOW_INTENSITY = 0.35;
/** The pipes carry the product's colour (the 3D plant's 20 °C), and the lye's while they clean (D20). */
const MILK_COLOR_VAR: SceneColorVar = '--t20';
const CLEAN_COLOR_VAR: SceneColorVar = '--clean-lye';

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

function lampMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: UNLIT_LAMP_HEX, roughness: 0.3, emissiveIntensity: 1 });
}

/** Lit in the lamps' glow colours (theme.ts) for ok, warn and bad; unlit for idle. */
function setLamp(material: THREE.MeshStandardMaterial, status: Status): void {
  if (status === 'idle') {
    material.color.setHex(UNLIT_LAMP_HEX);
    material.emissive.setHex(0x000000);
  } else {
    material.color.setHex(LAMP_GLOW_HEX[status]);
    material.emissive.setHex(LAMP_GLOW_HEX[status]);
  }
}

const toPoint = (point: FloorPointM): PointM => [point[0], point[1], point[2]];

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
function buildUht(kit: Kit, uht: UhtSpot, lamp: THREE.Material, glow: THREE.Material): Built & { plates: THREE.Mesh } {
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
  return { object, dispose, plates };
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

  const built: BuiltFiller = { object, dispose, reel: greyReel, jaws: greyJaws, hero: false };
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
  /** Where the first token stands, in [0, TOKEN_PITCH_M). */
  phaseM: number;
  /** How far along the belt the tokens reach after it emptied; the belt's length once full. */
  filledM: number;
  readonly slots: number;
}

function buildBelt(kit: Kit, ctx: EquipmentContext, spot: FillerSpot): BuiltBelt {
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

  const slots = Math.max(1, Math.floor(lengthM / TOKEN_PITCH_M));
  // Too small for the floor's shadow map: the tokens receive shadows only, and cost no shadow-pass draw.
  const tokens = new THREE.InstancedMesh(kit.shape('box'), ctx.materials.carton, slots);
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
    phaseM: 0,
    filledM: lengthM,
    slots,
    dispose() {
      tokens.dispose();
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
  status: Status;
  glowing: boolean;
}

interface LineMachine {
  machine: FloorMachine;
  spot: FillerSpot;
  filler: BuiltFiller;
  belt: BuiltBelt;
  lamp: THREE.MeshStandardMaterial;
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

  const uhts: UhtMachine[] = [];
  const lines: LineMachine[] = [];
  const pipes: PipeMesh[] = [];
  const stripe = createStripeTexture();
  disposers.push(() => stripe.dispose());

  layout.bays.forEach((bay, bayIndex) => {
    if (bay.uht && bay.tank) {
      const group = new THREE.Group();
      group.name = `uht:${bayIndex}`;
      const lamp = lampMaterial();
      const glow = new THREE.MeshStandardMaterial({ color: 0xb4c0c8, metalness: 0.55, roughness: 0.35, emissive: GLOW_HEX, emissiveIntensity: 0 });
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
        status: 'idle',
        glowing: false,
      });
    }

    bay.fillers.forEach((spot, fillerIndex) => {
      const group = new THREE.Group();
      group.name = `line:${bayIndex}:${fillerIndex}`;
      const lamp = lampMaterial();
      const filler = buildFiller(kit, ctx, spot, lamp, isAlive);
      const belt = buildBelt(kit, ctx, spot);
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
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.2 });
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

  const milkColor = new THREE.Color();
  const cleanColor = new THREE.Color();
  const colorPipe = (pipe: PipeMesh): void => {
    pipe.material.color.copy(pipe.flow.cleaning ? cleanColor : milkColor);
  };

  const applyTheme = (): void => {
    milkColor.set(readColor(MILK_COLOR_VAR));
    cleanColor.set(readColor(CLEAN_COLOR_VAR));
    for (const pipe of pipes) colorPipe(pipe);
    if (!slabParts) return;
    const colors = slabParts.slabs.geometry.getAttribute('color') as THREE.BufferAttribute;
    const color = new THREE.Color();
    let offset = 0;
    layout.bays.forEach((bay, i) => {
      // The bay of the lines no UHT claims takes the packing hall's tint, so it reads apart.
      color.set(readColor(bay.uht ? '--zone-proc' : '--zone-pack'));
      for (let k = offset; k < offset + slabParts.counts[i]; k++) colors.setXYZ(k, color.r, color.g, color.b);
      offset += slabParts.counts[i];
    });
    colors.needsUpdate = true;
    slabParts.outlines.material.color.set(readColor('--steel-dark'));
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
        if (status !== uht.status) {
          uht.status = status;
          setLamp(uht.lamp, status);
        }
        const glowing = view?.state === 'producing';
        if (glowing !== uht.glowing) {
          uht.glowing = glowing;
          uht.glow.emissiveIntensity = glowing ? GLOW_INTENSITY : 0;
        }
      }
      for (const line of lines) {
        const view = bays[line.machine.bay]?.lines[line.machine.filler ?? -1];
        const status = view?.lamp ?? 'idle';
        if (status !== line.status) {
          line.status = status;
          setLamp(line.lamp, status);
        }
        const state = view ? beltState(view.status) : 'empty';
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
        line.beltMps = state === 'moving' ? beltSpeedMps(view?.packsPerH ?? null) : 0;
      }
      for (const pipe of pipes) {
        const bay = bays[pipe.bay];
        const flow = bay ? pipeFlow(pipe.route, bay) : { flowLph: 0, cleaning: false };
        const recolour = flow.cleaning !== pipe.flow.cleaning;
        pipe.flow = flow;
        pipe.stripeMps = pipeStripeMps(flow);
        if (recolour) colorPipe(pipe);
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
