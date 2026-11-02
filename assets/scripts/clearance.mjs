// Geometry checks the model tests share (make-vehicles.test.mjs, make-heroes.test.mjs): the triangles of a
// model as it stands, whether moving parts touch still ones, and how close a part comes to a vertical axis.
// Exact for the flat faces the models are made of, a little cautious for their cylinders.

import * as THREE from 'three';

/** Every triangle of the meshes under `objects`, in the model's frame as they stand now. */
export function trianglesOf(...objects) {
  const out = [];
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    object.traverse((o) => {
      if (!o.isMesh) return;
      const position = o.geometry.getAttribute('position');
      const index = o.geometry.getIndex();
      const corner = (k) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(o.matrixWorld);
      for (let k = 0; k < (index ? index.count : position.count); k += 3) out.push(new THREE.Triangle(corner(k), corner(k + 1), corner(k + 2)));
    });
  }
  return out;
}

/**
 * The triangles moved by `matrix`, e.g. into the frame of parts that stand turned (the stretch wrapper's mast),
 * where their faces line up with the axes again and the boxes round them are the faces themselves.
 */
export const inFrame = (triangles, matrix) => triangles.map((t) => new THREE.Triangle(t.a.clone().applyMatrix4(matrix), t.b.clone().applyMatrix4(matrix), t.c.clone().applyMatrix4(matrix)));

/** The box round each triangle: for a box's face, the face itself. */
export const boxesOf = (triangles) => triangles.map((t) => new THREE.Box3().setFromPoints([t.a, t.b, t.c]));

/**
 * How many triangles of `moving` touch or cross a box of `stillBoxes` (boxesOf the still part's triangles).
 * Zero means the moving part never meets the still one.
 */
export function contacts(moving, stillBoxes) {
  let count = 0;
  const box = new THREE.Box3();
  for (const triangle of moving) {
    box.setFromPoints([triangle.a, triangle.b, triangle.c]);
    for (const still of stillBoxes) if (box.intersectsBox(still) && still.intersectsTriangle(triangle)) count++;
  }
  return count;
}

/**
 * The shortest distance, seen from above (x, z), from the point (x, z) to triangle `t`: 0 if the point is
 * under or over it, else the distance to its nearest edge. A face's middle counts, not just its corners.
 */
export function planDistance(x, z, t) {
  const p = [[t.a.x, t.a.z], [t.b.x, t.b.z], [t.c.x, t.c.z]];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const q = [x, z];
  const signs = [cross(p[0], p[1], q), cross(p[1], p[2], q), cross(p[2], p[0], q)];
  if (Math.abs(cross(p[0], p[1], p[2])) > 1e-12 && (signs.every((v) => v >= 0) || signs.every((v) => v <= 0))) return 0;
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const [a, b] = [p[i], p[(i + 1) % 3]];
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const lengthSq = dx * dx + dz * dz;
    const f = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq));
    best = Math.min(best, Math.hypot(x - a[0] - f * dx, z - a[1] - f * dz));
  }
  return best;
}
