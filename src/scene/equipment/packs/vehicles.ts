// The truck and forklifts (Should items): grey boxes, and the assets lane's own-work models in their place
// when public/models/vehicles/ has them (made by assets/scripts/make-vehicles.mjs; see assets/LICENSES.md).
// Each vehicle is built facing +z around its own footprint centre, then turned and placed as a whole, so
// phase 4 can drive it by moving its root.
import * as THREE from 'three';
import type { FixtureBuilder } from './builder';

/** Outer size a vehicle is fitted to: length (along its heading) × height × width. */
export interface VehicleSizeM {
  lengthM: number;
  heightM: number;
  widthM: number;
}

/**
 * An articulated truck, the trailer's tail at -z and the tractor at +z: the preview's trailer and cab,
 * stretched to the size its model is fitted to (a 13.6 m trailer, as on European roads).
 */
export function greyTruck(b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM): void {
  const halfM = size.lengthM / 2;
  const trailerM = 13.6;
  const cabM = 2.3;
  const trailerMidM = -halfM + trailerM / 2;
  const cabMidM = halfM - cabM / 2;
  const deckM = 1.25;
  b.part('box', 'panel', [0, (deckM + size.heightM) / 2, trailerMidM], [size.widthM, size.heightM - deckM, trailerM], { parent: layer, castShadow: true });
  b.part('box', 'paint', [0, 2.15, cabMidM], [size.widthM - 0.1, 3.0, cabM], { parent: layer, castShadow: true });
  b.part('box', 'rubber', [0, 2.75, halfM - 0.01], [size.widthM - 0.4, 1.0, 0.04], { parent: layer }); // windscreen
  b.part('box', 'steelDark', [0, 0.95, 0], [1.0, 0.3, size.lengthM - 1.0], { parent: layer }); // chassis
  const wheelRadiusM = 0.5;
  for (const zM of [-halfM + 1.2, -halfM + 2.5, -halfM + 3.8, cabMidM - 2.6, cabMidM - 1.4, cabMidM + 0.4]) {
    for (const side of [-1, 1]) {
      b.part('cylLo', 'rubber', [side * (size.widthM / 2 - 0.2), wheelRadiusM, zM], [wheelRadiusM, 0.35, wheelRadiusM], {
        parent: layer,
        rotationRad: [0, 0, Math.PI / 2],
      });
    }
  }
}

/** A counterbalance forklift, forks at +z: body and counterweight, overhead guard, mast, forks, wheels. */
export function greyForklift(b: FixtureBuilder, layer: THREE.Object3D, size: VehicleSizeM): void {
  const halfM = size.lengthM / 2;
  const bodyM = 2.3;
  const bodyMidM = -halfM + bodyM / 2;
  const bodyWidthM = size.widthM - 0.05;
  b.part('box', 'paint', [0, 0.7, bodyMidM], [bodyWidthM, 0.9, bodyM], { parent: layer, castShadow: true });
  b.part('box', 'rubber', [0, 1.3, bodyMidM + 0.1], [0.5, 0.3, 0.5], { parent: layer }); // seat
  // Overhead guard: four posts and a roof.
  const guardBackM = bodyMidM - 0.45;
  const guardFrontM = bodyMidM + 0.75;
  for (const zM of [guardBackM, guardFrontM]) {
    for (const side of [-1, 1]) b.part('box', 'steelDark', [side * (bodyWidthM / 2 - 0.05), 1.65, zM], [0.06, 1.0, 0.06], { parent: layer });
  }
  b.part('box', 'steelDark', [0, 2.13, (guardBackM + guardFrontM) / 2], [bodyWidthM, 0.06, guardFrontM - guardBackM + 0.1], { parent: layer, castShadow: true });
  // Mast at the front of the body, as tall as the vehicle, with the carriage and two forks.
  const mastM = -halfM + bodyM + 0.08;
  for (const side of [-1, 1]) b.part('box', 'steelDark', [side * 0.35, size.heightM / 2, mastM], [0.08, size.heightM, 0.1], { parent: layer, castShadow: true });
  b.part('box', 'steelDark', [0, 0.45, mastM + 0.09], [0.9, 0.5, 0.06], { parent: layer });
  const forkM = halfM - (mastM + 0.12);
  for (const side of [-1, 1]) b.part('box', 'steelDark', [side * 0.25, 0.08, halfM - forkM / 2], [0.12, 0.05, forkM], { parent: layer });
  const wheelRadiusM = 0.3;
  for (const zM of [mastM - 0.35, -halfM + 0.4]) {
    for (const side of [-1, 1]) {
      b.part('cylLo', 'rubber', [side * (size.widthM / 2 - 0.13), wheelRadiusM, zM], [wheelRadiusM, 0.24, wheelRadiusM], {
        parent: layer,
        rotationRad: [0, 0, Math.PI / 2],
      });
    }
  }
}

/**
 * Fits a loaded vehicle model into `size`: its longer side along z, uniformly scaled so it fits the box,
 * its footprint centred on the origin and its wheels on the floor. A model whose longer side runs along x
 * is taken to face +x and is turned to face +z, the way glTF models face by convention.
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
  holder.add(turnedModel);
  holder.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return holder;
}
