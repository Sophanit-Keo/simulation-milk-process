// The packs line's building blocks: a few unit shapes, scaled per part like the preview's G table, and
// the materials. Every fixture of stages 7–10 shares them, so the module holds one copy of each.
import * as THREE from 'three';
import type { EquipmentContext, MaterialName } from '../types';

/** Unit shapes (1 m across, 1 m tall, centred), as in uht-plant-preview.html's G table. */
export type Shape = 'box' | 'cyl' | 'cylLo' | 'sphere';

/**
 * The shared materials plus two the shared set lacks: the preview's light machine panels (filler
 * cabinets, QA lab, trailer) and amber floor markings (quarantine border, truck guide lines).
 * Both keep fixed colours. The panels match the preview; the markings keep the preview's light-theme
 * hatch colour in both themes, where the preview switched it with the theme.
 */
export type PacksMaterial = MaterialName | 'panel' | 'marking';

const OWN_MATERIALS: Record<Exclude<PacksMaterial, MaterialName>, THREE.MeshStandardMaterialParameters> = {
  panel: { color: 0xe3e8ec, metalness: 0.15, roughness: 0.45 },
  // The preview's light hatch colour (its light --warn, #c88a00); the light --warn is darker since the G1 lamp-contrast fix.
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

/**
 * The token prints in public/textures (assets lane, brand-free): the 1 L carton's face, the shrink-wrapped
 * tray and the pallet's deck. The colours are baked into the images, so they are drawn on white; the
 * roughness is the plain material's (carton) or the preview's (tray, pallet).
 */
export type PrintName = 'carton' | 'tray' | 'pallet';

const PRINT_ROUGHNESS: Record<PrintName, number> = { carton: 0.7, tray: 0.85, pallet: 0.9 };

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
   * A white material printed with public/textures/<name>.png, once the host has loaded the image; one per
   * print, shared by every fixture. Rejects if the host loads no textures or the file is missing, so the
   * caller keeps its plain material. The kit disposes it with its own materials; the texture is the host's.
   */
  print(name: PrintName): Promise<THREE.Material>;
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
  const prints = new Map<PrintName, Promise<THREE.Material>>();
  const printed = new Set<THREE.Material>();
  let holders = 0;
  /** Set once the last fixture has let go: a print that arrives later is not made at all. */
  let released = false;

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
    print(name) {
      let print = prints.get(name);
      if (!print) {
        const load = ctx.loadTexture?.(`${name}.png`) ?? Promise.reject(new Error('the host loads no textures'));
        print = load.then((texture) => {
          if (released) throw new Error(`packs line: the ${name} print arrived after the line was disposed`);
          const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture, roughness: PRINT_ROUGHNESS[name] });
          material.name = `${name}-print`;
          printed.add(material);
          return material;
        });
        prints.set(name, print);
      }
      return print;
    },
    hold() {
      holders += 1;
      let held = true;
      return () => {
        if (!held) return; // a second dispose() of the same fixture must not release another's hold
        held = false;
        holders -= 1;
        if (holders > 0) return;
        released = true;
        for (const geometry of shapes.values()) geometry.dispose();
        for (const material of [...own.values(), ...printed]) material.dispose();
        shapes.clear();
        own.clear();
        printed.clear();
      };
    },
  };
}
