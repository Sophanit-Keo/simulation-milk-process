// Pallets on the move (phase 4): when the sim closes a pallet, a pallet token leaves the palletizer, stops on
// the stretch wrapper's turntable while it is wrapped, rides the pallet rollers to the hall's edge and is
// carried down an aisle of the quarantine to its batch's block. Like the cartons, these are a sample: at most
// one sets off every MIN_GAP_S of real time and POOL ride at once, so ×10,000 doesn't flood the floor.
//
// Since phase 12 (D22) a pallet carries the palletizer's stack of trays (palletizing.ts), the wrap takes the
// wrapper's whole cycle (stretchWrap.ts), turning the pallet with the turntable while its film shell grows, and
// the film stays on all the way to quarantine. Only one pallet stands on the turntable at a time: the next waits
// on the rollers just before it, and one that would have no room to wait is not shown.
import * as THREE from 'three';
import type { PalletRef } from '../../../contracts';
import type { PointM } from '../../layout';
import { blockCentreM, blockPlaceOf, BLOCK_SIZE_M } from './quarantineBlocks';
import { PALLET_ROLLER_PATHS, PALLET_ROLLER_TOP_M, PLACE_M, QUARANTINE, QUARANTINE_ROW_Z_M, TURNTABLE_RADIUS_M, WRAPPER_M } from './layout';
import { PALLET_M, trayStackGeometry } from './palletizing';
import { createFilmMaterial, createWrapPose, FILM_BOTTOM_M, FILM_PLAN_M, FILM_TOP_M, WRAP_CYCLE_S, wrapPoseAt } from './stretchWrap';

/** Pallets riding at once, and the least real time between two setting off. */
export const POOL = 10;
export const MIN_GAP_S = 2;
/** Riding speed before the scene's motion rate. */
export const PALLET_SPEED_MPS = 1.4;
/** The wrap on the turntable: the stretch wrapper's cycle, in motion seconds. */
export const WRAP_S = WRAP_CYCLE_S;

/** A pallet token: the wooden pallet, as the palletizer's, and its load of trays from the deck's top. */
const BASE_M = PALLET_M;

/** The aisle between the quarantine's east edge and the QA lab, where the pallets turn into the hold area. */
const AISLE_X_M = (QUARANTINE.xMaxM + 8.0) / 2;
/** Floor height of a pallet on the quarantine floor. */
const FLOOR_Y_M = 0.05;

/** The route's leg that starts on the turntable, where the pallet is wrapped. */
const WRAP_LEG = 1;
/** Between pallets waiting nose to tail on the rollers. */
const QUEUE_GAP_M = 0.15;
/** From the turntable's centre to where a pallet is clear of it: the turntable's radius, half a pallet and a gap. */
const TURNTABLE_CLEAR_M = TURNTABLE_RADIUS_M + PALLET_M.widthM / 2 + QUEUE_GAP_M;
/** The first leg, from the palletizer's place point to the turntable's centre. */
const TO_WRAPPER_M = Math.hypot(WRAPPER_M[0] - PLACE_M[0], WRAPPER_M[1] - PLACE_M[1]);
/** Along the first leg: where a pallet waits while another stands on the turntable. */
const WAIT_AT_M = TO_WRAPPER_M - TURNTABLE_CLEAR_M;
/** A pallet whose centre is this close to the turntable's stands on it, wholly or in part. */
const ON_TURNTABLE_M = TURNTABLE_RADIUS_M + PALLET_M.widthM / 2;
/** Nose to tail, the pitch of the pallets waiting. */
const QUEUE_PITCH_M = PALLET_M.widthM + QUEUE_GAP_M;

/** The lane a block is reached from: the gap after its row, or before it for the last row. */
function laneZM(row: number): number {
  const rows = QUARANTINE_ROW_Z_M;
  const next = rows[row + 1];
  const here = rows[row] as number;
  return next !== undefined ? (here + next) / 2 : (here + (rows[row - 1] as number)) / 2;
}

/** The waypoints from the palletizer's place point to the top of a batch's block, and where the wrap happens. */
export function palletRouteM(batchId: number, blockTopYM: number): { points: PointM[]; wrapAt: number } {
  const rollerYM = PALLET_ROLLER_TOP_M;
  const rollersEndXM = PALLET_ROLLER_PATHS.at(-1)?.at(-1)?.[0] ?? 14.4;
  const place = blockPlaceOf(batchId);
  const [blockXM, blockZM] = blockCentreM(place);
  const row = QUARANTINE_ROW_Z_M.indexOf(blockZM as (typeof QUARANTINE_ROW_Z_M)[number]);
  const laneM = laneZM(Math.max(0, row));
  const sideZM = blockZM + Math.sign(laneM - blockZM) * (BLOCK_SIZE_M.depthM / 2 + 0.6);
  const points: PointM[] = [
    [PLACE_M[0], rollerYM, PLACE_M[1]],
    [WRAPPER_M[0], rollerYM, WRAPPER_M[1]],
    [rollersEndXM, rollerYM, WRAPPER_M[1]],
    [AISLE_X_M, FLOOR_Y_M, WRAPPER_M[1]],
    [AISLE_X_M, FLOOR_Y_M, laneM],
    [blockXM, FLOOR_Y_M, laneM],
    [blockXM, FLOOR_Y_M, sideZM],
    [blockXM, blockTopYM, blockZM],
  ];
  return { points, wrapAt: WRAP_LEG };
}

interface Rider {
  points: PointM[];
  /** Index of the waypoint it rides from, and how far along that stretch. */
  leg: number;
  alongM: number;
  /** Motion seconds on the turntable, -1 before it gets there; and true once wrapped. */
  wrapS: number;
  wrapped: boolean;
  /** The turn the turntable has given it, and how far up its load the film reaches (0–1). */
  spinRad: number;
  filmFrac: number;
  /** True while it waits on the rollers for the turntable or the pallet ahead. */
  held: boolean;
}

export interface PalletTraffic {
  readonly bases: THREE.InstancedMesh;
  /** The loads: each a stack of 84 trays (palletizing.ts), printed like the palletizer's. */
  readonly loads: THREE.InstancedMesh;
  /** The film round each load, from the wrap on: translucent, no shadow. */
  readonly films: THREE.InstancedMesh;
  /**
   * Once a frame: sets a pallet off when the sim has closed a new one, moves the riders on by `distanceM` and
   * the wrap clock by `dtS` (both 0 while paused). `blockTopYM` gives the top of a batch's block, to land on.
   */
  update(lastPallet: PalletRef | null, palletsMade: number, dtS: number, distanceM: number, realDtS: number, blockTopYM: (batchId: number) => number): void;
  /** True while a pallet stands on the turntable, being wrapped. */
  wrapping(): boolean;
  /** Motion seconds into the wrap of the pallet on the turntable, -1 for none: what the wrapper shows (stretchWrap.ts). */
  wrapS(): number;
  /** Pallets waiting on the rollers before the wrapper. */
  queued(): number;
  /** Pallets standing on the turntable, wholly or in part: never more than one. */
  onTurntable(): number;
  riding(): number;
  dispose(): void;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _pose = createWrapPose();

const legLengthM = (a: PointM, b: PointM): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** On the turntable or entering or leaving it: no other pallet may come on. */
const nearTurntable = (rider: Rider): boolean =>
  (rider.leg === 0 && rider.alongM > WAIT_AT_M + 1e-6) || (rider.leg === WRAP_LEG && rider.alongM < TURNTABLE_CLEAR_M);

/**
 * The riding pallets. `boxGeometry` is the kit's unit box, which the bases and films share; the loads' tray stack
 * is made from it and freed in dispose(), as is the film's material. The wooden and carton looks are the kit's.
 */
export function createPalletTraffic(boxGeometry: THREE.BufferGeometry, baseMaterial: THREE.Material, loadMaterial: THREE.Material): PalletTraffic {
  const stackGeometry = trayStackGeometry(boxGeometry);
  const filmMaterial = createFilmMaterial('shell');
  const bases = new THREE.InstancedMesh(boxGeometry, baseMaterial, POOL);
  const loads = new THREE.InstancedMesh(stackGeometry, loadMaterial, POOL);
  const films = new THREE.InstancedMesh(boxGeometry, filmMaterial, POOL);
  bases.name = 'riding-pallets';
  loads.name = 'riding-loads';
  films.name = 'riding-films';
  const meshes = [bases, loads, films] as const;
  for (const mesh of meshes) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, HIDDEN);
    // They ride from the packaging hall into the quarantine: bounds over both, so culling never hides one.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3((QUARANTINE.xMinM + PLACE_M[0]) / 2, 1, (QUARANTINE.zMinM + QUARANTINE.zMaxM) / 2), 26);
    // Only the pallets riding are drawn: none, no draw.
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = mesh !== films;
    mesh.receiveShadow = mesh !== films;
  }
  const riders: Rider[] = [];
  let seenMade: number | null = null;
  let sinceSpawnS = MIN_GAP_S;
  let turntableRider: Rider | null = null;
  let queued = 0;
  let onTurntable = 0;

  function place(rider: Rider, slot: number): void {
    const a = rider.points[rider.leg] as PointM;
    const b = (rider.points[rider.leg + 1] ?? a) as PointM;
    const k = Math.min(1, rider.alongM / Math.max(legLengthM(a, b), 1e-6));
    _position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    _quaternion.setFromAxisAngle(_up, rider.spinRad);
    const bottomYM = _position.y;
    _position.y = bottomYM + BASE_M.heightM / 2;
    bases.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _scale.set(BASE_M.widthM, BASE_M.heightM, BASE_M.depthM)));
    _position.y = bottomYM + BASE_M.heightM;
    loads.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _one));
    const filmM = (FILM_TOP_M - FILM_BOTTOM_M) * rider.filmFrac;
    if (filmM > 0.005) {
      _position.y = bottomYM + FILM_BOTTOM_M + filmM / 2;
      films.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _scale.set(FILM_PLAN_M.widthM, filmM, FILM_PLAN_M.depthM)));
    } else {
      films.setMatrixAt(slot, HIDDEN);
    }
  }

  /** Moves one rider on by `distanceM`, no further than the pallet ahead and, while it is taken, the turntable allow. */
  function ride(rider: Rider, ahead: Rider | undefined, turntableTaken: boolean, distanceM: number, dtS: number): void {
    rider.held = false;
    let leftM = distanceM;
    for (;;) {
      const a = rider.points[rider.leg] as PointM;
      const b = rider.points[rider.leg + 1];
      if (!b) break;
      // On the turntable the pallet stands and turns with it while the film goes round it.
      if (rider.leg === WRAP_LEG && rider.alongM === 0 && !rider.wrapped) {
        rider.wrapS = rider.wrapS < 0 ? 0 : Math.min(WRAP_CYCLE_S, rider.wrapS + dtS);
        wrapPoseAt(rider.wrapS, _pose);
        rider.spinRad = _pose.turnRad % (2 * Math.PI);
        rider.filmFrac = _pose.filmFrac;
        if (rider.wrapS >= WRAP_CYCLE_S) {
          rider.wrapped = true; // square again after 8 turns; it rides on from the next frame
          rider.spinRad = 0;
          rider.filmFrac = 1;
        }
        break;
      }
      const stretchM = legLengthM(a, b);
      let limitM = stretchM;
      if (rider.leg === 0) {
        if (turntableTaken) limitM = Math.min(limitM, WAIT_AT_M);
        if (ahead && ahead.leg === 0) limitM = Math.min(limitM, ahead.alongM - QUEUE_PITCH_M);
      }
      if (rider.alongM + leftM < limitM) {
        rider.alongM += leftM;
        break;
      }
      if (limitM < stretchM) {
        // Waiting: up to the turntable's edge or the pallet ahead, never back.
        rider.alongM = Math.max(rider.alongM, limitM);
        rider.held = true;
        break;
      }
      leftM -= stretchM - rider.alongM;
      rider.leg += 1;
      rider.alongM = 0;
    }
  }

  return {
    bases,
    loads,
    films,
    update(lastPallet, palletsMade, dtS, distanceM, realDtS, blockTopYM) {
      sinceSpawnS += Math.max(0, realDtS);
      // The first snapshot only sets the count; pallets made before it don't set off.
      if (seenMade === null) seenMade = palletsMade;
      if (palletsMade > seenMade && lastPallet) {
        seenMade = palletsMade;
        // It sets off from the palletizer only if it can move off the place point: a queue of two at most.
        const last = riders[riders.length - 1];
        const roomM = !last || last.leg > 0 ? Infinity : last.alongM;
        if (riders.length < POOL && sinceSpawnS >= MIN_GAP_S && roomM >= 2 * QUEUE_PITCH_M) {
          sinceSpawnS = 0;
          const { points } = palletRouteM(lastPallet.batchId, blockTopYM(lastPallet.batchId));
          riders.push({ points, leg: 0, alongM: 0, wrapS: -1, wrapped: false, spinRad: 0, filmFrac: 0, held: false });
        }
      } else if (palletsMade < seenMade) {
        seenMade = palletsMade; // a new sim behind the same scene
      }
      // Front to back: each pallet knows where the one ahead is now, and whether the turntable is taken.
      let turntableTaken = false;
      for (let i = 0; i < riders.length; i++) {
        const rider = riders[i] as Rider;
        ride(rider, riders[i - 1], turntableTaken, distanceM, dtS);
        if (nearTurntable(rider)) turntableTaken = true;
      }
      // A pallet that has reached its block's top has joined the block.
      for (let i = riders.length - 1; i >= 0; i--) if ((riders[i] as Rider).leg >= (riders[i] as Rider).points.length - 1) riders.splice(i, 1);
      turntableRider = null;
      queued = 0;
      onTurntable = 0;
      for (let slot = 0; slot < riders.length; slot++) {
        const rider = riders[slot] as Rider;
        if (rider.leg === WRAP_LEG && rider.alongM === 0 && !rider.wrapped && rider.wrapS >= 0) turntableRider = rider;
        if (rider.leg === 0 && rider.held) queued += 1;
        if ((rider.leg === 0 && rider.alongM > TO_WRAPPER_M - ON_TURNTABLE_M) || (rider.leg === WRAP_LEG && rider.alongM < ON_TURNTABLE_M)) onTurntable += 1;
        place(rider, slot);
      }
      for (const mesh of meshes) {
        mesh.count = riders.length;
        mesh.visible = riders.length > 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    wrapping: () => turntableRider !== null,
    wrapS: () => (turntableRider ? turntableRider.wrapS : -1),
    queued: () => queued,
    onTurntable: () => onTurntable,
    riding: () => riders.length,
    dispose() {
      bases.dispose();
      loads.dispose();
      films.dispose();
      stackGeometry.dispose();
      filmMaterial.dispose();
    },
  };
}
