// Tests for make-vehicles.mjs and the GLBs it wrote to public/models/vehicles/:
//   node --test assets/scripts/make-vehicles.test.mjs
// The scene fits each vehicle into a fixed box (src/scene/equipment/packs/vehicles.ts, fitVehicle),
// so the models must have exactly that size, face +z, stand on the floor round their footprint
// centre, and keep the node names the scene animates (phase 4's forks and inner mast, phase 12's
// tractor, rear doors and beacon) at rest with their origins on their joints, and the moving parts
// must clear the rest of the vehicle through their travel. The committed files must be what the script
// writes, byte for byte.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { boxesOf, contacts, planDistance, trianglesOf } from './clearance.mjs';
import { parseGlb, summarize } from './glb-stats.mjs';
import {
  buildForklift,
  buildTruck,
  FORKLIFT_BEACON_M,
  FORKLIFT_MAST_PIVOT_M,
  FORKLIFT_SIZE_M,
  FORKLIFT_STEER_M,
  FORKLIFT_TILT_RAD,
  TRUCK_CARGO_M,
  TRUCK_DOOR_OPEN_RAD,
  TRUCK_HINGE_M,
  TRUCK_KINGPIN_M,
  TRUCK_SIZE_M,
  TRUCK_TRACTOR_MAX_RAD,
  vehicleGlbs,
} from './make-vehicles.mjs';

const VEHICLES_DIR = fileURLToPath(new URL('../../public/models/vehicles/', import.meta.url));
const MM = 0.001;

const generated = await vehicleGlbs();

/** Meshes (draw calls) each model may have: the phase-12 card's limits, the forklift's raised to 8 in phase 14. */
const MAX_MESHES = { 'truck.glb': 7, 'forklift.glb': 8 };

for (const [file, size] of [['truck.glb', TRUCK_SIZE_M], ['forklift.glb', FORKLIFT_SIZE_M]]) {
  describe(file, () => {
    const summary = summarize(parseGlb(generated[file]), file);

    it('has the outer size the scene fits it to, so the fit is a scale of 1', () => {
      const [minX, minY, minZ] = summary.bounds.min;
      const [maxX, maxY, maxZ] = summary.bounds.max;
      assert.ok(Math.abs(maxX - minX - size.widthM) < MM, `width ${maxX - minX}`);
      assert.ok(Math.abs(maxY - minY - size.heightM) < MM, `height ${maxY - minY}`);
      assert.ok(Math.abs(maxZ - minZ - size.lengthM) < MM, `length ${maxZ - minZ}`);
    });

    it('follows the asset rules glb-stats checks (floor, footprint centre, names) and the budget', () => {
      assert.deepEqual(summary.warnings, []);
      assert.ok(summary.triangles.budgeted <= 5000, `${summary.triangles.budgeted} triangles`);
      assert.ok(summary.materials.length <= 4, `${summary.materials.length} materials`);
      assert.ok(summary.meshes.length <= MAX_MESHES[file], `${summary.meshes.length} meshes (draw calls)`);
      assert.ok(generated[file].length <= 500 * 1024, `${generated[file].length} bytes, over 500 KB`);
      assert.equal(summary.images.length, 0);
      assert.deepEqual(summary.extensionsRequired, []);
    });

    it('is the file committed in public/models/vehicles/, and a rerun writes the same bytes', async () => {
      assert.deepEqual((await vehicleGlbs())[file], generated[file], 'a rerun differs');
      assert.deepEqual(new Uint8Array(readFileSync(join(VEHICLES_DIR, file))), generated[file], 'rerun make-vehicles.mjs');
    });
  });
}

const boxOf = (object) => {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
};

/** Bounds of a mesh's own geometry in its own frame (its node's origin at 0). */
function ownBox(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.clone();
}

/** The trailer: the truck's root meshes, without the tractor and the doors. */
function trailerOf(truck) {
  return truck.children.filter((c) => c.isMesh && c.name.startsWith('body'));
}

describe('facing and moving nodes', () => {
  it('the truck faces +z: its windscreen is at the +z end, on the tractor', () => {
    const truck = buildTruck();
    truck.updateMatrixWorld(true);
    const glass = boxOf(truck.getObjectByName('tractor_glass'));
    assert.ok(glass.max.z > TRUCK_SIZE_M.lengthM / 2 - 0.1, `windscreen at z ${glass.max.z}`);
    assert.ok(glass.min.z > 0, 'no glass behind the cab');
    assert.equal(truck.getObjectByName('body_glass'), undefined, 'no glass on the trailer');
  });

  it('the forklift has its forks at +z, on nodes in the mast that lift along its y from the floor', () => {
    const forklift = buildForklift();
    forklift.updateMatrixWorld(true);
    const mast = forklift.getObjectByName('mast');
    const forks = forklift.getObjectByName('forks');
    const inner = forklift.getObjectByName('mast_inner');
    assert.ok(mast && forks && inner, 'mast, forks and mast_inner exist');
    // Both ride in the mast (phase 14), so they tilt with it, and lifting is position.y += liftM in its frame.
    assert.equal(mast.parent, forklift);
    assert.equal(forks.parent, mast);
    assert.equal(inner.parent, mast);
    assert.ok(Math.abs(boxOf(forks).max.z - FORKLIFT_SIZE_M.lengthM / 2) < MM, 'fork tips at the +z end');
    assert.ok(Math.abs(boxOf(forks).min.y - (FORKLIFT_MAST_PIVOT_M[1] + forks.position.y)) < MM, 'the forks origin is their underside');
    assert.ok(Math.abs(boxOf(inner).min.y - (FORKLIFT_MAST_PIVOT_M[1] + inner.position.y)) < MM, 'the inner mast origin is its foot');
  });

  it('tilts its mast about the pivot on the drive axle, the forks with it, clear of the guard and the floor (phase 14)', () => {
    const forklift = buildForklift();
    const mast = forklift.getObjectByName('mast');
    assert.deepEqual(mast.position.toArray(), FORKLIFT_MAST_PIVOT_M);
    assert.deepEqual(mast.quaternion.toArray(), [0, 0, 0, 1]);
    // The Linde E20's 5° forward and 8° back (VDI 2198 sheet, line 4.1).
    assert.ok(Math.abs(FORKLIFT_TILT_RAD.forward - (5 * Math.PI) / 180) < 1e-12 && Math.abs(FORKLIFT_TILT_RAD.back + (8 * Math.PI) / 180) < 1e-12);
    const forks = forklift.getObjectByName('forks');
    const inner = forklift.getObjectByName('mast_inner');
    const tipOf = () => boxOf(forks);
    const restTip = tipOf().max.z;
    const rest = { forks: forks.position.y, inner: inner.position.y };
    // The body, the guard and the operator; the mast, its inner mast and the forks never meet them, from 8° back to
    // 5° forward, with the forks at their travel height or at the full lift (the inner mast at half, the 2:1 chain).
    forklift.updateMatrixWorld(true);
    const still = boxesOf(trianglesOf(forklift.getObjectByName('body_paint'), forklift.getObjectByName('body_matte')));
    for (const tilt of [FORKLIFT_TILT_RAD.back, FORKLIFT_TILT_RAD.back / 2, 0, FORKLIFT_TILT_RAD.forward]) {
      for (const liftM of [0.15, 3.3]) {
        mast.rotation.x = tilt;
        forks.position.y = rest.forks + liftM;
        inner.position.y = rest.inner + liftM / 2;
        assert.equal(contacts(trianglesOf(mast), still), 0, `the mast at ${((tilt * 180) / Math.PI).toFixed(1)}° and ${liftM} m meets the body`);
      }
    }
    forks.position.y = rest.forks;
    inner.position.y = rest.inner;
    mast.rotation.x = FORKLIFT_TILT_RAD.back;
    assert.ok(tipOf().max.y > 0.15, 'tilted back, the fork tips rise');
    // 5° forward with the forks at their travel height, 0.15 m: the tips dip, and stay above the floor.
    mast.rotation.x = 0;
    forks.position.y = rest.forks + 0.15;
    const levelTipY = tipOf().min.y;
    mast.rotation.x = FORKLIFT_TILT_RAD.forward;
    assert.ok(tipOf().min.y > 0, `the fork tips at y ${tipOf().min.y.toFixed(3)}`);
    assert.ok(tipOf().min.y < levelTipY, 'tilted forward, the tips sit lower than level');
    // The tips stand below the pivot, so a forward tilt draws them back a little, never past their rest by much.
    assert.ok(Math.abs(tipOf().max.z - restTip) < 0.05, 'the tips stay at the +z end');
  });

  it('has its rear wheels as steer nodes on their centres, turning about y (phase 14)', () => {
    const forklift = buildForklift();
    for (const [name, centre] of Object.entries(FORKLIFT_STEER_M)) {
      const wheel = forklift.getObjectByName(name);
      assert.ok(wheel?.isMesh, `${name} is a mesh`);
      assert.equal(wheel.parent, forklift);
      assert.deepEqual(wheel.position.toArray(), centre);
      const own = ownBox(wheel);
      assert.ok(Math.abs(own.min.y + 0.24) < MM && Math.abs(own.min.z + own.max.z) < MM, `${name}: its origin at the wheel's centre`);
      assert.ok(boxOf(wheel).min.y > -MM && boxOf(wheel).min.y < MM, `${name} stands on the floor`);
    }
  });

  it('carries its operator on the seat, under the guard’s roof, in hi-vis and a hard hat (phase 14)', () => {
    const forklift = buildForklift();
    forklift.updateMatrixWorld(true);
    // A ray down through the operator's head meets the hard hat under the roof's slats (their underside at 2.09 m).
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 2.085, -0.81), new THREE.Vector3(0, -1, 0), 0, 0.2);
    const hits = raycaster.intersectObjects([forklift.getObjectByName('body_paint'), forklift.getObjectByName('body_matte')]);
    assert.ok(hits.length > 0, 'something stands under the roof at the seat');
    assert.ok(hits[0].point.y > 2.0 && hits[0].point.y < 2.09, `the hard hat's top at ${hits[0].point.y.toFixed(3)} m`);
    // No exhaust on an electric truck: nothing rises above the guard but the beacon.
    const body = boxOf(forklift.getObjectByName('body_matte')).max.y;
    assert.ok(body <= 2.15 + MM, `the body reaches ${body.toFixed(3)} m`);
  });

  it('the forklift has its amber beacon on the guard, at its foot, in a material of its own that glows', () => {
    const forklift = buildForklift();
    const beacon = forklift.getObjectByName('beacon');
    assert.ok(beacon?.isMesh, 'beacon is a mesh');
    assert.equal(beacon.parent, forklift);
    assert.deepEqual(beacon.position.toArray(), FORKLIFT_BEACON_M);
    assert.deepEqual(beacon.quaternion.toArray(), [0, 0, 0, 1]);
    assert.deepEqual(beacon.scale.toArray(), [1, 1, 1]);
    const own = ownBox(beacon);
    assert.ok(Math.abs(own.min.y) < MM && Math.abs(own.min.x + own.max.x) < MM && Math.abs(own.min.z + own.max.z) < MM, 'origin at its foot, on its axis');
    assert.ok(Math.abs(boxOf(beacon).max.y - FORKLIFT_SIZE_M.heightM) < MM, 'it reaches the forklift height, not over it');
    assert.equal(beacon.material.name, 'forklift_beacon');
    assert.ok(beacon.material.emissive.getHex() !== 0 && beacon.material.emissiveIntensity === 1, 'emissive, so it loads lit');
    const sharing = [];
    forklift.traverse((o) => o.isMesh && o !== beacon && o.material === beacon.material && sharing.push(o.name));
    assert.deepEqual(sharing, [], 'no other part takes the beacon material');
    // Something to stand on: the guard's mounting plate is right under its foot.
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 2.2, -0.95), new THREE.Vector3(0, -1, 0), 0, 0.06);
    forklift.updateMatrixWorld(true);
    assert.ok(raycaster.intersectObject(forklift.getObjectByName('body_matte')).length > 0, 'the beacon stands on the guard');
  });
});

describe('the truck: tractor and rear doors', () => {
  const [halfW, tailZ] = [TRUCK_SIZE_M.widthM / 2, -TRUCK_SIZE_M.lengthM / 2];

  it('has the tractor on its kingpin and the doors on their hinges, at rest, under the root', () => {
    const truck = buildTruck();
    const nodes = [
      ['tractor', TRUCK_KINGPIN_M],
      ['door_left', [-TRUCK_HINGE_M.xM, TRUCK_HINGE_M.yM, TRUCK_HINGE_M.zM]],
      ['door_right', [TRUCK_HINGE_M.xM, TRUCK_HINGE_M.yM, TRUCK_HINGE_M.zM]],
    ];
    for (const [name, atM] of nodes) {
      const node = truck.getObjectByName(name);
      assert.ok(node, `${name} exists`);
      assert.equal(node.parent, truck, `${name} is a child of the root`);
      assert.deepEqual(node.position.toArray(), atM, `${name} origin`);
      assert.deepEqual(node.quaternion.toArray(), [0, 0, 0, 1], `${name} has no rotation`);
      assert.deepEqual(node.scale.toArray(), [1, 1, 1], `${name} has scale 1`);
    }
    // The kingpin is the fifth wheel's centre, on the tractor's centre line, just under the trailer's deck.
    assert.ok(Math.abs(TRUCK_HINGE_M.xM - halfW) < MM && Math.abs(TRUCK_HINGE_M.zM - tailZ) < MM, 'hinges on the rear outer corners');
    assert.deepEqual(truck.getObjectByName('tractor').children.map((c) => c.name).sort(), ['tractor_glass', 'tractor_matte', 'tractor_paint']);
    for (const name of ['door_left', 'door_right']) {
      const door = truck.getObjectByName(name);
      assert.ok(door.isMesh && door.children.length === 0 && door.material.name === 'truck_paint', `${name} is one painted mesh`);
      // The hinge is the door's outer rear edge: the door reaches in from it to the middle, and forwards from it.
      const own = ownBox(door);
      const s = Math.sign(door.position.x);
      const [hingeEdge, middleEdge] = s > 0 ? [own.max.x, own.min.x] : [own.min.x, own.max.x];
      assert.ok(Math.abs(hingeEdge) < MM && Math.abs(Math.abs(middleEdge) - TRUCK_HINGE_M.xM) < 0.01, `${name} spans hinge to middle`);
      assert.ok(own.min.z >= 0 && own.min.z < 0.01 && own.max.z < 0.06, `${name} stands just in front of the hinge line, behind the rear frame`);
    }
    // Names are unique and none repeats the scene's.
    const names = [];
    truck.traverse((o) => o !== truck && names.push(o.name));
    assert.equal(new Set(names).size, names.length);
    assert.ok(!names.includes(truck.name));
  });

  it('the tractor holds everything ahead of the trailer that drives: no trailer part hangs below its deck ahead of the landing legs', () => {
    const truck = buildTruck();
    truck.updateMatrixWorld(true);
    const low = trianglesOf(...trailerOf(truck)).filter((t) => Math.min(t.a.y, t.b.y, t.c.y) < 1.05 && Math.max(t.a.z, t.b.z, t.c.z) > 2.6);
    assert.equal(low.length, 0, 'trailer parts under the deck in front of the legs');
    const tractor = boxOf(truck.getObjectByName('tractor'));
    assert.ok(tractor.min.y < MM && tractor.max.z > TRUCK_SIZE_M.lengthM / 2 - MM && tractor.min.z > 2.5, 'wheels to bumper, ending behind the kingpin');
    // Both tractor axles stand on the floor: tyre bottoms at the drive and front axles.
    const tyres = trianglesOf(truck.getObjectByName('tractor_matte')).filter((t) => Math.min(t.a.y, t.b.y, t.c.y) < 0.01);
    for (const axleZ of [3.6, 7.15]) assert.ok(tyres.some((t) => Math.abs(t.a.z - axleZ) < 0.3), `a tyre on the floor at z ${axleZ}`);
  });

  it('turning the tractor up to ±0.6 rad about its kingpin, it never meets the trailer', () => {
    const truck = buildTruck();
    truck.updateMatrixWorld(true);
    const trailer = boxesOf(trianglesOf(...trailerOf(truck)));
    const tractor = truck.getObjectByName('tractor');
    for (const rad of [-1, -0.5, 0, 0.5, 1].map((f) => f * TRUCK_TRACTOR_MAX_RAD)) {
      tractor.rotation.y = rad;
      const moved = trianglesOf(tractor);
      assert.equal(contacts(moved, trailer), 0, `tractor at ${rad.toFixed(2)} rad meets the trailer`);
      // The cab stays in front of the trailer's front wall at every angle (the corner check).
      const cab = moved.filter((t) => Math.min(t.a.y, t.b.y, t.c.y) > 1.3);
      for (const t of cab) {
        for (const v of [t.a, t.b, t.c]) assert.ok(v.z > 5.35 || Math.abs(v.x) > halfW, `cab at (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) inside the trailer at ${rad.toFixed(2)} rad`);
      }
    }
    // Everything of the tractor that reaches above the trailer's underside is farther from the kingpin, seen
    // from above, than the trailer's front corners, so no angle brings it into the trailer.
    tractor.rotation.y = 0;
    const cornerM = Math.hypot(halfW, 5.35 - TRUCK_KINGPIN_M[2]);
    const high = trianglesOf(tractor).filter((t) => Math.max(t.a.y, t.b.y, t.c.y) > 1.06);
    const nearestM = Math.min(...high.map((t) => planDistance(TRUCK_KINGPIN_M[0], TRUCK_KINGPIN_M[2], t)));
    assert.ok(nearestM > cornerM + 0.1, `the tractor's high parts come within ${nearestM.toFixed(3)} m of the kingpin, the trailer's corners are at ${cornerM.toFixed(3)} m`);
  });

  it('the rear doors swing out behind the truck, never through it, and fold flat against their own sides', () => {
    const truck = buildTruck();
    truck.updateMatrixWorld(true);
    const trailer = boxesOf(trianglesOf(...trailerOf(truck)));
    for (const [name, openRad] of Object.entries(TRUCK_DOOR_OPEN_RAD)) {
      const door = truck.getObjectByName(name);
      const s = Math.sign(door.position.x);
      assert.ok(Math.abs(Math.abs(openRad) - (3 * Math.PI) / 2) < 1e-9, `${name} turns 270°`);
      // The opening sign takes the door out: a little way open, its middle edge is behind the tail.
      door.rotation.y = 0.3 * Math.sign(openRad);
      assert.ok(boxOf(door).min.z < tailZ - 0.3, `${name} opens outwards`);
      for (let i = 0; i <= 24; i++) {
        door.rotation.y = (openRad * i) / 24;
        assert.equal(contacts(trianglesOf(door), trailer), 0, `${name} at ${door.rotation.y.toFixed(2)} rad meets the trailer`);
      }
      door.rotation.y = openRad;
      const open = boxOf(door);
      const [inner, outer] = s > 0 ? [open.min.x, open.max.x] : [-open.max.x, -open.min.x];
      assert.ok(inner >= halfW - MM, `${name} open is outside the trailer's side (${inner.toFixed(3)})`);
      assert.ok(outer <= halfW + 0.15, `${name} open lies within 0.15 m of the side (${outer.toFixed(3)})`);
      assert.ok(Math.abs(open.min.z - tailZ) < 0.01 && open.max.z > tailZ + 1.2 && open.max.z < tailZ + 1.3, `${name} lies along the side from the tail`);
      door.rotation.y = 0;
    }
  });

  it('with the doors open, the doorway shows an empty load space with its floor at deck height', () => {
    const truck = buildTruck();
    for (const [name, openRad] of Object.entries(TRUCK_DOOR_OPEN_RAD)) truck.getObjectByName(name).rotation.y = openRad;
    truck.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const forward = new THREE.Vector3(0, 0, 1);
    for (const xM of [-1.0, -0.5, 0, 0.5, 1.0]) {
      for (const yM of [1.4, 2.5, 3.7]) {
        raycaster.set(new THREE.Vector3(xM, yM, tailZ - 1), forward);
        const [hit] = raycaster.intersectObject(truck, true);
        assert.ok(Math.abs(hit.point.z - TRUCK_CARGO_M.frontZM) < MM, `through the doorway at (${xM}, ${yM}) the first thing is the front wall, at z ${hit.point.z.toFixed(3)}`);
        assert.equal(hit.object.name, 'body_matte', 'the front wall is lined');
      }
    }
    raycaster.set(new THREE.Vector3(0.5, 3.0, -4), new THREE.Vector3(0, -1, 0));
    assert.ok(Math.abs(raycaster.intersectObject(truck, true)[0].point.y - TRUCK_CARGO_M.floorYM) < MM, 'floor at the deck height');
    // Room for two 1.0 m pallets side by side and 11 rows of 1.2 m.
    assert.ok(2 * TRUCK_CARGO_M.doorwayHalfWidthM > 2.0 + 0.2 && TRUCK_CARGO_M.frontZM - TRUCK_CARGO_M.rearZM > 11 * 1.2, 'load space size');
    // Shut, the doors close the doorway.
    for (const name of Object.keys(TRUCK_DOOR_OPEN_RAD)) truck.getObjectByName(name).rotation.y = 0;
    truck.updateMatrixWorld(true);
    raycaster.set(new THREE.Vector3(0.6, 2.5, tailZ - 1), forward);
    assert.equal(raycaster.intersectObject(truck, true)[0].object.name, 'door_right');
  });
});
