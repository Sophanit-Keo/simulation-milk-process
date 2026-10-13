// Plant utilities that serve the liquid line but are no machine of it. For now the boiler house (a Could
// item of the plan 05 asset list), where the preview's steam line from the steam injector ends; pipes.ts
// draws that line. One box and a chimney, two draw calls, at the preview's position and size.
import * as THREE from 'three';
import type { Equipment, EquipmentFactory } from './types';

/** The preview's 'dark' material: a building, not a machine, so it keeps one colour in both themes. */
const BUILDING_COLOR = 0x2c343b;

/** Boiler house: footprint centre and size (preview "stage 4 … boiler house"). */
const HOUSE = { atM: [-17, 1.2, -21.3], sizeM: [3.2, 2.4, 2.2] } as const;
/** Chimney at the house's back corner, rising 2.3 m from just below the roof. */
const CHIMNEY = { atM: [-16, 3.5, -21.7], radiusM: 0.22, heightM: 2.3 } as const;
const CHIMNEY_SIDES = 14;

export const utilities: EquipmentFactory = (ctx) => [boilerHouse(ctx.materials.steelDark)];

function boilerHouse(chimneyMaterial: THREE.Material): Equipment {
  const object = new THREE.Group();
  object.name = 'boiler-house';
  // Same convention as the liquid line: the root at the footprint centre on the floor, so a model can replace it in place.
  object.position.set(HOUSE.atM[0], 0, HOUSE.atM[2]);
  object.userData = { equipmentId: 'boiler-house', stage: 4 };

  const houseGeometry = new THREE.BoxGeometry(...HOUSE.sizeM);
  const houseMaterial = new THREE.MeshStandardMaterial({ color: BUILDING_COLOR, roughness: 0.7 });
  const house = new THREE.Mesh(houseGeometry, houseMaterial);
  house.name = 'boiler-house-shell';
  house.position.set(0, HOUSE.atM[1], 0);

  const chimneyGeometry = new THREE.CylinderGeometry(CHIMNEY.radiusM, CHIMNEY.radiusM, CHIMNEY.heightM, CHIMNEY_SIDES);
  const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
  chimney.name = 'chimney';
  chimney.position.set(CHIMNEY.atM[0] - HOUSE.atM[0], CHIMNEY.atM[1], CHIMNEY.atM[2] - HOUSE.atM[2]);

  for (const mesh of [house, chimney]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false; // neither part ever moves
    object.add(mesh);
  }

  return {
    id: 'boiler-house',
    stage: 4,
    label: 'Boiler house',
    object,
    // Over the roof's front half, clear of the chimney at the back.
    labelAnchorM: [HOUSE.atM[0] - 0.6, HOUSE.sizeM[1] + 0.35, HOUSE.atM[2] + 0.4],
    // The snapshot carries no steam values (contracts v1); the label names the building only.
    labelText: () => '',
    update() {},
    dispose() {
      houseGeometry.dispose();
      houseMaterial.dispose();
      chimneyGeometry.dispose();
      // The chimney's material is shared (equipmentHost) and disposed there.
    },
  };
}
