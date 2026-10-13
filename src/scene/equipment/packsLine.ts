// Stages 7–10 as grey boxes: every Must item of the 3D asset list (plan 05) plus the cheap Should and
// Could items, the tray-shrink tunnel, palletizer, stretch wrapper, forklifts and a truck. Ported from
// uht-plant-preview.html ("stage 7" to "stage 10" blocks) at the preview's positions and sizes, so the
// product pipes scene-core draws reach the fillers. The accumulation table, quarantine floor markings,
// pallet rollers and dock details are not in the preview; packs/layout.ts says where they stand.
// Nothing carries packs, trays or pallets yet: phase 4 moves them along the paths in packs/layout.ts.
import * as THREE from 'three';
import type { Snapshot, StageId, Status } from '../../contracts';
import plantJson from '../../data/plant.json';
import type { PointM } from '../layout';
import { FixtureBuilder, type BuiltFixture, type InstanceM } from './packs/builder';
import { beltPlacements, createKitLoader, greyBelt, greyRollers, repeatPlacements, swapInKit, type KitLoader, type Placement } from './packs/conveyors';
import { createKit, type Kit } from './packs/kit';
import * as at from './packs/layout';
import { fillerFlowLph, kpiValue, labelValue, stageStatus, stageValue } from './packs/readings';
import { fitVehicle, greyForklift, greyTruck, type VehicleSizeM } from './packs/vehicles';
import type { Equipment, EquipmentContext, EquipmentFactory } from './types';

// Grey-box motion. It shows what runs, so it stays on under prefers-reduced-motion, but it is slower than
// the preview's (reel 1.6 rad/s, arm about 3.9 rad/s) so it reads as information, not busyness.
const REEL_RAD_PER_S = 0.9;
/** The sealing jaws ride down with the paper tube and back, once every 2.6 s or so. */
const JAW_RAD_PER_S = 2.4;
const JAW_TRAVEL_M = 0.12;
/** The palletizer arm swings from pick to place and back in about 12 s. */
const ARM_RAD_PER_S = 0.5;

/** Litres in one pack, to count the running fillers from the flow they draw. */
const PACK_VOLUME_L = plantJson.product.packVolumeL;
const FILLER_COUNT = plantJson.fillers.count;

/** The pallet on the palletizer is shown part-built (phase 4 grows it with the trays placed). */
const STACK_HEIGHT_M = 0.7;

/** Lamp colours: the light theme's --ok, --warn, --bad and --steel-dark (plan 08). */
const LAMP_COLORS: Record<Status, number> = { ok: 0x1f8f57, warn: 0xc88a00, bad: 0xc63a2b, idle: 0x76858f };

/** Warehouse pallet places filled in the static sample, until phase 4 shows the real stock. */
const SAMPLE_FILL_FRAC = 0.55;

/** Stages 7–10, packs to trucks: one Equipment per machine or fixture. */
export const packsLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  const kitLoader = createKitLoader(ctx);
  return [
    filler(kit, 'a'),
    filler(kit, 'b'),
    packConveyors(kit, kitLoader),
    accumulationTable(kit, kitLoader),
    trayShrinkTunnel(kit),
    trayConveyor(kit, kitLoader),
    palletizer(kit),
    stretchWrapper(kit),
    palletConveyor(kit, kitLoader),
    quarantine(kit),
    qaLab(kit),
    racks(kit),
    docks(kit),
    forklift(kit, ctx, 'forklift-1', [-30, 10.6], [-1, 0]),
    forklift(kit, ctx, 'forklift-2', [-42.5, 17.95], [-1, 0]),
    truck(kit, ctx),
  ];
};

/** Whether a fixture still stands, and what else to free when it goes (kit instance buffers, own materials). */
interface Lifetime {
  isAlive(): boolean;
  onEnd(cleanup: () => void): void;
  end(): void;
}

function lifetime(): Lifetime {
  let alive = true;
  const cleanups: (() => void)[] = [];
  return {
    isAlive: () => alive,
    onEnd: (cleanup) => void cleanups.push(cleanup),
    end() {
      if (!alive) return;
      alive = false;
      for (const cleanup of cleanups) cleanup();
    },
  };
}

interface MachineSpec {
  id: string;
  stage: StageId;
  label: string;
  labelAnchorM: PointM;
  labelText?: (snapshot: Snapshot) => string;
  update?: (snapshot: Snapshot, realDtS: number) => void;
}

function machine(fixture: BuiltFixture, spec: MachineSpec, life: Lifetime = lifetime()): Equipment {
  const { object } = fixture;
  object.userData = { equipmentId: spec.id, stage: spec.stage };
  return {
    id: spec.id,
    stage: spec.stage,
    label: spec.label,
    object,
    labelAnchorM: spec.labelAnchorM,
    labelText: spec.labelText ?? (() => ''),
    update: spec.update ?? (() => {}),
    dispose() {
      if (!life.isAlive()) return; // a second dispose() is harmless
      life.end();
      fixture.dispose();
    },
  };
}

/** Motion runs on real time, like the preview's, and stops while the sim is paused. */
const motionDtS = (snapshot: Snapshot, realDtS: number): number => (snapshot.paused ? 0 : realDtS);

/** True while a stage works: green or amber. Red (stopped) and idle hold still. */
const isWorking = (snapshot: Snapshot, stage: StageId): boolean => {
  const status = stageStatus(snapshot, stage);
  return status === 'ok' || status === 'warn';
};

/** Builds the fixture with its grey-box conveyor layer, then swaps in the kit pieces when they load. */
function kitConveyor(b: FixtureBuilder, greyLayer: THREE.Object3D, placements: Placement[], loader: KitLoader): { fixture: BuiltFixture; life: Lifetime } {
  const fixture = b.build();
  const life = lifetime();
  const swap = swapInKit(fixture, greyLayer, placements, loader, life.isAlive, { castShadow: true });
  life.onEnd(swap.dispose);
  return { fixture, life };
}

/* stage 7: two aseptic fillers, pack conveyors, accumulation table */

/**
 * How many fillers run. Each running filler draws its rate times the pack volume from the aseptic tank,
 * so the filler flow counts them; without it, a red stage means one filler is down (as in the mock).
 */
function runningFillers(snapshot: Snapshot): number {
  const count = stageValue(snapshot, 7, 'fillerCount') ?? FILLER_COUNT;
  const ratePacksPerH = stageValue(snapshot, 7, 'ratePacksPerH');
  const flowLph = fillerFlowLph(snapshot);
  if (ratePacksPerH !== undefined && ratePacksPerH > 0 && flowLph !== undefined) {
    return Math.min(Math.max(Math.round(flowLph / (ratePacksPerH * PACK_VOLUME_L)), 0), count);
  }
  const status = stageStatus(snapshot, 7);
  return status === 'idle' ? 0 : status === 'bad' ? count - 1 : count;
}

function filler(kit: Kit, which: 'a' | 'b'): Equipment {
  const xM = at.FILLER_X_M;
  const zM = at.FILLER_Z_M[which];
  const index = which === 'a' ? 0 : 1;
  const b = new FixtureBuilder(kit, `filler-${which}`, [xM, 0, zM]);
  b.part('box', 'panel', [xM, 1.2, zM], [3.2, 2.4, 2.2], { castShadow: true }); // cabinet
  b.part('box', 'glass', [xM, 2.95, zM], [2.0, 1.1, 1.6]); // aseptic zone
  b.part('cylLo', 'milk', [at.FILLER_INLET_M.xM, 2.95, zM], [0.13, 1.0, 0.13]); // the paper tube, full of milk
  b.part('box', 'steelDark', [xM, 3.53, zM], [2.1, 0.06, 1.7], { castShadow: true }); // top of the aseptic zone
  // Outfeed: a hood over the start of the belt, where the sealed packs leave the cabinet.
  b.part('box', 'steel', [at.FILLER_FACE_X_M + 0.15, 1.2, zM], [0.3, 0.6, 0.8], { castShadow: true });

  // The paper reel hangs on the side away from the other filler, as in the preview: A at -z, B at +z.
  const side = which === 'a' ? -1 : 1;
  // The spindle casts a shadow only so it merges with the roof's mesh: one draw call fewer.
  b.part('cylLo', 'steelDark', [19.2, 1.0, zM + side * 1.2], [0.08, 0.2, 0.08], { rotationRad: [Math.PI / 2, 0, 0], castShadow: true });
  // Named for the hero model (assets' hero spec): the reel turns about its own axis, along z.
  const reel = b.group('reel', [19.2, 1.0, zM + side * 1.42]);
  b.part('cyl', 'carton', [0, 0, 0], [0.78, 0.34, 0.78], { parent: reel, rotationRad: [Math.PI / 2, 0, 0], castShadow: true });
  b.part('box', 'steelDark', [0, 0, 0], [1.2, 0.1, 0.36], { parent: reel }); // a bar across the reel, so the turn shows

  // The sealing jaws close round the bottom of the tube inside the aseptic zone and ride down with it.
  const jawsTopM = 2.6;
  const jaws = b.group('jaws', [at.FILLER_INLET_M.xM, jawsTopM, zM]);
  for (const jawSide of [-1, 1]) b.part('box', 'steelDark', [0, 0, jawSide * 0.18], [0.34, 0.1, 0.08], { parent: jaws });

  let jawRad = 0;
  return machine(b.build(), {
    id: `filler-${which}`,
    stage: 7,
    label: `Filler ${which.toUpperCase()}`,
    labelAnchorM: [xM, 4.0, zM],
    labelText(s) {
      const ratePacksPerH = stageValue(s, 7, 'ratePacksPerH');
      if (ratePacksPerH === undefined) return '';
      return index < runningFillers(s) ? `running · ${labelValue(ratePacksPerH, 0, '')}/h` : 'stopped';
    },
    update(s, realDtS) {
      if (index >= runningFillers(s)) return;
      const dtS = motionDtS(s, realDtS);
      reel.rotation.z = (reel.rotation.z - REEL_RAD_PER_S * dtS) % (2 * Math.PI); // paper unwinds off the top
      jawRad = (jawRad + JAW_RAD_PER_S * dtS) % (2 * Math.PI);
      jaws.position.y = jawsTopM - JAW_TRAVEL_M * (0.5 - 0.5 * Math.cos(jawRad));
    },
  });
}

function packConveyors(kit: Kit, loader: KitLoader): Equipment {
  const b = new FixtureBuilder(kit, 'pack-conveyors', [28, 0, -6.5]);
  const greyLayer = b.layer('grey-box');
  greyBelt(b, greyLayer, at.PACK_BELT_PATHS, at.PACK_BELT_WIDTH_M, at.BELT_M);
  const placements = beltPlacements(at.PACK_BELT_PATHS, at.PACK_BELT_WIDTH_M, at.BELT_M, {
    end: 'conveyor-long-sides-part-end',
    middle: 'conveyor-long-sides-part-middle',
    corner: 'conveyor-corner',
  });
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  return machine(
    fixture,
    {
      id: 'pack-conveyors',
      stage: 7,
      label: 'Pack conveyors',
      labelAnchorM: [28, 1.6, -17.5],
      labelText: (s) => labelValue(kpiValue(s, 'packsPerH'), 0, 'packs/h'),
    },
    life,
  );
}

function accumulationTable(kit: Kit, loader: KitLoader): Equipment {
  const table = at.ACCUMULATION_TABLE;
  const xM = (table.xMinM + table.xMaxM) / 2;
  const zM = (table.zMinM + table.zMaxM) / 2;
  const widthM = table.xMaxM - table.xMinM;
  const path = [[[xM, table.zMinM], [xM, table.zMaxM]]] as const;
  const b = new FixtureBuilder(kit, 'accumulation-table', [xM, 0, zM]);
  const greyLayer = b.layer('grey-box');
  greyBelt(b, greyLayer, path, widthM, at.BELT_M);
  // One piece stretched over the whole table, so its rounded ends show only where the lines meet it.
  const placements = repeatPlacements(path, widthM, at.BELT_M, 'conveyor-sides', { stepM: table.zMaxM - table.zMinM });
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  return machine(fixture, { id: 'accumulation-table', stage: 7, label: 'Accumulation table', labelAnchorM: [xM, 1.6, zM] }, life);
}

/* stage 8: tray-shrink tunnel, tray rollers, palletizer, stretch wrapper, pallet rollers */

function trayShrinkTunnel(kit: Kit): Equipment {
  const [xM, yM, zM] = at.TUNNEL.centreM;
  const [, heightM, depthM] = at.TUNNEL.sizeM;
  const b = new FixtureBuilder(kit, 'tray-shrink-tunnel', [xM, 0, zM]);
  b.part('box', 'paint', at.TUNNEL.centreM, at.TUNNEL.sizeM, { castShadow: true });
  // The mouths: the two pack lines go in on the -z face, the trays come out on +z.
  for (const faceZM of [zM - depthM / 2 - 0.02, zM + depthM / 2 + 0.02]) b.part('box', 'rubber', [xM, yM, faceZM], [2.6, 0.9, 0.06]);
  return machine(b.build(), {
    id: 'tray-shrink-tunnel',
    stage: 8,
    label: 'Tray packer & shrink tunnel',
    labelAnchorM: [xM, yM + heightM / 2 + 0.4, zM],
    labelText: (s) => labelValue(stageValue(s, 8, 'packsPerTray'), 0, 'per tray'),
  });
}

function trayConveyor(kit: Kit, loader: KitLoader): Equipment {
  const b = new FixtureBuilder(kit, 'tray-conveyor', [31.5, 0, 9.9]);
  const greyLayer = b.layer('grey-box');
  greyRollers(b, greyLayer, at.TRAY_ROLLER_PATHS, at.TRAY_ROLLER_WIDTH_M, at.BELT_M, 0.05);
  const placements = repeatPlacements(at.TRAY_ROLLER_PATHS, at.TRAY_ROLLER_WIDTH_M, at.BELT_M, 'conveyor-bars-high');
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  return machine(
    fixture,
    {
      id: 'tray-conveyor',
      stage: 8,
      label: 'Tray conveyor',
      labelAnchorM: [33, 1.6, 10.4],
      labelText(s) {
        const packsPerH = kpiValue(s, 'packsPerH');
        const packsPerTray = stageValue(s, 8, 'packsPerTray');
        if (packsPerH === undefined || !packsPerTray) return '';
        return labelValue(packsPerH / packsPerTray, 0, 'trays/h');
      },
    },
    life,
  );
}

/** Arm angle (about y) that points the arm from its hinge at a floor point. */
function armRadToward(pointM: at.FloorPointM): number {
  return Math.atan2(-(pointM[1] - at.PALLETIZER_M[2]), pointM[0] - at.PALLETIZER_M[0]);
}

function palletizer(kit: Kit): Equipment {
  const [xM, , zM] = at.PALLETIZER_M;
  const b = new FixtureBuilder(kit, 'palletizer', at.PALLETIZER_M);
  b.part('cyl', 'paint', [xM, 0.3, zM], [0.55, 0.6, 0.55], { castShadow: true }); // base
  b.part('cylLo', 'paint', [xM, 1.45, zM], [0.22, 1.7, 0.22], { castShadow: true }); // column
  // Named for the hero model (assets' hero spec): the arm turns about y on top of the column.
  const arm = b.group('arm', [xM, at.ARM_HINGE_Y_M, zM]);
  b.part('box', 'paint', [1.22, 0, 0], [2.45, 0.2, 0.26], { parent: arm, castShadow: true });
  b.part('cylLo', 'steelDark', [2.45, -0.35, 0], [0.06, 0.6, 0.06], { parent: arm });
  b.part('box', 'steelDark', [2.45, -0.7, 0], [0.55, 0.14, 0.45], { parent: arm, castShadow: true }); // gripper
  // The pallet being built, on the pallet rollers under the place point.
  const [placeXM, placeZM] = at.PLACE_M;
  const palletTopM = at.PALLET_ROLLER_TOP_M + 0.16;
  b.part('box', 'wood', [placeXM, at.PALLET_ROLLER_TOP_M + 0.08, placeZM], [1.5, 0.16, 1.15]);
  b.mesh('stack', 'box', 'carton', [placeXM, palletTopM + STACK_HEIGHT_M / 2, placeZM], [1.42, STACK_HEIGHT_M, 1.08], { castShadow: true });

  // The preview's angles: the long way round would sweep over the tray line, so it swings via -z.
  const pickRad = armRadToward(at.PICK_M);
  const placeRad = armRadToward(at.PLACE_M) + 2 * Math.PI;
  arm.rotation.y = pickRad;
  let swingRad = 0;
  return machine(b.build(), {
    id: 'palletizer',
    stage: 8,
    label: 'Palletizer',
    labelAnchorM: [xM, 3.0, zM],
    labelText: (s) => labelValue(stageValue(s, 8, 'traysPerPallet'), 0, 'trays/pallet'),
    update(s, realDtS) {
      if (!isWorking(s, 8)) return;
      swingRad = (swingRad + ARM_RAD_PER_S * motionDtS(s, realDtS)) % (2 * Math.PI);
      arm.rotation.y = pickRad + (placeRad - pickRad) * (0.5 - 0.5 * Math.cos(swingRad));
    },
  });
}

function stretchWrapper(kit: Kit): Equipment {
  const [xM, zM] = at.WRAPPER_M;
  const b = new FixtureBuilder(kit, 'stretch-wrapper', [xM, 0, zM]);
  const radiusM = at.TURNTABLE_RADIUS_M;
  // The turntable is flush with the pallet rollers either side of it.
  b.part('cyl', 'steelDark', [xM, at.PALLET_ROLLER_TOP_M / 2, zM], [radiusM, at.PALLET_ROLLER_TOP_M, radiusM]);
  b.part('box', 'steelDark', [20.15, 0.05, 13.35], [0.5, 0.1, 0.5]); // mast foot
  b.part('box', 'paint', [20.15, 1.35, 13.35], [0.2, 2.7, 0.2], { castShadow: true }); // mast
  // The film carriage rides up and down the mast while a pallet turns (phase 4).
  b.mesh('carriage', 'box', 'steelDark', [20.35, 0.6, 13.5], [0.32, 0.22, 0.5]);
  return machine(b.build(), { id: 'stretch-wrapper', stage: 8, label: 'Stretch wrapper', labelAnchorM: [xM - 0.6, 3.1, zM - 0.5] });
}

function palletConveyor(kit: Kit, loader: KitLoader): Equipment {
  const b = new FixtureBuilder(kit, 'pallet-conveyor', [20.8, 0, 14.4]);
  const greyLayer = b.layer('grey-box');
  greyRollers(b, greyLayer, at.PALLET_ROLLER_PATHS, at.PALLET_ROLLER_WIDTH_M, at.PALLET_ROLLER_TOP_M, 0.06);
  const placements = repeatPlacements(at.PALLET_ROLLER_PATHS, at.PALLET_ROLLER_WIDTH_M, at.PALLET_ROLLER_TOP_M, 'conveyor-bars');
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  return machine(
    fixture,
    {
      id: 'pallet-conveyor',
      stage: 8,
      label: 'Pallet conveyor',
      labelAnchorM: [17.5, 0.9, 14.4],
      labelText: (s) => labelValue(kpiValue(s, 'palletsMade'), 0, 'pallets'),
    },
    life,
  );
}

/* stage 9: quarantine floor and QA lab */

const MARKING_Y_M = 0.055; // just above the zone floor (0.04 m) and the apron (0.03 m)
const MARKING_THICK_M = 0.02;

function quarantine(kit: Kit): Equipment {
  const q = at.QUARANTINE;
  const xM = (q.xMinM + q.xMaxM) / 2;
  const zM = (q.zMinM + q.zMaxM) / 2;
  const b = new FixtureBuilder(kit, 'quarantine', [xM, 0, zM]);
  // A solid amber border round the hold area (the preview's hatch line), then dashed lanes between the
  // rows of pallet blocks, so the blocks of phase 4 have their places on the floor.
  const lineM = 0.16;
  for (const edgeZM of [q.zMinM, q.zMaxM]) b.part('box', 'marking', [xM, MARKING_Y_M, edgeZM], [q.xMaxM - q.xMinM + lineM, MARKING_THICK_M, lineM]);
  for (const edgeXM of [q.xMinM, q.xMaxM]) b.part('box', 'marking', [edgeXM, MARKING_Y_M, zM], [lineM, MARKING_THICK_M, q.zMaxM - q.zMinM]);
  const dashM = 0.7;
  const gapM = 0.5;
  const rows = at.QUARANTINE_ROW_Z_M;
  for (let i = 1; i < rows.length; i++) {
    const laneZM = ((rows[i - 1] as number) + (rows[i] as number)) / 2;
    for (let dashXM = q.xMinM + 0.4; dashXM + dashM <= q.xMaxM - 0.4; dashXM += dashM + gapM) {
      b.part('box', 'marking', [dashXM + dashM / 2, MARKING_Y_M, laneZM], [dashM, MARKING_THICK_M, lineM * 0.75]);
    }
  }
  return machine(b.build(), {
    id: 'quarantine',
    stage: 9,
    label: 'Quarantine',
    // On the front edge, nearest the camera: the area itself fills with pallet blocks in phase 4.
    labelAnchorM: [xM, 0.5, q.zMaxM],
    labelText(s) {
      const days = labelValue(stageValue(s, 9, 'incubationDays'), 0, 'd');
      return days && `hold ${days}`;
    },
  });
}

function qaLab(kit: Kit): Equipment {
  const [xM, , zM] = at.QA_LAB.centreM;
  const [widthM, heightM, depthM] = at.QA_LAB.sizeM;
  const frontZM = zM + depthM / 2;
  const b = new FixtureBuilder(kit, 'qa-lab', [xM, 0, (zM - depthM / 2 + at.INCUBATOR_Z_M + 0.25) / 2]);
  b.part('box', 'panel', at.QA_LAB.centreM, at.QA_LAB.sizeM, { castShadow: true });
  b.part('box', 'steelDark', [xM, heightM + 0.05, zM], [widthM + 0.2, 0.1, depthM + 0.2], { castShadow: true }); // roof
  b.part('box', 'glass', [xM, 1.6, frontZM + 0.02], [1.8, 0.8, 0.04]); // window
  b.part('box', 'rubber', [xM - widthM / 2 - 0.02, 1.05, zM - 1.0], [0.04, 2.1, 0.9]); // door, toward the quarantine area
  // The sample incubators (55 °C), each with a status lamp on top.
  const lampMaterial = new THREE.MeshStandardMaterial({ roughness: 0.3 });
  const lamps: InstanceM[] = [];
  for (const incubatorXM of at.INCUBATOR_X_M) {
    b.part('box', 'steel', [incubatorXM, 0.5, at.INCUBATOR_Z_M], [0.66, 1.0, 0.5], { castShadow: true });
    b.part('box', 'steelDark', [incubatorXM, 0.55, at.INCUBATOR_Z_M + 0.26], [0.5, 0.7, 0.02]); // door
    lamps.push({ atM: [incubatorXM, 1.08, at.INCUBATOR_Z_M], sizeM: [0.08, 0.08, 0.08] });
  }
  b.instanced('lamps', 'sphere', lampMaterial, lamps);
  const life = lifetime();
  life.onEnd(() => lampMaterial.dispose());
  let shown: Status | null = null;
  const show = (status: Status): void => {
    if (status === shown) return;
    shown = status;
    const color = LAMP_COLORS[status];
    lampMaterial.color.setHex(color);
    lampMaterial.emissive.setHex(status === 'idle' ? 0x000000 : color);
    lampMaterial.emissiveIntensity = status === 'idle' ? 0 : 0.85;
  };
  show('idle');
  return machine(
    b.build(),
    {
      id: 'qa-lab',
      stage: 9,
      label: 'QA lab',
      labelAnchorM: [xM, heightM + 0.5, zM],
      labelText: (s) => labelValue(stageValue(s, 9, 'incubationTempC'), 0, '°C'),
      update: (s) => show(stageStatus(s, 9) ?? 'idle'),
    },
    life,
  );
}

/* stage 10: racks, docks, forklifts, truck */

/** A fixed pseudo-random share of places, the same on every load, so the static sample doesn't flicker. */
function sampleFilled(index: number): boolean {
  const hash = Math.imul(index + 1, 2654435761) >>> 0;
  return hash / 2 ** 32 < SAMPLE_FILL_FRAC;
}

function racks(kit: Kit): Equipment {
  const midXM = at.RACK_X0_M + (at.RACK_BAYS * at.RACK_BAY_M) / 2;
  const zMidM = (at.RACK_Z_M[0] + at.RACK_Z_M[at.RACK_Z_M.length - 1]) / 2;
  const b = new FixtureBuilder(kit, 'racks', [midXM, 0, zMidM]);
  const uprights: InstanceM[] = [];
  const beams: InstanceM[] = [];
  for (const zM of at.RACK_Z_M) {
    for (const sideM of [-at.RACK_HALF_DEPTH_M, at.RACK_HALF_DEPTH_M]) {
      for (let i = 0; i <= at.RACK_BAYS; i++) {
        uprights.push({ atM: [at.RACK_X0_M + i * at.RACK_BAY_M, at.RACK_HEIGHT_M / 2, zM + sideM], sizeM: [0.09, at.RACK_HEIGHT_M, 0.09] });
      }
      for (const yM of at.RACK_BEAM_Y_M) beams.push({ atM: [midXM, yM, zM + sideM], sizeM: [at.RACK_BAYS * at.RACK_BAY_M, 0.12, 0.07] });
    }
  }
  b.instanced('uprights', 'box', 'steelDark', uprights, { castShadow: true });
  b.instanced('beams', 'box', 'rack', beams, { castShadow: true });

  // A static sample of stock; phase 4 sets the counts from the snapshot. Room for every place.
  const slots = at.rackSlots();
  const filled = slots.filter((_, i) => sampleFilled(i));
  const p = at.RACK_PALLET;
  const pallets = filled.map((s): InstanceM => ({ atM: [s.xM, s.yM + p.heightM / 2, s.zM], sizeM: [p.widthM, p.heightM, p.depthM] }));
  const loads = filled.map((s): InstanceM => ({
    atM: [s.xM, s.yM + p.heightM + p.loadHeightM / 2, s.zM],
    sizeM: [p.widthM - 0.04, p.loadHeightM, p.depthM - 0.08],
  }));
  b.instanced('pallets', 'box', 'wood', pallets, { capacity: slots.length });
  b.instanced('loads', 'box', 'carton', loads, { capacity: slots.length, castShadow: true });

  return machine(b.build(), {
    id: 'racks',
    stage: 10,
    label: 'Racks',
    labelAnchorM: [midXM, at.RACK_HEIGHT_M + 0.4, zMidM],
    labelText: (s) => labelValue(stageValue(s, 10, 'palletsPerTruck'), 0, 'per truck'),
  });
}

function docks(kit: Kit): Equipment {
  const midXM = at.DOOR_X_M[1];
  const b = new FixtureBuilder(kit, 'docks', [midXM, 0, at.DOOR_Z_M]);
  for (const xM of at.DOOR_X_M) {
    b.part('box', 'rubber', [xM, 1.9, at.DOOR_Z_M], [3.4, 3.8, 0.3], { castShadow: true }); // door frame
    b.part('box', 'steel', [xM, 1.8, at.DOOR_Z_M + 0.17], [3.0, 3.4, 0.06]); // roller door
    for (const side of [-1, 1]) {
      b.part('box', 'rubber', [xM + side * 1.35, 1.0, at.DOOR_Z_M + 0.25], [0.3, 0.45, 0.2]); // bumper
      // Guide lines on the apron, a truck's width apart.
      b.part('box', 'marking', [xM + side * 1.65, MARKING_Y_M, at.DOCKED_TAIL_Z_M + 6], [0.12, MARKING_THICK_M, 11]);
    }
  }
  return machine(b.build(), {
    id: 'docks',
    stage: 10,
    label: 'Loading docks',
    labelAnchorM: [midXM, 4.3, at.DOOR_Z_M],
    labelText(s) {
      const trucks = kpiValue(s, 'trucksShipped');
      return trucks === undefined ? '' : `${labelValue(trucks, 0, '')} trucks out`;
    },
  });
}

/**
 * A vehicle: its grey box at once, the assets lane's model in its place when it loads (the grey box
 * stays if the file is missing). Built facing +z round its own centre, then turned to `dir` and placed.
 */
function vehicle(
  kit: Kit,
  ctx: EquipmentContext,
  spec: { id: string; label: string; modelPath: string; size: VehicleSizeM; atM: at.FloorPointM; dir: at.FloorPointM },
  buildGrey: (b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM) => void,
): Equipment {
  const b = new FixtureBuilder(kit, spec.id, [0, 0, 0]);
  const greyLayer = b.layer('grey-box');
  buildGrey(b, greyLayer, spec.size);
  const fixture = b.build();
  fixture.object.position.set(spec.atM[0], 0, spec.atM[1]);
  fixture.object.rotation.y = Math.atan2(spec.dir[0], spec.dir[1]); // turns +z toward dir
  const life = lifetime();
  // The model belongs to the host's cache (the host clones it per call), so it is never disposed here.
  ctx.loadModel(spec.modelPath).then(
    (model) => {
      if (!life.isAlive()) return;
      const fitted = fitVehicle(model, spec.size);
      fixture.release(greyLayer);
      fixture.object.add(fitted);
    },
    () => {}, // no model (yet): the grey box stays
  );
  return machine(
    fixture,
    { id: spec.id, stage: 10, label: spec.label, labelAnchorM: [spec.atM[0], spec.size.heightM + 0.4, spec.atM[1]] },
    life,
  );
}

function forklift(kit: Kit, ctx: EquipmentContext, id: string, atM: at.FloorPointM, dir: at.FloorPointM): Equipment {
  return vehicle(kit, ctx, { id, label: 'Forklift', modelPath: 'vehicles/forklift.glb', size: at.FORKLIFT_SIZE_M, atM, dir }, greyForklift);
}

/** A truck backed up to the middle dock door, as the preview's truck stands while it loads. */
function truck(kit: Kit, ctx: EquipmentContext): Equipment {
  const atM: at.FloorPointM = [at.DOOR_X_M[1], at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM / 2];
  return vehicle(kit, ctx, { id: 'truck', label: 'Truck', modelPath: 'vehicles/truck.glb', size: at.TRUCK_SIZE_M, atM, dir: [0, 1] }, greyTruck);
}
