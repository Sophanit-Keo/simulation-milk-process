// Stages 1–6 as grey boxes: every Must item of the 3D asset list (plan 05) plus two cheap Should items,
// the standardization skid and the balance tank with its pump. Ported from uht-plant-preview.html
// ("stage 1" to "stage 6" blocks) at the preview's positions and sizes, so the pipe routes scene-core
// draws from the same file meet each machine. The holding-tube coil and every pipe belong to
// scene-core; this module stands the machines between them. The boiler house (Could) is left out.
//
// Phase 3 makes them live from the snapshot (contracts v2): tank levels, the separator and agitator with
// the flow, the heat exchanger's glow, deaerator bubbles, pistons and gauge needles, steam and vapour,
// and the divert valve with its lamp. The mappings from snapshot to picture are in liquid/visuals.ts.
import * as THREE from 'three';
import { pctToFrac, type Snapshot, type StageId, type UhtMode } from '../../contracts';
import type { PointM } from '../layout';
import { advancePhase, motionDtS } from '../motion';
import { createLampPalette, glowInDark } from '../lamps';
import { LAMP_COLOR_VAR, LAMP_GLOW_HEX, type LampStatus } from '../theme';
import { HERO_MODELS, swapInHero } from './heroes';
import { MachineBuilder } from './liquid/builder';
import { createKit, type Kit } from './liquid/kit';
import { createPuffs } from './liquid/puffs';
import { labelValue, lineFlowLph, lineTempC, stageValue } from './liquid/readings';
import {
  flowFrac,
  GAUGE_FULL_SCALE_BAR,
  heatGlowFrac,
  needleAngleRad,
  steamFrac,
  tankFillFrac,
  uhtModeOf,
  valveLamp,
  vapourFrac,
  type TankId,
} from './liquid/visuals';
import type { Equipment, EquipmentContext, EquipmentFactory } from './types';

// Grey-box motion. It shows what runs, so it stays on under prefers-reduced-motion, but it is slower
// than the preview's (bowl 9, agitator 2.2, pistons 11 rad/s) so it reads as information, not busyness.
// It runs on animation time (motion.ts): a little faster at high sim speeds, still while paused.
const BOWL_RAD_PER_S = 4;
/** How fast the bowl and the agitator spin up or down when the flow starts or stops (fraction of the gap per second). */
const SPIN_EASE_PER_S = 1.5;
/** Below this a spin-down counts as stopped, so a part with no flow ends up still rather than creeping. */
const STOPPED_RAD_PER_S = 0.02;
/**
 * The most a spinning part turns in one frame: under half of one of the bowl's eight facets, so on a slow
 * frame at a high speed it never seems to stand still or run backwards.
 */
const MAX_TURN_PER_FRAME_RAD = 0.35;
const AGITATOR_RAD_PER_S = 1.2;
/** Piston cycle at full UHT flow; slower at reduced flow, still at zero flow. */
const PISTON_RAD_PER_S = 7;
const PISTON_STROKE_M = 0.12;
/** A crank turns at most a sixth of a turn per frame, so a stroke always reads as a stroke. */
const MAX_CRANK_PER_FRAME_RAD = Math.PI / 3;
/** The three cranks sit a third of a turn apart. */
const PISTON_PHASE_RAD = (2 * Math.PI) / 3;
const VALVE_EASE_PER_S = 8;
const FULL_TURN_RAD = 2 * Math.PI;

/** The plates' glow at the preheat set point: the pipe ramp's 80 °C orange (--t80), given off at this strength. */
const GLOW_HEX = 0xea8027;
const GLOW_MAX_INTENSITY = 0.5;

/** Lowest milk shown in a tank, so an empty one still shows its floor (as the preview does). */
const MIN_MILK_M = 0.01;

/** What the divert valve's label says the plant is doing. */
const VALVE_TEXT: Readonly<Record<UhtMode, string>> = {
  production: 'forward',
  divert: 'diverting',
  cip: 'cleaning',
  sterilize: 'sterilizing',
  aic: 'intermediate clean',
};

/** The liquid line, stages 1–6: one Equipment per machine. */
export const liquidLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  return [
    silo(kit, 'silo-a', 'Silo A', -18.5),
    silo(kit, 'silo-b', 'Silo B', -9.5),
    separator(kit, ctx),
    standardizationSkid(kit),
    mixingTank(kit),
    balanceTank(kit),
    plateHeatExchanger(kit),
    deaerator(kit),
    homogenizer(kit, ctx),
    steamInjector(kit),
    holdingTube(kit),
    divertValve(kit),
    rejectTank(kit),
    flashVessel(kit),
    tubularCooler(kit),
    asepticTank(kit),
  ];
};

interface MachineSpec {
  id: string;
  stage: StageId;
  label: string;
  labelAnchorM: PointM;
  labelText?: (snapshot: Snapshot) => string;
  update?: (snapshot: Snapshot, realDtS: number) => void;
  debugState?: () => Readonly<Record<string, number | string | boolean>>;
  /** Re-reads the theme into the machine's own materials (Equipment.applyTheme). */
  applyTheme?: () => void;
  /** Frees what the machine made beside the builder's parts (a material of its own). */
  dispose?: () => void;
  /** Called once with the built root, and whether the machine is still in the scene, for a model that loads later. */
  onBuilt?: (object: THREE.Object3D, isAlive: () => boolean) => void;
}

function machine(builder: MachineBuilder, spec: MachineSpec): Equipment {
  const { object, dispose } = builder.build();
  object.userData = { equipmentId: spec.id, stage: spec.stage };
  let alive = true;
  const equipment: Equipment = {
    id: spec.id,
    stage: spec.stage,
    label: spec.label,
    object,
    labelAnchorM: spec.labelAnchorM,
    labelText: spec.labelText ?? (() => ''),
    update: spec.update ?? (() => {}),
    dispose: () => {
      alive = false;
      spec.dispose?.();
      dispose();
    },
  };
  if (spec.debugState) equipment.debugState = spec.debugState;
  if (spec.applyTheme) equipment.applyTheme = spec.applyTheme;
  spec.onBuilt?.(object, () => alive);
  return equipment;
}

/** Moves `current` toward `target` by a share of the gap that grows with dt, without overshooting. */
const ease = (current: number, target: number, ratePerS: number, dtS: number): number =>
  current + (target - current) * Math.min(1, ratePerS * dtS);

/** A spin rate eased toward full speed while milk flows, and toward a stop, which it then reaches, while none does. */
function easeSpin(spinRadPerS: number, flowing: boolean, fullRadPerS: number, dtS: number): number {
  const next = ease(spinRadPerS, flowing ? fullRadPerS : 0, SPIN_EASE_PER_S, dtS);
  return !flowing && next < STOPPED_RAD_PER_S ? 0 : next;
}

/** Raises a unit-shape milk surface to `levelFrac` of the tank's fill height. */
function setMilkLevel(milk: THREE.Mesh, baseM: number, fullM: number, levelFrac: number): void {
  const heightM = Math.max(MIN_MILK_M, Math.min(Math.max(levelFrac, 0), 1) * fullM);
  milk.scale.y = heightM;
  milk.position.y = baseM + heightM / 2;
}

interface TankLevelView {
  /** Follows the tank in the snapshot; `fallbackFrac` stands in when the snapshot lacks the tank. */
  update(snapshot: Snapshot, fallbackFrac?: number): void;
  fillFrac(): number;
}

/**
 * The milk in a tank, or in the level gauge of an opaque one: a unit shape whose height follows the tank's
 * fill (contracts v2, liquid.tanks). A snapshot without the tank leaves the level where it was.
 */
function tankLevel(milk: THREE.Mesh, baseM: number, fullM: number, tank: TankId): TankLevelView {
  let fillFrac = 0;
  setMilkLevel(milk, baseM, fullM, fillFrac);
  return {
    update(snapshot, fallbackFrac) {
      const frac = tankFillFrac(snapshot, tank) ?? fallbackFrac;
      if (frac === undefined || frac === fillFrac) return;
      fillFrac = frac;
      setMilkLevel(milk, baseM, fullM, fillFrac);
    },
    fillFrac: () => fillFrac,
  };
}

/**
 * A level gauge down the front (+z, toward the stage cameras) of an opaque tank: a dark track, merged with
 * the machine's dark steel, and a milk-white bar in front of it that rises with the level.
 */
function levelGauge(b: MachineBuilder, frontM: PointM, bottomM: number, heightM: number, widthM: number, tank: TankId): TankLevelView {
  const [xM, , zM] = frontM;
  b.part('box', 'steelDark', [xM, bottomM + heightM / 2, zM], [widthM + 0.08, heightM + 0.08, 0.04]);
  const milk = b.mesh('milk', 'box', 'milk', [xM, bottomM, zM + 0.03], [widthM, MIN_MILK_M, 0.03]);
  return tankLevel(milk, bottomM, heightM, tank);
}

/* stage 1: silos, separator, standardization skid, mixing tank */

function silo(kit: Kit, id: string, label: string, zM: number): Equipment {
  const b = new MachineBuilder(kit, id, [-59, 0, zM]);
  b.part('cyl', 'steelDark', [-59, 0.3, zM], [2.45, 0.6, 2.45]); // plinth ring
  b.part('cyl', 'steel', [-59, 5.6, zM], [2.2, 10, 2.2], { castShadow: true });
  b.part('dome', 'steel', [-59, 10.6, zM], [2.2, 0.8, 2.2], { castShadow: true });
  b.part('box', 'steelDark', [-56.75, 5.6, zM], [0.08, 9.6, 0.5]); // ladder, on the side the outlet pipe leaves
  // The silo is opaque, so its level shows on a gauge down the front. Both silos show the snapshot's one
  // silo level: the raw milk is drawn from both alike.
  const level = levelGauge(b, [-59, 0, zM + 2.22], 1.0, 9.2, 0.14, 'silo');
  return machine(b, {
    id,
    stage: 1,
    label,
    labelAnchorM: [-59, 11.9, zM],
    labelText: (s) => labelValue(stageValue(s, 1, 'siloTempC'), 0, '°C'),
    update: (s) => level.update(s),
    debugState: () => ({ fillFrac: level.fillFrac() }),
  });
}

function separator(kit: Kit, ctx: EquipmentContext): Equipment {
  const b = new MachineBuilder(kit, 'separator', [-51.5, 0, -14]);
  b.part('box', 'paint', [-51.5, 0.4, -14], [1.7, 0.8, 1.7], { castShadow: true }); // frame
  b.part('box', 'paint', [-51.5, 0.4, -15.55], [0.8, 0.8, 1.0], { castShadow: true }); // motor
  // The node the hero model keeps (assets' hero spec): everything that spins with the disc stack.
  let bowl: THREE.Object3D = b.pivot('bowl', [-51.5, 1.35, -14]);
  b.part('cyl8', 'steel', [0, 0, 0], [0.6, 1.1, 0.6], { parent: bowl, castShadow: true });
  b.part('coneUp', 'steel', [0, 0.75, 0], [0.6, 0.4, 0.6], { parent: bowl, castShadow: true });
  b.part('box', 'steelDark', [0.56, 0, 0], [0.12, 0.9, 0.16], { parent: bowl }); // a fin, so the spin shows
  // Already turning on the first frame, as in the preview; it spins down to a stop while no milk flows.
  let spinRadPerS = BOWL_RAD_PER_S;
  return machine(b, {
    id: 'separator',
    stage: 1,
    label: 'Separator',
    labelAnchorM: [-51.5, 2.75, -14],
    labelText: (s) => labelValue(stageValue(s, 1, 'separatorTempC'), 0, '°C'),
    update(s, realDtS) {
      const dtS = motionDtS(s, realDtS);
      spinRadPerS = easeSpin(spinRadPerS, lineFlowLph(s, 'separator') > 0, BOWL_RAD_PER_S, dtS);
      bowl.rotation.y = advancePhase(bowl.rotation.y, spinRadPerS * dtS, MAX_TURN_PER_FRAME_RAD, FULL_TURN_RAD);
    },
    debugState: () => ({ spinRadPerS, angleRad: bowl.rotation.y }),
    onBuilt(object, isAlive) {
      swapInHero(ctx, object, { path: HERO_MODELS.separator, nodes: ['bowl'] }, (nodes) => {
        nodes.bowl.rotation.y = bowl.rotation.y;
        bowl = nodes.bowl;
      }, isAlive);
    },
  });
}

function standardizationSkid(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'standardization-skid', [-47.6, 0, -14]);
  b.part('box', 'steelDark', [-47.6, 0.55, -14], [2.8, 0.1, 1.3]); // deck
  for (const xM of [-48.8, -46.4]) b.part('box', 'steelDark', [xM, 0.28, -14], [0.08, 0.55, 1.1]); // end frames
  // Flow meters and the cream-dosing valve beside the line (preview: utility metal).
  for (const xM of [-48.5, -47.6, -46.7]) b.part('cylLo', 'steel', [xM, 0.95, -13.55], [0.14, 0.6, 0.14]);
  return machine(b, {
    id: 'standardization-skid',
    stage: 1,
    label: 'Standardization skid',
    labelAnchorM: [-47.6, 1.75, -14],
    labelText: (s) => {
      const fat = labelValue(stageValue(s, 1, 'productFatPct'), 1, '%');
      return fat && `${fat} fat`;
    },
  });
}

function mixingTank(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'mixing-tank', [-42.4, 0, -14]);
  b.legs([-42.4, -14], 1.15, 0.75, 4, 0.08);
  b.part('cyl', 'steel', [-42.4, 2.45, -14], [1.5, 3.4, 1.5], { castShadow: true });
  b.part('dome', 'steel', [-42.4, 4.15, -14], [1.5, 0.38, 1.5], { castShadow: true });
  b.part('box', 'paint', [-42.4, 4.8, -14], [0.55, 0.6, 0.55]); // agitator drive
  const agitator = b.mesh('agitator', 'box', 'steelDark', [-42.4, 5.15, -14], [1.1, 0.06, 0.12]);
  const level = levelGauge(b, [-42.4, 0, -12.48], 0.95, 3.0, 0.1, 'mixTank');
  // It stirs while the separator fills it, and comes to rest when the flow stops.
  let spinRadPerS = AGITATOR_RAD_PER_S;
  return machine(b, {
    id: 'mixing-tank',
    stage: 1,
    label: 'Mixing tank',
    labelAnchorM: [-42.4, 5.7, -14],
    // It is the UHT feed tank of stages.json: the milk leaves it cold for the preheater.
    labelText: (s) => labelValue(stageValue(s, 1, 'feedTankTempC'), 0, '°C'),
    update(s, realDtS) {
      const dtS = motionDtS(s, realDtS);
      spinRadPerS = easeSpin(spinRadPerS, lineFlowLph(s, 'separator') > 0, AGITATOR_RAD_PER_S, dtS);
      agitator.rotation.y = advancePhase(agitator.rotation.y, spinRadPerS * dtS, MAX_TURN_PER_FRAME_RAD, FULL_TURN_RAD);
      level.update(s);
    },
    debugState: () => ({ fillFrac: level.fillFrac(), spinRadPerS, angleRad: agitator.rotation.y }),
  });
}

/* stage 2: balance tank and feed pump, plate heat exchanger, deaerator */

function balanceTank(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'balance-tank', [-33, 0, -14]);
  // Short legs, which the preview lacks: its tank stands 0.3 m off the floor.
  b.legs([-33, -14], 0.4, 0.3, 3, 0.05);
  b.part('cyl', 'steel', [-33, 1.0, -14], [0.55, 1.4, 0.55], { castShadow: true });
  b.part('box', 'paint', [-31.9, 0.25, -13.1], [0.6, 0.5, 0.5]); // feed pump
  return machine(b, {
    id: 'balance-tank',
    stage: 2,
    label: 'Balance tank',
    labelAnchorM: [-33, 2.2, -14],
    labelText: (s) => labelValue(lineFlowLph(s, 'feedTank'), 0, 'L/h'),
  });
}

function plateHeatExchanger(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'plate-heat-exchanger', [-28.9, 0, -14]);
  for (const xM of [-30.2, -27.6]) b.part('box', 'paint', [xM, 1.15, -14], [0.26, 2.1, 1.15], { castShadow: true }); // frame and pressure plate
  for (const zM of [-14.45, -13.55]) b.part('box', 'steelDark', [-28.9, 2.25, zM], [3.0, 0.1, 0.1]); // carrying bars
  const plates = Array.from({ length: 18 }, (_, i) => ({ atM: [-29.95 + i * 0.122, 1.1, -14] as PointM, sizeM: [0.055, 1.75, 0.95] as const }));
  const plateMesh = b.instanced('plates', 'box', 'steel', plates, true);
  // The plates glow with the milk's heat. They get their own copy of the steel, which takes the shared
  // steel's themed colour each frame and adds the glow: still one draw call for the whole pack.
  const steel = kit.material('steel');
  const glow = steel instanceof THREE.MeshStandardMaterial ? steel.clone() : new THREE.MeshStandardMaterial();
  glow.name = 'plate-glow';
  glow.emissive.setHex(GLOW_HEX);
  glow.emissiveIntensity = 0;
  plateMesh.material = glow;
  let glowFrac = 0;
  return machine(b, {
    id: 'plate-heat-exchanger',
    stage: 2,
    label: 'Plate heat exchanger',
    labelAnchorM: [-28.9, 2.65, -14],
    labelText: (s) => labelValue(stageValue(s, 2, 'preheatTempC'), 0, '°C'),
    update(s) {
      if (steel instanceof THREE.MeshStandardMaterial) glow.color.copy(steel.color);
      const tempC = lineTempC(s, 'preheater');
      if (tempC === undefined) return;
      glowFrac = heatGlowFrac(tempC);
      glow.emissiveIntensity = GLOW_MAX_INTENSITY * glowFrac;
    },
    debugState: () => ({ glowFrac }),
    dispose: () => glow.dispose(),
  });
}

function deaerator(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'deaerator', [-24.8, 0, -14]);
  b.legs([-24.8, -14], 0.55, 0.6, 3, 0.06);
  b.part('coneDown', 'steel', [-24.8, 0.7, -14], [0.7, 0.5, 0.7], { castShadow: true });
  b.part('cyl', 'steel', [-24.8, 2.2, -14], [0.7, 2.5, 0.7], { castShadow: true });
  b.part('dome', 'steel', [-24.8, 3.45, -14], [0.7, 0.32, 0.7], { castShadow: true });
  b.part('cyl', 'steel', [-24.8, 4.1, -14], [0.28, 0.7, 0.28], { castShadow: true }); // condenser
  b.part('box', 'paint', [-23.5, 0.23, -12.8], [0.6, 0.45, 0.6]); // vacuum pump
  // A sight glass on the front, in which air bubbles rise out of the milk while it flows.
  b.part('cylLo', 'glass', [-24.8, 2.2, -13.24], [0.09, 1.5, 0.09]);
  const bubbles = createPuffs(b, 'bubbles', 'gauge', {
    fromM: [-24.8, 1.5, -13.2],
    travelM: [0, 1.38, 0],
    radiusM: 0.035,
    count: 6,
    cycleS: 1.6,
    envelope: 'steady',
  });
  return machine(b, {
    id: 'deaerator',
    stage: 2,
    label: 'Deaerator',
    labelAnchorM: [-24.8, 4.9, -14],
    labelText: (s) => labelValue(stageValue(s, 2, 'deaeratorTempC'), 0, '°C'),
    update: (s, realDtS) => bubbles.update(flowFrac(lineFlowLph(s, 'deaerator')), motionDtS(s, realDtS)),
    debugState: () => ({ bubbling: bubbles.mesh.visible, phase: bubbles.phase() }),
  });
}

/* stage 3: homogenizer */

function homogenizer(kit: Kit, ctx: EquipmentContext): Equipment {
  const originM: PointM = [-20.5, 0, -14];
  const b = new MachineBuilder(kit, 'homogenizer', originM);
  b.part('box', 'steelDark', [-20.5, 0.1, -14], [2.5, 0.2, 1.5]); // base frame
  b.part('box', 'paint', [-20.5, 0.75, -14], [2.2, 1.1, 1.3], { castShadow: true }); // crankcase
  b.part('cyl', 'paint', [-20.5, 0.55, -15.35], [0.42, 1.2, 0.42], { rotationRad: [0, 0, Math.PI / 2], castShadow: true }); // main motor
  for (const xM of [-21.0, -20.1]) b.part('cylLo', 'gauge', [xM, 1.34, -13.75], [0.13, 0.06, 0.13]); // stage 1 and 2 gauges
  // A needle on each dial, turning about the dial's centre: needle_1 reads stage 1, needle_2 stage 2.
  const needles = [-21.0, -20.1].map((xM, i) => {
    const pivot = b.pivot(`needle_${i + 1}`, [xM, 1.38, -13.75]);
    b.mesh(`needle_${i + 1}_hand`, 'box', 'rubber', [0.05, 0, 0], [0.11, 0.012, 0.018], { parent: pivot });
    pivot.rotation.y = needleAngleRad(0, 1);
    return pivot;
  });
  const dials = [
    { key: 'stage1Bar', fullScaleBar: GAUGE_FULL_SCALE_BAR.stage1 },
    { key: 'stage2Bar', fullScaleBar: GAUGE_FULL_SCALE_BAR.stage2 },
  ] as const;
  // Named for the hero model (assets' hero spec): piston_1 to piston_3, left to right, stroking along z.
  const pistonZM = -13.1;
  const pistons: THREE.Object3D[] = [-21.1, -20.5, -19.9].map((xM, i) =>
    b.mesh(`piston_${i + 1}`, 'cylLo', 'steel', [xM, 0.8, pistonZM], [0.09, 0.55, 0.09], { rotationRad: [Math.PI / 2, 0, 0] }),
  );
  let crankRad = 0;
  return machine(b, {
    id: 'homogenizer',
    stage: 3,
    label: 'Homogenizer',
    labelAnchorM: [-20.5, 1.9, -14],
    labelText: (s) => labelValue(stageValue(s, 3, 'stage1Bar'), 0, 'bar'),
    update(s, realDtS) {
      const stepRad = PISTON_RAD_PER_S * flowFrac(lineFlowLph(s, 'homogenizer')) * motionDtS(s, realDtS);
      crankRad = advancePhase(crankRad, stepRad, MAX_CRANK_PER_FRAME_RAD, FULL_TURN_RAD);
      for (let i = 0; i < pistons.length; i++) {
        pistons[i].position.z = pistonZM - originM[2] + PISTON_STROKE_M * Math.sin(crankRad + i * PISTON_PHASE_RAD);
      }
      // The needles read the pressure as it is, paused or not; a missing value leaves a needle where it was.
      for (let i = 0; i < dials.length; i++) {
        const bar = stageValue(s, 3, dials[i].key);
        if (bar !== undefined) needles[i].rotation.y = needleAngleRad(bar, dials[i].fullScaleBar);
      }
    },
    debugState: () => ({ crankRad, needle1Rad: needles[0].rotation.y, needle2Rad: needles[1].rotation.y }),
    onBuilt(object, isAlive) {
      // The model has the gauges but no needles: the grey needles stay, on its dials.
      const swap = { path: HERO_MODELS.homogenizer, nodes: ['piston_1', 'piston_2', 'piston_3'] as const, keep: needles };
      swapInHero(ctx, object, swap, (nodes) => {
        swap.nodes.forEach((name, i) => {
          nodes[name].position.z = pistons[i].position.z;
          pistons[i] = nodes[name];
        });
      }, isAlive);
    },
  });
}

/* stage 4: steam injector, holding-tube supports, flow-diversion valve, reject tank */

function steamInjector(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'steam-injector', [-17, 0, -14]);
  b.part('cylLo', 'steel', [-17, 1.0, -14], [0.18, 0.75, 0.18], { castShadow: true });
  // Puffs beside the steam inlet while the plant makes product; smaller at reduced flow.
  const steam = createPuffs(b, 'steam', 'steam', {
    fromM: [-16.8, 1.42, -13.85],
    travelM: [0.1, 0.85, 0.15],
    radiusM: 0.12,
    count: 5,
    cycleS: 1.3,
    envelope: 'swell',
  });
  return machine(b, {
    id: 'steam-injector',
    stage: 4,
    label: 'Steam injector',
    labelAnchorM: [-17, 1.8, -14],
    update: (s, realDtS) => steam.update(steamFrac(s), motionDtS(s, realDtS)),
    debugState: () => ({ steamFrac: steam.strength(), phase: steam.phase() }),
  });
}

/** The supports only: scene-core draws the coil itself between them (preview Helix, centred on -14.8, -14). */
function holdingTube(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'holding-tube', [-14.8, 0, -14]);
  for (const dxM of [-0.75, 0.75]) b.part('box', 'steelDark', [-14.8 + dxM, 1.3, -14], [0.06, 2.6, 0.06]);
  b.part('box', 'steelDark', [-14.8, 2.6, -14], [1.56, 0.06, 0.06]); // cross bar, just above the coil's top turn
  return machine(b, {
    id: 'holding-tube',
    stage: 4,
    label: 'Holding tube',
    labelAnchorM: [-14.8, 3.0, -14],
    labelText: (s) => {
      const temp = labelValue(stageValue(s, 4, 'tempC'), 1, '°C');
      const bStar = labelValue(stageValue(s, 4, 'bStar'), 2, '');
      return [temp, bStar && `B* ${bStar}`].filter(Boolean).join(' · ');
    },
  });
}

function divertValve(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'divert-valve', [-12.6, 0, -14]);
  b.part('box', 'steelDark', [-12.6, 2.5, -14], [0.45, 0.45, 0.45], { castShadow: true }); // valve body, where the routes split
  b.part('cylLo', 'steelDark', [-12.6, 2.8, -14], [0.07, 0.16, 0.07], { castShadow: true }); // stem
  // The flag points down the open outlet: +x to the flash vessel, or +z to the reject tank.
  const flag = b.pivot('flag', [-12.6, 2.9, -14]);
  b.part('box', 'paint', [0.18, 0, 0], [0.36, 0.05, 0.1], { parent: flag });
  // The lamp on top: red while diverting, amber while the plant cleans or re-sterilizes, green in production.
  // It glows in the dark theme's lamp colours there (lamps.ts), and keeps LAMP_GLOW_HEX in the light theme.
  const lampMaterial = kit.material('lamp');
  b.mesh('lamp', 'sphere', 'lamp', [-12.6, 3.02, -14], [0.07, 0.07, 0.07]);
  const palette = createLampPalette(LAMP_GLOW_HEX, LAMP_COLOR_VAR);
  let lamp: LampStatus | null = null;
  let diverting = false;
  const paintLamp = (status: LampStatus): void => {
    if (!(lampMaterial instanceof THREE.MeshStandardMaterial)) return;
    if (palette.dark) glowInDark(lampMaterial, palette.color(status));
    else {
      // The kit's lamp: a black body lit from inside.
      lampMaterial.color.setHex(0x000000);
      lampMaterial.emissive.copy(palette.color(status));
      lampMaterial.emissiveIntensity = 1;
    }
  };
  const showLamp = (status: LampStatus): void => {
    if (status === lamp) return;
    lamp = status;
    paintLamp(status);
  };
  showLamp('ok');
  return machine(b, {
    id: 'divert-valve',
    stage: 4,
    label: 'Flow-diversion valve',
    labelAnchorM: [-12.6, 3.25, -14],
    labelText: (s) => VALVE_TEXT[uhtModeOf(s)],
    update(s, realDtS) {
      const mode = uhtModeOf(s);
      diverting = mode === 'divert';
      showLamp(valveLamp(mode));
      // Rotating +x by -90° about y points it along +z. The flip follows the state even while paused.
      flag.rotation.y = ease(flag.rotation.y, diverting ? -Math.PI / 2 : 0, VALVE_EASE_PER_S, realDtS);
    },
    debugState: () => ({ diverting, lamp: lamp ?? 'ok', flagRad: flag.rotation.y }),
    applyTheme() {
      palette.applyTheme();
      paintLamp(lamp ?? 'ok');
    },
  });
}

function rejectTank(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'reject-tank', [-12.6, 0, -10.5]);
  // A steel floor, which the preview lacks, so the see-through shell still reads as a tank. No lid:
  // the stage camera looks down into the tank, and a lid would hide the level.
  b.part('cyl', 'steel', [-12.6, 0.025, -10.5], [0.8, 0.05, 0.8]);
  b.part('cyl', 'glass', [-12.6, 0.85, -10.5], [0.75, 1.6, 0.75]);
  const milkBaseM = 0.1;
  const milkFullM = 1.45;
  const milk = b.mesh('milk', 'cyl', 'milk', [-12.6, milkBaseM, -10.5], [0.7, MIN_MILK_M, 0.7]);
  // Diverted milk collects here (liquid.tanks.rejectTank) until the clean after a divert empties it.
  const level = tankLevel(milk, milkBaseM, milkFullM, 'rejectTank');
  return machine(b, {
    id: 'reject-tank',
    stage: 4,
    label: 'Reject tank',
    labelAnchorM: [-12.6, 2.1, -10.5],
    labelText: (s) => labelValue(s.liquid?.tanks?.rejectTank?.levelL, 0, 'L'),
    update: (s) => level.update(s),
    debugState: () => ({ fillFrac: level.fillFrac() }),
  });
}

/* stage 5: flash vessel with its vapour condenser, tubular cooler */

function flashVessel(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'flash-vessel', [-10, 0, -14]);
  b.legs([-10, -14], 0.7, 0.75, 3, 0.07);
  b.part('coneDown', 'steel', [-10, 0.7, -14], [0.85, 0.6, 0.85], { castShadow: true });
  b.part('cyl', 'steel', [-10, 2.5, -14], [0.85, 3.0, 0.85], { castShadow: true });
  b.part('dome', 'steel', [-10, 4.0, -14], [0.85, 0.35, 0.85], { castShadow: true });
  b.part('cyl', 'steel', [-8.25, 4.9, -14], [0.3, 1.3, 0.3], { rotationRad: [0, 0, Math.PI / 2], castShadow: true }); // vapour condenser
  // Vapour off the condenser's vent, as much as the water flashed off (the steam injected); none in a divert.
  const vapour = createPuffs(b, 'vapour', 'steam', {
    fromM: [-7.8, 5.15, -14],
    travelM: [0.35, 1.7, 0.1],
    radiusM: 0.3,
    count: 6,
    cycleS: 2.8,
    envelope: 'swell',
  });
  return machine(b, {
    id: 'flash-vessel',
    stage: 5,
    label: 'Flash vessel',
    labelAnchorM: [-10, 5.6, -14],
    labelText: (s) => labelValue(stageValue(s, 5, 'flashTempC'), 0, '°C'),
    update: (s, realDtS) => vapour.update(vapourFrac(s), motionDtS(s, realDtS)),
    debugState: () => ({ vapourFrac: vapour.strength(), phase: vapour.phase() }),
  });
}

/** The two return headers; the cooler's three passes are pipes, which scene-core draws between them. */
function tubularCooler(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'tubular-cooler', [-7.7, 0, -11.6]);
  for (const xM of [-9.45, -5.95]) {
    b.part('box', 'steelDark', [xM, 0.8, -11.6], [0.22, 1.0, 0.4]);
    b.part('box', 'steelDark', [xM, 0.15, -11.6], [0.08, 0.3, 0.08]); // a foot, which the preview lacks
  }
  return machine(b, {
    id: 'tubular-cooler',
    stage: 5,
    label: 'Tubular cooler',
    labelAnchorM: [-7.7, 1.7, -11.6],
    labelText: (s) => labelValue(stageValue(s, 5, 'coolerTempC'), 0, '°C'),
  });
}

/* stage 6: aseptic tank */

function asepticTank(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'aseptic-tank', [4, 0, -14]);
  b.legs([4, -14], 1.35, 1.0, 3, 0.1);
  b.part('cyl', 'steel', [4, 1.04, -14], [1.82, 0.08, 1.82], { castShadow: true }); // floor plate
  b.part('dome', 'steel', [4, 5.55, -14], [1.8, 0.45, 1.8], { castShadow: true });
  b.part('cylLo', 'steel', [5.3, 6.15, -14], [0.16, 0.6, 0.16], { castShadow: true }); // sterile-air filter
  // See-through, as in the preview, so the level shows from any side.
  b.part('cyl', 'glass', [4, 3.3, -14], [1.8, 4.5, 1.8]);
  const milkBaseM = 1.1;
  const milkFullM = 4.35;
  const milk = b.mesh('milk', 'cyl', 'milk', [4, milkBaseM, -14], [1.7, MIN_MILK_M, 1.7]);
  const level = tankLevel(milk, milkBaseM, milkFullM, 'asepticTank');
  return machine(b, {
    id: 'aseptic-tank',
    stage: 6,
    label: 'Aseptic tank',
    labelAnchorM: [4, 6.7, -14],
    labelText: (s) => labelValue(stageValue(s, 6, 'levelPct'), 0, '%'),
    update(s) {
      // Stage 6's levelPct stands in for a snapshot without contracts v2's tanks.
      const levelPct = stageValue(s, 6, 'levelPct');
      level.update(s, levelPct === undefined ? undefined : pctToFrac(levelPct));
    },
    debugState: () => ({ fillFrac: level.fillFrac() }),
  });
}
