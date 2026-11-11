// The reefers at the yogurt wing's north dock (phase 29, D31): each an articulated truck built of boxes, moved by the
// UHT dock's moves (phase 12, packs/truckMoves.ts) turned half a turn to the north yard. A reefer drives in from the
// east along the yard's lane, past its door, opens its rear doors, backs to its door along a curve with its tractor
// turned, stands under the dock's rising roller door while it fills by the sim's count, closes up and drives off west
// along the road behind the wing.
//
// The boxes are instances in the cold chain's box mesh (coldChainScene.ts SharedBoxes), coloured per box and casting no
// shadow, so the yard costs no draw call. The truck is drawn in its own frame, as the UHT truck's model: origin at its
// footprint centre on the floor, the cab at +z, the trailer's tail at −8.25 m, the fifth wheel's kingpin at +3.7 m.
//
// The sim gives a reefer 30 min to back up (`arriving`) and 20 min to load (`loading`). The arrival is timed to end as
// the sim docks the reefer: the truck sets off once the motion time left of its 30 min is what the moves take. From
// then on the bays fit it to the sim's time as they do the UHT trucks (played faster, or skipped, when the sim outruns
// them), and it closes up as the sim sends it away.
import * as THREE from 'three';
import type { Snapshot, YogurtReefer } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import { FLOOR } from '../../layout';
import { motionDtS, motionRate } from '../../motion';
import { DOCKED_TAIL_Z_M } from '../packs/layout';
import { bayArriveS, createBays, createDockPath, KINGPIN_Z_M, stepBays, TRUCK_MOVES_S, type Bay, type DoorTruck, type SimClock, type TruckPose, type Yard } from '../packs/truckMoves';
import type { SharedBoxes } from './coldChainScene';
import * as at from './layout';
import { yogurtOf } from './readings';

const CHAIN = plantJson.yogurt.coldChain;

/* the truck, in its own frame (metres) */

/** The trailer: its tail and front wall along z, its deck's top, its roof's top and its width. */
export const TRAILER = { tailZM: -8.25, frontZM: 5.35, deckM: 1.27, roofM: 3.95, widthM: 2.5 } as const;
/** Where the docked trailer's tail stands: against the dock leveller in front of the cold room's north wall. */
export const REEFER_TAIL_Z_M = at.COLD_ROOM.zMinM - 1.2;
/** The rear doors' hinges, 3 cm out from the walls so a folded door lies clear of them, and how they open about +y. */
const HINGE_X_M = TRAILER.widthM / 2 + 0.03;
export const REEFER_DOOR_OPEN_RAD = { left: (3 * Math.PI) / 2, right: (-3 * Math.PI) / 2 } as const;
const WHEEL_RADIUS_M = 0.52;
/**
 * The refrigeration unit on the trailer's front wall and the back of the tractor's cab. The cab's back is further from
 * the kingpin than the unit's far corner, so the two never meet however the tractor is turned (reeferTruck.test.ts).
 */
export const UNIT_DEPTH_M = 0.4;
export const UNIT_HALF_M = 1.05;
export const CAB_BACK_Z_M = 6.25;
/** The trailer's bogie and the tractor's drive and steer axles, along z. */
const TRAILER_AXLES_Z_M = [-7.05, -5.75, -4.45] as const;
const TRACTOR_AXLES_Z_M = [3.6, 7.15] as const;
/** The load: 26 pallets in 13 rows of two from the front wall back, each 1.2 m across and 1.0 m along the trailer. */
export const LOAD = { rows: 13, pitchZM: 1.02, firstZM: TRAILER.frontZM - 0.62, xM: 0.61, sizeM: [1.16, 0.95, 0.96] } as const;
export const PALLETS_PER_REEFER = CHAIN.palletsPerTruck;

const HEX = {
  trailer: 0xe9ecef,
  liner: 0x3c4146,
  deck: 0x5a4a3b,
  chassis: 0x2c343b,
  tractor: 0x4f7896,
  glass: 0x22303a,
  tyre: 0x1e2226,
  unit: 0xd7dce0,
  grille: 0x3c454d,
  fan: 0x8a96a0,
  running: 0x4aa3ff,
  lightRed: 0xc0392b,
  lightWhite: 0xf3f0e2,
  steel: 0xc5ccd2,
  load: 0xf2efe6,
  roller: 0xb8c1c8,
  red: 0xff3b30,
  green: 0x34c759,
} as const;

/** What a box rides on: the trailer, or the tractor, which turns about the kingpin. */
type Body = 'trailer' | 'tractor';
/** A box that moves within its body: a rear door on its hinge, a wheel turning on its axle, the unit's fan. */
type Moves = { kind: 'door'; side: 'left' | 'right' } | { kind: 'wheel'; turnRad: number } | { kind: 'fan' } | { kind: 'lamp' } | null;

interface BoxSpec {
  body: Body;
  /** Centre and size in the truck's frame; a door's centre is from its hinge, and `hinge` says where that is. */
  centre: readonly [number, number, number];
  size: readonly [number, number, number];
  hex: number;
  moves: Moves;
  hinge?: readonly [number, number, number];
}

function truckBoxes(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const add = (body: Body, centre: BoxSpec['centre'], size: BoxSpec['size'], hex: number, moves: Moves = null, hinge?: BoxSpec['hinge']): void => {
    boxes.push({ body, centre, size, hex, moves, ...(hinge ? { hinge } : {}) });
  };
  const T = TRAILER;
  const lengthM = T.frontZM - T.tailZM;
  const midZM = (T.frontZM + T.tailZM) / 2;
  const wallM = T.roofM - T.deckM;
  const halfM = T.widthM / 2;
  // The trailer's shell, open at the back: deck, two walls, roof, front wall.
  add('trailer', [0, T.deckM - 0.07, midZM], [T.widthM, 0.14, lengthM], HEX.deck);
  for (const side of [-1, 1]) add('trailer', [side * (halfM - 0.03), T.deckM + wallM / 2, midZM], [0.06, wallM, lengthM], HEX.trailer);
  add('trailer', [0, T.roofM - 0.03, midZM], [T.widthM, 0.06, lengthM], HEX.trailer);
  add('trailer', [0, T.deckM + wallM / 2, T.frontZM - 0.03], [T.widthM, wallM, 0.06], HEX.trailer);
  // Under it: the frame, the landing legs (raised), the rear bumper and its lights, the mudguards over the bogie.
  add('trailer', [0, 0.98, -1.9], [1.0, 0.3, 11.8], HEX.chassis);
  for (const side of [-1, 1]) {
    add('trailer', [side * 0.9, 0.78, 2.4], [0.1, 0.7, 0.1], HEX.chassis);
    add('trailer', [side * 0.95, 0.78, T.tailZM + 0.03], [0.3, 0.12, 0.05], HEX.lightRed);
    add('trailer', [side * (halfM - 0.2), 1.1, -5.75], [0.4, 0.05, 3.7], HEX.chassis);
  }
  add('trailer', [0, 0.55, T.tailZM + 0.1], [2.3, 0.14, 0.12], HEX.chassis);
  // The refrigeration unit on the front wall, over the tractor's cab: its casing, its grille, the fan and a lamp.
  add('trailer', [0, 3.05, T.frontZM + UNIT_DEPTH_M / 2], [UNIT_HALF_M * 2, 1.5, UNIT_DEPTH_M], HEX.unit);
  add('trailer', [0, 3.15, T.frontZM + UNIT_DEPTH_M + 0.005], [1.3, 0.9, 0.02], HEX.grille);
  add('trailer', [0, 3.15, T.frontZM + UNIT_DEPTH_M + 0.025], [0.8, 0.12, 0.02], HEX.fan, { kind: 'fan' });
  add('trailer', [0.85, 2.48, T.frontZM + UNIT_DEPTH_M + 0.005], [0.14, 0.14, 0.03], HEX.running, { kind: 'lamp' });
  // The bogie's six wheels: each two boxes, one turned an eighth of a turn, so it reads as round and is seen to roll.
  for (const zM of TRAILER_AXLES_Z_M) {
    for (const side of [-1, 1]) {
      for (const turnRad of [0, Math.PI / 4]) add('trailer', [side * (halfM - 0.2), WHEEL_RADIUS_M, zM], [0.34, 0.74, 0.74], HEX.tyre, { kind: 'wheel', turnRad });
    }
  }
  // The rear doors, each on its hinge at the tail's corner, shut across the opening.
  const doorM = halfM + 0.01;
  add('trailer', [doorM / 2, 0, -0.025], [doorM, wallM - 0.04, 0.05], HEX.trailer, { kind: 'door', side: 'left' }, [-HINGE_X_M, T.deckM + wallM / 2, T.tailZM]);
  add('trailer', [-doorM / 2, 0, -0.025], [doorM, wallM - 0.04, 0.05], HEX.trailer, { kind: 'door', side: 'right' }, [HINGE_X_M, T.deckM + wallM / 2, T.tailZM]);

  // The tractor: frame, fifth wheel, cab with its deflector, glass, grille, bumper, lights, mirrors, tank, wheels.
  add('tractor', [0, 0.72, 5.0], [1.0, 0.3, 6.3], HEX.chassis);
  add('tractor', [0, 1.08, KINGPIN_Z_M], [1.1, 0.1, 1.1], HEX.chassis);
  add('tractor', [0, 2.27, (CAB_BACK_Z_M + 8.15) / 2], [T.widthM, 2.5, 8.15 - CAB_BACK_Z_M], HEX.tractor);
  add('tractor', [0, 3.72, CAB_BACK_Z_M + 0.85], [2.3, 0.4, 1.5], HEX.tractor);
  add('tractor', [0, 2.85, 8.16], [2.2, 0.95, 0.04], HEX.glass);
  add('tractor', [0, 1.7, 8.16], [1.6, 0.7, 0.04], HEX.grille);
  add('tractor', [0, 0.82, 8.1], [T.widthM, 0.42, 0.3], HEX.chassis);
  add('tractor', [0.95, 0.75, 4.95], [0.55, 0.55, 1.1], HEX.steel);
  for (const side of [-1, 1]) {
    add('tractor', [side * (halfM + 0.01), 2.85, 7.6], [0.03, 0.8, 0.9], HEX.glass);
    add('tractor', [side * 0.95, 1.25, 8.17], [0.32, 0.16, 0.03], HEX.lightWhite);
    add('tractor', [side * (halfM + 0.13), 2.9, 8.0], [0.08, 0.4, 0.2], HEX.chassis);
  }
  for (const zM of TRACTOR_AXLES_Z_M) {
    for (const side of [-1, 1]) {
      for (const turnRad of [0, Math.PI / 4]) add('tractor', [side * (halfM - 0.2), WHEEL_RADIUS_M, zM], [0.34, 0.74, 0.74], HEX.tyre, { kind: 'wheel', turnRad });
    }
  }
  return boxes;
}

/** The boxes of one truck, in the order they are drawn. */
export const TRUCK_BOXES: readonly BoxSpec[] = truckBoxes();
/** Instances a dock door takes: its truck, the truck's load, the dock's roller door and its lamp. */
const PER_DOOR = TRUCK_BOXES.length + PALLETS_PER_REEFER + 2;

/** The dock's roller door in the cold room's north wall: its width, the height of its opening, its thickness. */
export const ROLLER_DOOR = { widthM: 2.7, openingM: at.COLD_ROOM.wallM - 0.3, thickM: 0.08 } as const;

/* the UHT dock's moves, turned round to the north yard */

/**
 * Where the reefers come onto the floor and leave it (the bogie's x): in from beyond the floor's east edge, the cab
 * leading, and out beyond its west edge, the tail clear of it. The UHT trucks' road runs the other way.
 */
export const REEFER_ROAD_X_M = { inXM: FLOOR.xMaxM + 15, outXM: FLOOR.xMinM - 3 } as const;
/**
 * The bays work in the UHT dock's frame (it faces +z, its trucks come from −x and stop past their door at +x). The
 * north dock is that frame turned half a turn about the y axis: x reads −x, a heading h reads h + π, and the tractor
 * turns the same way. So each bay's door and its road are given to the bays with their x negated.
 */
/**
 * The yard's path out of a dock. The doors stand 4.5 m apart (the UHT dock's 8 m), so a reefer pulls 9 m straight out
 * before it turns, which keeps it 0.9 m clear of a reefer docked at the next door, and it turns harder than a UHT
 * truck to keep to a lane as near: its tractor up to REEFER_ARTICULATION_RAD off the trailer (the UHT trucks' 0.6).
 */
export const REEFER_ARTICULATION_RAD = 0.9;
export const REEFER_MOVES: Readonly<Yard> = {
  path: createDockPath({ straightOutM: 9, articulationRad: REEFER_ARTICULATION_RAD }),
  road: { inXM: -REEFER_ROAD_X_M.inXM, outXM: -REEFER_ROAD_X_M.outXM },
};

/**
 * A bay's pose in the north yard: the UHT dock's tails stand at DOCKED_TAIL_Z_M, the yogurt dock's at REEFER_TAIL_Z_M,
 * the cabs to the north.
 */
export function reeferPose(bay: Pick<Bay, 'pose'>, out: TruckPose): TruckPose {
  out.xM = -bay.pose.xM;
  out.zM = REEFER_TAIL_Z_M - (bay.pose.zM - DOCKED_TAIL_Z_M);
  out.headingRad = bay.pose.headingRad + Math.PI;
  out.tractorRad = bay.pose.tractorRad;
  return out;
}

/** The bays of the north dock's doors, door by door, in the turned frame (createBays). */
export const createReeferBays = (): Bay[] => createBays(at.DOCK_DOORS_X_M.map((xM) => -xM), REEFER_MOVES);

/** Motion seconds a bay's reefer takes from the road to its door: driving in, opening up, backing in. */
export const approachS = (bay: Pick<Bay, 'doorXM' | 'yard'>): number => bayArriveS(bay) + TRUCK_MOVES_S.doors + TRUCK_MOVES_S.reverse;

/**
 * The sim's reefers as the bays read them, door by door. An arriving reefer is handed to its bay once the motion time
 * left of its backing up is what the approach takes (or once the bay already shows it), so it docks as the sim docks
 * it; a loading one with the sim seconds it has left and its pallets on board.
 */
export function doorTrucks(reefers: readonly YogurtReefer[], bays: readonly Bay[], timeS: number, clock: Pick<SimClock, 'speed' | 'rate'>, out: (DoorTruck | null)[]): (DoorTruck | null)[] {
  for (let door = 0; door < bays.length; door++) out[door] = null;
  for (const reefer of reefers) {
    const bay = bays[reefer.door];
    if (!bay) continue;
    if (reefer.state === 'loading') {
      out[reefer.door] = { id: reefer.id, loading: true, remainingS: Math.max(0, reefer.untilS - timeS), loadedPallets: reefer.pallets };
      continue;
    }
    const leftMotionS = (Math.max(0, reefer.untilS - timeS) / Math.max(clock.speed, 1e-9)) * clock.rate;
    if (bay.shownId === reefer.id || leftMotionS <= approachS(bay)) out[reefer.door] = { id: reefer.id, loading: false, remainingS: 0, loadedPallets: 0 };
  }
  return out;
}

/* the yard */

export interface ReeferYard extends SharedBoxes {
  readonly bays: readonly Bay[];
  /** Moves the bays on with the sim's reefers and draws them: once a frame. */
  advance(snapshot: Snapshot, realDtS: number): void;
  /** What the yard shows, for the cold chain's debugState. */
  state(): { reefers: number; reeferPhases: string; reeferDoorsOpen: number; reeferLoaded: string; dockDoorsUp: number; dockLamps: string; reeferFanTurns: number };
}

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export function createReeferYard(): ReeferYard {
  const bays = createReeferBays();
  const atDoor: (DoorTruck | null)[] = bays.map(() => null);
  const clock: SimClock = { speed: 1, rate: 1, palletsPerTruck: PALLETS_PER_REEFER };
  let mesh: THREE.InstancedMesh | null = null;
  let offset = 0;
  /** How far each truck's wheels have turned, and where its bogie stood last frame. */
  const wheelRad = bays.map(() => 0);
  const lastAt = bays.map(() => ({ xM: 0, zM: 0, seen: false }));
  let fanTurns = 0;
  let last: Snapshot | null = null;
  /** Each door's reefer's own load: a reefer called for the oldest pallets may leave with fewer than a full one. */
  const loadOf = bays.map(() => PALLETS_PER_REEFER);
  /** Pallets on board the reefer at a door: the bay's count (the full load once it closes up), within its own load. */
  const onBoard = (bay: Bay): number => Math.min(loadOf[bay.door] ?? PALLETS_PER_REEFER, bay.loaded);

  const pose: TruckPose = { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 };
  const trailer = new THREE.Matrix4();
  const tractor = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  /** A box's own matrix in its body's frame: where it is, how it is turned, its size. */
  function boxMatrix(spec: BoxSpec, doorsFrac: number, wheel: number): THREE.Matrix4 {
    const [cx, cy, cz] = spec.centre;
    scale.set(spec.size[0], spec.size[1], spec.size[2]);
    const moves = spec.moves;
    if (moves?.kind === 'door' && spec.hinge) {
      // About its hinge: the door's centre swings round with it.
      const rad = REEFER_DOOR_OPEN_RAD[moves.side] * doorsFrac;
      quaternion.setFromAxisAngle(up, rad);
      position.set(cx, cy, cz).applyQuaternion(quaternion);
      position.x += spec.hinge[0];
      position.y += spec.hinge[1];
      position.z += spec.hinge[2];
    } else if (moves?.kind === 'wheel') {
      quaternion.setFromEuler(euler.set(wheel + moves.turnRad, 0, 0));
      position.set(cx, cy, cz);
    } else if (moves?.kind === 'fan') {
      quaternion.setFromEuler(euler.set(0, 0, fanTurns * Math.PI * 2));
      position.set(cx, cy, cz);
    } else {
      quaternion.identity();
      position.set(cx, cy, cz);
    }
    return local.compose(position, quaternion, scale);
  }

  function draw(): void {
    if (!mesh) return;
    bays.forEach((bay, door) => {
      const first = offset + door * PER_DOOR;
      const shown = bay.phase !== 'away';
      if (shown) {
        reeferPose(bay, pose);
        trailer.makeRotationY(pose.headingRad).setPosition(pose.xM, 0, pose.zM);
        // The tractor turns about the kingpin: out to it, turned, and back.
        turn.makeRotationY(pose.tractorRad).setPosition(0, 0, KINGPIN_Z_M);
        tractor.copy(trailer).multiply(turn).multiply(local.makeTranslation(0, 0, -KINGPIN_Z_M));
      }
      TRUCK_BOXES.forEach((spec, i) => {
        if (!shown) {
          mesh?.setMatrixAt(first + i, HIDE);
          return;
        }
        world.copy(spec.body === 'tractor' ? tractor : trailer).multiply(boxMatrix(spec, bay.doorsFrac, wheelRad[door] ?? 0));
        mesh?.setMatrixAt(first + i, world);
      });
      // The load, from the front wall back, two abreast, while it can be seen through the open doors.
      const loaded = shown && bay.loadShown ? onBoard(bay) : 0;
      for (let i = 0; i < PALLETS_PER_REEFER; i++) {
        const at_ = first + TRUCK_BOXES.length + i;
        if (i >= loaded) {
          mesh?.setMatrixAt(at_, HIDE);
          continue;
        }
        const row = Math.floor(i / 2);
        position.set((i % 2 === 0 ? -1 : 1) * LOAD.xM, TRAILER.deckM + LOAD.sizeM[1] / 2, LOAD.firstZM - row * LOAD.pitchZM);
        world.copy(trailer).multiply(local.compose(position, quaternion.identity(), scale.set(LOAD.sizeM[0], LOAD.sizeM[1], LOAD.sizeM[2])));
        mesh?.setMatrixAt(at_, world);
      }
      // The dock's roller door hangs from the door head and rolls up; its lamp, on the wall's top, is red while a
      // reefer stands docked (do not drive off) and green otherwise.
      const rollerAt = first + TRUCK_BOXES.length + PALLETS_PER_REEFER;
      const doorXM = at.DOCK_DOORS_X_M[door] ?? 0;
      const hangM = Math.max(0.12, ROLLER_DOOR.openingM * (1 - bay.rollerFrac));
      position.set(doorXM, ROLLER_DOOR.openingM - hangM / 2, at.COLD_ROOM.zMinM);
      mesh?.setMatrixAt(rollerAt, world.compose(position, quaternion.identity(), scale.set(ROLLER_DOOR.widthM, hangM, ROLLER_DOOR.thickM)));
      position.set(doorXM + 1.05, at.COLD_ROOM.wallM + 0.11, at.COLD_ROOM.zMinM);
      mesh?.setMatrixAt(rollerAt + 1, world.compose(position, quaternion.identity(), scale.set(0.2, 0.2, 0.2)));
      mesh?.setColorAt(rollerAt + 1, color.setHex(bay.phase === 'docked' ? HEX.red : HEX.green));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    count: bays.length * PER_DOOR,
    bays,
    bind(target, first) {
      mesh = target;
      offset = first;
      // The colours stand: only the dock lamps change (draw()).
      bays.forEach((_bay, door) => {
        const start = first + door * PER_DOOR;
        TRUCK_BOXES.forEach((spec, i) => target.setColorAt(start + i, color.setHex(spec.hex)));
        for (let i = 0; i < PALLETS_PER_REEFER; i++) target.setColorAt(start + TRUCK_BOXES.length + i, color.setHex(HEX.load));
        target.setColorAt(start + TRUCK_BOXES.length + PALLETS_PER_REEFER, color.setHex(HEX.roller));
        target.setColorAt(start + TRUCK_BOXES.length + PALLETS_PER_REEFER + 1, color.setHex(HEX.green));
      });
      draw();
    },
    advance(snapshot, realDtS) {
      if (snapshot === last) return;
      last = snapshot;
      const chain = yogurtOf(snapshot)?.coldChain;
      const motionS = motionDtS(snapshot, realDtS);
      clock.speed = snapshot.speed;
      clock.rate = motionRate(snapshot.speed);
      for (const reefer of chain?.reefers ?? []) {
        if (reefer.door < loadOf.length) loadOf[reefer.door] = Math.min(PALLETS_PER_REEFER, Math.max(0, reefer.load));
      }
      doorTrucks(chain?.reefers ?? [], bays, snapshot.timeS, clock, atDoor);
      stepBays(bays, atDoor, motionS, clock);
      // The wheels roll with the trailer along its heading; the unit's fan turns while a reefer is on the yard.
      bays.forEach((bay, door) => {
        const was = lastAt[door];
        if (!was) return;
        if (bay.phase === 'away') {
          was.seen = false;
          return;
        }
        reeferPose(bay, pose);
        if (was.seen) {
          const alongM = (pose.xM - was.xM) * Math.sin(pose.headingRad) + (pose.zM - was.zM) * Math.cos(pose.headingRad);
          wheelRad[door] = ((wheelRad[door] ?? 0) + alongM / WHEEL_RADIUS_M) % (Math.PI * 2);
        }
        was.xM = pose.xM;
        was.zM = pose.zM;
        was.seen = true;
      });
      if (bays.some((bay) => bay.phase !== 'away')) fanTurns += Math.min(0.45, 2.5 * motionS);
      draw();
    },
    state() {
      return {
        reefers: bays.filter((bay) => bay.phase !== 'away').length,
        reeferPhases: bays.map((bay) => bay.phase).join(','),
        reeferDoorsOpen: bays.filter((bay) => bay.phase !== 'away' && bay.doorsFrac >= 1).length,
        reeferLoaded: bays.map((bay) => (bay.phase === 'away' ? '-' : String(onBoard(bay)))).join(','),
        dockDoorsUp: bays.filter((bay) => bay.rollerFrac >= 1).length,
        dockLamps: bays.map((bay) => (bay.phase === 'docked' ? 'red' : 'green')).join(','),
        reeferFanTurns: Math.round(fanTurns * 1000) / 1000,
      };
    },
  };
}
