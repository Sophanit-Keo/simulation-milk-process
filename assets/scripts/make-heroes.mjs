#!/usr/bin/env node
// Builds the hero models (assets/hero-specs.md: separator, homogenizer, aseptic filler, palletizer, since phase 12
// the stretch wrapper, and since phase 20 the yogurt wing's Line P8 and fermentation tank) as our own low-poly work, and writes them as the GLBs the scene loads
// in place of the grey boxes (src/scene/equipment/heroes.ts):
//
//   node assets/scripts/make-heroes.mjs [--out public/models/hero]
//
// Same tooling as make-vehicles.mjs: boxes, cylinders and cones with three.js and its GLTFExporter, at
// the version package.json pins, static parts merged into one mesh per material. Each model is built
// round its machine origin from the spec (not the footprint centre), +y up, product along +x and the
// operator side at +z, at the grey box's size. Every moving node the scene drives is a mesh of its
// own, named as in the spec, at its rest position with no rotation and scale 1, and its geometry hangs
// so that the node's origin is on its joint. The colours are plain greys; the filler's aseptic zone is
// the one glass part. Since phase 5 the faces are cut into small cells, the ambient occlusion is baked
// into the vertex colours (bakeAo) and the geometry is meshopt-compressed (compress). Running it twice
// writes the same bytes.

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
  // The grey box (packsLine.ts, palletizer) since phase 12: its boom runs out to MAX_REACH_M + 0.1, about 3.055 m.
  palletizer: {
    file: 'palletizer.glb',
    boundsM: { min: [-0.55, 0, -0.55], max: [3.055, 2.45, 0.55] },
    envelopeM: { min: [-0.64, 0, -0.578], max: [3.145, 2.57, 0.578] },
    maxHeightM: 2.95,
    nodes: [
      { name: 'arm', parent: null, atM: [0, 2.35, 0] },
      { name: 'arm_trolley', parent: 'arm', atM: [2.45, 0, 0] },
      { name: 'arm_lift', parent: 'arm', atM: [2.45, 0, 0] },
      { name: 'arm_wrist', parent: 'arm_lift', atM: [0, -0.63, 0] },
      { name: 'arm_clamp_1', parent: 'arm_wrist', atM: [0, -0.07, -0.225] },
      { name: 'arm_clamp_2', parent: 'arm_wrist', atM: [0, -0.07, 0.225] },
    ],
    nozzlesM: [],
  },
  // The grey box (packsLine.ts, stretchWrapper): turntable r 1.05, the mast's 0.5 m foot at (-1.45, -1.05).
  stretchWrapper: {
    file: 'stretch-wrapper.glb',
    boundsM: { min: [-1.7, 0, -1.3], max: [1.05, 2.7, 1.05] },
    envelopeM: { min: [-1.769, 0, -1.359], max: [1.119, 2.835, 1.109] },
    maxHeightM: 3.0,
    nodes: [
      { name: 'turntable', parent: null, atM: [0, 0.125, 0] },
      { name: 'carriage', parent: null, atM: [-1.25, 0.45, -0.9] },
    ],
    nozzlesM: [],
  },
  // Line P8 (phase 20), round its machine origin (6.5, 0, -47): the grey box of phase 18 (yogurt/p8Machine.ts), from
  // the hood's -x end to the ramp's foot at the check gates' belt (x +5.8).
  p8Filler: {
    file: 'p8-filler.glb',
    boundsM: { min: [-5.1, 0, -0.8], max: [5.8, 2.6, 0.8] },
    envelopeM: { min: [-5.2, 0, -0.85], max: [5.9, 2.73, 0.85] },
    maxHeightM: 3.0,
    nodes: [
      { name: 'pistons', parent: null, atM: [0.5, 1.39, 0] },
      { name: 'foil_pick', parent: null, atM: [1.8, 1.41, 0] },
      { name: 'seal_heads', parent: null, atM: [2.8, 1.41, 0] },
      { name: 'hood', parent: null, atM: [0, 0.95, 0] },
    ],
    nozzlesM: [[-5.0, 0.7, 0]],
  },
  // A fermentation tank (phase 20), round its origin on the axis at the floor; the scene stands it three times. Its
  // pipes meet it along z (the inlet on the +z face, the outlet under the cone): see the tank's own test.
  fermentTank: {
    file: 'ferment-tank.glb',
    boundsM: { min: [-1.4, 0, -1.4], max: [1.4, 4.7, 1.44] },
    envelopeM: { min: [-1.47, 0, -1.47], max: [1.47, 4.85, 1.52] },
    maxHeightM: 5.0,
    nodes: [
      { name: 'agitator', parent: null, atM: [0, 4.64, 0] },
    ],
    nozzlesM: [],
  },
  // The yogurt wing's gantry palletizer (phase 24), round the centre of its pallet place on the floor, world
  // (24.8, 0, -47): the frame over the place, the tray infeed reaching back to the packer, the dispenser behind.
  yogurtPalletizer: {
    file: 'yogurt-palletizer.glb',
    boundsM: { min: [-2.8, 0, -2.4], max: [0.8, 3.4, 1.0] },
    envelopeM: { min: [-2.9, 0, -2.5], max: [0.9, 3.55, 1.05] },
    maxHeightM: 3.8,
    nodes: [
      { name: 'bridge', parent: null, atM: [-0.6, 2.1, 0] },
      { name: 'trolley', parent: 'bridge', atM: [0, 0, 0] },
      { name: 'lift', parent: 'trolley', atM: [0, -0.55, 0] },
    ],
    nozzlesM: [],
  },
};

/**
 * The yogurt gantry palletizer's layout (phase 24), from the centre of its pallet place on the floor; the scene's
 * motion (src/scene/equipment/yogurt/palletLine.ts) moves the nodes within it. The bridge runs along x on the beams,
 * the trolley along z on the bridge, and the lift's origin is the vacuum head's underside.
 */
export const GANTRY = {
  postsXM: [-2.15, 0.75],
  postsZM: 0.9,
  beamTopM: 2.05,
  bridgeYM: 2.1,
  /** The lift's origin under the trolley at rest: the head's underside at 1.55 m, over a full stack and a tray. */
  liftRestM: -0.55,
  mastM: 1.85,
  head: { xM: 0.32, zM: 0.47, padsM: 0.02, plateM: 0.07 },
  bridgeTravelM: [-1.7, 0.45],
  trolleyTravelM: [-0.25, 0.25],
  /** The lowest the head's underside goes: on a first-layer tray, 0.444 m. */
  lowestM: 0.444,
  pickXM: -1.7,
  infeed: { xM: [-2.8, -1.5], topM: 0.76, widthM: 0.5 },
  rollerTopM: 0.25,
  place: { xM: [-0.75, 0.75], widthM: 1.1 },
  dispenser: { zM: -1.8, guideXM: 0.66, guideZM: 0.56, heightM: 1.3 },
};

/**
 * Line P8's stations along its carrier, from its machine origin (src/scene/equipment/yogurt/layout.ts, P8_STATIONS
 * less 6.5), and the carrier: 12 lanes 0.095 m apart, the cups' bases at y 1.03. The scene rides its cups there.
 */
export const P8_LAYOUT = {
  denesterXM: -4.2,
  ionizerXM: -3.2,
  uvM: [-2.5, -0.3],
  fillerXM: 0.5,
  foilXM: 1.8,
  sealerXM: 2.8,
  coderXM: 3.9,
  lanes: 12,
  lanePitchM: 0.095,
  carrierTopM: 1.03,
  cupTopM: 1.1,
  rampM: { fromXM: 5, toXM: 5.8, fromYM: 1.03, toYM: 0.76 },
};
/** Where the static carrier chain and the UV-C tunnel's shell stand, built round these points and merged into the body. */
const P8_PARTS = { carrierM: [0, 0.99, 0], uvTunnelM: [-1.4, 1.33, 0] };

/**
 * The stretch wrapper's layout round the turntable's centre (phase-12 card): the turntable flush with the
 * pallet rollers, the mast in the back corner, the carriage's foot on the mast and how far it climbs.
 */
export const WRAPPER = {
  turntableRadiusM: 1.05,
  topM: 0.25,
  mastXZ: [-1.45, -1.05],
  mastHeightM: 2.7,
  carriageAtM: [-1.25, 0.45, -0.9],
  carriageTravelM: 1.05,
};
/** The pallet the wrapper must clear: riding along x through the centre, or turning on the turntable (m). */
export const WRAPPER_PALLET = { halfWidthM: 0.5, bottomM: 0.25, loadTopM: 1.39, spinRadiusM: 0.79 };
/** The mast and carriage face the turntable's centre: their own +x turned this far about +y. */
export const WRAPPER_YAW_RAD = -Math.atan2(-WRAPPER.mastXZ[1], -WRAPPER.mastXZ[0]);
const WRAPPER_YAW = new THREE.Matrix4().makeRotationY(WRAPPER_YAW_RAD);
/** A point (u, w) of the carriage's own frame (u toward the turntable, w across, to the operator side) as (x, z) of its node. */
const carriageXZ = ([u, w]) => [u * Math.cos(WRAPPER_YAW_RAD) + w * Math.sin(WRAPPER_YAW_RAD), -u * Math.sin(WRAPPER_YAW_RAD) + w * Math.cos(WRAPPER_YAW_RAD)];
/** Where the film roll and the carriage's rollers stand in the carriage's own frame: axis (u, w), radius. */
const FILM_LAYOUT = {
  roll: { uw: [0.16, -0.11], radiusM: 0.12, yM: [0.045, 0.575] },
  prestretch: [{ uw: [0.075, 0.07], radiusM: 0.045 }, { uw: [0.075, 0.17], radiusM: 0.045 }],
  exit: { uw: [0.16, 0.12], radiusM: 0.025 },
  rollerYM: [0.04, 0.58],
};
/**
 * The film's path on the carriage, in the `carriage` node's frame (its origin the carriage's foot, axes the
 * model's; add carriage.position for the model frame): the roll's axis and height, and the exit roller the
 * film leaves from toward the load (the turntable turns +y, so the film runs off on the operator side).
 */
export const WRAPPER_FILM = {
  roll: { atXZ: carriageXZ(FILM_LAYOUT.roll.uw), radiusM: FILM_LAYOUT.roll.radiusM, yM: FILM_LAYOUT.roll.yM },
  exit: { atXZ: carriageXZ(FILM_LAYOUT.exit.uw), radiusM: FILM_LAYOUT.exit.radiusM, yM: FILM_LAYOUT.rollerYM },
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
  film: 0xd3dde2, // the stretch wrapper's film roll
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
export const AO_CELL_M = 0.2;

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

  /** Takes every part of `from`, moved by `matrix`: parts built square to a frame of their own, then turned and placed. */
  merge(from, matrix) {
    for (const [material, geometries] of from.byMaterial) {
      let list = this.byMaterial.get(material);
      if (!list) this.byMaterial.set(material, (list = []));
      for (const geometry of geometries) list.push(geometry.applyMatrix4(matrix));
    }
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
 * Where the scene stands the palletizer's lift since phase 12 (src/scene/equipment/packs/palletizing.ts): out
 * along the boom over each tray's place on the pallet (`arm_lift.position.x`, the reach from the column's axis)
 * and down to the tray on the belt or onto the stack (`arm_lift.position.y = -lift`). Worked out as the scene does
 * from its layout (packs/layout.ts): the column at (28.3, 13.2), the pick point at (29.85, 11.2), the pallet's
 * centre at (26.2, 14.4) with 12 places a layer, 3 along x by 4 along z of 0.40 × 0.25 m; a tray 0.135 m tall
 * hangs under the gripper, whose underside is 0.75 m under the hinge (2.35 m) at rest; the belt's surface is at
 * 0.86 m, an empty pallet's deck at 0.39 m. Metres: reach about 1.89 to 2.955, lift up to 1.075.
 */
export const PALLETIZER_TRAVEL = (() => {
  const reach = (x, z) => Math.hypot(x - 28.3, z - 13.2);
  const places = [];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) places.push(reach(26.2 + (column - 1) * 0.4, 14.4 + (row - 1.5) * 0.25));
  const liftTo = (surfaceM) => 2.35 - 0.75 - 0.135 - surfaceM;
  return {
    minReachM: Math.min(...places),
    maxReachM: Math.max(...places),
    pickReachM: reach(29.85, 11.2),
    pickLiftM: liftTo(0.86),
    maxLiftM: liftTo(0.39),
  };
})();

/**
 * The lift rod the scene draws (packsLine.ts, `lift-rod`, hung on `arm_lift`): a 12-sided cylinder of radius 0.07 m
 * on the lift's axis, stretched every frame from the top of the gripper (`arm_wrist`) up to `topM` over the
 * boom's centre line in the arm's frame (BOOM_TOP_M), however far the lift is down. The model's trolley takes
 * its top end.
 */
export const PALLETIZER_LIFT_ROD = { radiusM: 0.07, segments: 12, topM: 0.1 };

/**
 * The palletizer's boom since phase 12, along +x in the arm's frame: closed at the root, then two beams with a slot
 * between them for the lift rod, a guide rail on each and a rack on the +z side, an end stop at each end of the
 * rails, and an end plate at the tip. The trolley's guide blocks run on the rails. Metres.
 */
export const PALLETIZER_BOOM = {
  /** The beams' outer faces, z ±. */
  halfWidthM: 0.15,
  /** The slot between the beams, z ±: 1.5 cm clear of the scene's rod. */
  slotHalfM: 0.085,
  /** Where the slot begins: the closed root ends. */
  slotFromM: 1.55,
  /** The rails, between the end stops. */
  railM: [1.59, 3.09],
  /** The end plate's outer face. */
  tipM: 3.13,
};

/** The trolley, from its node's origin on the rod's axis: 0.135 m each way along the boom. */
const TROLLEY_HALF_M = 0.135;

/**
 * The column palletizer, 3.68 × 2.55 × 1.10 m with the arm at rest along +x, origin on the column axis.
 * Moving nodes: `arm` (turns about y on the column), and under it `arm_trolley` (rides along the boom),
 * `arm_lift` (the gripper's mount, slides along the boom and down), `arm_wrist` (the gripper) and
 * `arm_clamp_1`, `arm_clamp_2`. The pallet, the stack and the lift rod above the gripper's mount are the scene's.
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

  // The arm, from its hinge on the column axis: the turntable hub, and the boom (PALLETIZER_BOOM): closed at the
  // root, then two beams with the rod's slot between them, each with a guide rail and an end stop at each end of
  // it, the rack on the +z side (the stripe along the root), and the end plate at the tip.
  const B = PALLETIZER_BOOM;
  const arm = new HeroParts();
  arm.cylinder(m.paint, C.mid, 'y', [0, 0, 0], 0.24, 0.2, 32);
  arm.box(m.paint, C.casing, [0.1, B.slotFromM], span(-0.1, 0.1), span(-B.halfWidthM, B.halfWidthM));
  const railZ = (s) => side(s, (B.slotHalfM + B.halfWidthM) / 2 - 0.012, (B.slotHalfM + B.halfWidthM) / 2 + 0.012);
  for (const s of [-1, 1]) {
    arm.box(m.paint, C.casing, [B.slotFromM, B.tipM - 0.02], span(-0.1, 0.1), side(s, B.slotHalfM, B.halfWidthM));
    arm.box(m.paint, C.steel, B.railM, [0.1, 0.12], railZ(s));
    for (const x of [[B.railM[0] - 0.02, B.railM[0]], [B.railM[1], B.railM[1] + 0.02]]) arm.box(m.paint, C.black, x, [0.1, 0.13], side(s, 0.095, 0.14));
  }
  arm.box(m.paint, C.dark, [0.3, B.railM[1]], span(-0.03, 0.03), [B.halfWidthM, B.halfWidthM + 0.005]);
  arm.box(m.paint, C.dark, [B.tipM - 0.02, B.tipM], span(-0.1, 0.1), span(-B.halfWidthM - 0.01, B.halfWidthM + 0.01));
  const armNode = node(arm, 'arm', [0, 2.35, 0]);

  // The trolley, its origin on the rod's axis at the boom's centre line. It straddles the boom: a carriage plate
  // on four guide blocks over the rails (2 mm clear of them), skirts down both sides, a yoke under the beams with
  // the guide bush the rod runs through, a bearing cap on top, and a drive on each side (gearbox and motor).
  // The scene's rod ends inside it, at the boom's top, wherever the lift stands along the boom.
  const trolley = new HeroParts();
  const along = span(-TROLLEY_HALF_M, TROLLEY_HALF_M);
  trolley.box(m.paint, C.panel, along, [0.135, 0.16], span(-0.175, 0.175));
  trolley.box(m.paint, C.panel, along, [-0.16, -0.13], span(-0.175, 0.175));
  for (const s of [-1, 1]) {
    trolley.box(m.paint, C.panel, along, [-0.13, 0.135], side(s, B.halfWidthM + 0.01, 0.175));
    for (const x of [[-0.125, -0.035], [0.035, 0.125]]) trolley.box(m.paint, C.dark, x, [0.122, 0.135], side(s, 0.1, 0.135));
    trolley.box(m.paint, C.dark, span(-0.05, 0.05), [-0.03, 0.07], side(s, 0.175, 0.205));
    trolley.cylinder(m.paint, C.motor, 'z', [0, 0.02, s * 0.265], 0.045, 0.12, 16);
  }
  trolley.cylinder(m.paint, C.dark, 'y', [0, -0.23, 0], 0.095, 0.14, 24);
  trolley.cylinder(m.paint, C.black, 'y', [0, -0.305, 0], 0.08, 0.01, 24);
  trolley.cylinder(m.paint, C.dark, 'y', [0, 0.18, 0], 0.08, 0.04, 24);
  armNode.add(node(trolley, 'arm_trolley', [2.45, 0, 0]));

  // The gripper's mount, its origin on the rod's axis at the boom's centre line: the foot of the lift rod, clamped
  // to the top of the gripper, and the rod itself up into the trolley as it stands at rest, 1 cm short of the
  // boom's top. In the scene the stretched rod (PALLETIZER_LIFT_ROD), 1 cm thicker, covers it at every lift.
  const lift = new HeroParts();
  lift.cylinder(m.paint, C.steel, 'y', [0, -0.27, 0], 0.06, 0.72, 16);
  lift.cylinder(m.paint, C.dark, 'y', [0, -0.605, 0], 0.08, 0.05, 16);
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

/**
 * The turntable stretch wrapper, in line on the pallet rollers, origin on the turntable's axis at the floor:
 * a low base, the turntable with a roller deck flush with the pallet rollers, and the mast in the back corner
 * with its control box, facing the turntable, on which the film carriage climbs. Moving nodes: `turntable`
 * (turns about +y) and `carriage` (slides up the mast along +y, 0 to WRAPPER.carriageTravelM), which carries
 * the film roll, the two pre-stretch rollers and the exit roller (WRAPPER_FILM).
 */
export function buildStretchWrapper() {
  const m = makeMaterials('stretch_wrapper');
  const p = new HeroParts();
  const [mastX, mastZ] = WRAPPER.mastXZ;
  const [carX, carY, carZ] = WRAPPER.carriageAtM;
  const top = WRAPPER.topM;

  // The base the turntable turns on, a shadow gap under its disc (a height float32 holds exactly, so it stands on y 0).
  p.cylinder(m.matte, C.dark, 'y', [0, 0.03125, 0], 0.98, 0.0625, 64);

  // The mast, built square to its own frame (+x toward the turntable's centre, +z across to the operator
  // side) and turned to face the centre: foot plate and bolts, base collar, column with the carriage's guide
  // strip, top cap, the lift motor behind, the control box on the operator side, and the base frame to the turntable.
  const mast = new HeroParts();
  mast.box(m.matte, C.dark, span(-0.2, 0.2), [0, 0.04], span(-0.2, 0.2));
  for (const u of [-0.15, 0.15]) for (const w of [-0.15, 0.15]) mast.cylinder(m.matte, C.black, 'y', [u, 0.05, w], 0.015, 0.02, 8);
  mast.box(m.matte, C.dark, span(-0.14, 0.14), [0.04, 0.3], span(-0.14, 0.14));
  mast.box(m.paint, C.casing, span(-0.11, 0.11), [0.3, WRAPPER.mastHeightM - 0.06], span(-0.11, 0.11));
  mast.box(m.matte, C.black, [0.11, 0.115], [0.35, WRAPPER.mastHeightM - 0.1], span(-0.025, 0.025));
  mast.box(m.matte, C.dark, span(-0.14, 0.14), [WRAPPER.mastHeightM - 0.06, WRAPPER.mastHeightM], span(-0.14, 0.14));
  mast.box(m.matte, C.motor, [-0.3, -0.14], [0.08, 0.36], span(-0.1, 0.1));
  mast.box(m.paint, C.panel, [-0.11, 0.05], [0.95, 1.45], [0.11, 0.33]);
  mast.box(m.matte, C.black, [-0.07, 0.03], [1.25, 1.38], [0.33, 0.335]); // screen
  for (const u of [-0.06, -0.02, 0.02]) mast.box(m.matte, C.dark, [u - 0.012, u + 0.012], [1.12, 1.15], [0.33, 0.34]); // buttons
  mast.cylinder(m.matte, C.black, 'z', [-0.02, 1.03, 0.34], 0.025, 0.02, 12); // stop button
  mast.box(m.matte, C.dark, [0.14, 0.85], [0, 0.06], span(-0.06, 0.06)); // base frame, under the turntable's rim
  p.merge(mast, new THREE.Matrix4().makeTranslation(mastX, 0, mastZ).multiply(WRAPPER_YAW));

  // The turntable, its origin on the axis at mid-height: a disc, and on it a roller deck flush with the pallet
  // rollers (12 rollers across the line between two side frames), so a pallet rides on and off along x when it
  // stands square (rotation.y a multiple of π); a dark plate on one side shows the turn.
  const [, tableY] = HERO_SPECS.stretchWrapper.nodes[0].atM;
  const table = new HeroParts();
  table.cylinder(m.paint, C.mid, 'y', [0, 0.12 - tableY, 0], WRAPPER.turntableRadiusM, 0.08, 64);
  for (const s of [-1, 1]) table.box(m.paint, C.dark, span(-0.76, 0.76), [0.16 - tableY, top - tableY], side(s, 0.655, 0.7));
  for (let i = 0; i < 12; i++) {
    // Not cut into rings: in a deck of like rollers the shade does not change along a roller.
    const roller = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12).rotateX(Math.PI / 2).translate(-0.715 + 0.13 * i, top - 0.04 - tableY, 0);
    table.add(m.paint, C.steel, roller);
  }
  table.box(m.paint, C.black, span(-0.25, 0.25), [0.16 - tableY, 0.175 - tableY], [0.76, 0.96]);

  // The carriage, built in its own frame (u toward the turntable, w across) and turned like the mast. Guide
  // shoes on the mast's front face and corners; the housing over the pre-stretch gearing with its motor on
  // top; frame plates over and under the film roll, which stands on its chucks; the two pre-stretch rollers
  // and the exit roller on the operator side, where the film runs off; a photocell on the top plate.
  const [mu, , mw] = new THREE.Vector3(mastX - carX, 0, mastZ - carZ).applyMatrix4(new THREE.Matrix4().makeRotationY(-WRAPPER_YAW_RAD)).toArray();
  const { roll, prestretch, exit, rollerYM } = FILM_LAYOUT;
  const c = new HeroParts();
  c.box(m.paint, C.mid, [mu + 0.125, mu + 0.155], [0, 0.62], [mw - 0.15, mw + 0.15]);
  for (const s of [-1, 1]) c.box(m.paint, C.mid, [mu + 0.07, mu + 0.155], [0.04, 0.58], span(mw + s * 0.125, mw + s * 0.15));
  c.box(m.paint, C.panel, [mu + 0.155, 0.02], [0.03, 0.59], [-0.24, 0.22]);
  c.cylinder(m.paint, C.motor, 'y', [-0.04, 0.655, -0.12], 0.055, 0.07, 16);
  for (const y of [[0, 0.03], [0.59, 0.62]]) {
    c.box(m.paint, C.dark, [mu + 0.155, 0.13], y, [-0.24, 0.22]);
    c.box(m.paint, C.dark, [0.13, 0.3], y, [-0.24, 0.14]);
  }
  const rollY = (y0, y1) => [(y0 + y1) / 2, y1 - y0];
  for (const y of [[0.03, roll.yM[0]], [roll.yM[1], 0.59]]) {
    const [yM, hM] = rollY(...y);
    c.cylinder(m.paint, C.dark, 'y', [roll.uw[0], yM, roll.uw[1]], 0.05, hM, 16); // chuck
  }
  c.cylinder(m.paint, C.film, 'y', [roll.uw[0], rollY(...roll.yM)[0], roll.uw[1]], roll.radiusM, rollY(...roll.yM)[1], 32);
  for (const { uw, radiusM } of prestretch) c.cylinder(m.paint, C.black, 'y', [uw[0], rollY(...rollerYM)[0], uw[1]], radiusM, rollY(...rollerYM)[1], 16);
  c.cylinder(m.paint, C.steel, 'y', [exit.uw[0], rollY(...rollerYM)[0], exit.uw[1]], exit.radiusM, rollY(...rollerYM)[1], 12);
  c.box(m.paint, C.black, [0.26, 0.3], [0.62, 0.66], [-0.03, 0.03]);
  const carriage = new HeroParts();
  carriage.merge(c, WRAPPER_YAW);

  return group('stretch_wrapper', [...p.meshes('body'), node(table, 'turntable', [0, tableY, 0]), node(carriage, 'carriage', [carX, carY, carZ])]);
}


/**
 * Line P8, the cup filler (phase 20): 10 m of cabinet with the carrier chain on top, under a glass HEPA hood with its
 * filter housing; along the carrier the 12 cup magazines over the de-nester, the ionizer's shroud, the UV-C tunnel, the
 * piston manifold, the foil magazine, the sealing heads' housing and the coder, then the ramp down to the check gates.
 * The cups' band over the carrier (y 1.03 to 1.10, |z| < 0.56) stays clear. Moving nodes: `pistons`, `foil_pick` and
 * `seal_heads` stroke down; `hood` is a node so the scene can tint its glass. The chain and the tunnel are static body.
 */
export function buildP8Filler() {
  const m = makeMaterials('p8_filler');
  const L = P8_LAYOUT;
  const laneHalfM = ((L.lanes - 1) * L.lanePitchM) / 2;
  const laneZ = (lane) => -laneHalfM + lane * L.lanePitchM;
  const p = new HeroParts();
  // Cabinet on a recessed plinth, door seams on both long faces, the HMI on the +z side near the out end.
  p.box(m.matte, C.dark, span(-4.95, 4.95), [0, 0.08], span(-0.55, 0.55));
  p.box(m.paint, C.panel, span(-5, 5), [0.08, 0.95], span(-0.6, 0.6));
  for (const xM of [-3.75, -2.5, -1.25, 0, 1.25, 2.5, 3.75]) for (const s of [-1, 1]) p.box(m.matte, C.mid, span(xM - 0.01, xM + 0.01), [0.14, 0.88], side(s, 0.6, 0.605));
  p.box(m.matte, C.mid, span(3.2, 3.8), [0.45, 0.85], [0.6, 0.62]);
  p.box(m.matte, C.black, span(3.25, 3.75), [0.6, 0.82], [0.62, 0.625]);
  // The product in from the buffer, on the -x end.
  nozzle(p, m, -5.03, 0.7, 0, 0.1);
  // The hood's frame: corner and mid posts on the cabinet, under the filter housing; the housing and its fan boxes.
  for (const xM of [-5.07, -2.5, 0, 2.5, 5.07]) for (const s of [-1, 1]) p.box(m.matte, C.dark, span(xM - 0.03, xM + 0.03), [0.95, 2.3], side(s, 0.74, 0.8));
  p.box(m.paint, C.steel, span(-4.5, 4.5), [2.3, 2.56], span(-0.6, 0.6));
  for (const xM of [-3, 0, 3]) p.box(m.matte, C.motor, span(xM - 0.4, xM + 0.4), [2.56, 2.6], span(-0.35, 0.35));
  // The de-nester: a magazine tube over each lane with a stack of cups showing at its foot, the suction bar's rail
  // and its two uprights outside the lanes.
  for (let lane = 0; lane < L.lanes; lane++) {
    p.cylinder(m.paint, C.steel, 'y', [L.denesterXM, 1.65, laneZ(lane)], 0.042, 0.7, 12);
    p.cylinder(m.paint, C.paper, 'y', [L.denesterXM, 1.28, laneZ(lane)], 0.036, 0.04, 12);
  }
  p.box(m.matte, C.dark, span(L.denesterXM - 0.11, L.denesterXM + 0.11), [1.24, 1.3], span(-laneHalfM - 0.08, laneHalfM + 0.08));
  for (const s of [-1, 1]) p.box(m.matte, C.dark, span(L.denesterXM - 0.05, L.denesterXM + 0.05), [1.03, 2.03], side(s, laneHalfM + 0.09, laneHalfM + 0.15));
  // The ionizer's shroud and its air hose.
  p.box(m.paint, C.steel, span(L.ionizerXM - 0.2, L.ionizerXM + 0.2), [1.25, 1.37], span(-laneHalfM - 0.1, laneHalfM + 0.1));
  p.cylinder(m.matte, C.black, 'y', [L.ionizerXM, 1.6, -0.3], 0.03, 0.46, 10);
  // The piston manifold and its hopper, the foil magazine, the sealing heads' housing, the coder's head on the -z side.
  const across = span(-laneHalfM - 0.1, laneHalfM + 0.1);
  p.box(m.paint, C.steel, span(L.fillerXM - 0.21, L.fillerXM + 0.21), [1.5, 1.8], across);
  p.cylinder(m.paint, C.steel, 'y', [L.fillerXM, 1.95, 0], 0.18, 0.3, 20);
  p.box(m.paint, C.steel, span(L.foilXM - 0.16, L.foilXM + 0.16), [1.58, 1.84], across);
  p.box(m.paint, C.steel, span(L.sealerXM - 0.2, L.sealerXM + 0.2), [1.57, 1.81], across);
  p.box(m.matte, C.motor, span(L.sealerXM - 0.12, L.sealerXM + 0.12), [1.81, 2.0], span(-0.2, 0.2));
  p.box(m.matte, C.dark, span(L.coderXM - 0.11, L.coderXM + 0.11), [1.22, 1.44], [-laneHalfM - 0.13, -laneHalfM - 0.03 - 0.0475]);
  // The ramp to the check gates' belt, a plate between low rails, turned down from the carrier's end.
  const { fromXM, toXM, fromYM, toYM } = L.rampM;
  const rampRad = Math.atan2(fromYM - toYM, toXM - fromXM);
  const rampLengthM = Math.hypot(toXM - fromXM, fromYM - toYM);
  const ramp = new HeroParts();
  ramp.box(m.matte, C.dark, [0, rampLengthM], [-0.04, 0], span(-0.21, 0.21));
  for (const s of [-1, 1]) ramp.box(m.paint, C.steel, [0, rampLengthM], [0, 0.03], side(s, 0.19, 0.21));
  p.merge(ramp, new THREE.Matrix4().makeTranslation(fromXM, fromYM, 0).multiply(new THREE.Matrix4().makeRotationZ(-rampRad)));
  // Legs under the ramp's foot.
  for (const s of [-1, 1]) p.box(m.matte, C.dark, span(5.68, 5.74), [0, 0.74], side(s, 0.16, 0.2));

  // The carrier chain: plates the width of the lanes and the pockets' rims, at 0.10 m pitch.
  const carrier = new HeroParts();
  carrier.box(m.paint, C.mid, span(-5, 5), [-0.04, 0.03], span(-0.65, 0.65));
  // Not cut into cells: in a chain of like slats the shade does not change along a slat.
  for (let k = 0; k < 100; k++) carrier.add(m.paint, C.dark, new THREE.BoxGeometry(0.012, 0.01, 1.2).translate(-4.955 + 0.1 * k, 0.035, 0));

  // The UV-C tunnel's shell: its roof over the lanes and its two side walls down to the chain.
  const uv = new HeroParts();
  const uvHalf = (L.uvM[1] - L.uvM[0]) / 2;
  uv.box(m.paint, C.steel, span(-uvHalf, uvHalf), [-0.04, 0.04], span(-laneHalfM - 0.12, laneHalfM + 0.12));
  for (const s of [-1, 1]) uv.box(m.paint, C.steel, span(-uvHalf, uvHalf), [-0.3, -0.04], side(s, laneHalfM + 0.1, laneHalfM + 0.12));

  // The pistons: a crossbar and a nozzle over each lane, its tip 0.11 m under the node.
  const pistons = new HeroParts();
  pistons.box(m.paint, C.dark, span(-0.06, 0.06), [0.07, 0.11], span(-laneHalfM - 0.04, laneHalfM + 0.04));
  for (let lane = 0; lane < L.lanes; lane++) pistons.cylinder(m.paint, C.steel, 'y', [0, -0.02, laneZ(lane)], 0.018, 0.18, 10);

  // The foil pick: a beam with a suction cup over each lane.
  const pick = new HeroParts();
  pick.box(m.paint, C.dark, span(-0.06, 0.06), [0, 0.04], span(-laneHalfM - 0.04, laneHalfM + 0.04));
  for (let lane = 0; lane < L.lanes; lane++) pick.cylinder(m.paint, C.black, 'y', [0, -0.015, laneZ(lane)], 0.03, 0.03, 10);

  // The sealing heads: the heated platen and a head over each lane.
  const heads = new HeroParts();
  heads.box(m.paint, C.dark, span(-0.08, 0.08), [-0.04, 0.04], span(-laneHalfM - 0.04, laneHalfM + 0.04));
  for (let lane = 0; lane < L.lanes; lane++) heads.cylinder(m.paint, C.steel, 'y', [0, -0.055, laneZ(lane)], 0.038, 0.03, 12);

  // The HEPA hood's glass, from the cabinet's top to the filter housing.
  const hood = new HeroParts();
  // Glass takes no baked shade, so its faces are not cut.
  hood.add(m.glass, C.glass, new THREE.BoxGeometry(10.2, 1.35, 1.6).translate(0, 0.675, 0));

  // The chain and the tunnel stand still (the cups index over them), so they join the body: no draw call of their own.
  p.merge(carrier, new THREE.Matrix4().makeTranslation(...P8_PARTS.carrierM));
  p.merge(uv, new THREE.Matrix4().makeTranslation(...P8_PARTS.uvTunnelM));
  const { nodes } = HERO_SPECS.p8Filler;
  const at = (name) => nodes.find((each) => each.name === name).atM;
  return group('p8_filler', [
    ...p.meshes('body'),
    node(pistons, 'pistons', at('pistons')),
    node(pick, 'foil_pick', at('foil_pick')),
    node(heads, 'seal_heads', at('seal_heads')),
    node(hood, 'hood', at('hood')),
  ]);
}

/** The fermentation tank's shell (src/scene/equipment/yogurt/layout.ts, FERMENT_TANK) and where its pipes meet it. */
export const FERMENT_TANK = {
  radiusM: 1.4,
  legsM: 0.7,
  coneM: 0.5,
  bodyM: 2.6,
  domeM: 0.4,
  driveM: 0.44,
  inletM: [0, 1.4, 1.4],
  outletM: [0, 0.6, 0],
  /** The pH probe's port, on the shell at 45° toward +x and +z; the scene hangs the tank's hold lamp over it. */
  probeM: [0.99, 1.8, 0.99],
  /** The scene's level gauge, down the +z face: keep that strip plain. */
  gaugeM: { zM: 1.42, yM: [1.3, 3.7], halfWidthM: 0.09 },
};

/**
 * A fermentation tank (phase 20): an insulated, cone-bottomed tank of 10,000 L on four legs, stainless cladding with
 * its seams, a manway and a sight glass on the dome, the agitator's drive on top, the inlet on the +z face and the
 * outlet under the cone. Moving node: `agitator`, the coupling and paddle over the drive, which the scene turns. The pH
 * probe's port on the +z side is static body; the scene hangs the tank's hold lamp over it.
 */
export function buildFermentTank() {
  const m = makeMaterials('ferment_tank');
  const T = FERMENT_TANK;
  const bottomM = T.legsM + T.coneM;
  const topM = bottomM + T.bodyM;
  const p = new HeroParts();
  // Four legs with their pads, on a circle of 1.01 m, the first at 0.4 rad, and braces up to the cone's rim.
  for (let i = 0; i < 4; i++) {
    const a = 0.4 + (i * Math.PI) / 2;
    const [x, z] = [1.01 * Math.cos(a), 1.01 * Math.sin(a)];
    p.cylinder(m.matte, C.dark, 'y', [x, (bottomM + 0.05) / 2, z], 0.07, bottomM + 0.05, 12);
    p.cylinder(m.matte, C.dark, 'y', [x, 0.015, z], 0.12, 0.03, 12);
  }
  // The cone, the body with its cladding seams and the stiffening bands at both ends, the dome.
  frustum(p, m.paint, C.steel, [0, 0], [T.legsM, bottomM], 0.31, T.radiusM, 40);
  p.cylinder(m.paint, C.steel, 'y', [0, bottomM + T.bodyM / 2, 0], T.radiusM, T.bodyM, 48);
  for (const y of [bottomM + 0.03, topM - 0.03]) p.cylinder(m.matte, C.mid, 'y', [0, y, 0], T.radiusM + 0.005, 0.06, 48);
  for (const y of [bottomM + T.bodyM / 3, bottomM + (2 * T.bodyM) / 3]) p.cylinder(m.matte, C.casing, 'y', [0, y, 0], T.radiusM + 0.002, 0.012, 48);
  frustum(p, m.paint, C.steel, [0, 0], [topM, topM + T.domeM * 0.6], T.radiusM, T.radiusM * 0.72, 40);
  frustum(p, m.paint, C.steel, [0, 0], [topM + T.domeM * 0.6, topM + T.domeM], T.radiusM * 0.72, 0.3, 40);
  // A manway and a sight glass on the dome, at -x so the gauge strip and the camera's side stay plain.
  p.cylinder(m.matte, C.dark, 'y', [-0.75, topM + 0.3, -0.2], 0.25, 0.12, 24);
  p.cylinder(m.paint, C.mid, 'y', [-0.75, topM + 0.38, -0.2], 0.27, 0.04, 24);
  p.cylinder(m.matte, C.black, 'y', [0.6, topM + 0.31, -0.45], 0.08, 0.1, 16);
  // The agitator's drive: gearbox and motor on the dome's top.
  p.box(m.matte, C.motor, span(-0.2, 0.2), [topM + T.domeM, topM + T.domeM + 0.3], span(-0.2, 0.2));
  p.cylinder(m.matte, C.dark, 'y', [0, topM + T.domeM + 0.37, 0], 0.15, 0.14, 20);
  // The inlet on the +z face, flanged; the outlet under the cone's tip, with its valve.
  const [, inletY] = T.inletM;
  p.cylinder(m.paint, C.steel, 'z', [0, inletY, T.radiusM - 0.05], 0.06, 0.1, 16);
  p.cylinder(m.matte, C.dark, 'z', [0, inletY, T.radiusM], 0.09, 0.03, 16);
  p.cylinder(m.paint, C.steel, 'y', [0, T.legsM - 0.04, 0], 0.07, 0.08, 16);
  p.box(m.matte, C.dark, span(-0.09, 0.09), [T.outletM[1] - 0.04, T.legsM - 0.08], span(-0.09, 0.09));
  // The gauge's frame strip: the scene draws its level inside it.
  const g = T.gaugeM;
  p.box(m.matte, C.dark, span(-g.halfWidthM, g.halfWidthM), g.yM, [T.radiusM, g.zM + 0.02]);

  // The agitator: the shaft's coupling and the paddle across it, as the grey box's, over the drive.
  const agitator = new HeroParts();
  agitator.cylinder(m.paint, C.mid, 'y', [0, 0.03, 0], 0.09, 0.06, 16);
  agitator.box(m.paint, C.dark, span(-0.55, 0.55), [0, 0.06], span(-0.06, 0.06));

  // The pH probe's port and transmitter head, on the shell at 45° toward +x and +z.
  const probe = new HeroParts();
  probe.cylinder(m.paint, C.steel, 'y', [0, 0, 0], 0.05, 0.16, 12);
  probe.box(m.paint, C.mid, span(-0.06, 0.06), [0.08, 0.2], span(-0.06, 0.06));

  p.merge(probe, new THREE.Matrix4().makeTranslation(...FERMENT_TANK.probeM));
  const { nodes } = HERO_SPECS.fermentTank;
  const at = (name) => nodes.find((each) => each.name === name).atM;
  return group('ferment_tank', [...p.meshes('body'), node(agitator, 'agitator', at('agitator'))]);
}


/**
 * The yogurt wing's gantry palletizer (phase 24): four posts and two beams over the pallet place, the tray infeed
 * belt reaching back toward the tray packer, the place's roller deck, and the dispenser's four corner guides behind it,
 * all one painted mesh. Moving nodes: `bridge` runs along x on the beams, `trolley` along z on the bridge, and `lift`
 * up and down through the trolley with the vacuum head at its foot (its origin is the head's underside).
 */
export function buildYogurtPalletizer() {
  const m = makeMaterials('yogurt_palletizer');
  const G = GANTRY;
  const p = new HeroParts();
  // The frame: posts on feet, the two beams along x, and a cross beam over each end.
  for (const xM of G.postsXM) {
    for (const s of [-1, 1]) {
      p.box(m.paint, C.dark, span(xM - 0.09, xM + 0.09), [0, 0.03], side(s, G.postsZM - 0.09, G.postsZM + 0.09));
      p.box(m.paint, C.casing, span(xM - 0.05, xM + 0.05), [0.03, G.beamTopM], side(s, G.postsZM - 0.05, G.postsZM + 0.05));
    }
    p.box(m.paint, C.casing, span(xM - 0.05, xM + 0.05), [G.beamTopM - 0.1, G.beamTopM], span(-G.postsZM, G.postsZM));
  }
  for (const s of [-1, 1]) {
    p.box(m.paint, C.mid, span(G.postsXM[0] - 0.05, G.postsXM[1] + 0.05), [G.beamTopM - 0.1, G.beamTopM], side(s, G.postsZM - 0.06, G.postsZM + 0.06));
    // The rail the bridge's wheels run on, on top of each beam.
    p.box(m.paint, C.steel, span(G.postsXM[0], G.postsXM[1]), [G.beamTopM, G.beamTopM + 0.02], side(s, G.postsZM - 0.02, G.postsZM + 0.02));
  }
  // The control cabinet on the front post at +x, with its screen.
  p.box(m.paint, C.panel, span(G.postsXM[1] - 0.04, G.postsXM[1] + 0.04), [0.9, 1.5], [G.postsZM + 0.05, G.postsZM + 0.09]);
  // The tray infeed: legs, side frames, the belt on top, and an end stop at the pick point.
  const [inFrom, inTo] = G.infeed.xM;
  const halfIn = G.infeed.widthM / 2;
  for (const xM of [inFrom + 0.1, inTo - 0.1]) for (const s of [-1, 1]) p.box(m.paint, C.dark, span(xM - 0.03, xM + 0.03), [0, G.infeed.topM - 0.05], side(s, halfIn - 0.06, halfIn));
  for (const s of [-1, 1]) p.box(m.paint, C.mid, span(inFrom, inTo), [G.infeed.topM - 0.09, G.infeed.topM + 0.02], side(s, halfIn, halfIn + 0.03));
  p.box(m.paint, C.black, span(inFrom, inTo), [G.infeed.topM - 0.04, G.infeed.topM], span(-halfIn, halfIn));
  p.box(m.paint, C.dark, span(inTo, inTo + 0.03), [G.infeed.topM, G.infeed.topM + 0.08], span(-halfIn, halfIn));
  // The place's roller deck: side frames on legs and rollers across the line (not cut: like rollers shade alike).
  const [placeFrom, placeTo] = G.place.xM;
  const halfPlace = G.place.widthM / 2;
  for (const s of [-1, 1]) {
    p.box(m.paint, C.dark, span(placeFrom, placeTo), [G.rollerTopM - 0.1, G.rollerTopM - 0.02], side(s, halfPlace, halfPlace + 0.05));
    for (const xM of [placeFrom + 0.05, placeTo - 0.05]) p.box(m.paint, C.dark, span(xM - 0.03, xM + 0.03), [0, G.rollerTopM - 0.1], side(s, halfPlace, halfPlace + 0.05));
  }
  for (let xM = placeFrom + 0.06; xM <= placeTo - 0.05; xM += 0.125) {
    p.add(m.paint, C.steel, new THREE.CylinderGeometry(0.04, 0.04, G.place.widthM, 10).rotateX(Math.PI / 2).translate(xM, G.rollerTopM - 0.04, 0));
  }
  // The dispenser behind the place: a base frame and four corner guides round its stack of empty pallets.
  const dz = G.dispenser.zM;
  p.box(m.paint, C.dark, span(-0.7, 0.7), [0, 0.06], [dz - 0.6, dz + 0.6]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const [gx, gz] = [sx * G.dispenser.guideXM, dz + sz * G.dispenser.guideZM];
      p.box(m.paint, C.casing, span(gx - 0.04, gx + 0.04), [0, G.dispenser.heightM], span(gz - 0.04, gz + 0.04));
    }
    p.box(m.paint, C.mid, span(sx * G.dispenser.guideXM - 0.04, sx * G.dispenser.guideXM + 0.04), [G.dispenser.heightM - 0.08, G.dispenser.heightM], [dz - G.dispenser.guideZM, dz + G.dispenser.guideZM]);
  }

  // The bridge: a beam across, z ±1.0, riding on wheels on the rails, with its drive motor.
  const bridge = new HeroParts();
  bridge.box(m.paint, C.mid, span(-0.09, 0.09), [-0.05, 0.05], span(-1.0, 1.0));
  for (const s of [-1, 1]) bridge.box(m.paint, C.dark, span(-0.12, 0.12), [-0.05, 0.02], side(s, G.postsZM - 0.07, G.postsZM + 0.07));
  bridge.box(m.paint, C.motor, span(0.09, 0.25), [-0.03, 0.12], [G.postsZM - 0.2, G.postsZM - 0.02]);
  // The trolley: a carriage round the bridge, its lift's guide bush through it.
  const trolley = new HeroParts();
  trolley.box(m.paint, C.motor, span(-0.18, 0.18), [-0.13, 0.13], span(-0.17, 0.17));
  trolley.box(m.paint, C.dark, span(-0.07, 0.07), [-0.2, -0.13], span(-0.07, 0.07));
  // The lift: the mast up through the trolley, and the vacuum head at its foot, its pads underneath.
  const lift = new HeroParts();
  const { head } = G;
  lift.box(m.paint, C.steel, span(-0.04, 0.04), [head.padsM + head.plateM, G.mastM], span(-0.04, 0.04));
  lift.box(m.paint, C.dark, span(-head.xM / 2, head.xM / 2), [head.padsM, head.padsM + head.plateM], span(-head.zM / 2, head.zM / 2));
  for (const px of [-0.09, 0.09]) for (const pz of [-0.15, 0, 0.15]) lift.cylinder(m.paint, C.black, 'y', [px, head.padsM / 2, pz], 0.035, head.padsM, 10);

  const { nodes } = HERO_SPECS.yogurtPalletizer;
  const at = (name) => nodes.find((each) => each.name === name).atM;
  const bridgeNode = node(bridge, 'bridge', at('bridge'));
  const trolleyNode = node(trolley, 'trolley', at('trolley'));
  bridgeNode.add(trolleyNode);
  trolleyNode.add(node(lift, 'lift', at('lift')));
  return group('yogurt_palletizer', [...p.meshes('body'), bridgeNode]);
}

/** Each model's builder, by its key in HERO_SPECS. */
export const HERO_BUILDERS = {
  separator: buildSeparator,
  homogenizer: buildHomogenizer,
  asepticFiller: buildAsepticFiller,
  palletizer: buildPalletizer,
  stretchWrapper: buildStretchWrapper,
  p8Filler: buildP8Filler,
  fermentTank: buildFermentTank,
  yogurtPalletizer: buildYogurtPalletizer,
};

/** All of them as { 'separator.glb': bytes, ... }: built, AO baked, written and compressed. */
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
