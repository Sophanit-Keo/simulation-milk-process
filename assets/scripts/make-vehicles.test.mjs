// Tests for make-vehicles.mjs and the GLBs it wrote to public/models/vehicles/:
//   node --test assets/scripts/make-vehicles.test.mjs
// The scene fits each vehicle into a fixed box (src/scene/equipment/packs/vehicles.ts, fitVehicle),
// so the models must have exactly that size, face +z, stand on the floor round their footprint
// centre, and keep the node names phase 4 animates. The committed files must match the script.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseGlb, summarize } from './glb-stats.mjs';
import { buildForklift, buildTruck, FORKLIFT_SIZE_M, TRUCK_SIZE_M, vehicleGlbs } from './make-vehicles.mjs';

const VEHICLES_DIR = fileURLToPath(new URL('../../public/models/vehicles/', import.meta.url));
const MM = 0.001;

/** The parts of a summary that change when the geometry does, rounded so float noise can't fail it. */
function shape(summary) {
  const mm = (v) => Math.round(v / MM);
  return {
    sceneName: summary.sceneName,
    nodes: summary.nodes.map((n) => n.name),
    meshes: summary.meshes.map((m) => [m.triangles, m.vertices]),
    materials: summary.materials.map((m) => m.name),
    bounds: [...summary.bounds.min, ...summary.bounds.max].map(mm),
  };
}

const generated = await vehicleGlbs();

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
      assert.ok(summary.meshes.length <= 4, `${summary.meshes.length} meshes (draw calls)`);
      assert.equal(summary.images.length, 0);
      assert.deepEqual(summary.extensionsRequired, []);
    });

    it('is the file committed in public/models/vehicles/ (rerun make-vehicles.mjs if not)', () => {
      const committed = summarize(parseGlb(readFileSync(join(VEHICLES_DIR, file))), file);
      assert.deepEqual(shape(committed), shape(summary));
    });
  });
}

describe('facing and moving nodes', () => {
  const boxOf = (object) => new THREE.Box3().setFromObject(object);

  it('the truck faces +z: its windscreen is at the +z end', () => {
    const truck = buildTruck();
    truck.updateMatrixWorld(true);
    const glass = boxOf(truck.getObjectByName('body_glass'));
    assert.ok(glass.max.z > TRUCK_SIZE_M.lengthM / 2 - 0.1, `windscreen at z ${glass.max.z}`);
    assert.ok(glass.min.z > 0, 'no glass behind the cab');
  });

  it('the forklift has its forks at +z, on nodes that lift along y from the floor', () => {
    const forklift = buildForklift();
    forklift.updateMatrixWorld(true);
    const forks = forklift.getObjectByName('forks');
    const inner = forklift.getObjectByName('mast_inner');
    assert.ok(forks && inner, 'forks and mast_inner exist');
    // Both are children of the root, so lifting is position.y += liftM with nothing else to undo.
    assert.equal(forks.parent, forklift);
    assert.equal(inner.parent, forklift);
    assert.ok(Math.abs(boxOf(forks).max.z - FORKLIFT_SIZE_M.lengthM / 2) < MM, 'fork tips at the +z end');
    assert.ok(Math.abs(boxOf(forks).min.y - forks.position.y) < MM, 'the forks origin is their underside');
    assert.ok(Math.abs(boxOf(inner).min.y - inner.position.y) < MM, 'the inner mast origin is its foot');
  });
});
