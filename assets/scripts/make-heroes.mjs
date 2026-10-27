#!/usr/bin/env node
// Builds the phase-3 block-outs of the four hero models (assets/hero-specs.md) as our own low-poly
// work, and writes them as GLBs for the phase-5 swap:
//
//   node assets/scripts/make-heroes.mjs [--out public/models/hero]
//
// Same tooling as make-vehicles.mjs: boxes, cylinders and cones with three.js and its GLTFExporter, at
// the version package.json pins, static parts merged into one mesh per material. Each model is built
// round its machine origin from the spec (not the footprint centre), +y up, product along +x and the
// operator side at +z, at the grey box's size. Every moving node the scene drives is a mesh of its
// own, named as in the spec, at its rest position with no rotation and scale 1, and its geometry hangs
// so that the node's origin is on its joint. The colours are plain greys; the filler's aseptic zone is
// the one glass part. Running it twice writes the same bytes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { group, Parts, side, span, toGlb } from './make-vehicles.mjs';

/**
 * What each block-out must match, from assets/hero-specs.md: the grey box's bounds and the 5%
 * envelope round the machine origin, the height the model stays under (its label anchor sits above),
 * the moving nodes at rest, and the pipe nozzles. Metres, in the model's own frame.
 */
export const HERO_SPECS = {
  separator: {
    file: 'separator.glb',
    boundsM: { min: [-0.85, 0, -2.05], max: [0.85, 2.3, 0.85] },
    envelopeM: { min: [-0.895, 0, -2.125], max: [0.895, 2.42, 0.925] },
    maxHeightM: 2.7,
    nodes: [{ name: 'bowl', parent: null, atM: [0, 1.35, 0] }],
    nozzlesM: [[-0.8, 1.2, 0], [0.8, 1.2, 0]],
  },
  homogenizer: {
    file: 'homogenizer.glb',
    boundsM: { min: [-1.25, 0, -1.77], max: [1.25, 1.37, 1.175] },
    envelopeM: { min: [-1.31, 0, -1.77], max: [1.31, 1.44, 1.32] },
    maxHeightM: 1.85,
    nodes: [
      { name: 'piston_1', parent: null, atM: [-0.6, 0.8, 0.9] },
      { name: 'piston_2', parent: null, atM: [0, 0.8, 0.9] },
      { name: 'piston_3', parent: null, atM: [0.6, 0.8, 0.9] },
    ],
    nozzlesM: [[-1.15, 0.7, 0], [1.15, 0.9, 0]],
  },
  asepticFiller: {
    file: 'aseptic-filler.glb',
    boundsM: { min: [-1.6, 0, -1.6], max: [1.9, 3.56, 1.1] },
    envelopeM: { min: [-1.69, 0, -1.67], max: [1.99, 3.74, 1.17] },
    maxHeightM: 3.95,
    nodes: [
      { name: 'reel', parent: null, atM: [-0.8, 1.0, -1.42] },
      { name: 'jaws', parent: null, atM: [-0.3, 2.6, 0] },
      { name: 'jaw_1', parent: 'jaws', atM: [0, 0, -0.18] },
      { name: 'jaw_2', parent: 'jaws', atM: [0, 0, 0.18] },
    ],
    nozzlesM: [[-1.6, 0.55, 0]],
  },
  palletizer: {
    file: 'palletizer.glb',
    boundsM: { min: [-0.55, 0, -0.55], max: [2.725, 2.45, 0.55] },
    envelopeM: { min: [-0.632, 0, -0.578], max: [2.807, 2.57, 0.578] },
    maxHeightM: 2.95,
    nodes: [
      { name: 'arm', parent: null, atM: [0, 2.35, 0] },
      { name: 'arm_lift', parent: 'arm', atM: [2.45, 0, 0] },
      { name: 'arm_wrist', parent: 'arm_lift', atM: [0, -0.63, 0] },
      { name: 'arm_clamp_1', parent: 'arm_wrist', atM: [0, -0.07, -0.225] },
      { name: 'arm_clamp_2', parent: 'arm_wrist', atM: [0, -0.07, 0.225] },
    ],
    nozzlesM: [],
  },
};

// Plain greys (sRGB), lightest to darkest, plus the paper and the glass tint. No brand colours.
const C = {
  panel: 0xdfe3e6, // painted cabinets and casings
  paper: 0xe9e8e3, // the filler's paper reel and tube
  steel: 0xc3cacf, // stainless parts
  casing: 0xa9b1b7, // crankcase and frame paint
  mid: 0x89929a, // covers, stripes, guards
  motor: 0x646d74, // motors and drives
  dark: 0x41484e, // plinths, feet, frames, flanges
  black: 0x24292d, // openings, screens, seals
  glass: 0xc6d5dd,
};

/**
 * Two vertex-coloured materials per model, a satin one for casings and bright metal and a matte one
 * for drives and frames, plus the filler's glass. Every moving node takes the satin one only, so it
 * is one mesh, named as the spec names the node.
 */
function makeMaterials(prefix) {
  const paint = new THREE.MeshStandardMaterial({ name: `${prefix}_paint`, vertexColors: true, roughness: 0.45, metalness: 0.3 });
  const matte = new THREE.MeshStandardMaterial({ name: `${prefix}_matte`, vertexColors: true, roughness: 0.8, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({
    name: `${prefix}_glass`,
    color: C.glass,
    roughness: 0.1,
    metalness: 0,
    transparent: true, // exported as alphaMode BLEND; GLTFLoader turns depthWrite off for it
    opacity: 0.28,
  });
  return { paint, matte, glass };
}

/**
 * The longest edge a hero part's faces are cut to. The AO is baked into the vertex colours (bakeAo), so a
 * face needs vertices across it for its shading to vary: a box gets a grid on each face, a cylinder rings
 * along its length.
 */
export const AO_CELL_M = 0.12;

/** How many cells of AO_CELL_M or less cover `lengthM`. */
const cuts = (lengthM) => Math.max(1, Math.ceil(lengthM / AO_CELL_M - 1e-6));

/** (1 - t)·a + t·b, which lands exactly on a and b at the ends. */
const mix = (a, b, t) => (1 - t) * a + t * b;

/**
 * Parts (make-vehicles.mjs) with every box face cut into a grid and every cylinder into rings of AO_CELL_M
 * or less, for the AO bake. Same shapes, same calls; the vehicles keep the uncut ones.
 */
export class HeroParts extends Parts {
  prism(material, color, y, bottom, top) {
    const extent = (axis) => Math.max(bottom[axis][1] - bottom[axis][0], top[axis][1] - top[axis][0]);
    const geometry = new THREE.BoxGeometry(1, 1, 1, cuts(extent('x')), cuts(y[1] - y[0]), cuts(extent('z')));
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const ty = position.getY(i) + 0.5; // the unit box's -0.5..0.5 onto 0..1, bottom to top
      const x = [mix(bottom.x[0], top.x[0], ty), mix(bottom.x[1], top.x[1], ty)];
      const z = [mix(bottom.z[0], top.z[0], ty), mix(bottom.z[1], top.z[1], ty)];
      position.setXYZ(i, mix(x[0], x[1], position.getX(i) + 0.5), mix(y[0], y[1], ty), mix(z[0], z[1], position.getZ(i) + 0.5));
    }
    // BoxGeometry gives every face its own grid of vertices, so recomputed normals stay flat per face.
    geometry.computeVertexNormals();
    this.add(material, color, geometry);
  }

  cylinder(material, color, axis, centre, radiusM, lengthM, segments, tiltRad = [0, 0, 0]) {
    const geometry = new THREE.CylinderGeometry(radiusM, radiusM, lengthM, segments, cuts(lengthM));
    if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tiltRad)));
    geometry.translate(...centre);
    this.add(material, color, geometry);
  }
}

/**
 * The ambient-occlusion bake: rays a vertex casts, how far they look (m), and how much light a vertex
 * loses with every ray blocked at once. A ray blocked at distance t takes 1 − t/radiusM of its share.
 */
export const AO = { rays: 32, radiusM: 0.4, strength: 0.85 };

/** AO.rays directions over the hemisphere about +y, cosine-weighted, on a Fibonacci spiral: the same every run. */
const AO_DIRECTIONS = Array.from({ length: AO.rays }, (_, i) => {
  const u = (i + 0.5) / AO.rays;
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.sqrt(u) * Math.cos(phi), Math.sqrt(1 - u), Math.sqrt(u) * Math.sin(phi)];
});

/** The triangles of `meshes` in the model's frame, as v0 and its two edges (9 numbers each), binned on a grid of AO.radiusM. */
function occluders(meshes) {
  const out = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const world = new Float64Array(position.count * 3);
    for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(world, i * 3);
    const count = index ? index.count : position.count;
    for (let k = 0; k < count; k += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => 3 * (index ? index.getX(k + j) : k + j));
      for (let axis = 0; axis < 3; axis++) out.push(world[a + axis]);
      for (let axis = 0; axis < 3; axis++) out.push(world[b + axis] - world[a + axis]);
      for (let axis = 0; axis < 3; axis++) out.push(world[c + axis] - world[a + axis]);
    }
  }
  const tris = Float64Array.from(out);
  const cells = new Map();
  const cellOf = (m) => Math.floor(m / AO.radiusM);
  const key = (ix, iy, iz) => (ix + 512) * 1_048_576 + (iy + 512) * 1_024 + (iz + 512);
  for (let t = 0; t < tris.length / 9; t++) {
    const lo = [0, 1, 2].map((axis) => cellOf(tris[9 * t + axis] + Math.min(0, tris[9 * t + 3 + axis], tris[9 * t + 6 + axis])));
    const hi = [0, 1, 2].map((axis) => cellOf(tris[9 * t + axis] + Math.max(0, tris[9 * t + 3 + axis], tris[9 * t + 6 + axis])));
    for (let ix = lo[0]; ix <= hi[0]; ix++) {
      for (let iy = lo[1]; iy <= hi[1]; iy++) {
        for (let iz = lo[2]; iz <= hi[2]; iz++) {
          const k = key(ix, iy, iz);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(t);
        }
      }
    }
  }
  return { tris, cells, cellOf, key };
}

/**
 * Darkens each vertex colour of `mesh` by the occlusion round it: AO.rays rays over the hemisphere about
 * its normal, against `grid` and the floor (y 0). Möller–Trumbore, both faces of a triangle block.
 */
function shade(mesh, grid) {
  const { tris, cells, cellOf, key } = grid;
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  const color = mesh.geometry.getAttribute('color');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const seen = new Int32Array(tris.length / 9).fill(-1);
  const near = [];
  const R = AO.radiusM;
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    const [ox, oy, oz] = [p.x + n.x * 1e-4, p.y + n.y * 1e-4, p.z + n.z * 1e-4];
    // The triangles near enough to block, and in front of the vertex: a ray leaves into its hemisphere only.
    near.length = 0;
    for (let ix = cellOf(ox - R); ix <= cellOf(ox + R); ix++) {
      for (let iy = cellOf(oy - R); iy <= cellOf(oy + R); iy++) {
        for (let iz = cellOf(oz - R); iz <= cellOf(oz + R); iz++) {
          for (const t of cells.get(key(ix, iy, iz)) ?? []) {
            if (seen[t] === i) continue;
            seen[t] = i;
            const j = 9 * t;
            const d0 = (tris[j] - ox) * n.x + (tris[j + 1] - oy) * n.y + (tris[j + 2] - oz) * n.z;
            const d1 = d0 + tris[j + 3] * n.x + tris[j + 4] * n.y + tris[j + 5] * n.z;
            const d2 = d0 + tris[j + 6] * n.x + tris[j + 7] * n.y + tris[j + 8] * n.z;
            if (d0 > 1e-7 || d1 > 1e-7 || d2 > 1e-7) near.push(j);
          }
        }
      }
    }
    tangent.set(Math.abs(n.y) < 0.99 ? 0 : 1, Math.abs(n.y) < 0.99 ? 1 : 0, 0).cross(n).normalize();
    bitangent.crossVectors(n, tangent);
    let occlusion = 0;
    for (const [lx, ly, lz] of AO_DIRECTIONS) {
      const dx = tangent.x * lx + n.x * ly + bitangent.x * lz;
      const dy = tangent.y * lx + n.y * ly + bitangent.y * lz;
      const dz = tangent.z * lx + n.z * ly + bitangent.z * lz;
      let nearest = R;
      if (dy < 0) nearest = Math.min(nearest, Math.max(0, -oy / dy)); // the floor
      for (const j of near) {
        const [e1x, e1y, e1z, e2x, e2y, e2z] = [tris[j + 3], tris[j + 4], tris[j + 5], tris[j + 6], tris[j + 7], tris[j + 8]];
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = ox - tris[j];
        const ty = oy - tris[j + 1];
        const tz = oz - tris[j + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-6 && t < nearest) nearest = t;
      }
      occlusion += 1 - nearest / R;
    }
    const ao = 1 - (AO.strength * occlusion) / AO.rays;
    color.setXYZ(i, color.getX(i) * ao, color.getY(i) * ao, color.getZ(i) * ao);
  }
}

/**
 * Bakes ambient occlusion into the model's vertex colours (glTF COLOR_0, linear, so it multiplies the light),
 * as the contact shadows the one shadow-casting light can't give. Each rigid body shades itself only: the
 * static `body_*` meshes as one, every moving node on its own, so nothing leaves a shadow where a moving
 * part no longer is. The floor shades them all; glass neither shades nor takes shade. Returns the model.
 */
export function bakeAo(model) {
  model.updateMatrixWorld(true);
  const bodies = new Map();
  model.traverse((object) => {
    if (!object.isMesh) return;
    const body = object.name.startsWith('body') ? 'body' : object.name;
    if (!bodies.has(body)) bodies.set(body, []);
    bodies.get(body).push(object);
  });
  for (const meshes of bodies.values()) {
    const grid = occluders(meshes.filter((mesh) => !mesh.material.transparent));
    for (const mesh of meshes) if (mesh.material.vertexColors) shade(mesh, grid);
  }
  return model;
}

/**
 * The GLB with its geometry meshopt-compressed (EXT_meshopt_compression, required), by glTF-Transform.
 * Lossless: no quantization, so every position, node transform and name stays as it was.
 */
export async function compress(glb) {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const document = await io.readBinary(glb);
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return io.writeBinary(document);
}

/** A cone frustum along y, `bottomRadiusM` at y[0] and `topRadiusM` at y[1], centred on (x, z). */
function frustum(parts, material, color, [x, z], y, bottomRadiusM, topRadiusM, segments) {
  const geometry = new THREE.CylinderGeometry(topRadiusM, bottomRadiusM, y[1] - y[0], segments, cuts(Math.hypot(y[1] - y[0], bottomRadiusM - topRadiusM)));
  geometry.translate(x, (y[0] + y[1]) / 2, z);
  parts.add(material, color, geometry);
}

/** The single mesh of a moving node, at its rest position from the spec. */
function node(parts, name, atM) {
  const meshes = parts.meshes(name);
  if (meshes.length !== 1) throw new Error(`${name}: a moving node must use one material`);
  meshes[0].position.set(...atM);
  return meshes[0];
}

/** A pipe nozzle along x ending at `faceXM`, reaching inwards by `lengthM`, with a flange at its face. */
function nozzle(p, m, faceXM, yM, zM, lengthM) {
  const s = Math.sign(faceXM);
  p.cylinder(m.paint, C.steel, 'x', [faceXM - (s * lengthM) / 2, yM, zM], 0.1, lengthM, 20);
  p.cylinder(m.matte, C.dark, 'x', [faceXM - s * 0.015, yM, zM], 0.125, 0.03, 20);
}

/**
 * The disc-stack separator, 1.70 × 2.30 × 2.90 m, origin on the bowl's spin axis. The frame hood
 * hides the bowl's lower part; its upper part, the lock ring, the bolted top cone, a fin, a stripe and
 * an outlet stub stay in view so the spin reads. Moving node: `bowl`.
 */
export function buildSeparator() {
  const m = makeMaterials('separator');
  const p = new HeroParts();
  // Frame: plinth, body, an access door and a sight glass on the operator side, the top plate.
  p.box(m.matte, C.dark, span(-0.85, 0.85), [0, 0.08], span(-0.85, 0.85));
  p.box(m.paint, C.casing, span(-0.82, 0.82), [0.08, 0.78], span(-0.82, 0.82));
  p.box(m.paint, C.mid, span(-0.85, 0.85), [0.78, 0.82], span(-0.85, 0.85));
  p.box(m.matte, C.motor, span(-0.34, 0.34), [0.2, 0.62], [0.82, 0.835]);
  p.box(m.matte, C.dark, span(0.22, 0.28), [0.38, 0.46], [0.835, 0.85]); // door handle
  // Frame hood round the bowl's lower half, with its rim, a sight glass and the two nozzles.
  p.cylinder(m.paint, C.steel, 'y', [0, 1.085, 0], 0.72, 0.53, 40);
  p.cylinder(m.paint, C.mid, 'y', [0, 1.36, 0], 0.75, 0.04, 40);
  p.cylinder(m.matte, C.black, 'z', [0, 1.06, 0.715], 0.07, 0.03, 16);
  for (const s of [-1, 1]) nozzle(p, m, s * 0.85, 1.2, 0, 0.16);
  // Drive: gear housing behind the frame and the motor lying along z, with its fan cowl at the back.
  p.box(m.paint, C.casing, span(-0.26, 0.26), [0.12, 0.66], [-1.06, -0.82]);
  p.box(m.matte, C.dark, span(-0.4, 0.4), [0, 0.1], [-1.9, -1.1]);
  p.cylinder(m.matte, C.motor, 'z', [0, 0.43, -1.5], 0.36, 0.9, 32);
  p.cylinder(m.matte, C.dark, 'z', [0, 0.43, -2.0], 0.33, 0.1, 32);
  p.box(m.matte, C.motor, span(-0.13, 0.13), [0.72, 0.8], [-1.7, -1.4]); // terminal box

  // The bowl, in its own frame: origin on the spin axis at mid-height of the bowl body (y 1.35).
  const bowl = new HeroParts();
  bowl.cylinder(m.paint, C.steel, 'y', [0, 0, 0], 0.6, 1.1, 40);
  bowl.cylinder(m.paint, C.mid, 'y', [0, 0.53, 0], 0.625, 0.08, 40); // lock ring
  frustum(bowl, m.paint, C.steel, [0, 0], [0.55, 0.92], 0.6, 0.15, 40);
  bowl.cylinder(m.paint, C.dark, 'y', [0, 0.935, 0], 0.15, 0.03, 20); // top of the spindle
  for (let i = 0; i < 8; i++) {
    const angleRad = (i / 8) * Math.PI * 2 + Math.PI / 8;
    bowl.cylinder(m.paint, C.dark, 'y', [0.56 * Math.cos(angleRad), 0.6, 0.56 * Math.sin(angleRad)], 0.025, 0.05, 8);
  }
  // What breaks the symmetry: a fin (as on the grey box), a dark stripe opposite it, an outlet stub.
  bowl.box(m.paint, C.dark, [0.5, 0.62], [-0.45, 0.45], [-0.08, 0.08]);
  bowl.box(m.paint, C.motor, [-0.606, -0.59], [-0.45, 0.45], [-0.06, 0.06]);
  bowl.cylinder(m.paint, C.mid, 'z', [0, 0.76, 0.3], 0.045, 0.2, 12);

  return group('separator', [...p.meshes('body'), node(bowl, 'bowl', [0, 1.35, 0])]);
}

/** Where the homogenizer's liquid end starts; its front face is at z 1.32 m, the envelope's edge. */
export const LIQUID_END_Z_M = 1.06;

/**
 * The three-piston homogenizer, 2.50 × 1.37 × 3.09 m, origin at the centre of the base frame. The
 * pistons run between the crankcase and the liquid end at the front (z 1.06 to 1.32), each with a
 * collar that shows its stroke. Moving nodes: `piston_1` to `piston_3`, left to right along +x.
 */
export function buildHomogenizer() {
  const m = makeMaterials('homogenizer');
  const p = new HeroParts();
  // Base frame on six feet, crankcase with its top cover and three seal covers where the pistons leave it.
  p.box(m.matte, C.dark, span(-1.25, 1.25), [0.04, 0.2], span(-0.75, 0.75));
  for (const xM of [-1.1, 0, 1.1]) for (const zM of [-0.62, 0.62]) p.box(m.matte, C.black, span(xM - 0.08, xM + 0.08), [0, 0.04], span(zM - 0.08, zM + 0.08));
  p.box(m.paint, C.casing, span(-1.1, 1.1), [0.2, 1.3], span(-0.65, 0.65));
  p.box(m.paint, C.mid, span(-1.0, 1.0), [1.3, 1.32], span(-0.55, 0.55));
  for (const xM of [-0.6, 0, 0.6]) p.cylinder(m.matte, C.dark, 'z', [xM, 0.8, 0.66], 0.16, 0.02, 24);
  // Between crankcase and liquid end: four tie rods and a drip tray, open so the pistons show.
  for (const xM of [-0.8, 0.8]) for (const yM of [0.7, 0.9]) p.cylinder(m.paint, C.steel, 'z', [xM, yM, 0.855], 0.035, 0.41, 10);
  p.box(m.matte, C.dark, span(-0.85, 0.85), [0.5, 0.54], [0.65, LIQUID_END_Z_M]);
  // Liquid end (pump block) with its three valve covers. It is kept low (block top at 0.94 m, covers to
  // 0.98 m, the pistons' top at 0.89 m) so the stage-3 camera, about 30° above the floor at +z, sees the pistons behind it.
  p.box(m.paint, C.steel, span(-0.85, 0.85), [0.66, 0.94], [LIQUID_END_Z_M, 1.32]);
  for (const xM of [-0.6, 0, 0.6]) p.cylinder(m.paint, C.mid, 'y', [xM, 0.96, 1.19], 0.08, 0.04, 16);
  // The stage 1 and stage 2 gauges on the top cover: bezel, face and needle.
  for (const [xM, needleRad] of [[-0.5, 0.6], [0.4, -0.3]]) {
    p.cylinder(m.matte, C.dark, 'y', [xM, 1.335, 0.25], 0.13, 0.03, 24);
    p.cylinder(m.paint, C.panel, 'y', [xM, 1.355, 0.25], 0.11, 0.01, 24);
    p.cylinder(m.matte, C.black, 'x', [xM, 1.363, 0.25], 0.006, 0.17, 6, [0, needleRad, 0]);
  }
  // Main motor behind, along x, on its own feet, with a terminal box and the belt guard to the crankcase.
  p.cylinder(m.matte, C.motor, 'x', [0, 0.55, -1.35], 0.42, 1.0, 32);
  p.cylinder(m.matte, C.dark, 'x', [-0.55, 0.55, -1.35], 0.4, 0.1, 32); // fan cowl
  p.cylinder(m.matte, C.dark, 'x', [0.55, 0.55, -1.35], 0.38, 0.1, 32); // end shield
  p.box(m.matte, C.dark, span(-0.45, 0.45), [0, 0.18], [-1.6, -1.1]);
  p.box(m.matte, C.motor, span(-0.15, 0.15), [0.9, 1.05], [-1.5, -1.2]);
  p.box(m.paint, C.mid, span(0.62, 0.82), [0.25, 1.15], [-1.55, -0.6]);
  // Milk in on the -x side, out on the +x side.
  nozzle(p, m, -1.22, 0.7, 0, 0.14);
  nozzle(p, m, 1.22, 0.9, 0, 0.14);

  // Each piston on its slide axis: 0.70 m long (z -0.40 to +0.30 from its node), so at ±0.12 m of
  // stroke its back end stays in the crankcase (z ≤ 0.65) and its front end in the liquid end (z ≥ 1.06).
  const pistons = HERO_SPECS.homogenizer.nodes.map(({ name, atM }) => {
    const piston = new HeroParts();
    piston.cylinder(m.paint, C.steel, 'z', [0, 0, -0.05], 0.09, 0.7, 16);
    piston.cylinder(m.paint, C.dark, 'z', [0, 0, -0.1], 0.115, 0.05, 16); // collar, in view all stroke
    return node(piston, name, atM);
  });

  return group('homogenizer', [...p.meshes('body'), ...pistons]);
}

/**
 * The roll-fed aseptic filler (filler A), 3.53 × 3.56 × 2.70 m, origin at the cabinet centre: the
 * cabinet, the glass aseptic zone with the paper tube and the sealing jaws, the paper reel on the -z
 * side and the outfeed hood over the belt on +x. Filler B is this model mirrored (scale z -1), so it
 * carries no text. Moving nodes: `reel`, and `jaws` with `jaw_1` and `jaw_2`.
 */
export function buildAsepticFiller() {
  const m = makeMaterials('aseptic_filler');
  const p = new HeroParts();
  // Cabinet on a recessed plinth, with door seams and a control panel (screen and buttons) at +z.
  p.box(m.matte, C.dark, span(-1.55, 1.55), [0, 0.1], span(-1.05, 1.05));
  p.box(m.paint, C.panel, span(-1.6, 1.6), [0.1, 2.4], span(-1.1, 1.1));
  for (const xM of [-0.53, 0.53]) p.box(m.matte, C.mid, span(xM - 0.01, xM + 0.01), [0.15, 2.3], [1.1, 1.105]);
  p.box(m.matte, C.mid, span(0.65, 1.35), [1.35, 1.95], [1.1, 1.12]);
  p.box(m.matte, C.black, span(0.7, 1.3), [1.55, 1.9], [1.12, 1.125]);
  for (const xM of [0.8, 0.95, 1.1]) p.box(m.matte, C.dark, span(xM - 0.04, xM + 0.04), [1.41, 1.47], [1.12, 1.135]);
  // Aseptic zone: glass box with corner posts and the roof, and the paper tube inside with its forming
  // ring and the fill pipe rising into its bottom.
  p.box(m.glass, C.glass, span(-1.0, 1.0), [2.4, 3.5], span(-0.8, 0.8));
  for (const xM of [-0.975, 0.975]) for (const zM of [-0.775, 0.775]) p.box(m.matte, C.dark, span(xM - 0.025, xM + 0.025), [2.4, 3.5], span(zM - 0.025, zM + 0.025));
  p.box(m.matte, C.dark, span(-1.05, 1.05), [3.5, 3.56], span(-0.85, 0.85));
  p.cylinder(m.paint, C.paper, 'y', [-0.3, 2.95, 0], 0.13, 1.0, 24);
  p.cylinder(m.paint, C.mid, 'y', [-0.3, 3.3, 0], 0.16, 0.04, 24);
  p.cylinder(m.paint, C.steel, 'y', [-0.3, 2.44, 0], 0.04, 0.08, 10);
  // Product in on the -x face, standing 3 cm proud of it.
  nozzle(p, m, -1.63, 0.55, 0, 0.1);
  // Outfeed: a dark opening in the +x face and a hood over the belt, open below and at the front so
  // the packs (on the belt at y 0.86) pass under it.
  p.box(m.matte, C.black, [1.6, 1.605], [0.86, 1.4], span(-0.36, 0.36));
  p.box(m.paint, C.steel, [1.6, 1.9], [1.44, 1.5], span(-0.4, 0.4));
  for (const s of [-1, 1]) p.box(m.paint, C.steel, [1.6, 1.9], [0.9, 1.44], side(s, 0.37, 0.4));
  // Reel spindle, out of the cabinet's -z face.
  p.cylinder(m.matte, C.dark, 'z', [-0.8, 1.0, -1.2], 0.08, 0.2, 16);

  // The paper reel on its axle (z), with the hub, the bar across it (as on the grey box) and a splice
  // mark at right angles to the bar on both faces, so the turn reads from either side.
  const reel = new HeroParts();
  reel.cylinder(m.paint, C.paper, 'z', [0, 0, 0], 0.78, 0.34, 48);
  reel.cylinder(m.paint, C.mid, 'z', [0, 0, 0], 0.16, 0.355, 20);
  reel.box(m.paint, C.dark, span(-0.6, 0.6), span(-0.05, 0.05), span(-0.18, 0.18));
  reel.box(m.paint, C.motor, span(-0.04, 0.04), [0.2, 0.76], span(-0.175, 0.175));

  // The jaws' carriage: a frame round the tube that rides down and up; the jaw bars on it close along z.
  const jaws = new HeroParts();
  for (const s of [-1, 1]) jaws.cylinder(m.paint, C.mid, 'z', [s * 0.2, 0, 0], 0.015, 0.5, 8);
  for (const s of [-1, 1]) jaws.box(m.paint, C.dark, span(-0.23, 0.23), span(-0.03, 0.03), side(s, 0.24, 0.28));
  const jawsNode = node(jaws, 'jaws', [-0.3, 2.6, 0]);
  for (const [name, s] of [['jaw_1', -1], ['jaw_2', 1]]) {
    // Each bar's origin is its centre; its sealing edge faces the tube (towards z = 0 of `jaws`).
    const jaw = new HeroParts();
    jaw.box(m.paint, C.dark, span(-0.17, 0.17), span(-0.05, 0.05), span(-0.04, 0.04));
    jaw.box(m.paint, C.mid, span(-0.16, 0.16), span(-0.015, 0.015), side(-s, 0.04, 0.05));
    jawsNode.add(node(jaw, name, [0, 0, s * 0.18]));
  }

  return group('aseptic_filler', [...p.meshes('body'), node(reel, 'reel', [-0.8, 1.0, -1.42]), jawsNode]);
}

/**
 * The column palletizer, 3.28 × 2.45 × 1.10 m with the arm at rest along +x, origin on the column
 * axis. Moving nodes: `arm` (turns about y on the column), and under it `arm_lift` (the lift rod),
 * `arm_wrist` (the gripper) and `arm_clamp_1`, `arm_clamp_2`. The pallet and the stack are not part of it.
 */
export function buildPalletizer() {
  const m = makeMaterials('palletizer');
  const p = new HeroParts();
  // Base with its foot flange, an access panel at +z, the column and the slewing ring on top.
  p.cylinder(m.matte, C.dark, 'y', [0, 0.03, 0], 0.55, 0.06, 40);
  p.cylinder(m.paint, C.casing, 'y', [0, 0.33, 0], 0.5, 0.54, 40);
  p.box(m.matte, C.mid, span(-0.18, 0.18), [0.15, 0.48], [0.44, 0.515]);
  p.cylinder(m.paint, C.casing, 'y', [0, 1.39, 0], 0.22, 1.58, 32);
  p.cylinder(m.matte, C.dark, 'y', [0, 2.215, 0], 0.27, 0.07, 32);

  // The arm, from its hinge on the column axis: turntable hub, boom with a side stripe, and the head
  // that guides the lift rod.
  const arm = new HeroParts();
  arm.cylinder(m.paint, C.mid, 'y', [0, 0, 0], 0.24, 0.2, 32);
  arm.box(m.paint, C.casing, [0.1, 2.33], span(-0.1, 0.1), span(-0.13, 0.13));
  arm.box(m.paint, C.dark, [0.3, 2.2], span(-0.03, 0.03), [0.13, 0.135]);
  arm.box(m.paint, C.motor, [2.33, 2.57], span(-0.1, 0.1), span(-0.14, 0.14));
  const armNode = node(arm, 'arm', [0, 2.35, 0]);

  // The lift rod, its origin on its axis at the boom's centre line; its top end stays in the head.
  const lift = new HeroParts();
  lift.cylinder(m.paint, C.steel, 'y', [0, -0.265, 0], 0.06, 0.73, 16);
  const liftNode = node(lift, 'arm_lift', [2.45, 0, 0]);
  armNode.add(liftNode);

  // The gripper, its origin at its top on the rod's axis: a rotary unit, a frame and two rails.
  const wrist = new HeroParts();
  wrist.cylinder(m.paint, C.motor, 'y', [0, -0.02, 0], 0.09, 0.04, 16);
  wrist.box(m.paint, C.dark, span(-0.275, 0.275), [-0.07, -0.03], span(-0.19, 0.19));
  for (const zM of [-0.1, 0.1]) wrist.box(m.paint, C.mid, span(-0.275, 0.275), [-0.12, -0.07], span(zM - 0.02, zM + 0.02));
  const wristNode = node(wrist, 'arm_wrist', [0, -0.63, 0]);
  liftNode.add(wristNode);

  // Two clamp plates on the gripper's z faces, open at rest; each closes towards the other along z.
  for (const [name, s] of [['arm_clamp_1', -1], ['arm_clamp_2', 1]]) {
    const clamp = new HeroParts();
    clamp.box(m.paint, C.mid, span(-0.26, 0.26), span(-0.07, 0.07), side(-s, 0, 0.025));
    clamp.box(m.paint, C.dark, span(-0.26, 0.26), [0.03, 0.07], side(-s, 0.025, 0.06));
    wristNode.add(node(clamp, name, [0, -0.07, s * 0.225]));
  }

  return group('palletizer', [...p.meshes('body'), armNode]);
}

/** Each model's builder, by its key in HERO_SPECS. */
export const HERO_BUILDERS = {
  separator: buildSeparator,
  homogenizer: buildHomogenizer,
  asepticFiller: buildAsepticFiller,
  palletizer: buildPalletizer,
};

/** All four as { 'separator.glb': bytes, ... }: built, AO baked, written and compressed. */
export async function heroGlbs() {
  const out = {};
  for (const [key, build] of Object.entries(HERO_BUILDERS)) out[HERO_SPECS[key].file] = await compress(await toGlb(bakeAo(build())));
  return out;
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
  const outDir = resolve(args.values.out ?? join(repoRoot, 'public', 'models', 'hero'));
  mkdirSync(outDir, { recursive: true });
  for (const [file, bytes] of Object.entries(await heroGlbs())) {
    writeFileSync(join(outDir, file), bytes);
    console.log(`wrote ${join(outDir, file)} (${(bytes.length / 1024).toFixed(1)} KB)`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
