// Stages 7–10 as grey boxes: every Must item of the 3D asset list (plan 05) plus the cheap Should and
// Could items, the tray-shrink tunnel, palletizer, stretch wrapper, forklifts and trucks. Ported from
// uht-plant-preview.html ("stage 7" to "stage 10" blocks) at the preview's positions and sizes, so the
// product pipes scene-core draws reach the fillers. The accumulation table, quarantine floor markings,
// pallet rollers and dock details are not in the preview; packs/layout.ts says where they stand.
// Since phase 4 they move with Snapshot.packs (contracts v3): a sample of cartons and trays rides the belts
// (packs/belts.ts), the palletizer's pallet grows with its trays, closed pallets are wrapped and ride to
// their batch's block in quarantine (packs/palletTraffic.ts, packs/quarantineBlocks.ts), the racks hold the
// stock, forklifts shuttle while trucks load, and trucks dock at their doors and leave.
import * as THREE from 'three';
import type { Snapshot, StageId, Status } from '../../contracts';
import plantJson from '../../data/plant.json';
import { createLampPalette, DARK_LAMP_GLOW, glowInDark, type LampPalette } from '../lamps';
import type { PointM } from '../layout';
import { motionDtS as busyMotionDtS, motionRate } from '../motion';
import { LAMP_COLOR_VAR, type SceneColorVar } from '../theme';
import { HERO_MODELS, swapInHero } from './heroes';
import { createTokenStream, PACK_BELT_SPEED_MPS, TRAY_BELT_SPEED_MPS, type TokenStream } from './packs/belts';
import { FixtureBuilder, type BuiltFixture, type InstanceM } from './packs/builder';
import { createAisleLocks, createForkliftDriver, type AisleLocks, type ForkliftInputs, type ForkliftRole, type PalletPose } from './packs/forkliftJobs';
import { beltPlacements, createKitLoader, greyBelt, greyRollers, repeatPlacements, swapInKit, type KitLoader, type Placement } from './packs/conveyors';
import { createKit, type Kit, type PrintName } from './packs/kit';
import * as at from './packs/layout';
import {
  ARM_CLAMP_AT_M,
  ARM_LIFT_AT_M,
  ARM_WRIST_AT_M,
  BOOM_TOP_M,
  CARRIED_TRAY_Y_M,
  CLAMP_FACE_M,
  createPalletizing,
  fenceParts,
  GRIPPER_BOTTOM_M,
  MAX_REACH_M,
  PALLET_M,
  STACK_CAPACITY,
  STACK_TRAY_SIZE_M,
  stackInstances,
} from './packs/palletizing';
import { createPalletTraffic, PALLET_SPEED_MPS, type PalletTraffic } from './packs/palletTraffic';
import { createQuarantineBlocks, type QuarantineBlocks } from './packs/quarantineBlocks';
import { fillerFlowLph, kpiValue, labelValue, stageStatus, stageValue } from './packs/readings';
import {
  CARRIAGE_AT_M,
  createFilmWeb,
  createWrapPose,
  FILM_EXIT_AT_M,
  FILM_EXIT_RADIUS_M,
  MAST_AT_M,
  MAST_HEIGHT_M,
  ROLL_AT_M,
  ROLL_HEIGHT_M,
  ROLL_RADIUS_M,
  TURNTABLE_AT_M,
  WRAP_CYCLE_S,
  wrapPoseAt,
} from './packs/stretchWrap';
import { CARTON_PITCH_M, CARTON_SIZE_M, LINE_A_START_M, LINE_B_START_M, TRAY_PITCH_M, TRAY_SIZE_M, cartonPlaces, tokenInstances, trayPlaces } from './packs/tokens';
import { createBays, stepBays, type Bay, type DoorTruck, type SimClock } from './packs/truckMoves';
import {
  CARGO_FRONT_Z_M,
  CARGO_TAIL_Z_M,
  DOOR_OPEN_RAD,
  FORKLIFT_NODES,
  TRAILER_DECK_M,
  TRUCK_NODES,
  fitVehicle,
  greyForklift,
  greyTruck,
  nodeUnitM,
  type TruckNode,
  type VehicleSizeM,
} from './packs/vehicles';
import type { Equipment, EquipmentContext, EquipmentFactory } from './types';

// Grey-box motion. It shows what runs, so it stays on under prefers-reduced-motion, but it is slower than
// the preview's (reel 1.6 rad/s, arm about 3.9 rad/s) so it reads as information, not busyness.
const REEL_RAD_PER_S = 0.9;
/** The sealing jaws ride down with the paper tube and back, once every 2.6 s or so. */
const JAW_RAD_PER_S = 2.4;
const JAW_TRAVEL_M = 0.12;

/** Litres in one pack, to count the running fillers from the flow they draw. */
const PACK_VOLUME_L = plantJson.product.packVolumeL;
const FILLER_COUNT = plantJson.fillers.count;

/** Pallets of stock a rack place stands for: the racks' 384 places then hold 1,920, D11's 634 and about 39 days of growth (H43). */
export const PALLETS_PER_RACK_PLACE = 5;

/** Lamp colours: the light theme's --ok, --warn, --bad and --steel-dark (plan 08); the dark theme's tokens there (lamps.ts). */
const LAMP_COLORS: Record<Status, number> = { ok: 0x1f8f57, warn: 0xa87400, bad: 0xc63a2b, idle: 0x76858f };
const LAMP_COLOR_VARS: Record<Status, SceneColorVar> = { ...LAMP_COLOR_VAR, idle: '--steel-dark' };
/** An idle lamp gives off nothing. */
const BLACK = new THREE.Color(0x000000);

/** Stages 7–10, packs to trucks: one Equipment per machine or fixture. */
export const packsLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  const kitLoader = createKitLoader(ctx);
  // Shared by the fixtures that hand pallets on: the quarantine's blocks, and the pallets riding to them.
  const blocks = createQuarantineBlocks(kit.shape('box'), kit.shape('sphere'), kit.material('carton'));
  const traffic = createPalletTraffic(kit.shape('box'), kit.material('wood'), kit.material('carton'));
  // Shared by the warehouse's fixtures: the trucks' bays, the forklifts' aisle locks and pallets (stage 10).
  const warehouse = createWarehouse(kit);
  return [
    filler(kit, ctx, 'a'),
    filler(kit, ctx, 'b'),
    packConveyors(kit, kitLoader),
    accumulationTable(kit, kitLoader),
    trayShrinkTunnel(kit),
    trayConveyor(kit, kitLoader),
    palletizer(kit, ctx),
    stretchWrapper(kit, ctx, traffic),
    palletConveyor(kit, kitLoader, traffic, blocks),
    quarantine(kit, blocks),
    qaLab(kit),
    racks(kit),
    docks(kit, warehouse),
    forklift(kit, ctx, 'forklift-1', 'putAway', warehouse),
    forklift(kit, ctx, 'forklift-2', 'loading', warehouse),
    trucks(kit, ctx, warehouse),
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
  debugState?: () => Readonly<Record<string, number | string | boolean>>;
  batchAt?: Equipment['batchAt'];
  selectBatch?: Equipment['selectBatch'];
  batchPointM?: Equipment['batchPointM'];
  labelAnchorNowM?: Equipment['labelAnchorNowM'];
  applyTheme?: Equipment['applyTheme'];
}

function machine(fixture: BuiltFixture, spec: MachineSpec, life: Lifetime = lifetime()): Equipment {
  const { object } = fixture;
  object.userData = { equipmentId: spec.id, stage: spec.stage };
  const equipment: Equipment = {
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
  if (spec.debugState) equipment.debugState = spec.debugState;
  if (spec.batchAt) equipment.batchAt = spec.batchAt;
  if (spec.selectBatch) equipment.selectBatch = spec.selectBatch;
  if (spec.batchPointM) equipment.batchPointM = spec.batchPointM;
  if (spec.labelAnchorNowM) equipment.labelAnchorNowM = spec.labelAnchorNowM;
  if (spec.applyTheme) equipment.applyTheme = spec.applyTheme;
  return equipment;
}

/** Motion runs on real time, like the preview's, and stops while the sim is paused. */
const motionDtS = (snapshot: Snapshot, realDtS: number): number => (snapshot.paused ? 0 : realDtS);

/** True while a stage works: green or amber. Red (stopped) and idle hold still. */
const isWorking = (snapshot: Snapshot, stage: StageId): boolean => {
  const status = stageStatus(snapshot, stage);
  return status === 'ok' || status === 'warn';
};

/**
 * Shows the first `count` copies of an instanced mesh. Its bounds are refitted, so culling and picking
 * see the copies shown, and with none shown it is skipped altogether (no draw, no shadow draw).
 */
function showCopies(mesh: THREE.InstancedMesh, count: number): void {
  if (mesh.count === count) return;
  mesh.count = count;
  mesh.visible = count > 0;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

/**
 * Draws the meshes with a token print (public/textures) once it has loaded. Until then, or for good if
 * it can't load, they keep their plain material: the shared 'carton' or 'wood' look.
 */
function printOn(kit: Kit, name: PrintName, meshes: readonly THREE.Mesh[], life: Lifetime): void {
  kit.print(name).then(
    (material) => {
      if (!life.isAlive()) return;
      for (const mesh of meshes) mesh.material = material;
    },
    () => {}, // no print: the plain material stays
  );
}

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
 * Whether filler `index` runs: its state in Snapshot.packs (contracts v3). An older snapshot without it
 * falls back on counting the running fillers from the flow they draw (runningFillers), filler B first to stop.
 */
function fillerRuns(snapshot: Snapshot, index: number): boolean {
  const filler = snapshot.packs?.fillers[index];
  if (filler) return filler.state === 'running';
  return index < runningFillers(snapshot);
}

/** The palletizer and the tray line run while a packer lane packs: running or catching up, not in a batch change. */
function packerRuns(snapshot: Snapshot): boolean {
  const lanes = snapshot.packs?.packaging.lanes;
  if (!lanes) return isWorking(snapshot, 8);
  return lanes.some((lane) => lane.packerState === 'running' || lane.packerState === 'catchUp');
}

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

/** A filler's label while it does not run (contracts v3 states). */
const FILLER_LABELS: Record<'starved' | 'stopped' | 'repair' | 'cleaning', string> = {
  starved: 'waiting for milk',
  stopped: 'stopped',
  repair: 'broken down',
  cleaning: 're-sterilizing',
};

function filler(kit: Kit, ctx: EquipmentContext, which: 'a' | 'b'): Equipment {
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
  let reel: THREE.Object3D = b.group('reel', [19.2, 1.0, zM + side * 1.42]);
  b.part('cyl', 'carton', [0, 0, 0], [0.78, 0.34, 0.78], { parent: reel, rotationRad: [Math.PI / 2, 0, 0], castShadow: true });
  b.part('box', 'steelDark', [0, 0, 0], [1.2, 0.1, 0.36], { parent: reel }); // a bar across the reel, so the turn shows

  // The sealing jaws close round the bottom of the tube inside the aseptic zone and ride down with it.
  const jawsTopM = 2.6;
  let jaws: THREE.Object3D = b.group('jaws', [at.FILLER_INLET_M.xM, jawsTopM, zM]);
  for (const jawSide of [-1, 1]) b.part('box', 'steelDark', [0, 0, jawSide * 0.18], [0.34, 0.1, 0.08], { parent: jaws });

  let jawRad = 0;
  const fixture = b.build();
  const life = lifetime();
  // Filler B is the mirror image of A, so it takes the one model mirrored along z (assets' hero spec).
  const swap = { path: HERO_MODELS.filler, nodes: ['reel', 'jaws'] as const, mirrorZ: which === 'b' };
  swapInHero(ctx, fixture.object, swap, (nodes) => {
    nodes.reel.rotation.z = reel.rotation.z;
    nodes.jaws.position.y = jaws.position.y;
    ({ reel, jaws } = nodes);
  }, life.isAlive);
  return machine(fixture, {
    id: `filler-${which}`,
    stage: 7,
    label: `Filler ${which.toUpperCase()}`,
    labelAnchorM: [xM, 4.0, zM],
    labelText(s) {
      const state = s.packs?.fillers[index]?.state;
      if (state && state !== 'running') return FILLER_LABELS[state];
      const ratePacksPerH = stageValue(s, 7, 'ratePacksPerH');
      if (ratePacksPerH === undefined) return '';
      return fillerRuns(s, index) ? `running · ${labelValue(ratePacksPerH, 0, '')}/h` : 'stopped';
    },
    update(s, realDtS) {
      if (!fillerRuns(s, index)) return;
      const dtS = motionDtS(s, realDtS);
      reel.rotation.z = (reel.rotation.z - REEL_RAD_PER_S * dtS) % (2 * Math.PI); // paper unwinds off the top
      jawRad = (jawRad + JAW_RAD_PER_S * dtS) % (2 * Math.PI);
      jaws.position.y = jawsTopM - JAW_TRAVEL_M * (0.5 - 0.5 * Math.cos(jawRad));
    },
  }, life);
}

function packConveyors(kit: Kit, loader: KitLoader): Equipment {
  const originM: PointM = [28, 0, -6.5];
  const b = new FixtureBuilder(kit, 'pack-conveyors', originM);
  const greyLayer = b.layer('grey-box');
  greyBelt(b, greyLayer, at.PACK_BELT_PATHS, at.PACK_BELT_WIDTH_M, at.BELT_M);
  const placements = beltPlacements(at.PACK_BELT_PATHS, at.PACK_BELT_WIDTH_M, at.BELT_M, {
    end: 'conveyor-long-sides-part-end',
    middle: 'conveyor-long-sides-part-middle',
    corner: 'conveyor-corner',
  });
  // The 1 L cartons on both outfeeds, line A's first, in one draw. They are part of this fixture, so a
  // click on one selects stage 7. Too small for the plant-wide shadow map (a carton's shadow would be a
  // few texels, blurred away), so they only receive shadows and cost no shadow-pass draw.
  // The cartons ride both lines, line A's first, as a sample of the packs (packs/belts.ts). The copies
  // start on the preview's places, so the bounds cover both lines from the first frame.
  const streams: TokenStream[] = [
    createTokenStream(at.LINE_A, LINE_A_START_M, CARTON_PITCH_M, CARTON_SIZE_M[1]),
    createTokenStream(at.LINE_B, LINE_B_START_M, CARTON_PITCH_M, CARTON_SIZE_M[1]),
  ];
  const cartons = cartonPlaces();
  const [slotsA, slotsB] = streams.map((stream) => stream.slots) as [number, number];
  const cartonMesh = b.instanced('cartons', 'box', 'carton', tokenInstances([...cartons.a.slice(0, slotsA), ...cartons.b.slice(0, slotsB)], CARTON_SIZE_M));
  cartonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  printOn(kit, 'carton', [cartonMesh], life);
  return machine(
    fixture,
    {
      id: 'pack-conveyors',
      stage: 7,
      label: 'Pack conveyors',
      labelAnchorM: [28, 1.6, -17.5],
      labelText: (s) => labelValue(kpiValue(s, 'packsPerH'), 0, 'packs/h'),
      update(s, realDtS) {
        // The belts keep running, so a line whose filler stops empties from its start, and fills again
        // from its start once the filler runs.
        const distanceM = PACK_BELT_SPEED_MPS * busyMotionDtS(s, realDtS);
        let first = 0;
        streams.forEach((stream, index) => {
          stream.advance(distanceM, fillerRuns(s, index));
          stream.write(cartonMesh, first, CARTON_SIZE_M, originM);
          first += stream.slots;
        });
      },
      debugState: () => ({ cartonsA: streams[0]?.filled() ?? 0, cartonsB: streams[1]?.filled() ?? 0 }),
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
  const originM: PointM = [31.5, 0, 9.9];
  const b = new FixtureBuilder(kit, 'tray-conveyor', originM);
  const greyLayer = b.layer('grey-box');
  greyRollers(b, greyLayer, at.TRAY_ROLLER_PATHS, at.TRAY_ROLLER_WIDTH_M, at.BELT_M, 0.05);
  const placements = repeatPlacements(at.TRAY_ROLLER_PATHS, at.TRAY_ROLLER_WIDTH_M, at.BELT_M, 'conveyor-bars-high');
  // The trays on the rollers, in one draw, part of this fixture so a click on one selects stage 8.
  // No shadow, as for the cartons: a tray's would be a soft smudge of a few texels.
  const stream = createTokenStream(at.TRAY_LINE, 0, TRAY_PITCH_M, TRAY_SIZE_M[1]);
  const trayMesh = b.instanced('trays', 'box', 'carton', tokenInstances(trayPlaces().slice(0, stream.slots), TRAY_SIZE_M));
  trayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  printOn(kit, 'tray', [trayMesh], life);
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
      update(s, realDtS) {
        // Trays come out of the tunnel while a packer lane packs; in a batch change the line runs empty.
        stream.advance(TRAY_BELT_SPEED_MPS * busyMotionDtS(s, realDtS), packerRuns(s));
        stream.write(trayMesh, 0, TRAY_SIZE_M, originM);
      },
      debugState: () => ({ trays: stream.filled() }),
    },
    life,
  );
}

/** The palletizer's moving joints: the grey box's groups, or the hero model's nodes once it has swapped in. */
interface ArmJoints {
  arm: THREE.Object3D;
  lift: THREE.Object3D;
  wrist: THREE.Object3D;
  clamp1: THREE.Object3D;
  clamp2: THREE.Object3D;
}

/**
 * The palletizer (phase 12): the arm picks a tray off the end of the tray line, swings it over the long way via -z
 * and sets it on its place in the stack (packs/palletizing.ts), while a packer lane packs; idle, it parks over the
 * pick point. The stack is the sim's trays in layers of 12; when the pallet closes it rides off (palletTraffic.ts)
 * and a fresh pallet stands under the place point.
 */
function palletizer(kit: Kit, ctx: EquipmentContext): Equipment {
  const [xM, , zM] = at.PALLETIZER_M;
  const b = new FixtureBuilder(kit, 'palletizer', at.PALLETIZER_M);
  b.part('cyl', 'paint', [xM, 0.3, zM], [0.55, 0.6, 0.55], { castShadow: true }); // base
  b.part('cylLo', 'paint', [xM, 1.45, zM], [0.22, 1.7, 0.22], { castShadow: true }); // column
  // Named for the hero model (assets' hero spec), at its rest transforms: the arm turns about y on top of the
  // column; the lift slides down from the boom, and out along it to reach each tray's place; the wrist turns the
  // gripper so the tray stays square to the pallet; the clamps close on the tray. The boom runs out past the
  // farthest place.
  const arm = b.group('arm', [xM, at.ARM_HINGE_Y_M, zM]);
  const boomM = MAX_REACH_M + 0.1;
  b.part('box', 'paint', [boomM / 2, 0, 0], [boomM, 2 * BOOM_TOP_M, 0.26], { parent: arm, castShadow: true });
  const lift = b.group('arm_lift', ARM_LIFT_AT_M, arm);
  // The lift rod runs from the gripper up into the boom however far the lift is down: stretched to fit every frame.
  const rod = b.mesh('lift-rod', 'cylLo', 'steelDark', [0, 0, 0], [0.07, 1, 0.07], { parent: lift });
  const wrist = b.group('arm_wrist', ARM_WRIST_AT_M, lift);
  b.part('box', 'steelDark', [0, GRIPPER_BOTTOM_M / 2, 0], [0.55, -GRIPPER_BOTTOM_M, 0.45], { parent: wrist, castShadow: true }); // gripper
  const [clampXM, clampYM, clampZM] = ARM_CLAMP_AT_M;
  const clamp1 = b.group('arm_clamp_1', [clampXM, clampYM, -clampZM], wrist);
  const clamp2 = b.group('arm_clamp_2', [clampXM, clampYM, clampZM], wrist);
  // Plates on the gripper's z faces, their inner faces CLAMP_FACE_M out, reaching down over the tray's top.
  const plateM = 0.05;
  b.part('box', 'steelDark', [0, -0.03, clampZM - CLAMP_FACE_M - plateM / 2], [0.52, 0.2, plateM], { parent: clamp1 });
  b.part('box', 'steelDark', [0, -0.03, CLAMP_FACE_M - clampZM + plateM / 2], [0.52, 0.2, plateM], { parent: clamp2 });
  // The tray in the gripper, shown only while it carries one.
  const carried = b.mesh('carried-tray', 'box', 'carton', [0, CARRIED_TRAY_Y_M, 0], STACK_TRAY_SIZE_M, { parent: wrist });
  carried.visible = false;
  // The pallet being built, on the pallet rollers under the place point: as big as the pallet that rides off.
  const [placeXM, placeZM] = at.PLACE_M;
  b.part('box', 'wood', [placeXM, at.PALLET_ROLLER_TOP_M + PALLET_M.heightM / 2, placeZM], [PALLET_M.widthM, PALLET_M.heightM, PALLET_M.depthM]);
  // A low fence round the cell, open where the trays come in and the pallets leave; one merged mesh.
  for (const { atM, sizeM } of fenceParts()) b.part('box', 'marking', atM, sizeM);
  // The trays on the pallet, one copy a place: the first `count` show (the sim's, the fuller lane's pallet).
  const stack = b.instanced('stack', 'box', 'carton', stackInstances(), { castShadow: true });
  const slotMatrices = Array.from({ length: STACK_CAPACITY }, (_, slot) => {
    const matrix = new THREE.Matrix4();
    stack.getMatrixAt(slot, matrix);
    return matrix;
  });
  const emptySlot = new THREE.Matrix4().makeScale(0, 0, 0);
  const fixture = b.build();
  const life = lifetime();
  // The pallet and the fence are the fixture's only wooden and yellow parts: their merged meshes are them alone.
  const pallet = fixture.object.getObjectByName('palletizer-wood');
  const fence = fixture.object.getObjectByName('palletizer-marking');
  if (pallet instanceof THREE.Mesh) printOn(kit, 'pallet', [pallet], life);
  printOn(kit, 'tray', [stack, carried], life);

  const cycle = createPalletizing();
  const pose = cycle.pose;
  let joints: ArmJoints = { arm, lift, wrist, clamp1, clamp2 };
  const applyPose = (): void => {
    joints.arm.rotation.y = pose.armRad;
    joints.lift.position.set(pose.reachM, ARM_LIFT_AT_M[1] - pose.liftM, ARM_LIFT_AT_M[2]);
    joints.wrist.rotation.y = pose.wristRad;
    joints.clamp1.position.z = -clampZM + pose.clampM;
    joints.clamp2.position.z = clampZM - pose.clampM;
    // From the top of the gripper up to the top of the boom, in the lift's frame.
    const rodM = BOOM_TOP_M + pose.liftM - ARM_WRIST_AT_M[1];
    rod.position.y = ARM_WRIST_AT_M[1] + rodM / 2;
    rod.scale.y = rodM;
    carried.visible = cycle.carrying();
  };
  // Until the first snapshot with the packs model, half a pallet, as the grey box has always shown.
  let shownFrac = 0.5;
  let heldShown = -1;
  const showStack = (): void => {
    // A place the sim has counted while its tray is still in the gripper stays empty until the tray is set down.
    const held = cycle.heldSlot();
    if (held !== heldShown) {
      if (heldShown >= 0) stack.setMatrixAt(heldShown, slotMatrices[heldShown] as THREE.Matrix4);
      if (held >= 0) stack.setMatrixAt(held, emptySlot);
      heldShown = held;
      stack.instanceMatrix.needsUpdate = true;
    }
    showCopies(stack, cycle.traysShown());
  };
  cycle.update(0, false, shownFrac * STACK_CAPACITY);
  applyPose();
  showStack();

  // The model is the machine alone: the pallet, its load and the fence stay. The lift rod and the tray in the
  // gripper ride on with the model's lift and wrist.
  const keep = [stack, ...(pallet ? [pallet] : []), ...(fence ? [fence] : [])];
  const swap = { path: HERO_MODELS.palletizer, nodes: ['arm', 'arm_lift', 'arm_wrist', 'arm_clamp_1', 'arm_clamp_2'] as const, keep };
  swapInHero(ctx, fixture.object, swap, (nodes) => {
    joints = { arm: nodes.arm, lift: nodes.arm_lift, wrist: nodes.arm_wrist, clamp1: nodes.arm_clamp_1, clamp2: nodes.arm_clamp_2 };
    nodes.arm_lift.add(rod);
    nodes.arm_wrist.add(carried);
    applyPose();
  }, life.isAlive);
  return machine(
    fixture,
    {
      id: 'palletizer',
      stage: 8,
      label: 'Palletizer',
      labelAnchorM: [xM, 3.0, zM],
      labelText: (s) => labelValue(stageValue(s, 8, 'traysPerPallet'), 0, 'trays/pallet'),
      update(s, realDtS) {
        const fullFrac = palletFullFrac(s);
        if (fullFrac !== null) shownFrac = fullFrac;
        cycle.update(busyMotionDtS(s, realDtS), packerRuns(s), shownFrac * STACK_CAPACITY);
        applyPose();
        showStack();
      },
      debugState: () => ({
        stackFrac: shownFrac,
        armRad: joints.arm.rotation.y,
        phase: cycle.phase(),
        liftM: pose.liftM,
        carrying: cycle.carrying(),
        traysShown: cycle.traysShown(),
        layers: cycle.layers(),
        reachM: pose.reachM,
        clampM: pose.clampM,
        targetSlot: cycle.targetSlot(),
      }),
    },
    life,
  );
}

/** How full the pallet on the palletizer is: the fuller line's trays ÷ trays per pallet; null without Snapshot.packs. */
function palletFullFrac(snapshot: Snapshot): number | null {
  const lanes = snapshot.packs?.packaging.lanes;
  const traysPerPallet = stageValue(snapshot, 8, 'traysPerPallet');
  if (!lanes || lanes.length === 0 || !traysPerPallet) return null;
  return Math.min(1, Math.max(...lanes.map((lane) => lane.palletTrays)) / traysPerPallet);
}

/**
 * The stretch wrapper (phase 12): while a pallet stands on the turntable it turns with it, the carriage winds the
 * film round the base, up, over the top and down, and the web runs from the roll to the load (packs/stretchWrap.ts).
 * The pallet's wrap clock is the pallets' own (palletTraffic.ts), so the pallet turns as the turntable does.
 */
function stretchWrapper(kit: Kit, ctx: EquipmentContext, traffic: PalletTraffic): Equipment {
  const [xM, zM] = at.WRAPPER_M;
  const b = new FixtureBuilder(kit, 'stretch-wrapper', [xM, 0, zM]);
  /** The machine's frame (stretchWrap.ts) to world metres. */
  const inWorld = ([dxM, yM, dzM]: PointM): PointM => [xM + dxM, yM, zM + dzM];
  const radiusM = at.TURNTABLE_RADIUS_M;
  // Named for the hero model (phase-12 card): the turntable, flush with the pallet rollers either side of it,
  // turns while a pallet on it is wrapped; a bar across it shows the turn.
  const turntableGrey = b.group('turntable', inWorld(TURNTABLE_AT_M));
  turntableGrey.position.set(...TURNTABLE_AT_M); // the contract's rest transform exactly, as the model has it
  b.part('cyl', 'steelDark', [0, 0, 0], [radiusM, at.PALLET_ROLLER_TOP_M, radiusM], { parent: turntableGrey });
  b.part('box', 'paint', [0, at.PALLET_ROLLER_TOP_M / 2 + 0.005, 0], [radiusM * 1.8, 0.01, 0.12], { parent: turntableGrey });
  const [mastXM, , mastZM] = inWorld(MAST_AT_M);
  b.part('box', 'steelDark', [mastXM, 0.05, mastZM], [0.5, 0.1, 0.5]); // mast foot
  b.part('box', 'paint', [mastXM, MAST_HEIGHT_M / 2, mastZM], [0.2, MAST_HEIGHT_M, 0.2], { castShadow: true }); // mast
  // The film carriage rides up and down the mast: its frame on the mast's side, the film roll and the exit roller
  // the film leaves from (as in the model, assets' WRAPPER_FILM).
  const carriageGrey = b.group('carriage', inWorld(CARRIAGE_AT_M));
  carriageGrey.position.set(...CARRIAGE_AT_M);
  b.part('box', 'steelDark', [-0.06, ROLL_AT_M[1], -0.07], [0.26, 0.6, 0.26], { parent: carriageGrey });
  b.part('cylLo', 'steelDark', [FILM_EXIT_AT_M[0], ROLL_AT_M[1], FILM_EXIT_AT_M[1]], [FILM_EXIT_RADIUS_M, ROLL_HEIGHT_M, FILM_EXIT_RADIUS_M], { parent: carriageGrey });
  b.part('cylLo', 'carton', ROLL_AT_M, [ROLL_RADIUS_M, ROLL_HEIGHT_M, ROLL_RADIUS_M], { parent: carriageGrey });
  const fixture = b.build();
  const life = lifetime();
  // The web from the roll to the load: its own geometry and material, freed with the fixture.
  const web = createFilmWeb();
  fixture.object.add(web.mesh);
  life.onEnd(() => web.dispose());

  let turntable: THREE.Object3D = turntableGrey;
  let carriage: THREE.Object3D = carriageGrey;
  const pose = createWrapPose();
  const applyPose = (): void => {
    turntable.rotation.y = pose.turnRad % (2 * Math.PI);
    carriage.position.y = CARRIAGE_AT_M[1] + pose.carriageM;
    web.update(pose);
  };
  // The model is the machine alone: the film web stays.
  const swap = { path: HERO_MODELS.stretchWrapper, nodes: ['turntable', 'carriage'] as const, keep: [web.mesh] };
  swapInHero(ctx, fixture.object, swap, (nodes) => {
    ({ turntable, carriage } = nodes);
    applyPose();
  }, life.isAlive);
  return machine(
    fixture,
    {
      id: 'stretch-wrapper',
      stage: 8,
      label: 'Stretch wrapper',
      labelAnchorM: [xM - 0.6, 3.1, zM - 0.5],
      update(s, realDtS) {
        // The pallets move after this fixture in the frame (palletConveyor), by the same motion time: the wrap is
        // drawn where the pallet's clock will stand, so the turntable and its pallet turn as one.
        const wrapS = traffic.wrapS();
        wrapPoseAt(wrapS < 0 ? -1 : Math.min(wrapS + busyMotionDtS(s, realDtS), WRAP_CYCLE_S), pose);
        applyPose();
      },
      debugState: () => ({
        wrapping: traffic.wrapping(),
        turnRad: turntable.rotation.y,
        filmFrac: pose.filmFrac,
        carriageM: pose.carriageM,
        phase: pose.phase,
      }),
    },
    life,
  );
}

function palletConveyor(kit: Kit, loader: KitLoader, traffic: PalletTraffic, blocks: QuarantineBlocks): Equipment {
  const b = new FixtureBuilder(kit, 'pallet-conveyor', [20.8, 0, 14.4]);
  const greyLayer = b.layer('grey-box');
  greyRollers(b, greyLayer, at.PALLET_ROLLER_PATHS, at.PALLET_ROLLER_WIDTH_M, at.PALLET_ROLLER_TOP_M, 0.06);
  const placements = repeatPlacements(at.PALLET_ROLLER_PATHS, at.PALLET_ROLLER_WIDTH_M, at.PALLET_ROLLER_TOP_M, 'conveyor-bars');
  const { fixture, life } = kitConveyor(b, greyLayer, placements, loader);
  // The pallets riding to quarantine belong to this fixture: a click on one selects stage 8. Their meshes
  // are in world metres, so they sit in a group that undoes the fixture's own offset.
  const riders = new THREE.Group();
  riders.name = 'riders';
  riders.position.set(-20.8, 0, -14.4);
  riders.add(traffic.bases, traffic.loads, traffic.films);
  fixture.object.add(riders);
  life.onEnd(() => traffic.dispose());
  printOn(kit, 'pallet', [traffic.bases], life);
  printOn(kit, 'tray', [traffic.loads], life);
  return machine(
    fixture,
    {
      id: 'pallet-conveyor',
      stage: 8,
      label: 'Pallet conveyor',
      labelAnchorM: [17.5, 0.9, 14.4],
      labelText: (s) => labelValue(kpiValue(s, 'palletsMade'), 0, 'pallets'),
      update(s, realDtS) {
        const packaging = s.packs?.packaging;
        if (!packaging) return;
        const dtS = busyMotionDtS(s, realDtS);
        traffic.update(packaging.lastPallet, packaging.palletsMade, dtS, PALLET_SPEED_MPS * dtS, s.paused ? 0 : realDtS, (batchId) => blocks.blockTopM(batchId)[1]);
      },
      debugState: () => ({ riding: traffic.riding(), wrapping: traffic.wrapping(), queued: traffic.queued(), onTurntable: traffic.onTurntable() }),
    },
    life,
  );
}

/* stage 9: quarantine floor and QA lab */

const MARKING_Y_M = 0.055; // just above the zone floor (0.04 m) and the apron (0.03 m)
const MARKING_THICK_M = 0.02;

function quarantine(kit: Kit, blocks: QuarantineBlocks): Equipment {
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
  const fixture = b.build();
  // The blocks' meshes are in world metres: a group undoes the fixture's offset (packs/quarantineBlocks.ts).
  const holder = new THREE.Group();
  holder.name = 'blocks';
  holder.position.set(-xM, 0, -zM);
  holder.add(blocks.pallets, blocks.lamps, blocks.mark);
  fixture.object.add(holder);
  const life = lifetime();
  life.onEnd(() => blocks.dispose());
  return machine(
    fixture,
    {
      id: 'quarantine',
      stage: 9,
      label: 'Quarantine',
      // On the front edge, nearest the camera, just over the tallest a block and its lamp can stand.
      labelAnchorM: [xM, 2.6, q.zMaxM],
      labelText(s) {
        const pallets = stageValue(s, 9, 'palletsInQuarantine');
        if (pallets !== undefined) return labelValue(pallets, 0, 'pallets');
        const days = labelValue(stageValue(s, 9, 'incubationDays'), 0, 'd');
        return days && `hold ${days}`;
      },
      update(s, realDtS) {
        if (s.packs) blocks.update(s.packs.batches, realDtS);
      },
      batchAt: (object, instanceId) => blocks.batchAt(object, instanceId),
      selectBatch: (batchId) => blocks.select(batchId),
      applyTheme: () => blocks.applyTheme(),
      // Just under the top of its block's pallets, where a click lands on a pallet of the batch.
      batchPointM: (batchId) => {
        const [xM, yM, zM] = blocks.blockTopM(batchId);
        return [xM, yM - 0.1, zM];
      },
      debugState: () => {
        const { selected, ...counts } = blocks.state();
        return { ...counts, selected: selected ?? -1 };
      },
    },
    life,
  );
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
  const palette = createLampPalette(LAMP_COLORS, LAMP_COLOR_VARS);
  let shown: Status | null = null;
  const paint = (status: Status): void => {
    const color = palette.color(status);
    if (status !== 'idle' && palette.dark) {
      glowInDark(lampMaterial, color);
      return;
    }
    lampMaterial.color.copy(color);
    lampMaterial.emissive.copy(status === 'idle' ? BLACK : color);
    lampMaterial.emissiveIntensity = status === 'idle' ? 0 : 0.85;
  };
  const show = (status: Status): void => {
    if (status === shown) return;
    shown = status;
    paint(status);
  };
  show('idle');
  return machine(
    b.build(),
    {
      id: 'qa-lab',
      stage: 9,
      label: 'QA lab',
      // Over the lab's front, toward the incubators whose temperature it shows. From the overview its
      // lamp then stays clear of the aseptic tank's zone name in the aisle beyond (zones.ts).
      labelAnchorM: [xM, heightM + 0.5, frontZM - 0.4],
      labelText: (s) => labelValue(stageValue(s, 9, 'incubationTempC'), 0, '°C'),
      update: (s) => show(stageStatus(s, 9) ?? 'idle'),
      applyTheme() {
        palette.applyTheme();
        paint(shown ?? 'idle');
      },
    },
    life,
  );
}

/* stage 10: racks, docks, forklifts, truck */

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

  // A pallet and its load in every place, in fill order; the counts show the snapshot's stock.
  const slots = at.rackSlots();
  const p = at.RACK_PALLET;
  const pallets = slots.map((s): InstanceM => ({ atM: [s.xM, s.yM + p.heightM / 2, s.zM], sizeM: [p.widthM, p.heightM, p.depthM] }));
  const loads = slots.map((s): InstanceM => ({
    atM: [s.xM, s.yM + p.heightM + p.loadHeightM / 2, s.zM],
    sizeM: [p.widthM - 0.04, p.loadHeightM, p.depthM - 0.08],
  }));
  const palletMesh = b.instanced('pallets', 'box', 'wood', pallets);
  const loadMesh = b.instanced('loads', 'box', 'carton', loads, { castShadow: true });
  const fixture = b.build();
  const life = lifetime();
  printOn(kit, 'pallet', [palletMesh], life);

  // Empty until the first snapshot says otherwise.
  showCopies(palletMesh, 0);
  showCopies(loadMesh, 0);
  let placesShown = 0;
  const showStock = (s: Snapshot): void => {
    // showCopies does nothing while the count stands: stock changes a few times a day, not every frame.
    placesShown = rackLoadsShown(kpiValue(s, 'palletsInStock'), slots.length);
    showCopies(palletMesh, placesShown);
    showCopies(loadMesh, placesShown);
  };

  return machine(
    fixture,
    {
      id: 'racks',
      stage: 10,
      label: 'Racks',
      labelAnchorM: [midXM, at.RACK_HEIGHT_M + 0.4, zMidM],
      labelText: (s) => labelValue(kpiValue(s, 'palletsInStock'), 0, 'pallets'),
      update: showStock,
      debugState: () => ({ places: placesShown, palletsPerPlace: PALLETS_PER_RACK_PLACE }),
    },
    life,
  );
}

/**
 * How many rack places show a pallet: one for every PALLETS_PER_RACK_PLACE pallets of stock, rounded up, up to
 * the places there are, and none without a stock figure. The racks have 384 places; the plant opens with 634
 * pallets (D11) and gains about 30 a day (H43), so one place a pallet would show full racks from the start
 * (g1-checklist, defect 4). One place for 5 pallets holds 1,920, like the preview's one block for 10.
 */
export function rackLoadsShown(palletsInStock: number | undefined, places: number, palletsPerPlace = PALLETS_PER_RACK_PLACE): number {
  if (palletsInStock === undefined || !(palletsInStock > 0)) return 0;
  return Math.min(Math.ceil(Math.round(palletsInStock) / palletsPerPlace), places);
}

/**
 * What the warehouse's fixtures share (phase 12): the trucks' bays, which the trucks write and the docks and
 * forklift-2 read; the aisle locks that keep the two forklifts' routes from crossing; the forklifts' lit beacon
 * and the dock lamps' material; and the pallets the forklifts show (on their forks, set down, waiting at the
 * quarantine's edge), one instanced draw for both. Each fixture holds it while it stands; the last to go frees it.
 */
interface Warehouse {
  readonly bays: Bay[];
  readonly locks: AisleLocks;
  readonly beaconLit: THREE.MeshStandardMaterial;
  readonly lampMaterial: THREE.MeshBasicMaterial;
  readonly lampPalette: LampPalette<'red' | 'green'>;
  readonly pallets: { readonly bases: THREE.InstancedMesh; readonly loads: THREE.InstancedMesh; readonly shown: Uint8Array };
  /** prefers-reduced-motion, where there is a page to ask: the beacon then shines steadily. */
  readonly reducedMotion: MediaQueryList | null;
  applyBeaconTheme(): void;
  hold(): () => void;
}

/** The forklifts' pallets: each forklift's carried and set-down one, and the one waiting at the quarantine's edge. */
const FORKLIFT_PALLET_SLOTS = 5;
const WAITING_SLOT = 4;
/** A pallet token as the racks draw it: the wooden pallet and its stretch-wrapped load. */
const PALLET_LOAD_SIZE_M = [at.RACK_PALLET.widthM - 0.04, at.RACK_PALLET.loadHeightM, at.RACK_PALLET.depthM - 0.08] as const;
/** The beacon's amber: the light theme's --warn (plan 08), glowing in the dark theme's (lamps.ts). */
const BEACON_LIGHT_HEX = { lit: LAMP_COLORS.warn };
const BEACON_DARK_VAR: Record<'lit', SceneColorVar> = { lit: LAMP_COLOR_VAR.warn };
/** Dock lamps: red while a truck stands at the dock, green otherwise. */
const DOCK_LAMP_HEX = { red: LAMP_COLORS.bad, green: LAMP_COLORS.ok };
const DOCK_LAMP_VAR: Record<'red' | 'green', SceneColorVar> = { red: LAMP_COLOR_VAR.bad, green: LAMP_COLOR_VAR.ok };
/** A full truck load and the sim seconds it takes (D3). */
const PALLETS_PER_TRUCK = plantJson.warehouse.palletsPerTruck;
const TRUCK_LOAD_S = plantJson.warehouse.truckLoadS;
const RACK_PLACES = at.rackSlots().length;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function createWarehouse(kit: Kit): Warehouse {
  const beaconLit = new THREE.MeshStandardMaterial({ roughness: 0.3 });
  beaconLit.name = 'forklift-beacon-lit';
  const beaconPalette = createLampPalette(BEACON_LIGHT_HEX, BEACON_DARK_VAR);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  lampMaterial.name = 'dock-lamps';
  const lampPalette = createLampPalette(DOCK_LAMP_HEX, DOCK_LAMP_VAR);
  const bases = new THREE.InstancedMesh(kit.shape('box'), kit.material('wood'), FORKLIFT_PALLET_SLOTS);
  const loads = new THREE.InstancedMesh(kit.shape('box'), kit.material('carton'), FORKLIFT_PALLET_SLOTS);
  bases.name = 'forklift-pallets';
  loads.name = 'forklift-loads';
  // Hidden copies stand at forklift-1's spot, so the fixture's bounds are its own until a pallet shows.
  const hiddenAt = new THREE.Matrix4().makeTranslation(-14.8, 0, 8.7).multiply(HIDDEN);
  for (const mesh of [bases, loads]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FORKLIFT_PALLET_SLOTS; i++) mesh.setMatrixAt(i, hiddenAt);
    // They go wherever the forklifts go: bounds over the racks, the lanes, the quarantine's edge and the doors.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(-37, 1.5, 11), 30);
    mesh.receiveShadow = true;
  }
  loads.castShadow = true;
  // With no pallet shown they draw nothing.
  bases.visible = false;
  loads.visible = false;
  const paintBeacon = (): void => {
    const color = beaconPalette.color('lit');
    if (beaconPalette.dark) {
      glowInDark(beaconLit, color);
      return;
    }
    beaconLit.color.copy(color);
    beaconLit.emissive.copy(color);
    beaconLit.emissiveIntensity = 0.9;
  };
  paintBeacon();
  let holders = 0;
  return {
    bays: createBays(at.DOOR_X_M),
    locks: createAisleLocks(),
    beaconLit,
    lampMaterial,
    lampPalette,
    pallets: { bases, loads, shown: new Uint8Array(FORKLIFT_PALLET_SLOTS) },
    reducedMotion: typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null,
    applyBeaconTheme() {
      beaconPalette.applyTheme();
      paintBeacon();
    },
    hold() {
      holders += 1;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        holders -= 1;
        if (holders > 0) return;
        beaconLit.dispose();
        lampMaterial.dispose();
        bases.dispose();
        loads.dispose();
      };
    },
  };
}

/** Writes pallet `slot` of the forklifts' pallets at `pose`, or hides it; the meshes draw while one shows. */
function writePallet(pallets: Warehouse['pallets'], slot: number, pose: PalletPose): void {
  const { bases, loads, shown } = pallets;
  shown[slot] = pose.shown ? 1 : 0;
  const any = shown.includes(1);
  bases.visible = any;
  loads.visible = any;
  if (!pose.shown) {
    bases.getMatrixAt(slot, _matrix);
    _matrix.multiply(HIDDEN); // keeps its spot, at no size
    bases.setMatrixAt(slot, _matrix);
    loads.setMatrixAt(slot, _matrix);
    return;
  }
  const p = at.RACK_PALLET;
  _quaternion.setFromAxisAngle(_up, pose.headingRad);
  _position.set(pose.xM, pose.yM + p.heightM / 2, pose.zM);
  bases.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _scale.set(p.widthM, p.heightM, p.depthM)));
  _position.y = pose.yM + p.heightM + p.loadHeightM / 2;
  loads.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _scale.set(...PALLET_LOAD_SIZE_M)));
}

/**
 * The dock doors along the warehouse's +z edge: each an open frame with a roller door that rises while a truck
 * stands docked there in the 3D view (about 3 motion seconds), bumpers, guide lines on the apron, and a lamp on
 * the frame outside, red while a truck is docked (do not drive off) and green otherwise. It reads the trucks'
 * bays (`warehouse.bays`, written by the trucks' fixture).
 */
function docks(kit: Kit, warehouse: Warehouse): Equipment {
  const midXM = at.DOOR_X_M[1];
  const b = new FixtureBuilder(kit, 'docks', [midXM, 0, at.DOOR_Z_M]);
  const openingM = { widthM: 3.2, heightM: 3.4 };
  const jambM = 0.2;
  const frameHeightM = 3.8;
  const rollerZM = at.DOOR_Z_M + 0.1;
  const rollers: InstanceM[] = [];
  const lamps: InstanceM[] = [];
  for (const xM of at.DOOR_X_M) {
    for (const side of [-1, 1]) {
      b.part('box', 'rubber', [xM + side * (openingM.widthM / 2 + jambM / 2), frameHeightM / 2, at.DOOR_Z_M], [jambM, frameHeightM, 0.3], { castShadow: true }); // jamb
      b.part('box', 'rubber', [xM + side * 1.35, 1.0, at.DOOR_Z_M + 0.25], [0.3, 0.45, 0.2]); // bumper
      // Guide lines on the apron, a truck's width apart.
      b.part('box', 'marking', [xM + side * 1.65, MARKING_Y_M, at.DOCKED_TAIL_Z_M + 6], [0.12, MARKING_THICK_M, 11]);
    }
    // The header over the opening hides the roller door's drum.
    b.part('box', 'rubber', [xM, (openingM.heightM + frameHeightM) / 2, at.DOOR_Z_M], [openingM.widthM + 2 * jambM, frameHeightM - openingM.heightM, 0.45], { castShadow: true });
    rollers.push({ atM: [xM, openingM.heightM / 2, rollerZM], sizeM: [openingM.widthM, openingM.heightM, 0.06] });
    lamps.push({ atM: [xM + openingM.widthM / 2 + jambM / 2, 2.9, at.DOOR_Z_M + 0.27], sizeM: [0.28, 0.28, 0.28] });
  }
  const rollerMesh = b.instanced('roller-doors', 'box', 'steel', rollers);
  rollerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const lampMesh = b.instanced('dock-lamps', 'sphere', warehouse.lampMaterial, lamps);
  const life = lifetime();
  life.onEnd(warehouse.hold());
  const palette = warehouse.lampPalette;
  const shownRoller = at.DOOR_X_M.map(() => 1);
  const shownRed = at.DOOR_X_M.map(() => false);
  const paintLamps = (): void => {
    shownRed.forEach((red, door) => lampMesh.setColorAt(door, palette.color(red ? 'red' : 'green')));
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  };
  paintLamps();
  const fixture = b.build();
  return machine(
    fixture,
    {
      id: 'docks',
      stage: 10,
      label: 'Loading docks',
      labelAnchorM: [midXM, 4.3, at.DOOR_Z_M],
      labelText(s) {
        const trucks = kpiValue(s, 'trucksShipped');
        return trucks === undefined ? '' : `${labelValue(trucks, 0, '')} trucks out`;
      },
      update() {
        let rollersMoved = false;
        let lampsChanged = false;
        for (const bay of warehouse.bays) {
          const door = bay.door;
          // The roller door's bottom edge rises into the drum behind the header.
          const downFrac = 1 - bay.rollerFrac;
          if (downFrac !== shownRoller[door]) {
            shownRoller[door] = downFrac;
            const heightM = Math.max(openingM.heightM * downFrac, 0.001);
            _quaternion.identity();
            _position.set(at.DOOR_X_M[door] as number, openingM.heightM - heightM / 2, rollerZM);
            _scale.set(openingM.widthM, heightM, downFrac > 0 ? 0.06 : 0);
            rollerMesh.setMatrixAt(door, _matrix.compose(_position.sub(fixture.object.position), _quaternion, _scale));
            rollersMoved = true;
          }
          const red = bay.phase === 'docked';
          if (red !== shownRed[door]) {
            shownRed[door] = red;
            lampsChanged = true;
          }
        }
        if (rollersMoved) rollerMesh.instanceMatrix.needsUpdate = true;
        if (lampsChanged) paintLamps();
      },
      applyTheme() {
        palette.applyTheme();
        // Unlit, the lamps show their colour as it is; in the dark theme a little over, as the other lamps glow.
        warehouse.lampMaterial.color.setScalar(palette.dark ? DARK_LAMP_GLOW : 1);
        paintLamps();
      },
      debugState: () => ({
        doorsUp: shownRoller.filter((downFrac) => downFrac === 0).length,
        lamps: shownRed.map((red) => (red ? 'red' : 'green')).join(','),
      }),
    },
    life,
  );
}

/** A vehicle and the nodes that move on it: the grey box's at first, the model's once it is in. */
interface Vehicle<Node extends string> {
  fixture: BuiltFixture;
  nodes: Record<Node, THREE.Object3D>;
  /** Each node's rest height and turn, and vehicle metres per unit of its frame. */
  restY: Record<Node, number>;
  restTurn: Record<Node, number>;
  unitM: Record<Node, number>;
}

function bindNodes<Node extends string>(vehicle: Vehicle<Node>, found: Record<Node, THREE.Object3D>): void {
  for (const name of Object.keys(found) as Node[]) {
    const node = found[name];
    vehicle.nodes[name] = node;
    vehicle.restY[name] = node.position.y;
    vehicle.restTurn[name] = node.rotation.y;
    vehicle.unitM[name] = nodeUnitM(node);
  }
}

function findNodes<Node extends string>(root: THREE.Object3D, names: readonly Node[]): Record<Node, THREE.Object3D> | null {
  const found = {} as Record<Node, THREE.Object3D>;
  for (const name of names) {
    const node = root.getObjectByName(name);
    if (!node) return null;
    found[name] = node;
  }
  return found;
}

/**
 * A vehicle: its grey box at once, the assets lane's model in its place when it loads, built facing +z round its
 * own footprint centre. The model must have every moving node the grey box has (`spec.nodes`); a model short of
 * one keeps the grey box, as a missing file does. `onSwap` hears when the model is in.
 */
function buildVehicle<Node extends string>(
  kit: Kit,
  ctx: EquipmentContext,
  spec: { id: string; modelPath: string; size: VehicleSizeM; nodes: readonly Node[] },
  buildGrey: (b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM) => void,
  life: Lifetime,
  onSwap: () => void = () => {},
): Vehicle<Node> {
  const b = new FixtureBuilder(kit, spec.id, [0, 0, 0]);
  const greyLayer = b.layer('grey-box');
  buildGrey(b, greyLayer, spec.size);
  const fixture = b.build();
  const grey = findNodes(greyLayer, spec.nodes);
  if (!grey) throw new Error(`${spec.id}: the grey box lacks a moving node`);
  const vehicle: Vehicle<Node> = {
    fixture,
    nodes: {} as Record<Node, THREE.Object3D>,
    restY: {} as Record<Node, number>,
    restTurn: {} as Record<Node, number>,
    unitM: {} as Record<Node, number>,
  };
  bindNodes(vehicle, grey);
  // The model belongs to the host's cache (the host clones it per call), so it is never disposed here.
  ctx.loadModel(spec.modelPath).then(
    (model) => {
      if (!life.isAlive()) return;
      const fitted = fitVehicle(model, spec.size);
      const nodes = findNodes(fitted, spec.nodes);
      if (!nodes) {
        console.warn(`${spec.modelPath} lacks one of ${spec.nodes.join(', ')}: ${spec.id} keeps its grey box`);
        return;
      }
      fixture.release(greyLayer);
      fixture.object.add(fitted);
      bindNodes(vehicle, nodes);
      onSwap();
    },
    () => {}, // no model (yet): the grey box stays
  );
  return vehicle;
}

/**
 * A forklift with one job (packs/forkliftJobs.ts): forklift-1 puts released pallets away into the racks,
 * forklift-2 takes them to a loading truck. It drives, turns and lifts in motion seconds; its forks rise by the
 * lift and its inner mast by half of it; its pallet rides on the forks between pick and drop; its beacon
 * flashes while it works. Forklift-1's fixture also holds both forklifts' pallets (one instanced draw).
 */
function forklift(kit: Kit, ctx: EquipmentContext, id: string, role: ForkliftRole, warehouse: Warehouse): Equipment {
  const life = lifetime();
  life.onEnd(warehouse.hold());
  const driver = createForkliftDriver(role, warehouse.locks);
  const dark = kit.material('rubber');
  let beaconMeshes: THREE.Mesh[] = [];
  const findBeacon = (): void => {
    beaconMeshes = [];
    vehicle.nodes.beacon.traverse((child) => {
      if (child instanceof THREE.Mesh) beaconMeshes.push(child);
    });
    for (const mesh of beaconMeshes) mesh.material = litShown ? warehouse.beaconLit : dark;
  };
  let litShown = false;
  const buildGrey = (b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM): void => greyForklift(b, layer, size, dark);
  const vehicle = buildVehicle(kit, ctx, { id: `${id}-vehicle`, modelPath: 'vehicles/forklift.glb', size: at.FORKLIFT_SIZE_M, nodes: FORKLIFT_NODES }, buildGrey, life, () => findBeacon());
  findBeacon();
  const root = new THREE.Group();
  root.name = id;
  root.add(vehicle.fixture.object);
  const { bases, loads } = warehouse.pallets;
  const slots = role === 'putAway' ? { carried: 0, setDown: 2 } : { carried: 1, setDown: 3 };
  if (role === 'putAway') {
    // Both forklifts' pallets, in world metres: the root stands at the origin.
    const holder = new THREE.Group();
    holder.name = 'pallets';
    holder.add(bases, loads);
    root.add(holder);
    printOn(kit, 'pallet', [bases], life);
  }
  const inputs: ForkliftInputs = {
    placesShown: 0,
    places: RACK_PLACES,
    loadingDoor: -1,
    loadingLeftS: 0,
    dockedMask: 0,
    doorsXM: at.DOOR_X_M,
    steadyBeacon: false,
  };
  const heightM = at.FORKLIFT_SIZE_M.heightM + 0.4;
  const anchor: [number, number, number] = [driver.xM, heightM, driver.zM];
  let palletsShown = false;
  const pose = (): void => {
    const object = vehicle.fixture.object;
    object.position.set(driver.xM, 0, driver.zM);
    object.rotation.y = driver.headingRad;
    const { nodes, restY, unitM } = vehicle;
    nodes.forks.position.y = restY.forks + driver.liftM / unitM.forks;
    nodes.mast_inner.position.y = restY.mast_inner + driver.liftM / 2 / unitM.mast_inner;
    if (driver.beacon !== litShown) {
      litShown = driver.beacon;
      for (const mesh of beaconMeshes) mesh.material = litShown ? warehouse.beaconLit : dark;
    }
    const anyShown = driver.carried.shown || driver.setDown.shown || driver.waiting.shown;
    if (anyShown || palletsShown) {
      writePallet(warehouse.pallets, slots.carried, driver.carried);
      writePallet(warehouse.pallets, slots.setDown, driver.setDown);
      if (role === 'putAway') writePallet(warehouse.pallets, WAITING_SLOT, driver.waiting);
      bases.instanceMatrix.needsUpdate = true;
      loads.instanceMatrix.needsUpdate = true;
    }
    palletsShown = anyShown;
  };
  pose();
  const fixture: BuiltFixture = { object: root, dispose: () => vehicle.fixture.dispose(), release: () => {} };
  return machine(
    fixture,
    {
      id,
      stage: 10,
      label: 'Forklift',
      // Parked at its spot; while it drives, the label rides with it (labelAnchorNowM).
      labelAnchorM: [driver.xM, heightM, driver.zM],
      update(s, realDtS) {
        inputs.placesShown = rackLoadsShown(kpiValue(s, 'palletsInStock'), RACK_PLACES);
        inputs.loadingDoor = -1;
        inputs.loadingLeftS = 0;
        inputs.dockedMask = 0;
        for (const bay of warehouse.bays) {
          if (bay.phase !== 'docked') continue;
          inputs.dockedMask |= 1 << bay.door;
          if (inputs.loadingDoor < 0 && bay.simLoading && bay.rollerFrac >= 1) {
            inputs.loadingDoor = bay.door;
            inputs.loadingLeftS = bay.closeInS;
          }
        }
        inputs.steadyBeacon = warehouse.reducedMotion?.matches ?? false;
        driver.update(busyMotionDtS(s, realDtS), inputs);
        pose();
      },
      labelAnchorNowM: () => {
        anchor[0] = driver.xM;
        anchor[2] = driver.zM;
        return anchor;
      },
      applyTheme: () => warehouse.applyBeaconTheme(),
      debugState: () => ({
        job: driver.job,
        carrying: driver.carrying,
        liftM: driver.liftM,
        xM: driver.xM,
        zM: driver.zM,
        headingRad: driver.headingRad,
        beacon: driver.beacon,
        place: driver.place,
        model: !vehicle.fixture.object.getObjectByName('grey-box'),
      }),
    },
    life,
  );
}

/**
 * Instanced copies of a vehicle (the trucks parked in the yard): one InstancedMesh for each of its meshes, with
 * a copy at each spot. They start with none shown.
 */
function instanceVehicle(template: THREE.Object3D, spots: readonly at.FloorPointM[], name: string): THREE.InstancedMesh[] {
  template.updateMatrixWorld(true);
  const meshes: THREE.InstancedMesh[] = [];
  template.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const copies = new THREE.InstancedMesh(child.geometry, child.material, spots.length);
    copies.name = `${name}-${meshes.length}`;
    spots.forEach(([xM, zM], i) => copies.setMatrixAt(i, _matrix.makeTranslation(xM, 0, zM).multiply(child.matrixWorld)));
    copies.castShadow = child.castShadow;
    copies.receiveShadow = true;
    showCopies(copies, 0);
    meshes.push(copies);
  });
  return meshes;
}

/**
 * The trucks at the three dock doors (D2, D3), moved by packs/truckMoves.ts: a truck drives in when the sim
 * docks one at a door, opens its rear doors, backs in articulated and stands while it loads or waits for
 * stock, its trailer filling from the front; then it closes up, pulls out and drives away. Trucks that wait
 * in the yard for a free door stand parked east of the doors with their doors shut, drawn as instanced copies.
 * The label, over the middle door, names the first truck there.
 */
function trucks(kit: Kit, ctx: EquipmentContext, warehouse: Warehouse): Equipment {
  const life = lifetime();
  life.onEnd(warehouse.hold());
  const root = new THREE.Group();
  root.name = 'trucks';
  const size = at.TRUCK_SIZE_M;
  const vehicles = warehouse.bays.map((bay) => {
    const vehicle = buildVehicle(kit, ctx, { id: `truck-${bay.door + 1}`, modelPath: 'vehicles/truck.glb', size, nodes: TRUCK_NODES }, greyTruck, life);
    const object = vehicle.fixture.object;
    object.position.set(bay.pose.xM, 0, bay.pose.zM);
    object.visible = false;
    root.add(object);
    return vehicle;
  });

  // Trucks waiting in the yard park side by side east of the doors, level with the docked ones.
  const yard = new THREE.Group();
  yard.name = 'yard';
  root.add(yard);
  const yardSpots = at.YARD_X_M.map((xM): at.FloorPointM => [xM, at.DOCKED_TAIL_Z_M + size.lengthM / 2]);
  const greyTemplate = (() => {
    const b = new FixtureBuilder(kit, 'yard-truck', [0, 0, 0]);
    greyTruck(b, b.layer('grey-box'), size);
    return b.build();
  })();
  let templateLive = true;
  let yardMeshes = instanceVehicle(greyTemplate.object, yardSpots, 'yard-truck');
  yard.add(...yardMeshes);
  /** Trucks waiting in the yard, and the copies shown (one a spot; more show as a number on the label). */
  let inYard = 0;
  let yardShown = 0;
  ctx.loadModel('vehicles/truck.glb').then(
    (model) => {
      if (!life.isAlive()) return;
      const fitted = fitVehicle(model, size);
      if (!findNodes(fitted, TRUCK_NODES)) return; // as the docked trucks do, the yard keeps the grey box
      for (const mesh of yardMeshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      greyTemplate.dispose();
      templateLive = false;
      yardMeshes = instanceVehicle(fitted, yardSpots, 'yard-truck');
      yard.add(...yardMeshes);
      for (const mesh of yardMeshes) showCopies(mesh, yardShown);
    },
    () => {},
  );

  // The trailers' loads, every door's in one draw: wooden pallets and their loads, filling two by two from the front.
  const capacity = warehouse.bays.length * PALLETS_PER_TRUCK;
  const loadBases = new THREE.InstancedMesh(kit.shape('box'), kit.material('wood'), capacity);
  const loadLoads = new THREE.InstancedMesh(kit.shape('box'), kit.material('carton'), capacity);
  loadBases.name = 'trailer-pallets';
  loadLoads.name = 'trailer-loads';
  for (const mesh of [loadBases, loadLoads]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Inside the trailers, out of the sun: they cast no shadow. Bounds over the docked trailers and their creep out.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(at.DOOR_X_M[1], 2, at.DOCKED_TAIL_Z_M + 7), 16);
    mesh.receiveShadow = true;
    showCopies(mesh, 0);
    root.add(mesh);
  }
  printOn(kit, 'pallet', [loadBases], life);
  const shownLoad = new Float64Array(warehouse.bays.length * 4).fill(NaN);
  const writeLoads = (): void => {
    let changed = false;
    for (const bay of warehouse.bays) {
      const count = bay.loadShown ? bay.loaded : 0;
      const k = bay.door * 4;
      if (shownLoad[k] !== count || (count > 0 && (shownLoad[k + 1] !== bay.pose.xM || shownLoad[k + 2] !== bay.pose.zM || shownLoad[k + 3] !== bay.pose.headingRad))) changed = true;
      shownLoad[k] = count;
      shownLoad[k + 1] = bay.pose.xM;
      shownLoad[k + 2] = bay.pose.zM;
      shownLoad[k + 3] = bay.pose.headingRad;
    }
    if (!changed) return;
    const p = at.RACK_PALLET;
    const pitchM = (CARGO_FRONT_Z_M - CARGO_TAIL_Z_M) / Math.ceil(PALLETS_PER_TRUCK / 2);
    let n = 0;
    for (const bay of warehouse.bays) {
      if (!bay.loadShown) continue;
      const { xM, zM, headingRad } = bay.pose;
      const sin = Math.sin(headingRad);
      const cos = Math.cos(headingRad);
      _quaternion.setFromAxisAngle(_up, headingRad);
      for (let k = 0; k < bay.loaded; k++) {
        const localX = (k % 2 === 0 ? -1 : 1) * 0.55;
        const localZ = CARGO_FRONT_Z_M - pitchM / 2 - Math.floor(k / 2) * pitchM;
        _position.set(xM + localX * cos + localZ * sin, TRAILER_DECK_M + p.heightM / 2, zM - localX * sin + localZ * cos);
        loadBases.setMatrixAt(n, _matrix.compose(_position, _quaternion, _scale.set(p.widthM, p.heightM, p.depthM)));
        _position.y = TRAILER_DECK_M + p.heightM + p.loadHeightM / 2;
        loadLoads.setMatrixAt(n, _matrix.compose(_position, _quaternion, _scale.set(...PALLET_LOAD_SIZE_M)));
        n += 1;
      }
    }
    for (const mesh of [loadBases, loadLoads]) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const atDoor: (DoorTruck | null)[] = warehouse.bays.map(() => null);
  const doorTrucks: DoorTruck[] = warehouse.bays.map(() => ({ id: 0, loading: false, remainingS: 0, loadedPallets: 0 }));
  const clock: SimClock = { speed: 1, rate: 1, palletsPerTruck: PALLETS_PER_TRUCK };
  const pose = (): void => {
    for (let i = 0; i < warehouse.bays.length; i++) {
      const bay = warehouse.bays[i] as Bay;
      const vehicle = vehicles[i] as Vehicle<TruckNode>;
      const object = vehicle.fixture.object;
      object.visible = bay.phase !== 'away';
      if (!object.visible) continue;
      object.position.set(bay.pose.xM, 0, bay.pose.zM);
      object.rotation.y = bay.pose.headingRad;
      const { nodes, restTurn } = vehicle;
      nodes.tractor.rotation.y = restTurn.tractor + bay.pose.tractorRad;
      const open = bay.doorsFrac * bay.doorsFrac * (3 - 2 * bay.doorsFrac);
      nodes.door_left.rotation.y = restTurn.door_left + DOOR_OPEN_RAD.door_left * open;
      nodes.door_right.rotation.y = restTurn.door_right + DOOR_OPEN_RAD.door_right * open;
    }
    writeLoads();
  };

  const fixture: BuiltFixture = {
    object: root,
    dispose: () => {
      for (const vehicle of vehicles) vehicle.fixture.dispose();
      for (const mesh of [...yardMeshes, loadBases, loadLoads]) mesh.dispose();
      if (templateLive) greyTemplate.dispose();
    },
    release: () => {},
  };
  return machine(
    fixture,
    {
      id: 'truck',
      stage: 10,
      label: 'Trucks',
      labelAnchorM: [at.DOOR_X_M[1], size.heightM + 0.4, at.DOCKED_TAIL_Z_M + size.lengthM / 2],
      labelText(s) {
        const first = s.packs?.warehouse.trucks.find((truck) => truck.door >= 0);
        const waiting = s.packs?.warehouse.trucks.filter((truck) => truck.door < 0).length ?? 0;
        const yardText = waiting > 0 ? ` · ${waiting} in the yard` : '';
        if (!first) return s.packs ? `none at the dock${yardText}` : '';
        return `${first.state === 'loading' ? `${first.id} loading` : `${first.id} waiting for stock`}${yardText}`;
      },
      update(s, realDtS) {
        const simTrucks = s.packs?.warehouse.trucks ?? [];
        atDoor.fill(null);
        let waiting = 0;
        for (const truck of simTrucks) {
          if (truck.door < 0) {
            waiting += 1;
            continue;
          }
          const slot = doorTrucks[truck.door];
          if (!slot || atDoor[truck.door]) continue;
          slot.id = truck.id;
          slot.loading = truck.state === 'loading';
          slot.remainingS = truck.remainingS;
          slot.loadedPallets = slot.loading ? Math.round(PALLETS_PER_TRUCK * (1 - truck.remainingS / TRUCK_LOAD_S)) : 0;
          atDoor[truck.door] = slot;
        }
        clock.speed = s.speed;
        clock.rate = motionRate(s.speed);
        stepBays(warehouse.bays, atDoor, busyMotionDtS(s, realDtS), clock);
        pose();
        inYard = waiting;
        if (Math.min(waiting, yardSpots.length) !== yardShown) {
          yardShown = Math.min(waiting, yardSpots.length);
          for (const mesh of yardMeshes) showCopies(mesh, yardShown);
        }
      },
      debugState: () => ({
        shown: warehouse.bays.filter((bay) => bay.phase !== 'away').length,
        docked: warehouse.bays.filter((bay) => bay.phase === 'docked').length,
        doors: warehouse.bays.map((bay) => bay.shownId ?? '-').join(','),
        yard: inYard,
        phases: warehouse.bays.map((bay) => bay.phase).join(','),
        doorsOpen: warehouse.bays.filter((bay) => bay.phase !== 'away' && bay.doorsFrac >= 1).length,
        loaded: warehouse.bays.map((bay) => (bay.phase === 'away' ? '-' : String(bay.loaded))).join(','),
        maxTractorRad: Math.max(...warehouse.bays.map((bay) => Math.abs(bay.pose.tractorRad))),
        playRate: Math.max(...warehouse.bays.map((bay) => bay.playRate)),
      }),
    },
    life,
  );
}
