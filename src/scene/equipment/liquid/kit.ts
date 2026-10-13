// The liquid line's building blocks: a handful of unit shapes, scaled per part like the preview's
// G table, and the materials. Every machine shares them, so the module holds one copy of each.
import * as THREE from 'three';
import type { EquipmentContext, MaterialName } from '../types';

/** Unit shapes (1 m across, 1 m tall, centred), as in uht-plant-preview.html's G table. */
export type Shape = 'box' | 'cyl' | 'cylLo' | 'cyl8' | 'coneDown' | 'coneUp' | 'dome' | 'sphere';

/**
 * The shared materials plus two the shared set lacks: the preview's blue-grey paint for drives and
 * pumps, and white gauge faces. Both keep fixed colours, as in the preview, which doesn't theme them.
 */
export type LiquidMaterial = MaterialName | 'paint' | 'gauge';

const OWN_MATERIALS: Record<Exclude<LiquidMaterial, MaterialName>, THREE.MeshStandardMaterialParameters> = {
  paint: { color: 0x4f7896, metalness: 0.25, roughness: 0.55 },
  gauge: { color: 0xf5f5f0, roughness: 0.4 },
};

function makeShape(shape: Shape): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    // Big vessels are seen up close from their stage camera; 32 sides keep them round there.
    case 'cyl':
      return new THREE.CylinderGeometry(1, 1, 1, 32);
    case 'cylLo':
      return new THREE.CylinderGeometry(1, 1, 1, 14);
    // Eight sides on purpose: the separator bowl's facets show that it spins.
    case 'cyl8':
      return new THREE.CylinderGeometry(1, 1, 1, 8);
    case 'coneDown':
      return new THREE.CylinderGeometry(1, 0.22, 1, 32);
    case 'coneUp':
      return new THREE.CylinderGeometry(0.22, 1, 1, 32);
    case 'dome':
      return new THREE.SphereGeometry(1, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'sphere':
      return new THREE.SphereGeometry(1, 16, 12);
  }
}

export interface Kit {
  /** The shared unit shape; never dispose it (the kit does, after the last machine lets go). */
  shape(shape: Shape): THREE.BufferGeometry;
  material(name: LiquidMaterial): THREE.Material;
  /**
   * Each machine holds the kit while it lives and calls the returned function from its dispose().
   * The last one to let go disposes the unit shapes and the module's own materials, never the shared ones.
   */
  hold(): () => void;
}

export function createKit(ctx: EquipmentContext): Kit {
  const shapes = new Map<Shape, THREE.BufferGeometry>();
  const own = new Map<LiquidMaterial, THREE.Material>();
  // Should scene-core add 'paint' or 'gauge' to the shared set, use it, so it follows the theme.
  const shared = ctx.materials as Readonly<Partial<Record<LiquidMaterial, THREE.Material>>>;
  let holders = 0;

  return {
    shape(shape) {
      let geometry = shapes.get(shape);
      if (!geometry) {
        geometry = makeShape(shape);
        shapes.set(shape, geometry);
      }
      return geometry;
    },
    material(name) {
      const sharedMaterial = shared[name];
      if (sharedMaterial) return sharedMaterial;
      let material = own.get(name);
      if (!material) {
        material = new THREE.MeshStandardMaterial(OWN_MATERIALS[name as keyof typeof OWN_MATERIALS]);
        own.set(name, material);
      }
      return material;
    },
    hold() {
      holders += 1;
      let held = true;
      return () => {
        if (!held) return; // a second dispose() of the same machine must not release another's hold
        held = false;
        holders -= 1;
        if (holders > 0) return;
        for (const geometry of shapes.values()) geometry.dispose();
        for (const material of own.values()) material.dispose();
        shapes.clear();
        own.clear();
      };
    },
  };
}
