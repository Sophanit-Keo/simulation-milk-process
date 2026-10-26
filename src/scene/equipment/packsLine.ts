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
import type { PointM } from '../layout';
import { motionDtS as busyMotionDtS } from '../motion';
import { createTokenStream, PACK_BELT_SPEED_MPS, TRAY_BELT_SPEED_MPS, type TokenStream } from './packs/belts';
import { FixtureBuilder, type BuiltFixture, type InstanceM } from './packs/builder';
import { beltPlacements, createKitLoader, greyBelt, greyRollers, repeatPlacements, swapInKit, type KitLoader, type Placement } from './packs/conveyors';
import { createKit, type Kit, type PrintName } from './packs/kit';
import * as at from './packs/layout';
import { createPalletTraffic, PALLET_SPEED_MPS, type PalletTraffic } from './packs/palletTraffic';
import { createQuarantineBlocks, type QuarantineBlocks } from './packs/quarantineBlocks';
import { fillerFlowLph, kpiValue, labelValue, stageStatus, stageValue } from './packs/readings';
import { CARTON_PITCH_M, CARTON_SIZE_M, LINE_A_START_M, LINE_B_START_M, TRAY_PITCH_M, TRAY_SIZE_M, cartonPlaces, tokenInstances, trayPlaces } from './packs/tokens';
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
/** The stretch wrapper's turntable turns about once in 2.6 s while it wraps a pallet. */
const WRAP_RAD_PER_S = 2.4;

/** Litres in one pack, to count the running fillers from the flow they draw. */
const PACK_VOLUME_L = plantJson.product.packVolumeL;
const FILLER_COUNT = plantJson.fillers.count;

/** The load on a full pallet at the palletizer; it grows with the trays placed (phase 4). */
const STACK_HEIGHT_M = 1.1;

/** Pallets of stock a rack place stands for: the racks' 384 places then hold 1,920, D11's 634 and about 39 days of growth (H43). */
export const PALLETS_PER_RACK_PLACE = 5;

/** A truck drives in from the road and out again over this much real time (before the motion rate). */
const TRUCK_DRIVE_S = 3;
/** How far beyond its docked spot a truck starts and ends its drive, off the apron. */
const TRUCK_ROAD_M = 45;
/** Forklifts drive at this speed (before the motion rate) while there is stock to move. */
const FORKLIFT_SPEED_MPS = 2.2;
/** A forklift keeps going this long of real time after the stock last changed, putting pallets away. */
const FORKLIFT_BUSY_S = 12;

/** Lamp colours: the light theme's --ok, --warn, --bad and --steel-dark (plan 08). */
const LAMP_COLORS: Record<Status, number> = { ok: 0x1f8f57, warn: 0xa87400, bad: 0xc63a2b, idle: 0x76858f };

/** Stages 7–10, packs to trucks: one Equipment per machine or fixture. */
export const packsLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  const kitLoader = createKitLoader(ctx);
  // Shared by the fixtures that hand pallets on: the quarantine's blocks, and the pallets riding to them.
  const blocks = createQuarantineBlocks(kit.shape('box'), kit.shape('sphere'), kit.material('carton'));
  const traffic = createPalletTraffic(kit.shape('box'), kit.material('wood'), kit.material('carton'));
  return [
    filler(kit, 'a'),
    filler(kit, 'b'),
    packConveyors(kit, kitLoader),
    accumulationTable(kit, kitLoader),
    trayShrinkTunnel(kit),
    trayConveyor(kit, kitLoader),
    palletizer(kit),
    stretchWrapper(kit, traffic),
    palletConveyor(kit, kitLoader, traffic, blocks),
    quarantine(kit, blocks),
    qaLab(kit),
    racks(kit),
    docks(kit),
    forklift(kit, ctx, 'forklift-1', { fromM: [-24, 10.6], toM: [-56, 10.6] }),
    forklift(kit, ctx, 'forklift-2', { fromM: [-24, 17.95], toM: [-50, 17.95] }),
    trucks(kit, ctx),
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
  labelAnchorNowM?: Equipment['labelAnchorNowM'];
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
  if (spec.labelAnchorNowM) equipment.labelAnchorNowM = spec.labelAnchorNowM;
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
  });
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
  // The load grows with the trays placed: the fuller of the two lines' pallets, built in turn here.
  const stack = b.mesh('stack', 'box', 'carton', [placeXM, palletTopM + STACK_HEIGHT_M / 4, placeZM], [1.42, STACK_HEIGHT_M / 2, 1.08], { castShadow: true });
  let shownFrac = 0.5;

  // The preview's angles: the long way round would sweep over the tray line, so it swings via -z.
  const pickRad = armRadToward(at.PICK_M);
  const placeRad = armRadToward(at.PLACE_M) + 2 * Math.PI;
  arm.rotation.y = pickRad;
  let swingRad = 0;
  const fixture = b.build();
  const life = lifetime();
  // The pallet is the fixture's only wooden part, so its merged mesh is the pallet alone.
  const pallet = fixture.object.getObjectByName('palletizer-wood');
  if (pallet instanceof THREE.Mesh) printOn(kit, 'pallet', [pallet], life);
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
        if (fullFrac !== null && fullFrac !== shownFrac) {
          shownFrac = fullFrac;
          stack.visible = fullFrac > 0;
          stack.scale.y = Math.max(STACK_HEIGHT_M * fullFrac, 0.001);
          stack.position.y = palletTopM + stack.scale.y / 2;
        }
        if (!packerRuns(s)) return;
        swingRad = (swingRad + ARM_RAD_PER_S * motionDtS(s, realDtS)) % (2 * Math.PI);
        arm.rotation.y = pickRad + (placeRad - pickRad) * (0.5 - 0.5 * Math.cos(swingRad));
      },
      debugState: () => ({ stackFrac: shownFrac, armRad: arm.rotation.y }),
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

function stretchWrapper(kit: Kit, traffic: PalletTraffic): Equipment {
  const [xM, zM] = at.WRAPPER_M;
  const b = new FixtureBuilder(kit, 'stretch-wrapper', [xM, 0, zM]);
  const radiusM = at.TURNTABLE_RADIUS_M;
  // The turntable is flush with the pallet rollers either side of it, and turns while a pallet is wrapped;
  // a bar across it shows the turn.
  const turntable = b.group('turntable', [xM, at.PALLET_ROLLER_TOP_M / 2, zM]);
  b.part('cyl', 'steelDark', [0, 0, 0], [radiusM, at.PALLET_ROLLER_TOP_M, radiusM], { parent: turntable });
  b.part('box', 'paint', [0, at.PALLET_ROLLER_TOP_M / 2 + 0.005, 0], [radiusM * 1.8, 0.01, 0.12], { parent: turntable });
  b.part('box', 'steelDark', [20.15, 0.05, 13.35], [0.5, 0.1, 0.5]); // mast foot
  b.part('box', 'paint', [20.15, 1.35, 13.35], [0.2, 2.7, 0.2], { castShadow: true }); // mast
  // The film carriage rides up and down the mast while a pallet turns.
  const carriage = b.mesh('carriage', 'box', 'steelDark', [20.35, 0.6, 13.5], [0.32, 0.22, 0.5]);
  let wrapRad = 0;
  return machine(b.build(), {
    id: 'stretch-wrapper',
    stage: 8,
    label: 'Stretch wrapper',
    labelAnchorM: [xM - 0.6, 3.1, zM - 0.5],
    update(s, realDtS) {
      if (!traffic.wrapping()) return;
      const dtS = busyMotionDtS(s, realDtS);
      turntable.rotation.y = (turntable.rotation.y + WRAP_RAD_PER_S * dtS) % (2 * Math.PI);
      wrapRad = (wrapRad + (WRAP_RAD_PER_S / 4) * dtS) % (2 * Math.PI);
      carriage.position.y = 0.6 + 0.8 * (0.5 - 0.5 * Math.cos(wrapRad));
    },
    debugState: () => ({ wrapping: traffic.wrapping(), turnRad: turntable.rotation.y }),
  });
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
  riders.add(traffic.bases, traffic.loads);
  fixture.object.add(riders);
  life.onEnd(() => traffic.dispose());
  printOn(kit, 'pallet', [traffic.bases], life);
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
      debugState: () => ({ riding: traffic.riding(), wrapping: traffic.wrapping() }),
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
      update(s) {
        if (s.packs) blocks.update(s.packs.batches);
      },
      batchAt: (object, instanceId) => blocks.batchAt(object, instanceId),
      selectBatch: (batchId) => blocks.select(batchId),
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
      // Over the lab's front, toward the incubators whose temperature it shows. From the overview its
      // lamp then stays clear of the aseptic tank's zone name in the aisle beyond (zones.ts).
      labelAnchorM: [xM, heightM + 0.5, frontZM - 0.4],
      labelText: (s) => labelValue(stageValue(s, 9, 'incubationTempC'), 0, '°C'),
      update: (s) => show(stageStatus(s, 9) ?? 'idle'),
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
 * stays if the file is missing). Built facing +z round its own centre; place() turns it to `dir` and puts it at `atM`.
 */
function buildVehicle(
  kit: Kit,
  ctx: EquipmentContext,
  spec: { id: string; modelPath: string; size: VehicleSizeM },
  buildGrey: (b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM) => void,
  life: Lifetime,
): BuiltFixture {
  const b = new FixtureBuilder(kit, spec.id, [0, 0, 0]);
  const greyLayer = b.layer('grey-box');
  buildGrey(b, greyLayer, spec.size);
  const fixture = b.build();
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
  return fixture;
}

/** Puts a vehicle at a floor point, turned so its front (+z) faces `dir`. */
function place(object: THREE.Object3D, atM: at.FloorPointM, dir: at.FloorPointM): void {
  object.position.set(atM[0], 0, atM[1]);
  object.rotation.y = Math.atan2(dir[0], dir[1]); // turns +z toward dir
}

/** A stretch of floor a forklift shuttles along: from its parking spot to the far end and back. */
interface ForkliftRun {
  fromM: at.FloorPointM;
  toM: at.FloorPointM;
}

/**
 * A forklift on an aisle of the warehouse: parked at the run's start, it shuttles along the run while a truck
 * loads or stock has just come in from quarantine, forks first on the way out and turning at each end.
 */
function forklift(kit: Kit, ctx: EquipmentContext, id: string, run: ForkliftRun): Equipment {
  const life = lifetime();
  const fixture = buildVehicle(kit, ctx, { id, modelPath: 'vehicles/forklift.glb', size: at.FORKLIFT_SIZE_M }, greyForklift, life);
  const lengthM = Math.hypot(run.toM[0] - run.fromM[0], run.toM[1] - run.fromM[1]);
  const dirOut: at.FloorPointM = [(run.toM[0] - run.fromM[0]) / lengthM, (run.toM[1] - run.fromM[1]) / lengthM];
  const dirBack: at.FloorPointM = [-dirOut[0], -dirOut[1]];
  let alongM = 0;
  let outward = true;
  let busyS = 0;
  let lastStock: number | undefined;
  const at_ = (): at.FloorPointM => [run.fromM[0] + dirOut[0] * alongM, run.fromM[1] + dirOut[1] * alongM];
  place(fixture.object, at_(), dirOut);
  return machine(
    fixture,
    {
      id,
      stage: 10,
      label: 'Forklift',
      // Parked at the start of its run; while it drives, the label rides with it (labelAnchorNowM).
      labelAnchorM: [run.fromM[0], at.FORKLIFT_SIZE_M.heightM + 0.4, run.fromM[1]],
      update(s, realDtS) {
        const stock = kpiValue(s, 'palletsInStock');
        if (stock !== undefined && lastStock !== undefined && stock !== lastStock) busyS = FORKLIFT_BUSY_S;
        lastStock = stock;
        const loading = s.packs?.warehouse.trucks.some((truck) => truck.state === 'loading') ?? false;
        busyS = Math.max(0, busyS - (s.paused ? 0 : realDtS));
        // Idle, it finishes its trip back to its spot and parks there.
        if (!loading && busyS === 0 && alongM === 0) return;
        const stepM = FORKLIFT_SPEED_MPS * busyMotionDtS(s, realDtS);
        if (!(stepM > 0)) return;
        if (!loading && busyS === 0) outward = false;
        alongM += outward ? stepM : -stepM;
        if (alongM >= lengthM) {
          alongM = lengthM;
          outward = false;
        } else if (alongM <= 0) {
          alongM = 0;
          outward = true;
        }
        place(fixture.object, at_(), outward ? dirOut : dirBack);
      },
      labelAnchorNowM: () => {
        const [xM, zM] = at_();
        return [xM, at.FORKLIFT_SIZE_M.heightM + 0.4, zM];
      },
      debugState: () => ({ alongM, outward }),
    },
    life,
  );
}

/** Where a truck stands docked at a door: its tail at the bumpers, facing out (+z). */
const dockedAtM = (door: number): at.FloorPointM => [at.DOOR_X_M[door] ?? at.DOOR_X_M[1], at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM / 2];

/** One dock door's truck, as the 3D view shows it: away, driving in, at the door, or driving off. */
interface Bay {
  fixture: BuiltFixture;
  door: number;
  phase: 'away' | 'arriving' | 'docked' | 'leaving';
  /** Real time into the drive, and the truck the bay shows (null while away). */
  driveS: number;
  shownId: number | null;
}

/**
 * The trucks at the three dock doors (D2, D3): each door's truck drives in when the sim docks one there, stands
 * while it loads or waits for stock, and drives off when it leaves; a truck backs in tail first. A truck that
 * waits in the yard for a free door is not drawn. The label, over the middle door, names the first truck there.
 */
function trucks(kit: Kit, ctx: EquipmentContext): Equipment {
  const life = lifetime();
  const root = new THREE.Group();
  root.name = 'trucks';
  const bays: Bay[] = at.DOOR_X_M.map((_, door) => {
    const fixture = buildVehicle(kit, ctx, { id: `truck-${door + 1}`, modelPath: 'vehicles/truck.glb', size: at.TRUCK_SIZE_M }, greyTruck, life);
    place(fixture.object, dockedAtM(door), [0, 1]);
    fixture.object.visible = false;
    root.add(fixture.object);
    return { fixture, door, phase: 'away', driveS: 0, shownId: null };
  });
  const roadZ = (bay: Bay, frac: number): number => dockedAtM(bay.door)[1] + TRUCK_ROAD_M * frac;
  const drive = (bay: Bay, s: Snapshot, realDtS: number): void => {
    const targetId = s.packs?.warehouse.trucks.find((truck) => truck.door === bay.door)?.id ?? null;
    const dtS = busyMotionDtS(s, realDtS);
    if ((bay.phase === 'docked' || bay.phase === 'arriving') && targetId !== bay.shownId) {
      bay.phase = 'leaving';
      bay.driveS = 0;
    }
    if (bay.phase === 'away' && targetId !== null) {
      bay.phase = 'arriving';
      bay.driveS = 0;
      bay.shownId = targetId;
    }
    if (bay.phase === 'arriving' || bay.phase === 'leaving') bay.driveS += dtS;
    const k = Math.min(1, bay.driveS / TRUCK_DRIVE_S);
    const object = bay.fixture.object;
    if (bay.phase === 'arriving') {
      // Backs in, slowing to a stop at the bumpers.
      object.position.z = roadZ(bay, (1 - k) ** 3);
      if (k >= 1) bay.phase = 'docked';
    } else if (bay.phase === 'leaving') {
      // Pulls away, gathering speed.
      object.position.z = roadZ(bay, k ** 3);
      if (k >= 1) {
        bay.phase = 'away';
        bay.shownId = null;
      }
    } else if (bay.phase === 'docked') {
      object.position.z = roadZ(bay, 0);
    }
    object.visible = bay.phase !== 'away';
  };
  const fixture: BuiltFixture = {
    object: root,
    dispose: () => {
      for (const bay of bays) bay.fixture.dispose();
    },
    release: () => {},
  };
  return machine(
    fixture,
    {
      id: 'truck',
      stage: 10,
      label: 'Trucks',
      labelAnchorM: [at.DOOR_X_M[1], at.TRUCK_SIZE_M.heightM + 0.4, dockedAtM(1)[1]],
      labelText(s) {
        const first = s.packs?.warehouse.trucks.find((truck) => truck.door >= 0);
        if (!first) return s.packs ? 'none at the dock' : '';
        return first.state === 'loading' ? `${first.id} loading` : `${first.id} waiting for stock`;
      },
      update(s, realDtS) {
        for (const bay of bays) drive(bay, s, realDtS);
      },
      debugState: () => ({
        shown: bays.filter((bay) => bay.phase !== 'away').length,
        docked: bays.filter((bay) => bay.phase === 'docked').length,
        doors: bays.map((bay) => bay.shownId ?? '-').join(','),
      }),
    },
    life,
  );
}
