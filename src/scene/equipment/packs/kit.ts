// The packs line's building blocks: a few unit shapes, scaled per part like the preview's G table, and
// the materials. Every fixture of stages 7–10 shares them, so the module holds one copy of each.
import * as THREE from 'three';
import type { EquipmentContext, MaterialName } from '../types';

/** Unit shapes (1 m across, 1 m tall, centred), as in uht-plant-preview.html's G table. */
export type Shape = 'box' | 'cyl' | 'cylLo' | 'sphere';

/**
 * The shared materials plus two the shared set lacks: the preview's light machine panels (filler
 * cabinets, QA lab, trailer) and amber floor markings (quarantine border, truck guide lines).
 * Both keep fixed colours, as in the preview, which doesn't theme them either.
 */
export type PacksMaterial = MaterialName | 'panel' | 'marking';

const OWN_MATERIALS: Record<Exclude<PacksMaterial, MaterialName>, THREE.MeshStandardMaterialParameters> = {
  panel: { color: 0xe3e8ec, metalness: 0.15, roughness: 0.45 },
  // The light theme's --warn, the preview's hatch colour.
  marking: { color: 0xc88a00, roughness: 0.8 },
};

/**
 * Stand-ins for shared materials an older host may lack ('paint' and 'gauge' arrived after contracts v1),
 * with the host's own settings, so the module still builds against it.
 */
const SHARED_FALLBACKS: Partial<Record<MaterialName, THREE.MeshStandardMaterialParameters>> = {
  paint: { color: 0x4f7896, metalness: 0.25, roughness: 0.55 },
  gauge: { color: 0xf5f5f0, roughness: 0.4 },
};

function makeShape(shape: Shape): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    // The paper reels and the palletizer base are seen up close from the stage 7 and 8 cameras.
    case 'cyl':
      return new THREE.CylinderGeometry(1, 1, 1, 28);
    case 'cylLo':
      return new THREE.CylinderGeometry(1, 1, 1, 12);
    case 'sphere':
      return new THREE.SphereGeometry(1, 12, 8);
  }
}

export interface Kit {
  /** The shared unit shape; never dispose it (the kit does, after the last fixture lets go). */
  shape(shape: Shape): THREE.BufferGeometry;
  material(name: PacksMaterial): THREE.Material;
  /**
   * Each fixture holds the kit while it lives and calls the returned function from its dispose().
   * The last one to let go disposes the unit shapes and the module's own materials, never the shared ones.
   */
  hold(): () => void;
}

export function createKit(ctx: EquipmentContext): Kit {
  const shapes = new Map<Shape, THREE.BufferGeometry>();
  const own = new Map<PacksMaterial, THREE.Material>();
  const shared = ctx.materials as Readonly<Partial<Record<PacksMaterial, THREE.Material>>>;
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
        const settings = name in OWN_MATERIALS ? OWN_MATERIALS[name as keyof typeof OWN_MATERIALS] : SHARED_FALLBACKS[name as MaterialName];
        if (!settings) throw new Error(`packs line: the host has no shared '${name}' material`);
        material = new THREE.MeshStandardMaterial(settings);
        own.set(name, material);
      }
      return material;
    },
    hold() {
      holders += 1;
      let held = true;
      return () => {
        if (!held) return; // a second dispose() of the same fixture must not release another's hold
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
