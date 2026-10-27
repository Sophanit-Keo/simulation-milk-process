// Tests for make-heroes.mjs and the GLBs it wrote to public/models/hero/:
//   node --test assets/scripts/make-heroes.test.mjs
// Each hero replaces its grey box with no code change (assets/hero-specs.md), so each model must keep
// the grey box's size round the machine origin, stay under its label, carry every moving node the scene
// drives at its rest position with its origin on its joint, keep the moving parts in their envelope
// through their whole travel, and meet the budget. Since phase 5 the AO is baked into the vertex colours
// and the geometry is meshopt-compressed, losslessly. The committed files must be what the script
// writes, byte for byte.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { parseGlb, summarize } from './glb-stats.mjs';
import { AO, bakeAo, compress, HERO_BUILDERS, HERO_SPECS, heroGlbs, LIQUID_END_Z_M } from './make-heroes.mjs';
import { toGlb } from './make-vehicles.mjs';

const HERO_DIR = fileURLToPath(new URL('../../public/models/hero/', import.meta.url));
const MM = 0.001;
/** How far the outer size may differ from the grey box's (hero-specs.md, rule 5). */
const SIZE_TOLERANCE = 0.05;

const generated = await heroGlbs();

/** A fresh model with its world matrices up to date. */
function build(key) {
  const model = HERO_BUILDERS[key]();
  model.updateMatrixWorld(true);
  return model;
}

/** A second build of each model with its AO baked, made once: the bake takes a second or two a model. */
const bakedModels = new Map();
function baked(key) {
  if (!bakedModels.has(key)) bakedModels.set(key, bakeAo(build(key)));
  return bakedModels.get(key);
}

/** World bounds of an object and everything under it, from the vertices (a turned box would overstate them). */
const boxOf = (object) => {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
};

/** Bounds of a mesh's own geometry in its own frame (its children left out). */
function ownBox(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.clone();
}

function assertInside(box, envelope, what) {
  for (let axis = 0; axis < 3; axis++) {
    const [min, max] = [box.min.getComponent(axis), box.max.getComponent(axis)];
    assert.ok(min >= envelope.min[axis] - MM, `${what}: min ${'xyz'[axis]} ${min.toFixed(3)} below ${envelope.min[axis]}`);
    assert.ok(max <= envelope.max[axis] + MM, `${what}: max ${'xyz'[axis]} ${max.toFixed(3)} above ${envelope.max[axis]}`);
  }
}

for (const [key, spec] of Object.entries(HERO_SPECS)) {
  describe(spec.file, () => {
    const summary = summarize(parseGlb(generated[spec.file]), spec.file);

    it('matches the grey box: same outer size within 5%, inside the envelope, on the floor, under its label', () => {
      const [minX, minY, minZ] = summary.bounds.min;
      const [maxX, maxY, maxZ] = summary.bounds.max;
      const size = [maxX - minX, maxY - minY, maxZ - minZ];
      spec.boundsM.max.forEach((max, axis) => {
        const want = max - spec.boundsM.min[axis];
        assert.ok(Math.abs(size[axis] / want - 1) <= SIZE_TOLERANCE, `${'xyz'[axis]} size ${size[axis].toFixed(3)} against ${want}`);
      });
      assertInside(new THREE.Box3().set(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)), spec.envelopeM, spec.file);
      assert.ok(Math.abs(minY) < MM, `lowest point at y ${minY}`);
      assert.ok(maxY < spec.maxHeightM, `top at y ${maxY}, label above ${spec.maxHeightM}`);
    });

    it('carries every moving node the scene drives, at rest, under the parent the spec names', () => {
      const byName = new Map(summary.nodes.map((n) => [n.name, n]));
      const model = build(key);
      for (const { name, parent, atM } of spec.nodes) {
        assert.ok(byName.has(name), `${name} is in the file`);
        const object = model.getObjectByName(name);
        assert.equal(object.parent.name, parent ?? model.name, `${name}'s parent`);
        assert.deepEqual(object.position.toArray().map((v) => Math.round(v / MM)), atM.map((v) => Math.round(v / MM)), `${name} rest position`);
        assert.deepEqual(object.quaternion.toArray(), [0, 0, 0, 1], `${name} has no rotation`);
        assert.deepEqual(object.scale.toArray(), [1, 1, 1], `${name} has scale 1`);
      }
      // The scene itself has no transform, so the code's absolute values land where the spec says.
      assert.ok(model.matrix.equals(new THREE.Matrix4()), 'the scene root has no transform');
    });

    it('meets the budget and the asset rules glb-stats checks; the only warnings are the expected off-centre origin and meshopt', () => {
      assert.ok(summary.triangles.budgeted <= 30000, `${summary.triangles.budgeted} triangles`);
      assert.ok(summary.meshes.length <= 10, `${summary.meshes.length} meshes (draw calls)`);
      assert.ok(summary.materials.length <= 3, `${summary.materials.length} materials`);
      assert.equal(summary.images.length, 0);
      assert.equal(summary.animations.length, 0);
      assert.deepEqual(summary.extensionsRequired, ['EXT_meshopt_compression']);
      assert.ok(generated[spec.file].length <= 2 * 1024 * 1024, `${generated[spec.file].length} bytes, over 2 MB`);
      for (const warning of summary.warnings) assert.match(warning, /^footprint centre is at |^required extensions need loader support: EXT_meshopt_compression$/);
      const glass = summary.materials.filter((m) => m.alphaMode !== 'OPAQUE');
      assert.deepEqual(glass.map((m) => m.alphaMode), key === 'asepticFiller' ? ['BLEND'] : [], 'glass only on the filler');
    });

    it('puts a flange of about 0.24 m across at each pipe nozzle', () => {
      const model = build(key);
      const raycaster = new THREE.Raycaster();
      for (const [xM, yM, zM] of spec.nozzlesM) {
        const outwards = Math.sign(xM);
        for (const [dy, dz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
          raycaster.set(new THREE.Vector3(xM + outwards * 2, yM + dy, zM + dz), new THREE.Vector3(-outwards, 0, 0));
          const [hit] = raycaster.intersectObject(model, true);
          assert.ok(hit, `something at the nozzle (${xM}, ${yM + dy}, ${zM + dz})`);
          assert.ok(Math.abs(hit.point.x - xM) <= 0.08, `nozzle face at x ${hit.point.x.toFixed(3)}, spec ${xM}`);
          assert.ok(hit.object.name.startsWith('body'), `the nozzle is static, not on ${hit.object.name}`);
        }
      }
    });

    it('is the file committed in public/models/hero/, and a rerun writes the same bytes', async () => {
      assert.deepEqual(await compress(await toGlb(baked(key))), generated[spec.file]);
      assert.deepEqual(new Uint8Array(readFileSync(join(HERO_DIR, spec.file))), generated[spec.file], 'rerun make-heroes.mjs');
    });
  });
}

describe('the moving parts show from their stage camera', () => {
  // Stage cameras from src/scene/layout.ts (STAGE_VIEWS: focusM + cameraOffsetM), in each machine's
  // frame: world minus the machine origin from hero-specs.md. Glass does not block the view.
  const cases = [
    { key: 'separator', cameraM: [-50 + 3 + 51.5, 1.5 + 15, -14 + 21 + 14], targets: { bowl: [[0, 2.0, 0.45], [0.3, 2.1, 0.3]] } },
    {
      key: 'homogenizer',
      cameraM: [-20.5 + 1 + 20.5, 1 + 5, -14 + 9 + 14],
      targets: { piston_1: [[-0.6, 0.88, 0.95]], piston_2: [[0, 0.88, 0.95]], piston_3: [[0.6, 0.88, 0.95]] },
    },
    // Filler B (origin z -10.5, mirrored front to back), whose reel and jaws face the camera.
    { key: 'asepticFiller', mirrorZ: true, cameraM: [23 + 2 - 20, 1.4 + 12, -14 + 17 + 10.5], targets: { reel: [[-0.8, 1.5, 1.6]], jaws: [[-0.3, 2.6, 0.2]] } },
    { key: 'palletizer', cameraM: [28 + 2 - 28.3, 1 + 13, 10.5 + 16 - 13.2], targets: { arm: [[1.2, 2.45, 0]], arm_wrist: [[2.45, 1.7, 0.1]] } },
  ];
  for (const { key, mirrorZ, cameraM, targets } of cases) {
    it(`${key}: ${Object.keys(targets).join(', ')}`, () => {
      const model = build(key);
      if (mirrorZ) model.scale.z = -1;
      model.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      const camera = new THREE.Vector3(...cameraM);
      for (const [name, points] of Object.entries(targets)) {
        const part = model.getObjectByName(name);
        for (const point of points) {
          raycaster.set(camera, new THREE.Vector3(...point).sub(camera).normalize());
          const hit = raycaster.intersectObject(model, true).find((h) => !h.object.name.endsWith('_glass'));
          let owner = hit?.object;
          while (owner && owner !== part && owner !== model) owner = owner.parent;
          assert.equal(owner, part, `${name} at ${point} is hidden behind ${hit?.object.name}`);
        }
      }
    });
  }
});

describe('moving nodes sit on their joints and stay in their envelope through their travel', () => {
  it('separator: the bowl spins on its own axis, and is the only part above the frame hood that moves', () => {
    const model = build('separator');
    const bowl = model.getObjectByName('bowl');
    const own = ownBox(bowl);
    assert.ok(Math.abs((own.min.x + own.max.x) / 2) < 0.02 && Math.abs((own.min.z + own.max.z) / 2) < 0.02, 'centred on the spin axis');
    for (let i = 0; i < 8; i++) {
      bowl.rotation.y = (i / 8) * Math.PI * 2;
      assertInside(boxOf(model), HERO_SPECS.separator.envelopeM, `bowl at ${bowl.rotation.y.toFixed(2)} rad`);
    }
    // A fin, a stripe and a stub break the symmetry: turned a quarter, many of the bowl's vertices
    // land where it has none, so the turn shows. A plain round bowl would map onto itself.
    const position = bowl.geometry.getAttribute('position');
    const vertices = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
    const quarter = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const unmatched = vertices.filter((v) => {
      const turned = v.clone().applyMatrix4(quarter);
      return !vertices.some((w) => w.distanceTo(turned) < MM);
    });
    assert.ok(unmatched.length >= 50, `${unmatched.length} vertices move to an empty place`);
    assert.equal(model.children.filter((c) => c.name !== 'body_paint' && c.name !== 'body_matte').length, 1);
  });

  it('homogenizer: the pistons stroke along z, attached to crankcase and liquid end at both ends of the stroke', () => {
    const model = build('homogenizer');
    for (const strokeM of [-0.12, 0.12]) {
      for (const { name, atM } of HERO_SPECS.homogenizer.nodes) {
        const piston = model.getObjectByName(name);
        piston.position.z = atM[2] + strokeM; // what the scene writes: 0.90 + 0.12·sin(...)
        const own = ownBox(piston);
        assert.ok(Math.abs(own.min.x + own.max.x) < MM && Math.abs(own.min.y + own.max.y) < MM, `${name} on its slide axis`);
        const box = boxOf(piston);
        assert.ok(box.min.z <= 0.65, `${name} back end ${box.min.z.toFixed(3)} is in the crankcase`);
        assert.ok(box.max.z >= LIQUID_END_Z_M && box.max.z <= 1.32 + MM, `${name} front end ${box.max.z.toFixed(3)} is in the liquid end`);
      }
      assertInside(boxOf(model), HERO_SPECS.homogenizer.envelopeM, `stroke ${strokeM}`);
    }
    const xs = HERO_SPECS.homogenizer.nodes.map(({ name }) => model.getObjectByName(name).position.x);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'numbered left to right along +x');
  });

  it('filler: the reel turns on its axle, the jaws ride down 0.12 m round the tube and close without touching', () => {
    const model = build('asepticFiller');
    const reel = model.getObjectByName('reel');
    const own = ownBox(reel);
    assert.ok(Math.abs(own.min.x + own.max.x) < MM && Math.abs(own.min.y + own.max.y) < MM, 'reel centred on its axle');
    for (let i = 0; i < 8; i++) {
      reel.rotation.z = -(i / 8) * Math.PI * 2;
      assertInside(boxOf(model), HERO_SPECS.asepticFiller.envelopeM, `reel at ${reel.rotation.z.toFixed(2)} rad`);
    }
    const jaws = model.getObjectByName('jaws');
    const jawsOwn = ownBox(jaws);
    assert.ok(Math.abs(jawsOwn.min.x + jawsOwn.max.x) < MM && Math.abs(jawsOwn.min.z + jawsOwn.max.z) < MM, 'jaws centred on the tube');
    jaws.position.y = 2.6 - 0.12;
    const low = boxOf(jaws);
    assert.ok(low.min.y > 2.4, `the jaws stay in the aseptic zone at the bottom of their stroke (${low.min.y.toFixed(3)})`);
    const [jaw1, jaw2] = ['jaw_1', 'jaw_2'].map((n) => model.getObjectByName(n));
    jaw1.position.z += 0.1;
    jaw2.position.z -= 0.1;
    assert.ok(boxOf(jaw1).max.z < boxOf(jaw2).min.z, 'closed jaws leave a gap');
    // The packs leave under the outfeed hood: along the belt (y 0.86 to about 1.1, 0.85 m wide) the
    // first thing a ray meets coming in along -x is the cabinet's face, not the hood.
    const raycaster = new THREE.Raycaster();
    for (const [yM, zM] of [[0.88, 0], [1.1, 0], [0.88, 0.36], [0.88, -0.36]]) {
      raycaster.set(new THREE.Vector3(3, yM, zM), new THREE.Vector3(-1, 0, 0));
      const [hit] = raycaster.intersectObject(model, true);
      assert.ok(Math.abs(hit.point.x - 1.605) < 0.01, `outfeed open at y ${yM}, z ${zM}: hit at x ${hit.point.x.toFixed(3)}`);
    }
  });

  it('filler B, mirrored front to back, has its reel at +z and keeps its own envelope', () => {
    const model = build('asepticFiller');
    model.scale.z = -1;
    const box = boxOf(model);
    assert.ok(boxOf(model.getObjectByName('reel')).min.z > 1.2, 'reel on the +z side');
    assert.ok(Math.abs(box.max.z - 1.6) < 0.01 && box.min.z >= -1.17, `z ${box.min.z.toFixed(3)} to ${box.max.z.toFixed(3)}`);
  });

  it('palletizer: the arm swings about the column, keeps within its reach, and the sub-joints sit where phase 4 drives them', () => {
    const model = build('palletizer');
    const arm = model.getObjectByName('arm');
    const reach = (object) => {
      object.updateWorldMatrix(true, true);
      let maxM = 0;
      const v = new THREE.Vector3();
      object.traverse((o) => {
        if (!o.isMesh) return;
        const position = o.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
          maxM = Math.max(maxM, Math.hypot(v.x, v.z));
        }
      });
      return maxM;
    };
    // From the pick point (0.91 rad) to the place point (3.66 rad), the way round via -z.
    for (let i = 0; i <= 10; i++) {
      arm.rotation.y = 0.91 + (2.75 * i) / 10;
      assert.ok(reach(arm) <= 2.87, `reach ${reach(arm).toFixed(3)} at ${arm.rotation.y.toFixed(2)} rad`);
      const box = boxOf(arm);
      assert.ok(box.min.y >= 1.5 && box.max.y <= 2.57, `arm between y ${box.min.y.toFixed(2)} and ${box.max.y.toFixed(2)}`);
    }
    arm.rotation.y = 0;
    model.updateMatrixWorld(true);
    const armOwn = ownBox(arm);
    assert.ok(Math.abs(armOwn.min.z + armOwn.max.z) < MM && Math.abs(armOwn.min.y + armOwn.max.y) < MM, 'arm hinge on its centre line');
    const lift = model.getObjectByName('arm_lift');
    const liftOwn = ownBox(lift);
    assert.ok(Math.abs(liftOwn.min.x + liftOwn.max.x) < MM && Math.abs(liftOwn.min.z + liftOwn.max.z) < MM, 'arm_lift on the rod axis');
    assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(lift.matrixWorld).x - 2.45) < MM, 'gripper 2.45 m out');
    const wrist = model.getObjectByName('arm_wrist');
    const wristBox = boxOf(wrist);
    assert.ok(Math.abs(wristBox.max.y - (2.35 - 0.63)) < MM, 'arm_wrist origin at the top of the gripper');
    assert.ok(Math.abs(wristBox.min.y - (2.35 - 0.77)) < MM, 'gripper bottom as the grey box');
    // Lowering arm_lift takes the gripper down and leaves the boom where it is.
    lift.position.y = -1.2;
    assert.ok(Math.abs(boxOf(wrist).min.y - (2.35 - 0.77 - 1.2)) < MM, 'gripper lowered 1.2 m');
    const boomBox = ownBox(arm).applyMatrix4(arm.matrixWorld);
    assert.ok(Math.abs(boomBox.min.y - 2.25) < MM, 'the rod and gripper hang under arm_lift, so the boom stays put');
    lift.position.y = 0;
    const [c1, c2] = ['arm_clamp_1', 'arm_clamp_2'].map((n) => model.getObjectByName(n));
    assert.ok(boxOf(c1).max.z < boxOf(c2).min.z && boxOf(c1).min.z >= -0.225 - MM && boxOf(c2).max.z <= 0.225 + MM, 'clamps open, inside the gripper');
    c1.position.z += 0.1;
    c2.position.z -= 0.1;
    assert.ok(boxOf(c2).min.z - boxOf(c1).max.z > 0.1, 'closed clamps leave room for a tray');
  });
});

/** The vertex colours of each vertex-coloured mesh, by mesh name. */
function colours(model) {
  const out = new Map();
  model.traverse((o) => {
    if (o.isMesh && o.material.vertexColors) out.set(o.name, Array.from(o.geometry.getAttribute('color').array));
  });
  return out;
}

/** How much light the bake leaves the vertex of `meshName` nearest `pointM` among those facing `normal` (0–1). */
function aoAt(key, meshName, pointM, normal) {
  const plain = build(key).getObjectByName(meshName);
  const shaded = baked(key).getObjectByName(meshName);
  const position = plain.geometry.getAttribute('position');
  const normals = plain.geometry.getAttribute('normal');
  const want = new THREE.Vector3(...normal);
  const point = new THREE.Vector3(...pointM);
  const v = new THREE.Vector3();
  let best = -1;
  let bestM = Infinity;
  for (let i = 0; i < position.count; i++) {
    if (v.fromBufferAttribute(normals, i).dot(want) < 0.99) continue;
    const distanceM = v.fromBufferAttribute(position, i).distanceTo(point);
    if (distanceM < bestM) [best, bestM] = [i, distanceM];
  }
  assert.ok(bestM < AO_NEAR_M, `a vertex of ${meshName} within ${AO_NEAR_M} m of ${pointM} (nearest ${bestM.toFixed(3)} m)`);
  return shaded.geometry.getAttribute('color').getX(best) / plain.geometry.getAttribute('color').getX(best);
}
const AO_NEAR_M = 0.1;

describe('the baked ambient occlusion', () => {
  for (const key of Object.keys(HERO_SPECS)) {
    it(`${key}: darkens corners and contacts, by AO.strength at most, and leaves open faces nearly as they were`, () => {
      const plain = colours(build(key));
      const shaded = colours(baked(key));
      const ratios = [];
      for (const [name, before] of plain) {
        const after = shaded.get(name);
        assert.equal(after.length, before.length, name);
        for (let i = 0; i < before.length; i++) ratios.push(after[i] / before[i]);
      }
      assert.ok(Math.min(...ratios) >= 1 - AO.strength - 1e-6, `darkest ${Math.min(...ratios).toFixed(3)}`);
      assert.ok(Math.max(...ratios) <= 1 + 1e-6, `lightest ${Math.max(...ratios).toFixed(3)}`);
      const share = (test) => ratios.filter(test).length / ratios.length;
      assert.ok(share((r) => r < 0.8) > 0.05, `${(100 * share((r) => r < 0.8)).toFixed(1)}% of vertices in shade`);
      assert.ok(share((r) => r > 0.95) > 0.2, `${(100 * share((r) => r > 0.95)).toFixed(1)}% of vertices in the open`);
    });
  }

  it('shades a face where it meets another and where it meets the floor, not in the middle', () => {
    // The homogenizer's crankcase, -x side, standing on the base frame (y 0.2) and open at mid-height.
    assert.ok(aoAt('homogenizer', 'body_paint', [-1.1, 0.2, -0.4], [-1, 0, 0]) < 0.8, 'crankcase foot');
    assert.ok(aoAt('homogenizer', 'body_paint', [-1.1, 0.75, -0.4], [-1, 0, 0]) > 0.95, 'crankcase side');
    // The filler's plinth, recessed under the cabinet: in shade between the floor and the cabinet's overhang.
    assert.ok(aoAt('asepticFiller', 'body_matte', [0, 0, 1.05], [0, 0, 1]) < 0.7, 'plinth at the floor');
    assert.ok(aoAt('asepticFiller', 'body_paint', [0, 1.3, 1.1], [0, 0, 1]) > 0.95, 'cabinet door');
  });

  it('lets nothing that moves shade the static body, and nothing static shade what moves', () => {
    for (const key of Object.keys(HERO_SPECS)) {
      const whole = colours(baked(key));
      const still = build(key);
      for (const child of [...still.children]) if (!child.name.startsWith('body')) still.remove(child);
      for (const [name, body] of colours(bakeAo(still))) assert.deepEqual(whole.get(name), body, `${key} ${name}`);
      for (const { name } of HERO_SPECS[key].nodes) {
        const alone = build(key).getObjectByName(name);
        const world = alone.matrixWorld.clone();
        alone.removeFromParent();
        for (const child of [...alone.children]) alone.remove(child);
        world.decompose(alone.position, alone.quaternion, alone.scale);
        assert.deepEqual(colours(bakeAo(alone)).get(name), whole.get(name), `${key} ${name}`);
      }
    }
  });
});

/** The bytes under a typed array, to compare two arrays fast and without a diff of thousands of numbers. */
const bytesOf = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

/** The triangles of an index list, each turned to start at its lowest index: meshopt may rotate a triangle, keeping its winding. */
function triangles(indices) {
  const out = [];
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = indices.slice(k, k + 3);
    out.push(a <= b && a <= c ? [a, b, c] : b <= c ? [b, c, a] : [c, a, b]);
  }
  return out.join(' ');
}

describe('the compression', () => {
  it('is lossless: every file decodes to the nodes, vertices, triangles and baked colours the script built', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const [key, spec] of Object.entries(HERO_SPECS)) {
      const [packed, plain] = await Promise.all([io.readBinary(generated[spec.file]), io.readBinary(await toGlb(baked(key)))]).then((docs) => docs.map((d) => d.getRoot()));
      const nodes = (root) => root.listNodes().map((n) => [n.getName(), n.getTranslation(), n.getRotation(), n.getScale(), n.listChildren().map((c) => c.getName())]);
      assert.deepEqual(nodes(packed), nodes(plain), `${spec.file} nodes`);
      const [packedMeshes, plainMeshes] = [packed.listMeshes(), plain.listMeshes()];
      assert.equal(packedMeshes.length, plainMeshes.length);
      packedMeshes.forEach((mesh, m) => {
        const [p, q] = [mesh.listPrimitives()[0], plainMeshes[m].listPrimitives()[0]];
        assert.equal(p.getMaterial()?.getName(), q.getMaterial()?.getName());
        assert.deepEqual(p.listSemantics(), q.listSemantics());
        for (const semantic of q.listSemantics()) {
          assert.ok(bytesOf(p.getAttribute(semantic).getArray()).equals(bytesOf(q.getAttribute(semantic).getArray())), `${spec.file} mesh ${m} ${semantic}`);
        }
        assert.ok(triangles(p.getIndices().getArray()) === triangles(q.getIndices().getArray()), `${spec.file} mesh ${m} triangles`);
      });
    }
  });
});
