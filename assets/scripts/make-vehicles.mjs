#!/usr/bin/env node
// Builds the two vehicle models the loading docks show, as our own low-poly work, and writes them
// as GLBs the scene loads (src/scene/equipment/packs/vehicles.ts):
//
//   node assets/scripts/make-vehicles.mjs [--out public/models/vehicles]
//
// No CC0 kit has an articulated truck or a forklift (assets/README.md, "Vehicles"), so they are made
// here from boxes and cylinders with three.js and its GLTFExporter, at the version package.json pins.
// Each model is built at the exact size the scene fits it to (packs/layout.ts, TRUCK_SIZE_M and
// FORKLIFT_SIZE_M), facing +z with its origin at the footprint centre on the floor, so the fit is a
// scale of 1 and nothing moves. Static parts are merged into one mesh per material (a draw call
// each); the parts the scene moves are nodes of their own, at rest with their origin on the joint:
// the forklift's inner mast, forks and beacon, and since phase 12 the truck's tractor (about the
// kingpin) and its two rear doors (on their hinges). Running it twice writes the same bytes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Outer sizes, as in src/scene/equipment/packs/layout.ts: x is the width, z the length. */
export const TRUCK_SIZE_M = { lengthM: 16.5, heightM: 4.0, widthM: 2.55 };
export const FORKLIFT_SIZE_M = { lengthM: 3.5, heightM: 2.2, widthM: 1.2 };

// Brand-free colours (sRGB). The cab and trailer take the preview's truck colours.
const C = {
  cab: 0x1d64a8,
  trailer: 0xeceff1,
  trim: 0xb8c1c8,
  chassis: 0x2c343b,
  bumper: 0x3a4249,
  grille: 0x262c31,
  tyre: 0x1e2226,
  hub: 0xaab4bb,
  steel: 0xc5ccd2,
  lightWhite: 0xf3f0e2,
  lightRed: 0xc0392b,
  lightAmber: 0xe08a1e,
  glass: 0x22303a,
  liner: 0x3c4146, // the trailer's inner walls and roof, dark so the pallets inside show
  floor: 0x5a4a3b, // its floor
  forkliftBody: 0xe0a31a,
  counterweight: 0x3b4248,
  guard: 0x2c343b,
  seat: 0x22272b,
  mast: 0x3b4248,
  mastInner: 0x4a535a,
  fork: 0x30363b,
};

/**
 * Three materials per vehicle: painted panels and bright metal, matte rubber and chassis, and glass.
 * The first two take their colours from the vertices (glTF COLOR_0), so one material draws many colours.
 */
function makeMaterials(prefix) {
  const paint = new THREE.MeshStandardMaterial({ name: `${prefix}_paint`, vertexColors: true, roughness: 0.45, metalness: 0.2 });
  const matte = new THREE.MeshStandardMaterial({ name: `${prefix}_matte`, vertexColors: true, roughness: 0.85, metalness: 0.05 });
  const glass = new THREE.MeshStandardMaterial({ name: `${prefix}_glass`, color: C.glass, roughness: 0.08, metalness: 0.1 });
  return { paint, matte, glass };
}

/** [min, max] on one axis, in metres. */
export const span = (a, b) => [Math.min(a, b), Math.max(a, b)];
/** The same x span on the left (side -1) or right (side +1) of the centre line. */
export const side = (s, inner, outer) => (s > 0 ? [inner, outer] : [-outer, -inner]);

const _color = new THREE.Color();

/**
 * Collects the parts of one rigid body by material, each part a small indexed geometry in the
 * body's own frame, and merges them into one mesh per material.
 * make-heroes.mjs builds the hero models with it too.
 */
export class Parts {
  constructor() {
    this.byMaterial = new Map();
  }

  add(material, color, geometry) {
    geometry.deleteAttribute('uv'); // no textures: positions, normals and colours are all a part needs
    if (material.vertexColors) {
      const count = geometry.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      // Color takes sRGB hex and holds linear values, which is what glTF's COLOR_0 stores.
      _color.setHex(color);
      for (let i = 0; i < count; i++) _color.toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    let list = this.byMaterial.get(material);
    if (!list) this.byMaterial.set(material, (list = []));
    list.push(geometry);
  }

  /** A box between two corners: x, y, z each [min, max] in metres. */
  box(material, color, x, y, z) {
    this.prism(material, color, y, { x, z }, { x, z });
  }

  /**
   * A box whose top face is a different rectangle from its bottom one (a sloped cab roof, a
   * counterweight): `bottom` at y[0] and `top` at y[1], each { x: [min, max], z: [min, max] }.
   */
  prism(material, color, y, bottom, top) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const position = geometry.getAttribute('position');
    const lerp = ([a, b], t) => a + (b - a) * (t + 0.5); // the unit box's -0.5..0.5 onto [a, b]
    for (let i = 0; i < position.count; i++) {
      const rect = position.getY(i) > 0 ? top : bottom;
      position.setXYZ(i, lerp(rect.x, position.getX(i)), position.getY(i) > 0 ? y[1] : y[0], lerp(rect.z, position.getZ(i)));
    }
    // BoxGeometry gives every face its own four vertices, so recomputed normals stay flat per face.
    geometry.computeVertexNormals();
    this.add(material, color, geometry);
  }

  /**
   * A closed cylinder along `axis` ('x', 'y' or 'z') through `centre`, then turned by `tiltRad`
   * (Euler XYZ) about its own centre, e.g. a steering wheel leaning back.
   */
  cylinder(material, color, axis, centre, radiusM, lengthM, segments, tiltRad = [0, 0, 0]) {
    const geometry = new THREE.CylinderGeometry(radiusM, radiusM, lengthM, segments);
    if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tiltRad)));
    geometry.translate(...centre);
    this.add(material, color, geometry);
  }

  /** One mesh per material, named `<name>_<material suffix>` (or just `name` if there is one material). */
  meshes(name) {
    const out = [];
    for (const [material, geometries] of this.byMaterial) {
      const merged = mergeGeometries(geometries, false);
      if (!merged) throw new Error(`${name}: parts of ${material.name} do not merge`);
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = this.byMaterial.size === 1 ? name : `${name}_${material.name.split('_').pop()}`;
      out.push(mesh);
    }
    return out;
  }
}

/** A wheel on an axle along x: tyre, and a hub disc on its outer face. */
function wheel(parts, m, s, axleZM, radiusM, tyreX, hubRadiusM) {
  const [x0, x1] = side(s, tyreX[0], tyreX[1]);
  parts.cylinder(m.matte, C.tyre, 'x', [(x0 + x1) / 2, radiusM, axleZM], radiusM, x1 - x0, 16);
  // 2 cm thick, standing 5 mm proud of the tyre's outer face.
  const outerX = s > 0 ? x1 : x0;
  parts.cylinder(m.paint, C.hub, 'x', [outerX - s * 0.005, radiusM, axleZM], hubRadiusM, 0.02, 10);
}

/** The fifth wheel's kingpin: the `tractor` node's origin, which it turns about (+y), in the model frame (m). */
export const TRUCK_KINGPIN_M = [0, 1.3, 3.7];
/** How far the tractor may turn off the trailer's line about its kingpin, either way (phase-12 card). */
export const TRUCK_TRACTOR_MAX_RAD = 0.6;
/**
 * The rear doors' hinges, on the outer edges of the rear corner posts (flush with the side rails, so a door
 * folded back lies just outside them): `door_left` at x -xM, `door_right` at x +xM.
 */
export const TRUCK_HINGE_M = { xM: 1.275, yM: 1.3, zM: -8.25 };
/**
 * Each rear door's rotation.y when open, folded flat against its own side: both swing out behind the truck
 * first, so the left door turns the positive way about +y and the right door the negative way.
 */
export const TRUCK_DOOR_OPEN_RAD = { door_left: (3 * Math.PI) / 2, door_right: (-3 * Math.PI) / 2 };
/**
 * The load space the open doors show (model frame, m): its floor at the trailer's deck height, the inner
 * walls and roof, the rear end (where the rear frame starts) and the front wall, and the doorway between the
 * rear posts. The scene stands pallets on the floor inside.
 */
export const TRUCK_CARGO_M = {
  floorYM: 1.3,
  innerHalfWidthM: 1.215,
  innerTopYM: 3.93,
  rearZM: -8.1,
  frontZM: 5.29,
  doorwayHalfWidthM: 1.19,
  doorwayTopYM: 3.85,
};

/** The meshes of one rigid part, their geometry moved by -origin so a node at `origin` holds them where they were built. */
function onJoint(meshes, origin) {
  for (const mesh of meshes) mesh.geometry.translate(-origin[0], -origin[1], -origin[2]);
  return meshes;
}

/**
 * An articulated truck, 16.5 × 4.0 × 2.55 m: a 13.6 m box trailer on three axles at -z, coupled to a
 * two-axle tractor whose cab faces +z. The trailer is the root; three nodes move on it: `tractor` turns about
 * the kingpin (TRUCK_KINGPIN_M), and the rear doors `door_left` and `door_right` swing on their hinges
 * (TRUCK_HINGE_M) to lie flat against the trailer's sides (TRUCK_DOOR_OPEN_RAD), which opens the empty load
 * space behind them (TRUCK_CARGO_M).
 */
export function buildTruck() {
  const m = makeMaterials('truck');
  const p = new Parts(); // the trailer, at the root
  const t = new Parts(); // the tractor, built in the model frame and hung on the kingpin
  const halfW = TRUCK_SIZE_M.widthM / 2; // 1.275
  const tailZ = -TRUCK_SIZE_M.lengthM / 2; // -8.25
  const noseZ = TRUCK_SIZE_M.lengthM / 2; // 8.25
  const roofY = TRUCK_SIZE_M.heightM; // 4.0
  const trailerFrontZ = tailZ + 13.6; // 5.35
  const bodyW = halfW - 0.02; // the rails stand 2 cm proud of the panels
  const cargo = TRUCK_CARGO_M;
  const deckY = cargo.floorYM;
  const panelY = roofY - 0.06; // where the roof panel starts
  const portalZ = [tailZ + 0.05, cargo.rearZM]; // the rear frame, just inside the shut doors

  // Trailer box, open at the back: floor at deck height, white side, front and roof panels with dark
  // liners inside, so the doorway shows an empty load space.
  p.box(m.matte, C.floor, span(-cargo.innerHalfWidthM, cargo.innerHalfWidthM), [deckY - 0.12, deckY], [cargo.rearZM, trailerFrontZ - 0.05]);
  p.box(m.paint, C.trailer, span(-bodyW, bodyW), [panelY, roofY], [cargo.rearZM, trailerFrontZ]);
  p.box(m.paint, C.trailer, span(-bodyW, bodyW), [deckY - 0.12, panelY], [trailerFrontZ - 0.05, trailerFrontZ]);
  p.box(m.matte, C.liner, span(-cargo.innerHalfWidthM, cargo.innerHalfWidthM), [cargo.innerTopYM, panelY], [cargo.rearZM, cargo.frontZM]);
  p.box(m.matte, C.liner, span(-cargo.innerHalfWidthM, cargo.innerHalfWidthM), [deckY, cargo.innerTopYM], [cargo.frontZM, trailerFrontZ - 0.05]);
  for (const s of [-1, 1]) {
    p.box(m.paint, C.trailer, side(s, cargo.innerHalfWidthM + 0.01, bodyW), [deckY - 0.12, panelY], [cargo.rearZM, trailerFrontZ - 0.05]);
    p.box(m.matte, C.liner, side(s, cargo.innerHalfWidthM, cargo.innerHalfWidthM + 0.01), [deckY, panelY], [cargo.rearZM, cargo.frontZM]);
    // Rails, a stripe and posts along the sides.
    p.box(m.paint, C.trim, side(s, bodyW, halfW), [1.22, 1.42], [cargo.rearZM, trailerFrontZ]);
    p.box(m.paint, C.trim, side(s, bodyW, halfW), [3.9, roofY], [cargo.rearZM, trailerFrontZ]);
    p.box(m.paint, C.cab, side(s, bodyW, halfW - 0.005), [1.55, 1.75], [tailZ + 0.35, trailerFrontZ - 0.3]);
    for (const zM of [-4.6, -1.0, 2.6]) p.box(m.paint, C.trim, side(s, bodyW, halfW - 0.005), [1.75, 3.9], [zM - 0.04, zM + 0.04]);
  }
  // Rear frame: corner posts (the doors hang on their outer edges), and the header and sill, which stand
  // as far back as the shut doors. The sill is flush with the floor.
  for (const s of [-1, 1]) p.box(m.paint, C.trim, side(s, cargo.doorwayHalfWidthM, halfW), [deckY, cargo.doorwayTopYM], portalZ);
  p.box(m.paint, C.trim, span(-halfW, halfW), [cargo.doorwayTopYM, roofY], [tailZ, cargo.rearZM]);
  p.box(m.paint, C.trim, span(-halfW, halfW), [deckY - 0.18, deckY], [tailZ, cargo.rearZM]);
  // Under the trailer: main beams, landing legs (raised), side guards, rear bumper and its lights. The
  // beams start 2 cm over the tractor's fifth wheel and mudguards, so the tractor turns under them freely.
  for (const s of [-1, 1]) {
    p.box(m.matte, C.chassis, side(s, 0.45, 0.6), [1.06, deckY - 0.12], [tailZ + 0.25, trailerFrontZ - 0.25]);
    p.box(m.matte, C.chassis, side(s, 0.85, 0.97), [0.38, deckY - 0.12], [2.4, 2.52]);
    p.box(m.matte, C.chassis, side(s, 0.8, 1.02), [0.3, 0.38], [2.34, 2.58]);
    for (const yM of [[0.55, 0.65], [0.85, 0.95]]) p.box(m.matte, C.bumper, side(s, 1.1, 1.16), yM, [-3.75, 2.2]);
    p.box(m.matte, C.bumper, side(s, 0.55, 0.65), [0.58, deckY - 0.18], [tailZ + 0.13, tailZ + 0.23]);
    p.box(m.paint, C.lightRed, side(s, 0.75, 1.05), [0.42, 0.56], [tailZ + 0.06, tailZ + 0.1]);
    p.box(m.matte, C.chassis, side(s, 0.82, halfW - 0.005), [1.06, 1.12], [-7.65, -3.85]); // mudguard
  }
  p.box(m.matte, C.chassis, span(-0.85, 0.85), [0.8, 0.88], [2.42, 2.5]);
  p.box(m.matte, C.bumper, span(-1.15, 1.15), [0.4, 0.58], [tailZ + 0.1, tailZ + 0.25]);
  // Trailer axles: a tri-axle bogie at the tail, as the grey box has it.
  for (const zM of [-7.05, -5.75, -4.45]) {
    p.cylinder(m.matte, C.chassis, 'x', [0, 0.5, zM], 0.07, 1.7, 8);
    for (const s of [-1, 1]) wheel(p, m, s, zM, 0.5, [0.85, halfW - 0.025], 0.27);
  }

  // Tractor: chassis rails (ending 1.1 m behind the kingpin), the fifth wheel under it, drive and front axles.
  const [, , kingpinZ] = TRUCK_KINGPIN_M;
  for (const s of [-1, 1]) t.box(m.matte, C.chassis, side(s, 0.38, 0.5), [0.55, 0.85], [kingpinZ - 1.1, 8.0]);
  t.box(m.matte, C.chassis, span(-0.6, 0.6), [0.85, 0.95], [3.2, 4.2]);
  t.cylinder(m.matte, C.grille, 'y', [0, 0.995, kingpinZ], 0.62, 0.09, 20); // fifth wheel plate
  for (const s of [-1, 1]) t.box(m.matte, C.chassis, side(s, 0.1, 0.62), [0.94, 0.99], [kingpinZ - 0.75, kingpinZ - 0.45]); // its ramps
  for (const [zM, tyreX] of [[3.6, [0.75, halfW - 0.025]], [7.15, [0.85, halfW - 0.025]]]) {
    t.cylinder(m.matte, C.chassis, 'x', [0, 0.5, zM], 0.07, 1.6, 8);
    for (const s of [-1, 1]) wheel(t, m, s, zM, 0.5, tyreX, 0.27);
  }
  for (const s of [-1, 1]) {
    t.box(m.matte, C.chassis, side(s, 0.72, halfW - 0.005), [1.01, 1.04], [2.95, 4.25]); // mudguard, under the trailer's beams
    t.box(m.matte, C.bumper, side(s, 1.0, 1.24), [0.55, 0.62], [5.95, 6.55]); // steps
    t.box(m.matte, C.bumper, side(s, 1.0, 1.24), [0.82, 0.89], [5.95, 6.55]);
  }
  t.cylinder(m.paint, C.steel, 'z', [0.92, 0.72, 4.95], 0.28, 1.1, 14); // fuel tank
  t.box(m.matte, C.bumper, span(-1.2, -0.64), [0.45, 0.95], [4.45, 5.45]); // battery and air tanks
  t.cylinder(m.paint, C.steel, 'y', [-1.05, 2.3, 5.8], 0.07, 2.6, 10); // exhaust stack behind the cab

  // Cab, with a roof deflector that meets the trailer's roof line. Its back wall is 2.25 m from the
  // kingpin and the trailer's front corners 2.09 m, so the cab swings clear of the trailer at any angle.
  const cabZ = [5.95, noseZ - 0.05];
  t.box(m.paint, C.cab, span(-1.25, 1.25), [1.0, 3.55], cabZ);
  t.prism(m.paint, C.cab, [3.55, roofY - 0.02], { x: span(-1.25, 1.25), z: [5.95, 7.9] }, { x: span(-1.15, 1.15), z: [5.95, 6.9] });
  t.box(m.glass, C.glass, span(-1.12, 1.12), [2.3, 3.3], [cabZ[1], cabZ[1] + 0.035]); // windscreen
  for (const s of [-1, 1]) t.box(m.glass, C.glass, side(s, 1.25, 1.268), [2.35, 3.25], [7.15, 8.05]); // door windows
  t.box(m.matte, C.grille, span(-0.8, 0.8), [1.35, 2.1], [cabZ[1], cabZ[1] + 0.03]);
  for (const s of [-1, 1]) {
    t.box(m.paint, C.lightWhite, side(s, 0.88, 1.18), [1.2, 1.38], [cabZ[1], cabZ[1] + 0.04]);
    t.box(m.paint, C.lightAmber, side(s, 1.19, 1.25), [1.2, 1.38], [cabZ[1], cabZ[1] + 0.04]);
  }
  t.box(m.matte, C.bumper, span(-1.25, 1.25), [0.62, 1.05], [7.95, noseZ]);
  const tractor = new THREE.Group();
  tractor.name = 'tractor';
  tractor.position.set(...TRUCK_KINGPIN_M);
  for (const mesh of onJoint(t.meshes('tractor'), TRUCK_KINGPIN_M)) tractor.add(mesh);

  return group('truck', [...p.meshes('body'), tractor, ...['door_left', 'door_right'].map(rearDoor.bind(null, m))]);
}

/**
 * One rear barn door, a single painted mesh: the panel, the rubber seal along the middle, the edge on the
 * hinge side, two lock bars with their keepers and handles, and four hinge straps and knuckles. Shut, it
 * stands behind the rear frame (z -8.247 to -8.205, 5 mm clear of the posts) from the middle out to the
 * hinge's edge; its node is on the hinge, so a turn of TRUCK_DOOR_OPEN_RAD[name] about +y swings it out and
 * folds it flat against its side, its face 3 mm clear of the side rails.
 */
function rearDoor(m, name) {
  const s = name === 'door_left' ? -1 : 1;
  const d = new Parts();
  const { xM: hingeX, yM: hingeY, zM: tailZ } = TRUCK_HINGE_M;
  const y = [hingeY + 0.01, TRUCK_CARGO_M.doorwayTopYM - 0.01]; // between the sill and the header
  const z = (from, to) => [tailZ + from, tailZ + to]; // depth behind the hinge line
  const panelZ = z(0.018, 0.045);
  d.box(m.paint, C.chassis, side(s, 0.004, 0.03), y, z(0.012, 0.045)); // seal
  d.box(m.paint, C.trailer, side(s, 0.03, hingeX - 0.025), y, panelZ);
  d.box(m.paint, C.trim, side(s, hingeX - 0.025, hingeX), y, z(0.012, 0.045));
  for (const xM of [0.3, 0.85]) {
    d.box(m.paint, C.hub, side(s, xM - 0.025, xM + 0.025), [y[0] + 0.06, y[1] - 0.06], z(0.005, 0.018)); // lock bar
    for (const yM of [[y[0] + 0.06, y[0] + 0.12], [y[1] - 0.12, y[1] - 0.06]]) d.box(m.paint, C.bumper, side(s, xM - 0.04, xM + 0.04), yM, z(0.003, 0.017));
    d.box(m.paint, C.bumper, side(s, xM - 0.16, xM + 0.02), [1.95, 2.0], z(0.003, 0.014)); // handle
  }
  for (const yM of [1.55, 2.25, 2.95, 3.6]) {
    d.box(m.paint, C.bumper, side(s, 0.96, hingeX - 0.025), [yM - 0.035, yM + 0.035], z(0.008, 0.018)); // strap
    d.cylinder(m.paint, C.bumper, 'y', [s * (hingeX - 0.018), yM, tailZ + 0.018], 0.015, 0.12, 8); // knuckle
  }
  const hinge = [s * hingeX, hingeY, tailZ];
  const [mesh] = onJoint(d.meshes(name), hinge);
  mesh.position.set(...hinge);
  return mesh;
}

/** The forklift's amber beacon: its node's origin, the beacon's foot on the overhead guard (model frame, m). */
export const FORKLIFT_BEACON_M = [0, 2.15, -0.95];
/**
 * The mast's pivot (phase 14, D24): its foot on the drive axle's housing. The mast tilts about +x here, from 8° back
 * (negative) to 5° forward, as the Linde E20's sheet gives; the inner mast and the forks ride in it.
 */
export const FORKLIFT_MAST_PIVOT_M = [0, 0.32, 0.61];
export const FORKLIFT_TILT_RAD = { forward: (5 * Math.PI) / 180, back: (-8 * Math.PI) / 180 };
/** The rear (steer) wheels' centres, each a node that turns about +y (phase 14). */
export const FORKLIFT_STEER_M = { steer_left: [-0.45, 0.24, -1.3], steer_right: [0.45, 0.24, -1.3] };
/** Where the inner mast's foot and the forks' heel underside stand at rest, in the model frame. */
const MAST_INNER_AT_M = [0, 0.1, 0.64];
const FORKS_AT_M = [0, 0.03, 0.75];

/**
 * The beacon's own material, so the scene can flash it without touching the rest: amber, and emissive in the
 * same amber at intensity 1, so it loads lit. The scene darkens it with emissiveIntensity 0 (or swaps it).
 */
function beaconMaterial() {
  return new THREE.MeshStandardMaterial({ name: 'forklift_beacon', color: C.lightAmber, emissive: C.lightAmber, roughness: 0.3, metalness: 0 });
}

/** A round bar from `a` to `b` (each [x, y, z], m): an arm, a grab handle, a lift-cylinder rod. */
function rod(parts, material, color, a, b, radiusM, segments = 8) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const along = to.clone().sub(from);
  const geometry = new THREE.CylinderGeometry(radiusM, radiusM, along.length(), segments);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
  geometry.translate(...from.add(to).multiplyScalar(0.5).toArray());
  parts.add(material, color, geometry);
}

/** Moves a node's parts so its origin is `at` (model frame), and puts it there. */
const atJoint = (mesh, at, base = [0, 0, 0]) => {
  mesh.position.set(at[0] - base[0], at[1] - base[1], at[2] - base[2]);
  return mesh;
};

/** The forklift's colours beyond the vehicles' shared ones: the operator, the safety lights. */
const F = {
  vest: 0xd5e13b, // hi-vis yellow
  reflective: 0xc9cdd1,
  trousers: 0x2b3445,
  skin: 0xc48a63,
  helmet: 0xf1f2f2,
  boot: 0x1d2124,
  blueSpot: 0x2f6fe0,
  socket: 0xb3382c,
  plate: 0xd4d8db,
  hose: 0x16191c,
  chain: 0x5b6268,
};

/**
 * One rear wheel, its node's origin at the wheel's centre (phase 14): the tyre, a hub on its outer face and the
 * fork that carries it from the steer axle, all in one mesh that turns about +y.
 */
function steerWheel(m, s) {
  const p = new Parts();
  p.cylinder(m.matte, C.tyre, 'x', [0, 0, 0], 0.24, 0.2, 16);
  p.cylinder(m.matte, C.hub, 'x', [s * 0.105, 0, 0], 0.12, 0.02, 10);
  p.box(m.matte, C.guard, span(-0.13, 0.13), [0.2, 0.3], span(-0.06, 0.06)); // the axle's fork over the tyre
  return p.meshes(s < 0 ? 'steer_left' : 'steer_right')[0];
}

/**
 * A 2 t electric counterbalance forklift (phase 14, D24, after the Linde E20's VDI 2198 sheet), 3.5 × 2.2 × 1.2 m,
 * forks at +z, an operator on the seat. Moving nodes:
 * - `mast` turns about +x on its pivot (FORKLIFT_MAST_PIVOT_M); in it `mast_inner` and `forks` slide along its +y
 *   (the 2:1 chain), so they tilt with it, the lift cylinders' rods coming out of their barrels as the inner mast rises;
 * - `steer_left` and `steer_right`, the rear wheels, turn about +y on their centres;
 * - `beacon`, the amber lamp on the overhead guard, in its own material (beaconMaterial) for the scene to flash.
 */
export function buildForklift() {
  const m = makeMaterials('forklift');
  const body = new Parts();
  const halfW = FORKLIFT_SIZE_M.widthM / 2; // 0.6
  const rearZ = -FORKLIFT_SIZE_M.lengthM / 2; // -1.75
  const tipZ = FORKLIFT_SIZE_M.lengthM / 2; // 1.75
  const topY = FORKLIFT_SIZE_M.heightM; // 2.2

  // Body: a narrow lower frame between the wheels, a full-width upper body over them, the counterweight at the
  // back and the battery hood the seat stands on (an electric truck: no exhaust). Its front stops at z 0.36, short of
  // the mast, so the mast tilts back 8° into the gap (phase 14).
  const bodyFrontZ = 0.36;
  body.box(m.paint, C.forkliftBody, span(-0.34, 0.34), [0.12, 0.55], [rearZ + 0.15, bodyFrontZ]);
  body.box(m.paint, C.counterweight, span(-0.34, 0.34), [0.12, 0.55], [rearZ, rearZ + 0.15]);
  body.box(m.paint, C.forkliftBody, span(-0.58, 0.58), [0.55, 0.95], [-1.1, bodyFrontZ]);
  body.prism(m.paint, C.counterweight, [0.55, 1.2], { x: span(-0.58, 0.58), z: [rearZ, -1.1] }, { x: span(-0.55, 0.55), z: [rearZ + 0.13, -1.1] });
  body.prism(m.paint, C.forkliftBody, [0.95, 1.12], { x: span(-0.52, 0.52), z: [-1.1, -0.35] }, { x: span(-0.5, 0.5), z: [-1.05, -0.4] });
  body.box(m.paint, C.forkliftBody, span(-0.5, 0.5), [0.95, 1.25], [0.2, 0.32]); // cowl, under the steering column
  body.box(m.matte, C.guard, span(-0.5, 0.5), [0.95, 0.98], [-0.35, 0.2]); // floor plate
  // The battery hood's seam, its charging socket on the right, the capacity plate on the cowl, the tow pin.
  body.box(m.matte, C.guard, span(-0.525, 0.525), [1.105, 1.115], [-1.08, -0.37]);
  body.box(m.matte, F.socket, [0.58, 0.6], [0.68, 0.84], [-0.95, -0.77]);
  body.box(m.paint, F.plate, [-0.505, -0.5], [1.03, 1.17], [0.21, 0.31]);
  body.cylinder(m.matte, C.guard, 'y', [0, 0.6, rearZ + 0.04], 0.03, 0.14, 8); // in its slot in the counterweight
  // Seat, steering column and wheel.
  body.box(m.matte, C.seat, span(-0.24, 0.24), [1.12, 1.24], [-0.98, -0.58]);
  body.box(m.matte, C.seat, span(-0.24, 0.24), [1.24, 1.62], [-1.02, -0.92]);
  body.box(m.matte, C.guard, span(-0.04, 0.04), [1.25, 1.42], [0.2, 0.28]);
  body.cylinder(m.matte, C.seat, 'y', [0, 1.45, 0.17], 0.17, 0.03, 16, [-0.5, 0, 0]);

  // The operator, seated: boots on the floor plate, hands on the wheel, a hi-vis vest and a hard hat.
  for (const s of [-1, 1]) {
    body.box(m.matte, F.trousers, side(s, 0.03, 0.16), [1.24, 1.37], [-0.66, -0.3]); // thigh
    body.box(m.matte, F.trousers, side(s, 0.04, 0.15), [1.0, 1.32], [-0.36, -0.24]); // shin
    body.box(m.matte, F.boot, side(s, 0.04, 0.15), [0.98, 1.05], [-0.36, -0.1]);
    rod(body, m.matte, F.vest, [s * 0.2, 1.74, -0.8], [s * 0.22, 1.5, -0.56], 0.045); // upper arm
    rod(body, m.matte, F.vest, [s * 0.22, 1.5, -0.56], [s * 0.13, 1.47, 0.1], 0.04); // forearm
    body.box(m.matte, F.skin, side(s, 0.1, 0.16), [1.44, 1.5], [0.08, 0.16]); // hand
  }
  body.box(m.matte, F.trousers, span(-0.17, 0.17), [1.24, 1.39], [-0.9, -0.62]); // hips
  body.box(m.paint, F.vest, span(-0.19, 0.19), [1.39, 1.8], [-0.92, -0.7]); // torso in the vest
  for (const yM of [[1.5, 1.53], [1.63, 1.66]]) body.box(m.paint, F.reflective, span(-0.195, 0.195), yM, [-0.925, -0.695]);
  body.cylinder(m.matte, F.skin, 'y', [0, 1.84, -0.81], 0.05, 0.08, 8); // neck
  body.cylinder(m.matte, F.skin, 'y', [0, 1.94, -0.81], 0.095, 0.16, 12); // head
  body.cylinder(m.paint, F.helmet, 'y', [0, 2.03, -0.81], 0.11, 0.05, 14); // hard hat
  body.cylinder(m.paint, F.helmet, 'y', [0, 2.0, -0.79], 0.13, 0.012, 14); // its brim

  // Overhead guard: four posts, two side rails and six slats, its front just behind the steering wheel so the
  // mast clears it tilted back; work lights, mirrors and a grab handle on the front posts, a work light, the
  // blue-spot lamp and the beacon at the back.
  const guardFrontZ = [0.19, 0.25];
  for (const s of [-1, 1]) {
    for (const zM of [[-1.12, -1.06], guardFrontZ]) body.box(m.matte, C.guard, side(s, 0.5, 0.56), [0.95, 2.08], zM);
    body.box(m.matte, C.guard, side(s, 0.48, 0.58), [2.08, 2.15], [-1.15, guardFrontZ[1] + 0.02]);
    body.box(m.paint, C.lightWhite, side(s, 0.44, 0.5), [1.85, 1.95], [guardFrontZ[1], guardFrontZ[1] + 0.06]);
    body.box(m.matte, C.guard, side(s, 0.56, 0.585), [1.86, 1.89], [0.2, 0.23]); // mirror arm
    body.box(m.paint, C.glass, side(s, 0.585, 0.6), [1.8, 1.95], [0.15, 0.27]); // mirror
    // A tail light on the counterweight's sloping back, about 10 cm in from its foot at this height.
    body.box(m.paint, C.lightRed, side(s, 0.4, 0.5), [1.06, 1.13], [rearZ + 0.085, rearZ + 0.115]);
  }
  for (let i = 0; i < 6; i++) {
    const zM = -1.1 + (i * (guardFrontZ[0] + 1.1)) / 5;
    body.box(m.matte, C.guard, span(-0.48, 0.48), [2.09, 2.14], [zM - 0.03, zM + 0.03]);
  }
  rod(body, m.matte, C.guard, [-0.47, 1.25, 0.16], [-0.47, 1.75, 0.16], 0.016); // grab handle
  body.box(m.matte, C.guard, [-0.6, -0.5], [0.55, 0.58], [-0.36, -0.1]); // step
  body.box(m.paint, C.lightWhite, [0.44, 0.5], [1.85, 1.95], [-1.16, -1.12]); // rear work light
  body.cylinder(m.paint, F.blueSpot, 'z', [0.53, 1.75, -1.15], 0.035, 0.05, 10); // blue-spot lamp
  // The beacon's mounting plate, across the two rearmost slats; the beacon stands on it.
  const [, beaconY, beaconZ] = FORKLIFT_BEACON_M;
  body.box(m.matte, C.guard, span(-0.09, 0.09), [beaconY - 0.03, beaconY], [-1.13, -0.766]);
  // The drive wheels under the mast (the steer wheels are nodes of their own) and the mast's tilt cylinders.
  for (const s of [-1, 1]) {
    wheel(body, m, s, 0.2, 0.32, [0.35, halfW - 0.005], 0.17);
    body.cylinder(m.matte, C.mast, 'z', [s * 0.42, 0.85, 0.42], 0.035, 0.3, 8);
  }

  // The mast, in its own frame round its pivot: the outer channels and their cross beams, the two lift
  // cylinders' barrels behind them, and a hose up the right channel.
  const pivot = FORKLIFT_MAST_PIVOT_M;
  const inMast = ([x, y, z]) => [x - pivot[0], y - pivot[1], z - pivot[2]];
  const mast = new Parts();
  const mastBox = (color, x, y, z) => mast.box(m.matte, color, x, [y[0] - pivot[1], y[1] - pivot[1]], [z[0] - pivot[2], z[1] - pivot[2]]);
  for (const s of [-1, 1]) {
    mastBox(C.mast, side(s, 0.3, 0.38), [0.06, topY], [0.56, 0.66]);
    mast.cylinder(m.matte, C.mast, 'y', inMast([s * 0.2, 1.0, 0.52]), 0.045, 1.8, 10); // lift cylinder barrel, 0.1–1.9 m
  }
  mastBox(C.mast, span(-0.38, 0.38), [topY - 0.08, topY], [0.56, 0.66]);
  mastBox(C.mast, span(-0.38, 0.38), [0.42, 0.5], [0.56, 0.6]);
  mastBox(F.hose, [0.33, 0.35], [0.3, 1.7], [0.66, 0.68]); // on the channel's front, behind the carriage

  // The inner mast, in its frame (its foot on the lift axis, so lifting adds to y): channels, the top beam with
  // the chain sheaves and chains, and the lift cylinders' rods, which stay in their barrels at the full lift.
  const inner = new Parts();
  for (const s of [-1, 1]) {
    inner.box(m.matte, C.mastInner, side(s, 0.22, 0.29), [0, 2.05], [-0.04, 0.04]);
    inner.cylinder(m.matte, C.mastInner, 'x', [s * 0.12, 1.96, 0.01], 0.05, 0.04, 10); // chain sheave
    inner.box(m.matte, F.chain, side(s, 0.1, 0.14), [1.25, 1.96], [0, 0.02]); // chain, between the channels, behind the carriage
    rod(inner, m.matte, C.steel, [s * 0.2, 0.12, -0.12], [s * 0.2, 1.98, -0.12], 0.025); // lift cylinder rod
  }
  inner.box(m.matte, C.mastInner, span(-0.29, 0.29), [1.98, 2.05], [-0.04, 0.04]);

  // Carriage, backrest and two forks (45 × 100 × 1,000 mm); the origin is the forks' heel underside.
  const forks = new Parts();
  forks.box(m.matte, C.fork, span(-0.45, 0.45), [0.09, 0.52], [-0.06, 0]); // carriage plate
  for (const yM of [[0.92, 0.97], [1.12, 1.17]]) forks.box(m.matte, C.fork, span(-0.45, 0.45), yM, [-0.05, -0.02]);
  for (const xM of [-0.42, -0.15, 0.15, 0.42]) forks.box(m.matte, C.fork, span(xM - 0.02, xM + 0.02), [0.52, 1.17], [-0.05, -0.02]);
  for (const s of [-1, 1]) {
    forks.box(m.matte, C.fork, side(s, 0.2, 0.3), [0.05, 0.47], [0, 0.05]); // shank
    forks.box(m.matte, C.fork, side(s, 0.2, 0.3), [0, 0.045], [0, tipZ - FORKS_AT_M[2] - 0.08]); // blade
    forks.prism(m.matte, C.fork, [0, 0.045], { x: side(s, 0.2, 0.3), z: [tipZ - FORKS_AT_M[2] - 0.08, tipZ - FORKS_AT_M[2]] }, { x: side(s, 0.21, 0.29), z: [tipZ - FORKS_AT_M[2] - 0.08, tipZ - FORKS_AT_M[2] - 0.06] }); // tapered tip
  }

  // The beacon, its origin at its foot: an amber lens up to the forklift's full height (2.2 m).
  const beacon = new Parts();
  const lens = new THREE.CylinderGeometry(0.05, 0.065, topY - beaconY, 12);
  lens.translate(0, (topY - beaconY) / 2, 0);
  beacon.add(beaconMaterial(), C.lightAmber, lens);

  const mastMesh = atJoint(mast.meshes('mast')[0], pivot);
  mastMesh.add(atJoint(inner.meshes('mast_inner')[0], MAST_INNER_AT_M, pivot), atJoint(forks.meshes('forks')[0], FORKS_AT_M, pivot));
  const beaconMesh = atJoint(beacon.meshes('beacon')[0], [0, beaconY, beaconZ]);
  const steer = [-1, 1].map((s) => atJoint(steerWheel(m, s), FORKLIFT_STEER_M[s < 0 ? 'steer_left' : 'steer_right']));
  return group('forklift', [...body.meshes('body'), mastMesh, beaconMesh, ...steer]);
}

/** The exported scene: glTF's scene takes `name`; its nodes must not repeat it (three would rename them). */
export function group(name, children) {
  const scene = new THREE.Scene();
  scene.name = name;
  for (const child of children) scene.add(child);
  return scene;
}

/**
 * GLTFExporter hands its binary output over through FileReader, which Node lacks. Blob has
 * arrayBuffer(), which is all that path needs.
 */
function ensureFileReader() {
  if (typeof globalThis.FileReader !== 'undefined') return;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.();
      });
    }
  };
}

/** The model as GLB bytes. */
export async function toGlb(scene) {
  ensureFileReader();
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  return new Uint8Array(result);
}

/** Both vehicles as { 'truck.glb': bytes, 'forklift.glb': bytes }. */
export async function vehicleGlbs() {
  return {
    'truck.glb': await toGlb(buildTruck()),
    'forklift.glb': await toGlb(buildForklift()),
  };
}

async function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { out: { type: 'string' } } });
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const outDir = resolve(args.values.out ?? join(repoRoot, 'public', 'models', 'vehicles'));
  mkdirSync(outDir, { recursive: true });
  for (const [file, bytes] of Object.entries(await vehicleGlbs())) {
    writeFileSync(join(outDir, file), bytes);
    console.log(`wrote ${join(outDir, file)} (${(bytes.length / 1024).toFixed(1)} KB)`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
