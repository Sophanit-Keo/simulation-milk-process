// Builds every equipment module into the scene and owns the materials they share. world.ts adds
// picking, labels and status lamps around the machines (equipmentLabels.ts, picking.ts).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Snapshot } from '../contracts';
import { EQUIPMENT_FACTORIES, type Equipment, type EquipmentContext, type EquipmentFactory, type MaterialName } from './equipment';
import { readSceneColor, type SceneColorVar } from './theme';

const MATERIAL_SETTINGS: Record<MaterialName, THREE.MeshStandardMaterialParameters> = {
  steel: { color: 0xb4c0c8, metalness: 0.55, roughness: 0.35 },
  steelDark: { color: 0x76858f, metalness: 0.5, roughness: 0.5 },
  milk: { color: 0xf4f1e8, roughness: 0.6 },
  glass: { color: 0xbfd9e6, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false },
  rubber: { color: 0x2b3238, roughness: 0.9 },
  concrete: { color: 0xa8b0b5, roughness: 0.95 },
  wood: { color: 0xb08a5a, roughness: 0.85 },
  carton: { color: 0xf7f7f2, roughness: 0.7 },
  rack: { color: 0xd28a2c, metalness: 0.3, roughness: 0.6 },
  paint: { color: 0x4f7896, metalness: 0.25, roughness: 0.55 },
  gauge: { color: 0xf5f5f0, roughness: 0.4 },
};

/**
 * Materials whose colour follows the theme, as in the preview's applyTheme: stainless steel is darker in
 * the dark theme so it doesn't glare against the dark floor. The rest keep one colour in both themes.
 */
const THEMED_MATERIALS: Partial<Record<MaterialName, SceneColorVar>> = {
  steel: '--steel',
  steelDark: '--steel-dark',
};

export interface EquipmentHost {
  readonly equipment: readonly Equipment[];
  readonly materials: Readonly<Record<MaterialName, THREE.MeshStandardMaterial>>;
  /** Re-reads the theme colours into the shared materials. */
  applyTheme(): void;
  update(snapshot: Snapshot, realDtS: number): void;
  dispose(): void;
}

export function createEquipmentHost(
  scene: THREE.Scene,
  factories: readonly EquipmentFactory[] = EQUIPMENT_FACTORIES,
): EquipmentHost {
  const materials = Object.fromEntries(
    Object.entries(MATERIAL_SETTINGS).map(([name, settings]) => [name, new THREE.MeshStandardMaterial(settings)]),
  ) as Record<MaterialName, THREE.MeshStandardMaterial>;

  const applyTheme = (): void => {
    for (const [name, colorVar] of Object.entries(THEMED_MATERIALS) as [MaterialName, SceneColorVar][]) {
      materials[name].color.set(readSceneColor(colorVar));
    }
  };
  applyTheme();

  // One load per file; every caller gets its own clone of the loaded scene.
  const loader = new GLTFLoader();
  const loads = new Map<string, Promise<THREE.Object3D>>();
  const loadModel = (path: string): Promise<THREE.Object3D> => {
    let load = loads.get(path);
    if (!load) {
      load = loader.loadAsync(`${import.meta.env.BASE_URL}models/${path}`).then((gltf) => gltf.scene);
      loads.set(path, load);
    }
    return load.then((model) => model.clone(true));
  };

  const ctx: EquipmentContext = { materials, loadModel };
  // A module that throws while building is reported and left out, so the rest of the plant still shows.
  const equipment = factories.flatMap((make) => {
    try {
      return make(ctx);
    } catch (error) {
      console.error('An equipment module failed to build:', error);
      return [];
    }
  });
  const ids = new Set<string>();
  for (const item of equipment) {
    // Labels, picking and the debug hook key on the id, so a repeat would make two machines one.
    if (ids.has(item.id)) console.warn(`Two machines share the equipment id "${item.id}"`);
    ids.add(item.id);
    scene.add(item.object);
  }

  // A machine whose update throws is reported once and left still, so one module's bug can't stop the frame loop.
  const failed = new Set<Equipment>();

  return {
    equipment,
    materials,
    applyTheme,
    update(snapshot, realDtS) {
      for (const item of equipment) {
        if (failed.has(item)) continue;
        try {
          item.update(snapshot, realDtS);
        } catch (error) {
          failed.add(item);
          console.error(`Equipment "${item.id}" stopped animating:`, error);
        }
      }
    },
    dispose() {
      for (const item of equipment) {
        item.dispose();
        item.object.removeFromParent();
      }
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
