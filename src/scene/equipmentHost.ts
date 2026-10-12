// Builds every equipment module into the scene (phase 2 skeleton). The scene core extends this
// with theme-aware materials, picking, labels and status lamps.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Snapshot } from '../contracts';
import { EQUIPMENT_FACTORIES, type Equipment, type EquipmentContext, type MaterialName } from './equipment';

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
};

export interface EquipmentHost {
  readonly equipment: readonly Equipment[];
  readonly materials: Readonly<Record<MaterialName, THREE.MeshStandardMaterial>>;
  update(snapshot: Snapshot, realDtS: number): void;
  dispose(): void;
}

export function createEquipmentHost(scene: THREE.Scene): EquipmentHost {
  const materials = Object.fromEntries(
    Object.entries(MATERIAL_SETTINGS).map(([name, settings]) => [name, new THREE.MeshStandardMaterial(settings)]),
  ) as Record<MaterialName, THREE.MeshStandardMaterial>;

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
  const equipment = EQUIPMENT_FACTORIES.flatMap((make) => make(ctx));
  for (const item of equipment) scene.add(item.object);

  return {
    equipment,
    materials,
    update(snapshot, realDtS) {
      for (const item of equipment) item.update(snapshot, realDtS);
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
