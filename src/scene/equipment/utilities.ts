// Plant utilities that serve the liquid line but are no machine of it, both Could items of the plan 05 asset
// list at stage 4: the boiler house, where the preview's steam line from the steam injector ends (one box and
// a chimney, two draw calls, at the preview's position and size), and since phase 7 the CIP station that
// cleans the UHT plant, behind the flash vessel. pipes.ts draws the steam line and the CIP lines. Since phase 8
// the boiler house is live (contracts v6): its label reads the steam it raises, and its chimney's plume grows
// with the gas it burns, one more draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLEANING_FLUIDS, type CleaningFluid, type Snapshot } from '../../contracts';
import { motionDtS } from '../motion';
import { FLUID_COLOR_VAR } from '../pipes';
import { readSceneColor } from '../theme';
import { MachineBuilder } from './liquid/builder';
import { createKit, type Kit } from './liquid/kit';
import { createPuffs } from './liquid/puffs';
import { labelValue } from './liquid/readings';
import { boilerPlumeFrac } from './liquid/visuals';
import type { Equipment, EquipmentFactory } from './types';

/** The preview's 'dark' material: a building, not a machine, so it keeps one colour in both themes. */
const BUILDING_COLOR = 0x2c343b;

/** Boiler house: footprint centre and size (preview "stage 4 … boiler house"). */
const HOUSE = { atM: [-17, 1.2, -21.3], sizeM: [3.2, 2.4, 2.2] } as const;
/** Chimney at the house's back corner, rising 2.3 m from just below the roof. */
const CHIMNEY = { atM: [-16, 3.5, -21.7], radiusM: 0.22, heightM: 2.3 } as const;
const CHIMNEY_SIDES = 14;
/** The plume rises from the chimney's top (y 4.65) and drifts a little east, as the flash vessel's vapour does. */
const PLUME = { fromM: [-16, 4.75, -21.7], travelM: [0.3, 1.6, 0.1], radiusM: 0.32, count: 6, cycleS: 3.2 } as const;

/**
 * The CIP station (phase 7): a tank for each cleaning fluid in a row along x behind the flash vessel, on a skid,
 * with the supply pump in front of the lye tank and the return header across the tanks' fronts, where pipes.ts's
 * CIP_LINES start and end. Each tank wears a band of its fluid's pipe colour and a lamp on top that lights while
 * its fluid circulates.
 */
export const CIP_STATION = {
  centreM: [-9.5, 0, -21.6],
  tankXM: { water: -11.3, lye: -9.5, acid: -7.7 } as Readonly<Record<CleaningFluid, number>>,
  tankRadiusM: 0.55,
  tankBottomM: 0.3,
  tankTopM: 2.3,
  skid: { xM: [-12.1, -6.9], zM: [-22.3, -20.4], heightM: 0.15 },
  /** On the floor in front of the lye tank; the supply line leaves its front face at y 0.3. */
  pump: { atM: [-9.5, 0.2, -20.3], sizeM: [0.5, 0.4, 0.4] },
  header: { yM: 1.1, zM: -20.6, radiusM: 0.07 },
  lampRadiusM: 0.13,
} as const;
const TANK_SIDES = 24;
/** A lit lamp's glow, and the dark it shows while its fluid stands. */
const LAMP_LIT_INTENSITY = 0.9;

export const utilities: EquipmentFactory = (ctx) => [boilerHouse(createKit(ctx), ctx.materials.steelDark), cipStation(ctx.materials.steel, ctx.materials.steelDark)];

/** What circulates now: the fluid of the cleaning step under way (contracts v5), or none. */
const fluidOf = (snapshot: Snapshot): CleaningFluid | null => snapshot.liquid?.cleaning?.fluid ?? null;

function cipStation(steel: THREE.Material, dark: THREE.Material): Equipment {
  const S = CIP_STATION;
  const [cx, , cz] = S.centreM;
  const object = new THREE.Group();
  object.name = 'cip-station';
  object.position.set(cx, 0, cz);
  object.userData = { equipmentId: 'cip-station', stage: 4 };
  const local = (xM: number, zM: number): [number, number] => [xM - cx, zM - cz];

  // The tanks, the skid, the header and its stubs into the tanks: one steel mesh.
  const parts: THREE.BufferGeometry[] = [];
  const tankHeightM = S.tankTopM - S.tankBottomM;
  for (const fluid of CLEANING_FLUIDS) {
    const [x, z] = local(S.tankXM[fluid], cz);
    const tank = new THREE.CylinderGeometry(S.tankRadiusM, S.tankRadiusM, tankHeightM, TANK_SIDES);
    tank.translate(x, S.tankBottomM + tankHeightM / 2, z);
    const dome = new THREE.SphereGeometry(S.tankRadiusM, TANK_SIDES, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.35, 1);
    dome.translate(x, S.tankTopM, z);
    // From the header, in front of the tanks, back to the tank's front face (z centre + radius).
    const tankFrontZM = cz + S.tankRadiusM;
    const stub = new THREE.CylinderGeometry(S.header.radiusM, S.header.radiusM, S.header.zM - tankFrontZM, 10);
    stub.rotateX(-Math.PI / 2);
    stub.translate(x, S.header.yM, (S.header.zM + tankFrontZM) / 2 - cz);
    parts.push(tank, dome, stub);
  }
  const [skidX0, skidZ0] = local(S.skid.xM[0], S.skid.zM[0]);
  const [skidX1, skidZ1] = local(S.skid.xM[1], S.skid.zM[1]);
  const skid = new THREE.BoxGeometry(skidX1 - skidX0, S.skid.heightM, skidZ1 - skidZ0);
  skid.translate((skidX0 + skidX1) / 2, S.skid.heightM / 2, (skidZ0 + skidZ1) / 2);
  const headerLengthM = S.tankXM.acid - S.tankXM.water;
  const header = new THREE.CylinderGeometry(S.header.radiusM, S.header.radiusM, headerLengthM, 10);
  header.rotateZ(Math.PI / 2);
  header.translate((S.tankXM.water + S.tankXM.acid) / 2 - cx, S.header.yM, S.header.zM - cz);
  parts.push(skid, header);
  const bodyGeometry = mergeGeometries(parts.map((part) => part.toNonIndexed()));
  for (const part of parts) part.dispose();
  if (!bodyGeometry) throw new Error('cip-station: the tanks could not be merged');
  const body = new THREE.Mesh(bodyGeometry, steel);
  body.name = 'cip-station-tanks';

  const pumpGeometry = new THREE.BoxGeometry(...S.pump.sizeM);
  const pump = new THREE.Mesh(pumpGeometry, dark);
  pump.name = 'cip-station-pump';
  pump.position.set(S.pump.atM[0] - cx, S.pump.atM[1], S.pump.atM[2] - cz);

  // Per tank: a band of its fluid's colour near the top, and the lamp on the dome.
  const bandGeometry = new THREE.CylinderGeometry(S.tankRadiusM + 0.01, S.tankRadiusM + 0.01, 0.16, TANK_SIDES, 1, true);
  const lampGeometry = new THREE.SphereGeometry(S.lampRadiusM, 12, 8);
  const fluidMaterials: THREE.MeshStandardMaterial[] = [];
  const lamps = {} as Record<CleaningFluid, THREE.MeshStandardMaterial>;
  const extras: THREE.Mesh[] = [];
  for (const fluid of CLEANING_FLUIDS) {
    const [x, z] = local(S.tankXM[fluid], cz);
    const colour = new THREE.Color(readSceneColor(FLUID_COLOR_VAR[fluid]));
    const bandMaterial = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
    const band = new THREE.Mesh(bandGeometry, bandMaterial);
    band.name = `cip-station-band-${fluid}`;
    band.position.set(x, S.tankTopM - 0.3, z);
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x2c343b, emissive: colour, emissiveIntensity: 0, roughness: 0.4 });
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.name = `cip-station-lamp-${fluid}`;
    lamp.position.set(x, S.tankTopM + S.tankRadiusM * 0.35 + S.lampRadiusM * 0.6, z);
    lamps[fluid] = lampMaterial;
    fluidMaterials.push(bandMaterial, lampMaterial);
    extras.push(band, lamp);
  }

  for (const mesh of [body, pump, ...extras]) {
    // The bands and lamps sit on the tanks, inside their shadow: casting their own would only add draw calls.
    mesh.castShadow = mesh === body || mesh === pump;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false; // nothing in it moves; only the lamps' glow changes
    object.add(mesh);
  }

  let lit: CleaningFluid | null = null;
  const light = (fluid: CleaningFluid | null): void => {
    if (fluid === lit) return;
    lit = fluid;
    for (const each of CLEANING_FLUIDS) lamps[each].emissiveIntensity = each === fluid ? LAMP_LIT_INTENSITY : 0;
  };

  return {
    id: 'cip-station',
    stage: 4,
    label: 'CIP station',
    object,
    labelAnchorM: [cx, S.tankTopM + 0.9, cz],
    // While it cleans: the fluid, and the temperature a CIP step runs at.
    labelText(snapshot) {
      const cleaning = snapshot.liquid?.cleaning;
      if (!cleaning) return '';
      return cleaning.tempC === null ? cleaning.fluid : `${cleaning.fluid} · ${cleaning.tempC} °C`;
    },
    update(snapshot) {
      light(fluidOf(snapshot));
    },
    debugState: () => ({ lit: lit ?? 'none' }),
    dispose() {
      bodyGeometry.dispose();
      pumpGeometry.dispose();
      bandGeometry.dispose();
      lampGeometry.dispose();
      for (const material of fluidMaterials) material.dispose();
      // steel and dark are shared (equipmentHost) and disposed there.
    },
  };
}

function boilerHouse(kit: Kit, chimneyMaterial: THREE.Material): Equipment {
  // Same convention as the liquid line: the root at the footprint centre on the floor, so a model can replace it in place.
  const builder = new MachineBuilder(kit, 'boiler-house', [HOUSE.atM[0], 0, HOUSE.atM[2]]);
  // The plume: the liquid line's see-through puffs, as the flash vessel's vapour.
  const plume = createPuffs(builder, 'boiler-plume', 'steam', { ...PLUME, envelope: 'swell' });
  const built = builder.build();
  const object = built.object;
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
    // The steam it raises for the injector (contracts v6); nothing from an older snapshot.
    labelText: (snapshot) => labelValue(snapshot.liquid?.energy?.steamKgPerH, 0, 'kg/h'),
    update: (snapshot, realDtS) => plume.update(boilerPlumeFrac(snapshot), motionDtS(snapshot, realDtS)),
    debugState: () => ({ plumeFrac: plume.strength(), phase: plume.phase() }),
    dispose() {
      houseGeometry.dispose();
      houseMaterial.dispose();
      chimneyGeometry.dispose();
      // The plume's instance buffer; its shape and material are the kit's, which lets go of them with the last holder.
      built.dispose();
      // The chimney's material is shared (equipmentHost) and disposed there.
    },
  };
}
