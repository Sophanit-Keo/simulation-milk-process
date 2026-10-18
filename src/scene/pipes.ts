// The liquid line's pipes (preview: "pipes: colour follows milk temperature"). Each run is one
// TubeGeometry mesh along the preview's route, coloured per vertex from the temperatures in
// snapshot.line, with a shared stripe texture that flows at the speed of the milk. The divert route to
// the reject tank lights up red while the plant diverts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { degToRad, LINE_POINT_IDS, type LinePoint, type LinePointId, type StageId } from '../contracts';
import type { PointM } from './layout';
import { advancePhase } from './motion';
import { LAMP_GLOW_HEX, readSceneColor, type SceneColorVar } from './theme';

/**
 * Where a route vertex takes its temperature from: one measuring point of the line, or part-way
 * from one point's temperature to the next inside a heater or cooler (`frac` 0 is `from`, 1 is `to`).
 */
export type PipeTemp = LinePointId | { readonly from: LinePointId; readonly to: LinePointId; readonly frac: number };

/**
 * One vertex of a route, in flow order: position, the temperature it carries (the measuring point
 * upstream of it), and optionally the point whose flow moves the milk on from here, when that is
 * not the temperature's point (the product line just past the divert valve is still at holding-tube
 * temperature but only flows when the flash vessel does).
 */
export type RouteVertex = readonly [xM: number, yM: number, zM: number, temp: PipeTemp, flow?: LinePointId];

export interface PipePath {
  /** In flow order: the stripes run from the first vertex to the last. */
  readonly vertices: readonly RouteVertex[];
  readonly radiusM: number;
}

/** A ball where paths meet (a tee, or a run starting off another run's end). */
export interface PipeJoint {
  readonly at: RouteVertex;
  readonly radiusM: number;
}

export interface PipeRun {
  readonly id: string;
  readonly paths: readonly PipePath[];
  readonly joints?: readonly PipeJoint[];
  /** A click on the run selects this stage. Only the holding tube, which is stage 4's centrepiece, has one. */
  readonly stage?: StageId;
}

/** Part-way from one point's temperature to the next; the fractions reproduce the preview's in-between values. */
const between = (from: LinePointId, to: LinePointId, frac: number): PipeTemp => ({ from, to, frac });

/** The run from the divert valve to the reject tank, which lights up while the plant diverts. */
export const DIVERT_RUN_ID = 'divert';

const MAIN_RADIUS_M = 0.11;
const HOLDING_TUBE_RADIUS_M = 0.09;
/** Joint balls are a shade fatter than the pipe, so they hide the seam where two pieces meet (as the preview's). */
const JOINT_SCALE = 1.05;

/** The holding tube: 5.5 turns of 0.6 m radius, rising 1.6 m (preview class Helix). */
const HELIX = { centreXM: -14.8, centreZM: -14, radiusM: 0.6, bottomYM: 0.9, riseM: 1.6, turns: 5.5, startRad: Math.PI };
/** Samples along the helix: about 9 cm apart, close enough that the tube reads as smooth. */
const HELIX_SAMPLES = 240;

function helixVertices(): RouteVertex[] {
  const vertices: RouteVertex[] = [];
  for (let i = 0; i <= HELIX_SAMPLES; i++) {
    const t = i / HELIX_SAMPLES;
    const angleRad = HELIX.startRad + t * HELIX.turns * 2 * Math.PI;
    vertices.push([
      HELIX.centreXM + HELIX.radiusM * Math.cos(angleRad),
      HELIX.bottomYM + HELIX.riseM * t,
      HELIX.centreZM + HELIX.radiusM * Math.sin(angleRad),
      'holdingTube',
    ]);
  }
  return vertices;
}

/** The flow-diversion valve, where the holding tube ends and the product and divert lines start. */
const FDV: RouteVertex = [-12.6, 2.5, -14, 'holdingTube'];

/**
 * The milk's routes, from the preview (PRE, HELIX, FDV, PROD, DIV, OUT_A, OUT_B). The preview's fourth
 * number per vertex was a fixed temperature; here it is the measuring point that sets it, so the
 * colours follow the snapshot.
 */
export const MILK_RUNS: readonly PipeRun[] = [
  {
    // Both raw-milk silos drain into one manifold, which feeds the separator.
    id: 'silo-manifold',
    paths: [
      { radiusM: MAIN_RADIUS_M, vertices: [[-56.85, 0.9, -18.5, 'silo'], [-55.6, 0.9, -18.5, 'silo'], [-55.6, 0.9, -14, 'silo']] },
      { radiusM: MAIN_RADIUS_M, vertices: [[-56.85, 0.9, -9.5, 'silo'], [-55.6, 0.9, -9.5, 'silo'], [-55.6, 0.9, -14, 'silo']] },
    ],
    joints: [{ at: [-55.6, 0.9, -14, 'silo'], radiusM: MAIN_RADIUS_M * JOINT_SCALE }],
  },
  {
    // Separator, standardization, feed tank, preheater, deaerator, homogenizer, steam injector.
    id: 'feed',
    paths: [
      {
        radiusM: MAIN_RADIUS_M,
        vertices: [
          [-55.6, 0.9, -14, 'silo'],
          [-52.3, 0.9, -14, between('silo', 'separator', 0.64)],
          [-52.3, 1.2, -14, between('silo', 'separator', 0.96)],
          [-50.7, 1.2, -14, 'separator'],
          [-48.9, 1.2, -14, 'separator'],
          [-46.3, 1.2, -14, between('separator', 'feedTank', 0.36)],
          [-43.9, 1.2, -14, between('separator', 'feedTank', 0.96)],
          [-42.4, 1.2, -14, 'feedTank'],
          [-42.4, 0.7, -14, 'feedTank'],
          [-40.9, 0.7, -14, 'feedTank'],
          [-33.55, 0.7, -14, 'feedTank'],
          [-33, 0.7, -14, 'feedTank'],
          [-32.45, 0.5, -14, 'feedTank'],
          [-30.35, 0.5, -14, 'feedTank'],
          [-28.9, 0.5, -14, between('feedTank', 'preheater', 0.47)],
          [-28.9, 1.7, -14, between('feedTank', 'preheater', 0.87)],
          [-27.45, 1.7, -14, 'preheater'],
          [-26.2, 1.7, -14, 'preheater'],
          [-26.2, 3.0, -14, 'preheater'],
          [-25.5, 3.0, -14, 'preheater'],
          [-24.8, 2.0, -14, between('preheater', 'deaerator', 0.75)],
          [-24.8, 0.45, -14, 'deaerator'],
          [-23.2, 0.45, -14, 'deaerator'],
          [-23.2, 0.7, -14, 'deaerator'],
          [-21.65, 0.7, -14, 'deaerator'],
          [-20.5, 0.7, -14, between('deaerator', 'homogenizer', 0.5)],
          [-19.35, 0.9, -14, 'homogenizer'],
          [-17.2, 0.9, -14, 'homogenizer'],
          // Steam injection heats the milk to UHT temperature in a fraction of a second.
          [-17, 0.9, -14, 'holdingTube'],
          [-15.4, 0.9, -14, 'holdingTube'],
        ],
      },
    ],
  },
  {
    id: 'holding-tube',
    stage: 4,
    paths: [{ radiusM: HOLDING_TUBE_RADIUS_M, vertices: [...helixVertices(), FDV] }],
    joints: [{ at: [-15.4, 0.9, -14, 'holdingTube'], radiusM: MAIN_RADIUS_M * JOINT_SCALE }],
  },
  {
    // Through the divert valve in production, the flash vessel and the tubular cooler, into the aseptic tank.
    id: 'product',
    paths: [
      {
        radiusM: MAIN_RADIUS_M,
        vertices: [
          [-12.6, 2.5, -14, 'holdingTube', 'flashVessel'],
          [-11.6, 2.5, -14, 'holdingTube', 'flashVessel'],
          [-11.6, 3.3, -14, 'holdingTube', 'flashVessel'],
          [-10.85, 3.3, -14, 'holdingTube', 'flashVessel'],
          [-10, 2.5, -14, 'flashVessel'],
          [-10, 0.4, -14, 'flashVessel'],
          [-10, 0.4, -11.6, 'flashVessel'],
          [-9.3, 0.5, -11.6, 'flashVessel'],
          [-6.1, 0.5, -11.6, between('flashVessel', 'cooler', 1 / 3)],
          [-6.1, 0.8, -11.6, between('flashVessel', 'cooler', 1 / 3)],
          [-9.3, 0.8, -11.6, between('flashVessel', 'cooler', 2 / 3)],
          [-9.3, 1.1, -11.6, between('flashVessel', 'cooler', 2 / 3)],
          [-6.1, 1.1, -11.6, 'cooler'],
          [1.0, 1.1, -11.6, 'cooler'],
          [1.0, 1.1, -14, 'cooler'],
          [2.2, 1.1, -14, 'cooler'],
          [4, 1.6, -14, 'cooler'],
        ],
      },
    ],
  },
  {
    // From the divert valve to the reject tank; it carries milk only while the plant diverts.
    id: DIVERT_RUN_ID,
    paths: [
      {
        radiusM: MAIN_RADIUS_M,
        vertices: [
          [-12.6, 2.5, -14, 'divert'],
          [-12.6, 2.5, -13.2, 'divert'],
          [-12.6, 2.5, -10.5, 'divert'],
          [-12.6, 1.7, -10.5, 'divert'],
          [-12.6, 0.6, -10.5, 'divert'],
        ],
      },
    ],
  },
  {
    id: 'filler-a',
    paths: [
      {
        radiusM: MAIN_RADIUS_M,
        vertices: [
          [4, 1.0, -14, 'asepticTank'],
          [4, 0.55, -14, 'asepticTank'],
          [13, 0.55, -14, 'asepticTank'],
          [13, 0.55, -17.5, 'asepticTank'],
          [18.4, 0.55, -17.5, 'asepticTank'],
          [19.7, 2.5, -17.5, 'filler'],
        ],
      },
    ],
  },
  {
    // Branches off filler A's line at the tee (13, -14), where that line has a joint ball.
    id: 'filler-b',
    paths: [
      {
        radiusM: MAIN_RADIUS_M,
        vertices: [
          [13, 0.55, -14, 'asepticTank'],
          [13, 0.55, -10.5, 'asepticTank'],
          [18.4, 0.55, -10.5, 'asepticTank'],
          [19.7, 2.5, -10.5, 'filler'],
        ],
      },
    ],
  },
];

/** Steam, vapour, vacuum and sterile-air lines (the preview's utility pipes): plain steel, no milk in them. */
export const UTILITY_PATHS: readonly { pointsM: readonly PointM[]; radiusM: number }[] = [
  // Steam from the boiler house to the steam injector.
  { radiusM: 0.07, pointsM: [[-17, 1.38, -14], [-17, 4.2, -14], [-17, 4.2, -20.2], [-17, 2.45, -20.2]] },
  // Flash vapour to the condenser.
  { radiusM: 0.1, pointsM: [[-10, 4.35, -14], [-10, 4.9, -14], [-8.9, 4.9, -14]] },
  // Deaerator vacuum line down to its pump.
  { radiusM: 0.06, pointsM: [[-24.8, 4.45, -14], [-24.8, 4.75, -14], [-23.5, 4.75, -14], [-23.5, 0.45, -12.8]] },
  // Sterile air into the aseptic tank's head space.
  { radiusM: 0.05, pointsM: [[5.3, 6.45, -14], [5.3, 6.7, -14], [4.6, 6.7, -14], [4.6, 5.95, -14]] },
];

/** The colour ramp's stops (plan 08 and the preview's --t4 … --t140): cold blue, teal, yellow, orange, UHT red. */
export const TEMP_STOPS: readonly { tempC: number; colorVar: SceneColorVar }[] = [
  { tempC: 4, colorVar: '--t4' },
  { tempC: 20, colorVar: '--t20' },
  { tempC: 60, colorVar: '--t60' },
  { tempC: 80, colorVar: '--t80' },
  { tempC: 140, colorVar: '--t140' },
];

/**
 * Colour of milk at `tempC`: linear between the two stops around it, clamped at both ends (preview
 * tempColor). `stops` is in rising temperature order and not empty.
 */
export function tempColor(tempC: number, stops: readonly { tempC: number; color: THREE.Color }[], out: THREE.Color): THREE.Color {
  if (tempC <= stops[0].tempC) return out.copy(stops[0].color);
  for (let i = 1; i < stops.length; i++) {
    const lo = stops[i - 1];
    const hi = stops[i];
    if (tempC <= hi.tempC) return out.lerpColors(lo.color, hi.color, (tempC - lo.tempC) / (hi.tempC - lo.tempC));
  }
  return out.copy(stops[stops.length - 1].color);
}

/** Rings at most this far apart, so a temperature ramp along a pipe passes through every colour stop. */
const MAX_RING_SPACING_M = 0.25;
const RADIAL_SEGMENTS = 8;
/** Corners sharper than this get a joint ball; the helix's gentle bends don't. */
const JOINT_MIN_TURN_RAD = degToRad(15);
const JOINT_WIDTH_SEGMENTS = 10;
const JOINT_HEIGHT_SEGMENTS = 8;

/** One stripe and one gap of the flow texture, along the pipe. */
const STRIPE_M = 0.7;
/** A visual scale in real time, not a model number: 10,000 L/h moves the stripes 1 m/s. */
const STRIPE_MPS_PER_LPH = 1e-4;
/**
 * The stripes move at most a quarter of a stripe and gap per frame: faster, on a slow frame at a high sim
 * speed, they would seem to stand still or run backwards.
 */
const MAX_STRIPE_STEP_M = STRIPE_M / 4;
/** How brightly the divert route glows, in the lamps' red, while the plant diverts. */
const DIVERT_LIT_INTENSITY = 0.6;
/** Slots in the phase table: one per line point, then one that never moves (joint balls). */
const STILL_SLOT = LINE_POINT_IDS.length;
const FLOW_SLOTS = LINE_POINT_IDS.length + 1;
/** Where the still slot samples the stripe texture: the middle of the light part. */
const STILL_ARC_M = 0.25 * STRIPE_M;
const SLOT_OF = new Map<LinePointId, number>(LINE_POINT_IDS.map((id, i) => [id, i]));

export interface Pipes {
  /** Meshes a click may hit, with the stage they select. */
  readonly pickTargets: readonly { object: THREE.Object3D; stage: StageId }[];
  /**
   * Colours and stripes from the snapshot's line points. Each point's stripes move at a speed proportional
   * to its flow for `animationDtS` (motion.ts: 0 while paused, so they stand still); the divert route to
   * the reject tank glows red while `diverting`.
   */
  update(line: Readonly<Record<LinePointId, LinePoint>>, animationDtS: number, diverting?: boolean): void;
  /** For tests and the ?debug hook: whether the divert route is lit, and each line point's stripe offset. */
  state(): { divertLit: boolean; phaseM: Record<LinePointId, number> };
  applyTheme(): void;
  dispose(): void;
}

export function createPipes(scene: THREE.Scene, utilityMaterial: THREE.Material): Pipes {
  const flowTexture = createStripeTexture();
  // One phase per line point. The vertex shader looks a vertex's phase up by its slot, so each part of
  // a run flows at its own point's speed, and all runs share one material and one texture.
  const phaseM = new Float32Array(FLOW_SLOTS);
  const makeMilkMaterial = (name: string): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2, map: flowTexture });
    material.name = name;
    material.defines = { FLOW_SLOTS: String(FLOW_SLOTS) };
    // One cache key, so both milk materials share one shader program; each has its own uniforms object,
    // and both point at the same phase table.
    material.customProgramCacheKey = () => 'milk-pipe-flow';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.flowPhaseM = { value: phaseM };
      shader.uniforms.stripeM = { value: STRIPE_M };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float arcM;\nattribute float flowSlot;\nuniform float flowPhaseM[ FLOW_SLOTS ];\nuniform float stripeM;',
        )
        .replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n\tvMapUv = vec2( ( arcM - flowPhaseM[ int( flowSlot + 0.5 ) ] ) / stripeM, 0.5 );',
        );
    };
    return material;
  };
  const milkMaterial = makeMilkMaterial('milk-pipe');
  // The divert route has a material of its own, the same but for an emissive red it shows while diverting.
  // It is its own mesh anyway, so this costs no draw call.
  const divertMaterial = makeMilkMaterial('milk-pipe-divert');
  divertMaterial.emissive.setHex(LAMP_GLOW_HEX.bad);
  divertMaterial.emissiveIntensity = 0;
  let divertLit = false;

  const runs = MILK_RUNS.map((run) => buildMilkRun(run));
  const meshes = runs.map(({ run, geometry }) => {
    const mesh = new THREE.Mesh(geometry, run.id === DIVERT_RUN_ID ? divertMaterial : milkMaterial);
    mesh.name = `pipe-${run.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });

  const utilityGeometry = mergeOrThrow(UTILITY_PATHS.map(({ pointsM, radiusM }) => buildPath(pointsM, radiusM).geometry));
  const utilityMesh = new THREE.Mesh(utilityGeometry, utilityMaterial);
  utilityMesh.name = 'pipe-utilities';
  utilityMesh.castShadow = true;
  scene.add(utilityMesh);

  const stops = TEMP_STOPS.map(({ tempC }) => ({ tempC, color: new THREE.Color() }));
  const pointTempC = new Float32Array(LINE_POINT_IDS.length);
  const color = new THREE.Color();
  /** Per line point: did its temperature change in this update? */
  const tempChanged = new Uint8Array(LINE_POINT_IDS.length);
  let coloured = false;

  const carriesChange = (points: Uint8Array): boolean => {
    for (let i = 0; i < points.length; i++) if (tempChanged[points[i]] === 1) return true;
    return false;
  };

  /** Recolours every run, or with `onlyChanged` just the runs that carry a point whose temperature changed. */
  const recolour = (onlyChanged = false): void => {
    for (const { colors, tempIndex, tempWeight, tempPoints } of runs) {
      if (onlyChanged && !carriesChange(tempPoints)) continue;
      const array = colors.array as Float32Array;
      for (let v = 0; v < colors.count; v++) {
        let tempC = 0;
        for (let k = v * 4; k < v * 4 + 4; k++) tempC += tempWeight[k] * pointTempC[tempIndex[k]];
        tempColor(tempC, stops, color);
        array[v * 3] = color.r;
        array[v * 3 + 1] = color.g;
        array[v * 3 + 2] = color.b;
      }
      colors.needsUpdate = true;
    }
    coloured = true;
  };

  const applyTheme = (): void => {
    for (const [i, stop] of TEMP_STOPS.entries()) stops[i].color.set(readSceneColor(stop.colorVar));
    if (coloured) recolour();
  };
  applyTheme();

  return {
    pickTargets: meshes.flatMap((mesh, i) => {
      const stage = runs[i].run.stage;
      return stage === undefined ? [] : [{ object: mesh, stage }];
    }),
    update(line, animationDtS, diverting = false) {
      // Recolour only the runs whose temperatures moved: the static plant never does; the live model's
      // display noise moves only the UHT section, so the silo and filler runs stay as they are.
      let changed = false;
      for (let i = 0; i < LINE_POINT_IDS.length; i++) {
        const tempC = Math.fround(line[LINE_POINT_IDS[i]].tempC);
        tempChanged[i] = pointTempC[i] !== tempC ? 1 : 0;
        if (tempChanged[i] === 1) {
          pointTempC[i] = tempC;
          changed = true;
        }
      }
      if (!coloured) recolour();
      else if (changed) recolour(true);

      if (diverting !== divertLit) {
        divertLit = diverting;
        divertMaterial.emissiveIntensity = diverting ? DIVERT_LIT_INTENSITY : 0;
      }

      if (!(animationDtS > 0)) return;
      for (let i = 0; i < LINE_POINT_IDS.length; i++) {
        const flowLph = line[LINE_POINT_IDS[i]].flowLph;
        const speedMps = Number.isFinite(flowLph) ? Math.max(0, flowLph) * STRIPE_MPS_PER_LPH : 0;
        // Modulo one stripe: the texture repeats, and a small phase keeps the shader's float precision.
        phaseM[i] = advancePhase(phaseM[i], speedMps * animationDtS, MAX_STRIPE_STEP_M, STRIPE_M);
      }
    },
    state() {
      return {
        divertLit,
        phaseM: Object.fromEntries(LINE_POINT_IDS.map((id, i) => [id, phaseM[i]])) as Record<LinePointId, number>,
      };
    },
    applyTheme,
    dispose() {
      for (const mesh of [...meshes, utilityMesh]) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      milkMaterial.dispose();
      divertMaterial.dispose();
      flowTexture.dispose();
      // utilityMaterial is shared (equipmentHost) and disposed there.
    },
  };
}

/** A run's merged geometry, and for each vertex the line points (up to four) and weights its temperature mixes. */
interface MilkRunGeometry {
  run: PipeRun;
  geometry: THREE.BufferGeometry;
  colors: THREE.BufferAttribute;
  tempIndex: Uint8Array;
  tempWeight: Float32Array;
  /** The line points whose temperatures colour the run, each once. */
  tempPoints: Uint8Array;
}

function buildMilkRun(run: PipeRun): MilkRunGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tempIndex: number[] = [];
  const tempWeight: number[] = [];
  const arcM: number[] = [];
  const flowSlot: number[] = [];

  const pushVertex = (weights: readonly [LinePointId, number][], slot: number, arc: number): void => {
    for (let k = 0; k < 4; k++) {
      const [id, weight] = weights[k] ?? ['silo', 0];
      tempIndex.push(slotOf(id));
      tempWeight.push(weight);
    }
    flowSlot.push(slot);
    arcM.push(arc);
  };

  for (const path of run.paths) {
    const { vertices } = path;
    const built = buildPath(
      vertices.map(([xM, yM, zM]) => [xM, yM, zM] as const),
      path.radiusM,
    );
    parts.push(built.geometry);
    for (const sample of built.samples) {
      if (sample.joint) {
        pushVertex(tempWeights(vertices[sample.segment][3], 1), STILL_SLOT, STILL_ARC_M);
        continue;
      }
      const { segment, frac } = sample;
      const start = vertices[segment];
      const end = vertices[segment + 1];
      // The segment flows at its upstream end's speed; its temperature ramps from one end to the other.
      pushVertex([...tempWeights(start[3], 1 - frac), ...tempWeights(end[3], frac)], slotOf(start[4] ?? upstreamPoint(start[3])), sample.arcM);
    }
  }

  for (const joint of run.joints ?? []) {
    const ball = jointBall(joint.at, joint.radiusM);
    parts.push(ball);
    for (let v = 0; v < ball.getAttribute('position').count; v++) pushVertex(tempWeights(joint.at[3], 1), STILL_SLOT, STILL_ARC_M);
  }

  const geometry = mergeOrThrow(parts);
  const count = geometry.getAttribute('position').count;
  if (flowSlot.length !== count) throw new Error(`pipes: run ${run.id} has ${count} vertices but ${flowSlot.length} samples`);
  const colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute('color', colors);
  geometry.setAttribute('arcM', new THREE.Float32BufferAttribute(arcM, 1));
  geometry.setAttribute('flowSlot', new THREE.Float32BufferAttribute(flowSlot, 1));
  const tempPoints = Uint8Array.from(new Set(tempIndex.filter((_, k) => tempWeight[k] !== 0)));
  return { run, geometry, colors, tempIndex: Uint8Array.from(tempIndex), tempWeight: Float32Array.from(tempWeight), tempPoints };
}

function slotOf(id: LinePointId): number {
  const slot = SLOT_OF.get(id);
  if (slot === undefined) throw new Error(`pipes: unknown line point ${id}`);
  return slot;
}

function upstreamPoint(temp: PipeTemp): LinePointId {
  return typeof temp === 'string' ? temp : temp.from;
}

/** The temperature `temp` as weighted line points, scaled by `scale`; zero weights are dropped. */
function tempWeights(temp: PipeTemp, scale: number): [LinePointId, number][] {
  const weights: [LinePointId, number][] =
    typeof temp === 'string'
      ? [[temp, scale]]
      : [
          [temp.from, (1 - temp.frac) * scale],
          [temp.to, temp.frac * scale],
        ];
  return weights.filter(([, weight]) => weight !== 0);
}

/** Where a vertex of a path's geometry lies: on the tube between two route vertices, or on a joint ball. */
type PathSample = { joint: false; segment: number; frac: number; arcM: number } | { joint: true; segment: number };

/**
 * A tube along a polyline, one ring at every vertex and more in between, with a ball over every sharp
 * corner (the tube pinches where a ring turns a corner; the ball hides it). Returns the geometry and,
 * for each of its vertices in order, where on the route it lies.
 */
function buildPath(pointsM: readonly PointM[], radiusM: number): { geometry: THREE.BufferGeometry; samples: PathSample[] } {
  const points = pointsM.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  if (points.length < 2) throw new Error('pipes: a path needs at least two points');
  const directions = points.slice(1).map((point, i) => point.clone().sub(points[i]));
  const lengthsM = directions.map((direction) => direction.length());
  for (const direction of directions) direction.normalize();
  const startArcM = [0];
  for (const lengthM of lengthsM) startArcM.push((startArcM.at(-1) ?? 0) + lengthM);

  // Ring positions as "route coordinates": segment index plus the fraction along it.
  const rings: number[] = [];
  lengthsM.forEach((lengthM, segment) => {
    const steps = Math.max(1, Math.ceil(lengthM / MAX_RING_SPACING_M));
    for (let j = 0; j < steps; j++) rings.push(segment + j / steps);
  });
  rings.push(points.length - 1);

  const locate = (coord: number): { segment: number; frac: number } => {
    const segment = Math.min(Math.floor(coord), points.length - 2);
    return { segment, frac: coord - segment };
  };
  const curve = new RingCurve(points, directions, rings, locate);
  const tube = new THREE.TubeGeometry(curve, rings.length - 1, radiusM, RADIAL_SEGMENTS, false);

  const samples: PathSample[] = [];
  for (const coord of rings) {
    const { segment, frac } = locate(coord);
    const sample: PathSample = { joint: false, segment, frac, arcM: startArcM[segment] + frac * lengthsM[segment] };
    for (let j = 0; j <= RADIAL_SEGMENTS; j++) samples.push(sample);
  }

  const parts: THREE.BufferGeometry[] = [tube];
  for (let i = 1; i < points.length - 1; i++) {
    if (directions[i - 1].angleTo(directions[i]) < JOINT_MIN_TURN_RAD) continue;
    const ball = jointBall(pointsM[i], radiusM * JOINT_SCALE);
    parts.push(ball);
    const sample: PathSample = { joint: true, segment: i };
    for (let v = 0; v < ball.getAttribute('position').count; v++) samples.push(sample);
  }
  return { geometry: parts.length === 1 ? tube : mergeOrThrow(parts), samples };
}

function jointBall(at: PointM | RouteVertex, radiusM: number): THREE.BufferGeometry {
  const ball = new THREE.SphereGeometry(radiusM, JOINT_WIDTH_SEGMENTS, JOINT_HEIGHT_SEGMENTS);
  ball.translate(at[0], at[1], at[2]);
  return ball;
}

function mergeOrThrow(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('pipes: geometries could not be merged');
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * The path as a curve TubeGeometry can follow, parameterised so that t = i / (rings - 1) is exactly
 * ring i: rings fall on every vertex instead of wherever even spacing would put them. The tangent at
 * a corner is the bisector of the two segments, so the corner ring sits square to neither.
 */
class RingCurve extends THREE.Curve<THREE.Vector3> {
  private readonly points: readonly THREE.Vector3[];
  private readonly directions: readonly THREE.Vector3[];
  private readonly rings: readonly number[];
  private readonly locate: (coord: number) => { segment: number; frac: number };

  constructor(
    points: readonly THREE.Vector3[],
    directions: readonly THREE.Vector3[],
    rings: readonly number[],
    locate: (coord: number) => { segment: number; frac: number },
  ) {
    super();
    this.points = points;
    this.directions = directions;
    this.rings = rings;
    this.locate = locate;
  }

  /** The route coordinate at t, between the two rings around it. */
  private coordAt(t: number): number {
    const position = Math.min(Math.max(t, 0), 1) * (this.rings.length - 1);
    const i = Math.min(Math.floor(position), this.rings.length - 2);
    return this.rings[i] + (position - i) * (this.rings[i + 1] - this.rings[i]);
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const { segment, frac } = this.locate(this.coordAt(t));
    return target.lerpVectors(this.points[segment], this.points[segment + 1], frac);
  }

  override getTangent(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const coord = this.coordAt(t);
    const vertex = Math.round(coord);
    if (Math.abs(coord - vertex) < 1e-6 && vertex > 0 && vertex < this.points.length - 1) {
      target.addVectors(this.directions[vertex - 1], this.directions[vertex]);
      if (target.lengthSq() > 1e-9) return target.normalize();
    }
    return target.copy(this.directions[this.locate(coord).segment]);
  }

  // t already is the ring parameter; TubeGeometry's arc-length remapping would move rings off the vertices.
  override getUtoTmapping(u: number): number {
    return u;
  }
}

/**
 * The flowing stripes: a 64 × 1 texture repeating along the pipe, white with one soft darker band.
 * It multiplies the vertex colour; mipmaps fade it to an even tint at a distance instead of shimmering.
 */
function createStripeTexture(): THREE.DataTexture {
  const widthPx = 64;
  const data = new Uint8Array(widthPx * 4);
  for (let i = 0; i < widthPx; i++) {
    const u = (i + 0.5) / widthPx;
    const fromBandCentre = Math.abs(u - 0.75);
    const band = 1 - THREE.MathUtils.smoothstep(fromBandCentre, 0.1, 0.2);
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
