// Stages 1–6 as grey boxes: every Must item of the 3D asset list (plan 05) plus two cheap Should items,
// the standardization skid and the balance tank with its pump. Ported from uht-plant-preview.html
// ("stage 1" to "stage 6" blocks) at the preview's positions and sizes, so the pipe routes scene-core
// draws from the same file meet each machine. The holding-tube coil and every pipe belong to
// scene-core; this module stands the machines between them. The boiler house (Could) is left out.
import type * as THREE from 'three';
import { lphToLps, pctToFrac, type Snapshot, type StageId } from '../../contracts';
import plantJson from '../../data/plant.json';
import type { PointM } from '../layout';
import { MachineBuilder } from './liquid/builder';
import { createKit, type Kit } from './liquid/kit';
import { labelValue, lineFlowLph, stageValue } from './liquid/readings';
import type { Equipment, EquipmentFactory } from './types';

// Grey-box motion. It shows what runs, so it stays on under prefers-reduced-motion, but it is slower
// than the preview's (bowl 9, agitator 2.2, pistons 11 rad/s) so it reads as information, not busyness.
const BOWL_RAD_PER_S = 4;
/** How fast the bowl spins up or down when the flow starts or stops (fraction of the gap per second). */
const BOWL_EASE_PER_S = 1.5;
const AGITATOR_RAD_PER_S = 1.2;
/** Piston cycle at full UHT flow; slower at reduced flow, still at zero flow. */
const PISTON_RAD_PER_S = 7;
const PISTON_STROKE_M = 0.12;
/** The three cranks sit a third of a turn apart. */
const PISTON_PHASE_RAD = (2 * Math.PI) / 3;
const VALVE_EASE_PER_S = 8;

/** Lowest milk shown in a tank, so an empty one still shows its floor (as the preview does). */
const MIN_MILK_M = 0.01;

/** Full-flow reference for the homogenizer's stroke rate. */
const UHT_CAPACITY_LPH = plantJson.uht.capacityLph;
/** The reject tank's volume, for its milk level. */
const REJECT_TANK_L = plantJson.uht.rejectTankL;
/** The preview empties a full reject tank during the re-sterilization that follows a divert. */
const REJECT_DRAIN_LPS = REJECT_TANK_L / plantJson.uht.sterilizeS;

/** The liquid line, stages 1–6: one Equipment per machine. */
export const liquidLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  return [
    silo(kit, 'silo-a', 'Silo A', -18.5),
    silo(kit, 'silo-b', 'Silo B', -9.5),
    separator(kit),
    standardizationSkid(kit),
    mixingTank(kit),
    balanceTank(kit),
    plateHeatExchanger(kit),
    deaerator(kit),
    homogenizer(kit),
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
}

function machine(builder: MachineBuilder, spec: MachineSpec): Equipment {
  const { object, dispose } = builder.build();
  object.userData = { equipmentId: spec.id, stage: spec.stage };
  return {
    id: spec.id,
    stage: spec.stage,
    label: spec.label,
    object,
    labelAnchorM: spec.labelAnchorM,
    labelText: spec.labelText ?? (() => ''),
    update: spec.update ?? (() => {}),
    dispose,
  };
}

/** Motion runs on real time, like the preview's, and stops while the sim is paused. */
const motionDtS = (snapshot: Snapshot, realDtS: number): number => (snapshot.paused ? 0 : realDtS);

/** Moves `current` toward `target` by a share of the gap that grows with dt, without overshooting. */
const ease = (current: number, target: number, ratePerS: number, dtS: number): number =>
  current + (target - current) * Math.min(1, ratePerS * dtS);

/** Raises a unit-cylinder milk surface to `levelFrac` of the tank's fill height. */
function setMilkLevel(milk: THREE.Mesh, baseM: number, fullM: number, levelFrac: number): void {
  const heightM = Math.max(MIN_MILK_M, Math.min(Math.max(levelFrac, 0), 1) * fullM);
  milk.scale.y = heightM;
  milk.position.y = baseM + heightM / 2;
}

/* stage 1: silos, separator, standardization skid, mixing tank */

function silo(kit: Kit, id: string, label: string, zM: number): Equipment {
  const b = new MachineBuilder(kit, id, [-59, 0, zM]);
  b.part('cyl', 'steelDark', [-59, 0.3, zM], [2.45, 0.6, 2.45]); // plinth ring
  b.part('cyl', 'steel', [-59, 5.6, zM], [2.2, 10, 2.2], { castShadow: true });
  b.part('dome', 'steel', [-59, 10.6, zM], [2.2, 0.8, 2.2], { castShadow: true });
  b.part('box', 'steelDark', [-56.75, 5.6, zM], [0.08, 9.6, 0.5]); // ladder, on the side the outlet pipe leaves
  return machine(b, {
    id,
    stage: 1,
    label,
    labelAnchorM: [-59, 11.9, zM],
    labelText: (s) => labelValue(stageValue(s, 1, 'siloTempC'), 0, '°C'),
  });
}

function separator(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'separator', [-51.5, 0, -14]);
  b.part('box', 'paint', [-51.5, 0.4, -14], [1.7, 0.8, 1.7], { castShadow: true }); // frame
  b.part('box', 'paint', [-51.5, 0.4, -15.55], [0.8, 0.8, 1.0], { castShadow: true }); // motor
  // The node the hero model keeps (assets' hero spec): everything that spins with the disc stack.
  const bowl = b.pivot('bowl', [-51.5, 1.35, -14]);
  b.part('cyl8', 'steel', [0, 0, 0], [0.6, 1.1, 0.6], { parent: bowl, castShadow: true });
  b.part('coneUp', 'steel', [0, 0.75, 0], [0.6, 0.4, 0.6], { parent: bowl, castShadow: true });
  b.part('box', 'steelDark', [0.56, 0, 0], [0.12, 0.9, 0.16], { parent: bowl }); // a fin, so the spin shows
  // Already turning on the first frame, as in the preview; it spins down if the flow stops.
  let spinRadPerS = BOWL_RAD_PER_S;
  return machine(b, {
    id: 'separator',
    stage: 1,
    label: 'Separator',
    labelAnchorM: [-51.5, 2.75, -14],
    labelText: (s) => labelValue(stageValue(s, 1, 'separatorTempC'), 0, '°C'),
    update(s, realDtS) {
      const dtS = motionDtS(s, realDtS);
      spinRadPerS = ease(spinRadPerS, lineFlowLph(s, 'separator') > 0 ? BOWL_RAD_PER_S : 0, BOWL_EASE_PER_S, dtS);
      bowl.rotation.y = (bowl.rotation.y + spinRadPerS * dtS) % (2 * Math.PI);
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
  return machine(b, {
    id: 'mixing-tank',
    stage: 1,
    label: 'Mixing tank',
    labelAnchorM: [-42.4, 5.7, -14],
    // It is the UHT feed tank of stages.json: the milk leaves it cold for the preheater.
    labelText: (s) => labelValue(stageValue(s, 1, 'feedTankTempC'), 0, '°C'),
    update(s, realDtS) {
      agitator.rotation.y = (agitator.rotation.y + AGITATOR_RAD_PER_S * motionDtS(s, realDtS)) % (2 * Math.PI);
    },
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
  b.instanced('plates', 'box', 'steel', plates, true);
  return machine(b, {
    id: 'plate-heat-exchanger',
    stage: 2,
    label: 'Plate heat exchanger',
    labelAnchorM: [-28.9, 2.65, -14],
    labelText: (s) => labelValue(stageValue(s, 2, 'preheatTempC'), 0, '°C'),
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
  return machine(b, {
    id: 'deaerator',
    stage: 2,
    label: 'Deaerator',
    labelAnchorM: [-24.8, 4.9, -14],
    labelText: (s) => labelValue(stageValue(s, 2, 'deaeratorTempC'), 0, '°C'),
  });
}

/* stage 3: homogenizer */

function homogenizer(kit: Kit): Equipment {
  const originM: PointM = [-20.5, 0, -14];
  const b = new MachineBuilder(kit, 'homogenizer', originM);
  b.part('box', 'steelDark', [-20.5, 0.1, -14], [2.5, 0.2, 1.5]); // base frame
  b.part('box', 'paint', [-20.5, 0.75, -14], [2.2, 1.1, 1.3], { castShadow: true }); // crankcase
  b.part('cyl', 'paint', [-20.5, 0.55, -15.35], [0.42, 1.2, 0.42], { rotationRad: [0, 0, Math.PI / 2], castShadow: true }); // main motor
  for (const xM of [-21.0, -20.1]) b.part('cylLo', 'gauge', [xM, 1.34, -13.75], [0.13, 0.06, 0.13]); // stage 1 and 2 gauges
  // Named for the hero model (assets' hero spec): piston_1 to piston_3, left to right, stroking along z.
  const pistonZM = -13.1;
  const pistons = [-21.1, -20.5, -19.9].map((xM, i) =>
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
      const flowFrac = Math.min(Math.max(lineFlowLph(s, 'homogenizer') / UHT_CAPACITY_LPH, 0), 1);
      crankRad = (crankRad + PISTON_RAD_PER_S * flowFrac * motionDtS(s, realDtS)) % (2 * Math.PI);
      pistons.forEach((piston, i) => {
        piston.position.z = pistonZM - originM[2] + PISTON_STROKE_M * Math.sin(crankRad + i * PISTON_PHASE_RAD);
      });
    },
  });
}

/* stage 4: steam injector, holding-tube supports, flow-diversion valve, reject tank */

function steamInjector(kit: Kit): Equipment {
  const b = new MachineBuilder(kit, 'steam-injector', [-17, 0, -14]);
  b.part('cylLo', 'steel', [-17, 1.0, -14], [0.18, 0.75, 0.18], { castShadow: true });
  return machine(b, {
    id: 'steam-injector',
    stage: 4,
    label: 'Steam injector',
    labelAnchorM: [-17, 1.8, -14],
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
  return machine(b, {
    id: 'divert-valve',
    stage: 4,
    label: 'Flow-diversion valve',
    labelAnchorM: [-12.6, 3.25, -14],
    labelText: (s) => (lineFlowLph(s, 'divert') > 0 ? 'diverting' : 'forward'),
    update(s, realDtS) {
      // Rotating +x by -90° about y points it along +z. The flip follows the state even while paused.
      const targetRad = lineFlowLph(s, 'divert') > 0 ? -Math.PI / 2 : 0;
      flag.rotation.y = ease(flag.rotation.y, targetRad, VALVE_EASE_PER_S, realDtS);
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
  setMilkLevel(milk, milkBaseM, milkFullM, 0);
  // The snapshot has no reject-tank contents yet (contracts v1), so the tank sums the divert flow itself.
  // While nothing is diverted it empties at the preview's rate, a full tank over one re-sterilization,
  // so a run with many diverts (the mock) doesn't leave it full for good.
  let rejectL = 0;
  let lastTimeS: number | null = null;
  return machine(b, {
    id: 'reject-tank',
    stage: 4,
    label: 'Reject tank',
    labelAnchorM: [-12.6, 2.1, -10.5],
    labelText: () => labelValue(rejectL, 0, 'L'),
    update(s) {
      if (lastTimeS !== null) {
        const simDtS = s.timeS - lastTimeS;
        const inLps = lphToLps(lineFlowLph(s, 'divert'));
        const changeLps = inLps > 0 ? inLps : -REJECT_DRAIN_LPS;
        // Time running backwards means a fresh sim: start empty.
        rejectL = simDtS < 0 ? 0 : Math.min(Math.max(rejectL + changeLps * simDtS, 0), REJECT_TANK_L);
      }
      lastTimeS = s.timeS;
      setMilkLevel(milk, milkBaseM, milkFullM, rejectL / REJECT_TANK_L);
    },
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
  return machine(b, {
    id: 'flash-vessel',
    stage: 5,
    label: 'Flash vessel',
    labelAnchorM: [-10, 5.6, -14],
    labelText: (s) => labelValue(stageValue(s, 5, 'flashTempC'), 0, '°C'),
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
  setMilkLevel(milk, milkBaseM, milkFullM, 0);
  return machine(b, {
    id: 'aseptic-tank',
    stage: 6,
    label: 'Aseptic tank',
    labelAnchorM: [4, 6.7, -14],
    labelText: (s) => labelValue(stageValue(s, 6, 'levelPct'), 0, '%'),
    update(s) {
      const levelPct = stageValue(s, 6, 'levelPct');
      if (levelPct !== undefined) setMilkLevel(milk, milkBaseM, milkFullM, pctToFrac(levelPct));
    },
  });
}
