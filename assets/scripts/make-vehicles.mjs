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
// each); the forklift's mast and forks are nodes of their own so phase 4 can lift a pallet.
// Running it twice writes the same bytes.

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

/**
 * An articulated truck, 16.5 × 4.0 × 2.55 m: a 13.6 m box trailer on three axles at -z, coupled to a
 * two-axle tractor whose cab faces +z. Nothing on it moves on its own; phase 4 drives the whole model.
 */
export function buildTruck() {
  const m = makeMaterials('truck');
  const p = new Parts();
  const halfW = TRUCK_SIZE_M.widthM / 2; // 1.275
  const tailZ = -TRUCK_SIZE_M.lengthM / 2; // -8.25
  const noseZ = TRUCK_SIZE_M.lengthM / 2; // 8.25
  const roofY = TRUCK_SIZE_M.heightM; // 4.0
  const trailerFrontZ = tailZ + 13.6; // 5.35
  const bodyW = halfW - 0.02; // the rails stand 2 cm proud of the panels

  // Trailer box, deck at 1.3 m, with rails, a stripe and posts along its sides.
  p.box(m.paint, C.trailer, span(-bodyW, bodyW), [1.3, roofY], [tailZ + 0.05, trailerFrontZ]);
  for (const s of [-1, 1]) {
    p.box(m.paint, C.trim, side(s, bodyW, halfW), [1.22, 1.42], [tailZ + 0.05, trailerFrontZ]);
    p.box(m.paint, C.trim, side(s, bodyW, halfW), [3.9, roofY], [tailZ + 0.05, trailerFrontZ]);
    p.box(m.paint, C.cab, side(s, bodyW, halfW - 0.005), [1.55, 1.75], [tailZ + 0.35, trailerFrontZ - 0.3]);
    for (const zM of [-4.6, -1.0, 2.6]) p.box(m.paint, C.trim, side(s, bodyW, halfW - 0.005), [1.75, 3.9], [zM - 0.04, zM + 0.04]);
  }
  // Rear frame and doors: posts, header and sill, the door seam and four lock bars.
  const rearZ = [tailZ, tailZ + 0.05];
  for (const s of [-1, 1]) p.box(m.paint, C.trim, side(s, 1.13, bodyW), [1.3, roofY], rearZ);
  p.box(m.paint, C.trim, span(-1.13, 1.13), [3.85, roofY], rearZ);
  p.box(m.paint, C.trim, span(-1.13, 1.13), [1.3, 1.45], rearZ);
  p.box(m.matte, C.chassis, span(-0.015, 0.015), [1.45, 3.85], [tailZ + 0.01, tailZ + 0.05]);
  for (const xM of [-0.85, -0.3, 0.3, 0.85]) p.box(m.paint, C.hub, span(xM - 0.025, xM + 0.025), [1.5, 3.8], [tailZ + 0.005, tailZ + 0.045]);
  // Under the trailer: main beams, landing legs (raised), side guards, rear bumper and its lights.
  for (const s of [-1, 1]) {
    p.box(m.matte, C.chassis, side(s, 0.45, 0.6), [1.05, 1.3], [tailZ + 0.25, trailerFrontZ - 0.25]);
    p.box(m.matte, C.chassis, side(s, 0.85, 0.97), [0.38, 1.3], [2.4, 2.52]);
    p.box(m.matte, C.chassis, side(s, 0.8, 1.02), [0.3, 0.38], [2.34, 2.58]);
    for (const yM of [[0.55, 0.65], [0.85, 0.95]]) p.box(m.matte, C.bumper, side(s, 1.1, 1.16), yM, [-3.75, 2.2]);
    p.box(m.matte, C.bumper, side(s, 0.55, 0.65), [0.58, 1.05], [tailZ + 0.13, tailZ + 0.23]);
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

  // Tractor: chassis rails, fifth wheel under the trailer's kingpin, drive and front axles.
  for (const s of [-1, 1]) p.box(m.matte, C.chassis, side(s, 0.38, 0.5), [0.55, 0.85], [1.7, 8.0]);
  p.box(m.matte, C.chassis, span(-0.6, 0.6), [0.85, 0.95], [3.2, 4.2]);
  p.box(m.matte, C.grille, span(-0.9, 0.9), [0.95, 1.05], [3.1, 4.3]);
  for (const [zM, tyreX] of [[3.6, [0.75, halfW - 0.025]], [7.15, [0.85, halfW - 0.025]]]) {
    p.cylinder(m.matte, C.chassis, 'x', [0, 0.5, zM], 0.07, 1.6, 8);
    for (const s of [-1, 1]) wheel(p, m, s, zM, 0.5, tyreX, 0.27);
  }
  for (const s of [-1, 1]) {
    p.box(m.matte, C.chassis, side(s, 0.72, halfW - 0.005), [1.04, 1.1], [2.95, 4.25]); // mudguard
    p.box(m.matte, C.bumper, side(s, 1.0, 1.24), [0.55, 0.62], [5.95, 6.55]); // steps
    p.box(m.matte, C.bumper, side(s, 1.0, 1.24), [0.82, 0.89], [5.95, 6.55]);
  }
  p.cylinder(m.paint, C.steel, 'z', [0.92, 0.72, 4.95], 0.28, 1.1, 14); // fuel tank
  p.box(m.matte, C.bumper, span(-1.2, -0.64), [0.45, 0.95], [4.45, 5.45]); // battery and air tanks
  p.cylinder(m.paint, C.steel, 'y', [-1.05, 2.3, 5.8], 0.07, 2.6, 10); // exhaust stack behind the cab

  // Cab, with a roof deflector that meets the trailer's roof line.
  const cabZ = [5.95, noseZ - 0.05];
  p.box(m.paint, C.cab, span(-1.25, 1.25), [1.0, 3.55], cabZ);
  p.prism(m.paint, C.cab, [3.55, roofY - 0.02], { x: span(-1.25, 1.25), z: [5.95, 7.9] }, { x: span(-1.15, 1.15), z: [5.95, 6.9] });
  p.box(m.glass, C.glass, span(-1.12, 1.12), [2.3, 3.3], [cabZ[1], cabZ[1] + 0.035]); // windscreen
  for (const s of [-1, 1]) p.box(m.glass, C.glass, side(s, 1.25, 1.268), [2.35, 3.25], [7.15, 8.05]); // door windows
  p.box(m.matte, C.grille, span(-0.8, 0.8), [1.35, 2.1], [cabZ[1], cabZ[1] + 0.03]);
  for (const s of [-1, 1]) {
    p.box(m.paint, C.lightWhite, side(s, 0.88, 1.18), [1.2, 1.38], [cabZ[1], cabZ[1] + 0.04]);
    p.box(m.paint, C.lightAmber, side(s, 1.19, 1.25), [1.2, 1.38], [cabZ[1], cabZ[1] + 0.04]);
  }
  p.box(m.matte, C.bumper, span(-1.25, 1.25), [0.62, 1.05], [7.95, noseZ]);

  return group('truck', p.meshes('body'));
}

/**
 * A counterbalance forklift, 3.5 × 2.2 × 1.2 m, forks at +z. Moving nodes (both slide along +y):
 * `mast_inner`, the inner mast channel, and `forks`, the carriage with backrest and forks.
 */
export function buildForklift() {
  const m = makeMaterials('forklift');
  const body = new Parts();
  const halfW = FORKLIFT_SIZE_M.widthM / 2; // 0.6
  const rearZ = -FORKLIFT_SIZE_M.lengthM / 2; // -1.75
  const tipZ = FORKLIFT_SIZE_M.lengthM / 2; // 1.75
  const topY = FORKLIFT_SIZE_M.heightM; // 2.2

  // Body: a narrow lower frame between the wheels, a full-width upper body over them, the
  // counterweight at the back and the hood the seat stands on.
  body.box(m.paint, C.forkliftBody, span(-0.34, 0.34), [0.12, 0.55], [rearZ + 0.15, 0.52]);
  body.box(m.paint, C.counterweight, span(-0.34, 0.34), [0.12, 0.55], [rearZ, rearZ + 0.15]);
  body.box(m.paint, C.forkliftBody, span(-0.58, 0.58), [0.55, 0.95], [-1.1, 0.52]);
  body.prism(m.paint, C.counterweight, [0.55, 1.2], { x: span(-0.58, 0.58), z: [rearZ, -1.1] }, { x: span(-0.55, 0.55), z: [rearZ + 0.13, -1.1] });
  body.prism(m.paint, C.forkliftBody, [0.95, 1.12], { x: span(-0.52, 0.52), z: [-1.1, -0.35] }, { x: span(-0.5, 0.5), z: [-1.05, -0.4] });
  body.box(m.paint, C.forkliftBody, span(-0.5, 0.5), [0.95, 1.25], [0.25, 0.52]); // cowl
  body.box(m.matte, C.guard, span(-0.5, 0.5), [0.95, 0.98], [-0.35, 0.25]); // floor plate
  // Seat, steering column and wheel.
  body.box(m.matte, C.seat, span(-0.24, 0.24), [1.12, 1.24], [-0.98, -0.58]);
  body.box(m.matte, C.seat, span(-0.24, 0.24), [1.24, 1.62], [-1.02, -0.92]);
  body.box(m.matte, C.guard, span(-0.04, 0.04), [1.25, 1.42], [0.2, 0.28]);
  body.cylinder(m.matte, C.seat, 'y', [0, 1.45, 0.17], 0.17, 0.03, 16, [-0.5, 0, 0]);
  // Overhead guard: four posts, two side rails, six slats, work lights and an amber beacon.
  for (const s of [-1, 1]) {
    for (const zM of [[-1.12, -1.06], [0.38, 0.44]]) body.box(m.matte, C.guard, side(s, 0.5, 0.56), [0.95, 2.08], zM);
    body.box(m.matte, C.guard, side(s, 0.48, 0.58), [2.08, 2.15], [-1.15, 0.47]);
    body.box(m.paint, C.lightWhite, side(s, 0.44, 0.5), [1.85, 1.95], [0.44, 0.5]);
  }
  for (let i = 0; i < 6; i++) {
    const zM = -1.1 + (i * 1.52) / 5;
    body.box(m.matte, C.guard, span(-0.48, 0.48), [2.09, 2.14], [zM - 0.03, zM + 0.03]);
  }
  body.cylinder(m.paint, C.lightAmber, 'y', [0, 2.175, -0.95], 0.06, 0.05, 10);
  // Wheels: big drive wheels under the mast, small steer wheels under the counterweight.
  for (const s of [-1, 1]) {
    wheel(body, m, s, 0.2, 0.32, [0.35, halfW - 0.005], 0.17);
    wheel(body, m, s, -1.3, 0.24, [0.35, 0.55], 0.12);
  }
  // Outer mast and its tilt cylinders, fixed to the body.
  for (const s of [-1, 1]) {
    body.box(m.matte, C.mast, side(s, 0.3, 0.38), [0.06, topY], [0.56, 0.66]);
    body.cylinder(m.matte, C.mast, 'z', [s * 0.42, 0.85, 0.42], 0.035, 0.3, 8);
  }
  body.box(m.matte, C.mast, span(-0.38, 0.38), [topY - 0.08, topY], [0.56, 0.66]);

  // The inner mast channel; its origin is its foot on the lift axis, so lifting only adds to y.
  const innerOrigin = new THREE.Vector3(0, 0.1, 0.64);
  const inner = new Parts();
  for (const s of [-1, 1]) inner.box(m.matte, C.mastInner, side(s, 0.22, 0.29), [0, 2.05], [-0.04, 0.04]);
  inner.box(m.matte, C.mastInner, span(-0.29, 0.29), [1.98, 2.05], [-0.04, 0.04]);

  // Carriage, backrest and two forks; the origin is the forks' heel underside, where a pallet sits on.
  const forksOrigin = new THREE.Vector3(0, 0.03, 0.75);
  const forks = new Parts();
  forks.box(m.matte, C.fork, span(-0.45, 0.45), [0.09, 0.52], [-0.06, 0]); // carriage plate
  for (const yM of [[0.92, 0.97], [1.12, 1.17]]) forks.box(m.matte, C.fork, span(-0.45, 0.45), yM, [-0.05, -0.02]);
  for (const xM of [-0.42, -0.15, 0.15, 0.42]) forks.box(m.matte, C.fork, span(xM - 0.02, xM + 0.02), [0.52, 1.17], [-0.05, -0.02]);
  for (const s of [-1, 1]) {
    forks.box(m.matte, C.fork, side(s, 0.2, 0.3), [0.05, 0.47], [0, 0.05]); // shank
    forks.box(m.matte, C.fork, side(s, 0.2, 0.3), [0, 0.05], [0, tipZ - forksOrigin.z]); // blade
  }

  const innerMesh = inner.meshes('mast_inner')[0];
  innerMesh.position.copy(innerOrigin);
  const forksMesh = forks.meshes('forks')[0];
  forksMesh.position.copy(forksOrigin);
  return group('forklift', [...body.meshes('body'), innerMesh, forksMesh]);
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
