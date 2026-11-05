// The truck and forklifts (Should items): grey boxes, and the assets lane's own-work models in their place
// when public/models/vehicles/ has them (made by assets/scripts/make-vehicles.mjs; see assets/LICENSES.md).
// Each vehicle is built facing +z around its own footprint centre, then turned and placed as a whole. Since
// phase 12 the parts that move are named nodes, in the grey box as in the models (phase-12 card, Contracts):
// the truck's `tractor` turns at the kingpin and its rear doors `door_left` and `door_right` swing open; the
// forklift's `forks` and `mast_inner` lift and its `beacon` flashes. Since phase 14 (D24) the forklift's `mast` tilts
// with the inner mast and the forks in it, and its rear wheels `steer_left` and `steer_right` steer.
import * as THREE from 'three';
import type { FixtureBuilder } from './builder';

/** Outer size a vehicle is fitted to: length (along its heading) × height × width. */
export interface VehicleSizeM {
  lengthM: number;
  heightM: number;
  widthM: number;
}

/** The truck's moving nodes and their origins in the truck's frame (model frame, metres). */
export const TRUCK_NODES = ['tractor', 'door_left', 'door_right'] as const;
export type TruckNode = (typeof TRUCK_NODES)[number];
/** The fifth wheel's kingpin: the tractor turns about +y here. */
export const KINGPIN_M = [0, 1.3, 3.7] as const;
/** The rear doors' hinges, left (-x) and right (+x), at the trailer's tail and deck. */
export const DOOR_HINGE_M = { door_left: [-1.275, 1.3, -8.25], door_right: [1.275, 1.3, -8.25] } as const;
/** The trailer's cargo floor, the deck the pallets stand on. */
export const TRAILER_DECK_M = 1.3;
/** The trailer box: its tail and front wall along z, in the truck's frame. */
export const TRAILER_TAIL_Z_M = -8.25;
export const TRAILER_FRONT_Z_M = 5.35;
/** The load space inside it (assets' TRUCK_CARGO_M): from the tail's sill to the front wall's inner face, walls ±1.215 m. */
export const CARGO_TAIL_Z_M = -8.1;
export const CARGO_FRONT_Z_M = 5.29;
/**
 * How the rear doors open, about +y from shut (0): flat against the trailer's sides at ±3π/2. The left door
 * (-x) turns +3π/2 and the right one -3π/2 (assets' truck.glb); the other sign would swing them through the
 * trailer. Flip a sign here if a model's door turns the other way.
 */
export const DOOR_OPEN_RAD = { door_left: (3 * Math.PI) / 2, door_right: (-3 * Math.PI) / 2 } as const;

/**
 * The forklift's moving nodes and their origins in its frame (assets/README.md, Vehicles). `mast_inner` and `forks`
 * ride in `mast` (phase 14), so their origins here are where they stand at rest; in the mast's frame they are taken
 * from the pivot.
 */
export const FORKLIFT_NODES = ['mast', 'forks', 'mast_inner', 'beacon', 'steer_left', 'steer_right'] as const;
export type ForkliftNode = (typeof FORKLIFT_NODES)[number];
export const FORKS_ORIGIN_M = [0, 0.03, 0.75] as const;
export const MAST_INNER_ORIGIN_M = [0, 0.1, 0.64] as const;
export const BEACON_ORIGIN_M = [0, 2.15, -0.95] as const;
/** The mast's pivot on the drive axle (phase 14, D24): it tilts about +x here, 8° back (negative) to 5° forward. */
export const MAST_PIVOT_M = [0, 0.32, 0.61] as const;
export const MAST_TILT_RAD = { forward: (5 * Math.PI) / 180, back: (-8 * Math.PI) / 180 } as const;
/**
 * The rear wheels' centres: each steers about +y on its own, up to 85° either way (phase 14); the forklift's jobs
 * give the angles (forkliftJobs.ts STEER_WHEELS_M and wheelSteerRad).
 */
export const STEER_M = { steer_left: [-0.45, 0.24, -1.3], steer_right: [0.45, 0.24, -1.3] } as const;

/** Nodes whose meshes cast no shadow: the doors lie inside the trailer's own shadow, the beacon is a lamp. */
const NO_SHADOW_NODES = new Set<string>(['door_left', 'door_right', 'beacon']);

/**
 * An articulated truck, the trailer's tail at -z and the tractor at +z: a 13.6 m trailer, as on European
 * roads, open inside behind its rear doors with its cargo floor at deck height, and the preview's cab on a
 * tractor that turns at the kingpin.
 */
export function greyTruck(b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM): void {
  const halfM = size.lengthM / 2;
  const cabM = 2.3;
  const cabMidM = halfM - cabM / 2;
  const tailM = TRAILER_TAIL_Z_M;
  const frontM = TRAILER_FRONT_Z_M;
  const trailerM = frontM - tailM;
  const midM = (tailM + frontM) / 2;
  const deckM = TRAILER_DECK_M;
  const wallM = 0.05;
  // The box's outer faces stand at the hinges, 1.275 m either side; the doors fold flat against them.
  const halfWidthM = Math.abs(DOOR_HINGE_M.door_left[0]);
  const box = (atM: [number, number, number], sizeM: [number, number, number]): void =>
    b.part('box', 'panel', atM, sizeM, { parent: layer, castShadow: true });
  box([0, deckM - wallM / 2, midM], [2 * halfWidthM, wallM, trailerM]); // cargo floor
  box([0, size.heightM - wallM / 2, midM], [2 * halfWidthM, wallM, trailerM]); // roof
  for (const side of [-1, 1]) box([side * (halfWidthM - wallM / 2), (deckM + size.heightM) / 2, midM], [wallM, size.heightM - deckM, trailerM]);
  box([0, (deckM + size.heightM) / 2, frontM - wallM / 2], [2 * halfWidthM - 2 * wallM, size.heightM - deckM - 2 * wallM, wallM]); // front wall
  // The trailer's chassis, landing legs and its three axles.
  b.part('box', 'steelDark', [0, 0.95, (tailM + 0.25 + 4.4) / 2], [1.0, 0.3, 4.4 - tailM - 0.25], { parent: layer });
  for (const side of [-1, 1]) b.part('box', 'steelDark', [side * 0.8, 0.5, 2.3], [0.12, 0.9, 0.12], { parent: layer });
  const wheelRadiusM = 0.5;
  const wheel = (parent: THREE.Object3D, atM: [number, number, number]): void =>
    b.part('cylLo', 'rubber', atM, [wheelRadiusM, 0.35, wheelRadiusM], { parent, rotationRad: [0, 0, Math.PI / 2] });
  for (const zM of [tailM + 1.2, tailM + 2.5, tailM + 3.8]) for (const side of [-1, 1]) wheel(layer, [side * (size.widthM / 2 - 0.2), wheelRadiusM, zM]);

  // The tractor: cab, windscreen, chassis, fifth wheel and its two axles, built round the kingpin.
  const [kingX, kingY, kingZ] = KINGPIN_M;
  const tractor = b.group('tractor', [kingX, kingY, kingZ], layer);
  const at = (xM: number, yM: number, zM: number): [number, number, number] => [xM - kingX, yM - kingY, zM - kingZ];
  b.part('box', 'paint', at(0, 2.15, cabMidM), [size.widthM - 0.1, 3.0, cabM], { parent: tractor, castShadow: true });
  b.part('box', 'rubber', at(0, 2.75, halfM - 0.01), [size.widthM - 0.4, 1.0, 0.04], { parent: tractor }); // windscreen
  b.part('box', 'steelDark', at(0, 0.95, (2.6 + halfM - 0.3) / 2), [1.0, 0.3, halfM - 0.3 - 2.6], { parent: tractor });
  b.part('box', 'steelDark', at(0, 1.15, kingZ), [1.2, 0.1, 1.0], { parent: tractor }); // fifth wheel
  for (const zM of [cabMidM - 2.6, cabMidM - 1.4, cabMidM + 0.4]) for (const side of [-1, 1]) wheel(tractor, at(side * (size.widthM / 2 - 0.2), wheelRadiusM, zM));

  // The rear doors, hinged at the tail's corners; shut, they close the box. Each is as thick as the gap the
  // box leaves inside the width, on its inner side, so it folds flat outside the side wall when open.
  const doorHeightM = size.heightM - deckM;
  for (const name of ['door_left', 'door_right'] as const) {
    const door = b.group(name, [...DOOR_HINGE_M[name]], layer);
    const towardCentre = name === 'door_left' ? 1 : -1;
    b.part('box', 'panel', [(towardCentre * halfWidthM) / 2, doorHeightM / 2, 0.02], [halfWidthM - 0.01, doorHeightM - 0.02, 0.04], { parent: door });
  }
}

/**
 * A counterbalance forklift, forks at +z: body and counterweight, overhead guard with the beacon on top, the mast on
 * its pivot (it tilts) with the inner mast and the forks on their carriage in it (both lift), the drive wheels, and
 * the rear wheels that steer. The body's front stops short of the mast, so the mast can tilt back (phase 14).
 */
export function greyForklift(b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM, beaconMaterial: THREE.Material): void {
  const halfM = size.lengthM / 2;
  const bodyM = 2.11;
  const bodyMidM = -halfM + bodyM / 2;
  const bodyWidthM = size.widthM - 0.05;
  b.part('box', 'paint', [0, 0.7, bodyMidM], [bodyWidthM, 0.9, bodyM], { parent: layer, castShadow: true });
  b.part('box', 'rubber', [0, 1.3, bodyMidM + 0.1], [0.5, 0.3, 0.5], { parent: layer }); // seat
  // Overhead guard: four posts and a roof.
  const guardBackM = bodyMidM - 0.45;
  const guardFrontM = 0.22;
  for (const zM of [guardBackM, guardFrontM]) {
    for (const side of [-1, 1]) b.part('box', 'steelDark', [side * (bodyWidthM / 2 - 0.05), 1.65, zM], [0.06, 1.0, 0.06], { parent: layer });
  }
  b.part('box', 'steelDark', [0, 2.12, (guardBackM + guardFrontM) / 2], [bodyWidthM, 0.06, guardFrontM - guardBackM + 0.1], { parent: layer, castShadow: true });
  // The mast on its pivot: the outer channels, in its frame (positions from the pivot).
  const [, pivotYM, pivotZM] = MAST_PIVOT_M;
  const mast = b.group('mast', [...MAST_PIVOT_M], layer);
  for (const side of [-1, 1]) b.part('box', 'steelDark', [side * 0.35, size.heightM / 2 - pivotYM, 0], [0.08, size.heightM, 0.1], { parent: mast, castShadow: true });
  // The inner mast rides inside it at half the forks' lift (the 2:1 chain).
  const inner = b.group('mast_inner', [MAST_INNER_ORIGIN_M[0], MAST_INNER_ORIGIN_M[1] - pivotYM, MAST_INNER_ORIGIN_M[2] - pivotZM], mast);
  const innerM = size.heightM - MAST_INNER_ORIGIN_M[1];
  for (const side of [-1, 1]) b.part('box', 'steelDark', [side * 0.27, innerM / 2, 0], [0.06, innerM, 0.07], { parent: inner });
  b.part('box', 'steelDark', [0, innerM - 0.04, 0], [0.6, 0.06, 0.06], { parent: inner });
  // The carriage and the two forks; the node's origin is at the forks' underside.
  const forks = b.group('forks', [FORKS_ORIGIN_M[0], FORKS_ORIGIN_M[1] - pivotYM, FORKS_ORIGIN_M[2] - pivotZM], mast);
  const forkM = halfM - FORKS_ORIGIN_M[2];
  b.part('box', 'steelDark', [0, 0.42, -0.03], [0.9, 0.5, 0.06], { parent: forks });
  for (const side of [-1, 1]) b.part('box', 'steelDark', [side * 0.25, 0.025, forkM / 2], [0.12, 0.05, forkM], { parent: forks });
  // The amber beacon on the guard's roof, a low dome; the scene swaps its material to flash it.
  const beacon = b.group('beacon', [...BEACON_ORIGIN_M], layer);
  b.mesh('beacon-lamp', 'cylLo', beaconMaterial, [0, (size.heightM - BEACON_ORIGIN_M[1]) / 2, 0], [0.09, size.heightM - BEACON_ORIGIN_M[1], 0.09], { parent: beacon });
  // The drive wheels under the mast, and the rear wheels, each a group that steers about its centre.
  const driveRadiusM = 0.3;
  for (const side of [-1, 1]) {
    b.part('cylLo', 'rubber', [side * (size.widthM / 2 - 0.13), driveRadiusM, 0.2], [driveRadiusM, 0.24, driveRadiusM], {
      parent: layer,
      rotationRad: [0, 0, Math.PI / 2],
    });
  }
  for (const name of ['steer_left', 'steer_right'] as const) {
    const wheel = b.group(name, [...STEER_M[name]], layer);
    b.part('cylLo', 'rubber', [0, 0, 0], [0.24, 0.2, 0.24], { parent: wheel, rotationRad: [0, 0, Math.PI / 2] });
  }
}

/**
 * Fits a loaded vehicle model into `size`: its longer side along z, uniformly scaled so it fits the box,
 * its footprint centred on the origin and its wheels on the floor. A model whose longer side runs along x
 * is taken to face +x and is turned to face +z, the way glTF models face by convention. The scale it took
 * is in `userData.scale`. Every mesh casts a shadow but the doors', the beacon's and glass.
 */
export function fitVehicle(model: THREE.Object3D, size: VehicleSizeM): THREE.Group {
  const turnedModel = new THREE.Group();
  turnedModel.add(model);
  const box = new THREE.Box3().setFromObject(turnedModel);
  const measured = box.getSize(new THREE.Vector3());
  if (measured.x > measured.z) {
    turnedModel.rotation.y = -Math.PI / 2; // +x turns to +z
    turnedModel.updateMatrixWorld(true);
    box.setFromObject(turnedModel);
    box.getSize(measured);
  }
  const scale = Math.min(size.lengthM / measured.z, size.heightM / measured.y, size.widthM / measured.x);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('vehicle model has no size');
  const centre = box.getCenter(new THREE.Vector3());
  turnedModel.scale.setScalar(scale);
  turnedModel.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  const holder = new THREE.Group();
  holder.name = 'model';
  holder.userData = { scale };
  holder.add(turnedModel);
  holder.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = castsShadow(child);
      child.receiveShadow = true;
    }
  });
  holder.updateMatrixWorld(true);
  return holder;
}

function castsShadow(mesh: THREE.Mesh): boolean {
  for (const material of [mesh.material].flat()) if (material.transparent) return false;
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (NO_SHADOW_NODES.has(node.name)) return false;
  return true;
}

/** How many vehicle metres one unit of `node`'s own frame is: the fit's scale, read from the node's parent. */
export function nodeUnitM(node: THREE.Object3D): number {
  const parent = node.parent;
  if (!parent) return 1;
  parent.updateWorldMatrix(true, false);
  const scale = new THREE.Vector3().setFromMatrixScale(parent.matrixWorld);
  return scale.y > 0 ? scale.y : 1;
}
