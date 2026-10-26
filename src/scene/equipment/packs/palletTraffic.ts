// Pallets on the move (phase 4): when the sim closes a pallet, a pallet token leaves the palletizer, stops on
// the stretch wrapper's turntable while it is wrapped, rides the pallet rollers to the hall's edge and is
// carried down an aisle of the quarantine to its batch's block. Like the cartons, these are a sample: at most
// one sets off every MIN_GAP_S of real time and POOL ride at once, so ×10,000 doesn't flood the floor.
import * as THREE from 'three';
import type { PalletRef } from '../../../contracts';
import type { PointM } from '../../layout';
import { blockCentreM, blockPlaceOf, BLOCK_SIZE_M } from './quarantineBlocks';
import { PALLET_ROLLER_PATHS, PALLET_ROLLER_TOP_M, PLACE_M, QUARANTINE, QUARANTINE_ROW_Z_M, WRAPPER_M } from './layout';

/** Pallets riding at once, and the least real time between two setting off. */
export const POOL = 10;
export const MIN_GAP_S = 2;
/** Riding speed before the scene's motion rate, and the wrap on the turntable. */
export const PALLET_SPEED_MPS = 1.4;
export const WRAP_S = 2.5;

/** A pallet token: the wooden pallet and its stretch-wrapped load, like the one on the palletizer. */
const BASE_M = { widthM: 1.2, heightM: 0.14, depthM: 1.0 } as const;
const LOAD_M = { widthM: 1.14, heightM: 1.0, depthM: 0.94 } as const;

/** The aisle between the quarantine's east edge and the QA lab, where the pallets turn into the hold area. */
const AISLE_X_M = (QUARANTINE.xMaxM + 8.0) / 2;
/** Floor height of a pallet on the quarantine floor. */
const FLOOR_Y_M = 0.05;

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
  return { points, wrapAt: 1 };
}

interface Rider {
  points: PointM[];
  /** Index of the waypoint it rides from, and how far along that stretch. */
  leg: number;
  alongM: number;
  /** Time left on the turntable once it reaches the wrap point. */
  wrapLeftS: number;
  wrapAt: number;
  spinRad: number;
}

export interface PalletTraffic {
  readonly bases: THREE.InstancedMesh;
  readonly loads: THREE.InstancedMesh;
  /**
   * Once a frame: sets a pallet off when the sim has closed a new one, moves the riders on by `distanceM` and
   * the wrap clock by `dtS` (both 0 while paused). `blockTopYM` gives the top of a batch's block, to land on.
   */
  update(lastPallet: PalletRef | null, palletsMade: number, dtS: number, distanceM: number, realDtS: number, blockTopYM: (batchId: number) => number): void;
  /** True while a pallet stands on the turntable, wrapped. */
  wrapping(): boolean;
  riding(): number;
  dispose(): void;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const legLengthM = (a: PointM, b: PointM): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

export function createPalletTraffic(boxGeometry: THREE.BufferGeometry, baseMaterial: THREE.Material, loadMaterial: THREE.Material): PalletTraffic {
  const bases = new THREE.InstancedMesh(boxGeometry, baseMaterial, POOL);
  const loads = new THREE.InstancedMesh(boxGeometry, loadMaterial, POOL);
  bases.name = 'riding-pallets';
  loads.name = 'riding-loads';
  for (const mesh of [bases, loads]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, HIDDEN);
    // They ride from the packaging hall into the quarantine: bounds over both, so culling never hides one.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3((QUARANTINE.xMinM + PLACE_M[0]) / 2, 1, (QUARANTINE.zMinM + QUARANTINE.zMaxM) / 2), 26);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const riders: Rider[] = [];
  let seenMade: number | null = null;
  let sinceSpawnS = MIN_GAP_S;

  function place(rider: Rider, slot: number): void {
    const a = rider.points[rider.leg] as PointM;
    const b = (rider.points[rider.leg + 1] ?? a) as PointM;
    const k = Math.min(1, rider.alongM / Math.max(legLengthM(a, b), 1e-6));
    _position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    _quaternion.setFromAxisAngle(_up, rider.spinRad);
    _scale.set(BASE_M.widthM, BASE_M.heightM, BASE_M.depthM);
    const baseYM = _position.y;
    _position.y = baseYM + BASE_M.heightM / 2;
    bases.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _scale));
    _position.y = baseYM + BASE_M.heightM + LOAD_M.heightM / 2;
    _scale.set(LOAD_M.widthM, LOAD_M.heightM, LOAD_M.depthM);
    loads.setMatrixAt(slot, _matrix.compose(_position, _quaternion, _scale));
  }

  return {
    bases,
    loads,
    update(lastPallet, palletsMade, dtS, distanceM, realDtS, blockTopYM) {
      sinceSpawnS += Math.max(0, realDtS);
      // The first snapshot only sets the count; pallets made before it don't set off.
      if (seenMade === null) seenMade = palletsMade;
      if (palletsMade > seenMade && lastPallet) {
        seenMade = palletsMade;
        if (riders.length < POOL && sinceSpawnS >= MIN_GAP_S) {
          sinceSpawnS = 0;
          const { points, wrapAt } = palletRouteM(lastPallet.batchId, blockTopYM(lastPallet.batchId));
          riders.push({ points, leg: 0, alongM: 0, wrapLeftS: WRAP_S, wrapAt, spinRad: 0 });
        }
      } else if (palletsMade < seenMade) {
        seenMade = palletsMade; // a new sim behind the same scene
      }
      for (const rider of riders) {
        let leftM = distanceM;
        for (;;) {
          const a = rider.points[rider.leg] as PointM;
          const b = rider.points[rider.leg + 1];
          if (!b) break;
          // On the turntable the pallet waits and turns while the film goes round it.
          if (rider.leg === rider.wrapAt && rider.alongM === 0 && rider.wrapLeftS > 0) {
            rider.wrapLeftS = Math.max(0, rider.wrapLeftS - dtS);
            rider.spinRad = (rider.spinRad + 2.4 * dtS) % (2 * Math.PI);
            break;
          }
          const stretchM = legLengthM(a, b);
          if (rider.alongM + leftM < stretchM) {
            rider.alongM += leftM;
            break;
          }
          leftM -= stretchM - rider.alongM;
          rider.leg += 1;
          rider.alongM = 0;
        }
      }
      // A pallet that has reached its block's top has joined the block.
      for (let i = riders.length - 1; i >= 0; i--) if ((riders[i] as Rider).leg >= (riders[i] as Rider).points.length - 1) riders.splice(i, 1);
      for (let slot = 0; slot < POOL; slot++) {
        const rider = riders[slot];
        if (rider) place(rider, slot);
        else {
          bases.setMatrixAt(slot, HIDDEN);
          loads.setMatrixAt(slot, HIDDEN);
        }
      }
      bases.instanceMatrix.needsUpdate = true;
      loads.instanceMatrix.needsUpdate = true;
    },
    wrapping: () => riders.some((rider) => rider.leg === rider.wrapAt && rider.alongM === 0 && rider.wrapLeftS > 0),
    riding: () => riders.length,
    dispose() {
      bases.dispose();
      loads.dispose();
    },
  };
}
