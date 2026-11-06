// Stage 16 in the 3D view (phase 19, D29): the cold chain's pallets and the reefers at the north dock, drawn from the
// snapshot's coldChain. Every pallet and every reefer is boxes in one InstancedMesh, coloured per box (a wooden base, a
// load: cream, a warm cream in the warm room, frosted blue in the chiller), and the rooms' lamps are a second: the warm
// room's orange glow while it holds pallets, the chiller's frost while it chills. Two draw calls in all.
//
// The warm room shows each of its pallets, two high; the chiller and the cold room show how full they are, one box for
// each share of their positions, since the tunnel and the racks hold fewer visible places than the sim's positions.
// The pallet building at the palletizer grows with its trays; pallets waiting by the wrapper stand in a row. A reefer
// backs the last metres to its door in its last 10 minutes of arriving, and stands there while it loads.
import * as THREE from 'three';
import type { ColdChainSnapshot, Snapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import type { Kit } from '../liquid/kit';
import type { Equipment } from '../types';
import * as at from './layout';
import { yogurtOf } from './readings';

/** A yogurt pallet drawn: a 1.2 × 1.0 m base and its wrapped load, low enough for the cold room's rack levels. */
export const YOGURT_PALLET_M = { widthM: 1.2, depthM: 1.0, baseM: 0.14, loadM: 0.85 } as const;
const PALLET_TALL_M = YOGURT_PALLET_M.baseM + YOGURT_PALLET_M.loadM;

const COLORS = { base: 0x9a7a52, load: 0xf2efe6, warm: 0xf4dcb6, frost: 0xcfe3f2, trailer: 0xe9ecef, tractor: 0x4f7896, unit: 0x3c454d } as const;

/** Floor places, centres in world metres, for a grid of `cols` × `rows` pallets inside a rect's walls. */
function grid(rect: { xMinM: number; xMaxM: number; zMinM: number; zMaxM: number }, cols: number, rows: number, levels: number, levelM: number, floorM = 0): [number, number, number][] {
  const places: [number, number, number][] = [];
  const pitchX = (rect.xMaxM - rect.xMinM) / cols;
  const pitchZ = (rect.zMaxM - rect.zMinM) / rows;
  for (let level = 0; level < levels; level++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) places.push([rect.xMinM + (col + 0.5) * pitchX, floorM + level * levelM, rect.zMinM + (row + 0.5) * pitchZ]);
    }
  }
  return places;
}

/** The warm room's places: 5 × 4 on the floor, two high, 40 for its 36 positions, inside walls and doorway. */
export const WARM_PLACES = grid({ xMinM: at.WARM_ROOM.xMinM + 0.3, xMaxM: at.WARM_ROOM.xMaxM - 0.3, zMinM: at.WARM_ROOM.zMinM + 1.4, zMaxM: at.WARM_ROOM.zMaxM - 0.3 }, 5, 4, 2, PALLET_TALL_M);
/** The chiller's: four along the roller track, two high, each a share of its positions. */
export const CHILLER_PLACES = grid({ xMinM: at.BLAST_CHILLER.xMinM + 0.2, xMaxM: at.BLAST_CHILLER.xMaxM - 0.2, zMinM: (at.BLAST_CHILLER.zMinM + at.BLAST_CHILLER.zMaxM) / 2 - 0.5, zMaxM: (at.BLAST_CHILLER.zMinM + at.BLAST_CHILLER.zMaxM) / 2 + 0.5 }, 4, 1, 2, PALLET_TALL_M, 0.4);
/**
 * The cold room's: two pallets on each level of each rack bay, the racks' two rows of six bays and three levels
 * (yogurtLine.ts coldRoom), 72 for its 360 positions.
 */
export const COLD_PLACES: [number, number, number][] = (() => {
  const places: [number, number, number][] = [];
  const r = at.COLD_ROOM;
  for (const yM of [0.14, 1.24, 2.34]) {
    for (const rowZM of [r.zMinM + 1.4, r.zMaxM - 1.4]) {
      for (let i = 0; i < 6; i++) {
        const bayXM = r.xMinM + 1.2 + i * 2.6 + 1.25;
        for (const dx of [-0.6, 0.6]) places.push([bayXM + dx, yM, rowZM]);
      }
    }
  }
  return places;
})();
/** Pallets waiting by the wrapper, in a row along the line toward the rooms. */
const STAGING_PLACES: [number, number, number][] = Array.from({ length: 6 }, (_, i) => [at.WRAPPER.xM + 2 + i * 1.4, 0, at.LINE_Z_M]);
/** The pallet the palletizer builds, on its pallet place. */
const FORMING_AT: [number, number, number] = [at.PALLETIZER.xM, 0.3, at.PALLETIZER.zM + 0.9];

/** A docked reefer: its trailer's tail at the dock leveller, the trailer and its tractor reaching north. */
export const REEFER_M = { trailerM: 13.6, widthM: 2.5, heightM: 2.6, tractorM: 3.6, unitM: 0.9, tailZM: at.COLD_ROOM.zMinM - 1.2, backInM: 8 } as const;

/** How many of `places` a room `held` of `capacity` fills: every pallet, or its share where the places are fewer. */
export function shownPallets(held: number, capacity: number | undefined, places: number): number {
  if (!(held > 0)) return 0;
  if (capacity === undefined || capacity <= places) return Math.min(held, places);
  return Math.min(places, Math.max(1, Math.round((held / capacity) * places)));
}

/** How far a reefer stands north of its door: it backs the last metres in its last 10 minutes of arriving. */
export function reeferOffsetM(state: 'arriving' | 'loading', untilS: number, timeS: number): number {
  if (state === 'loading') return 0;
  return REEFER_M.backInM * Math.min(1, Math.max(0, (untilS - timeS) / 600));
}

const coldChainOf = (snapshot: Snapshot): ColdChainSnapshot | undefined => yogurtOf(snapshot)?.coldChain;

export function coldChainTokens(kit: Kit): Equipment {
  const root = new THREE.Group();
  root.name = 'yogurt-pallets';
  // Tokens, not a machine: they stand in the rooms and on the yard (tests skip them as a machine).
  root.userData = { equipmentId: 'yogurt-pallets', stage: 16, tokens: true };
  const palletSlots = WARM_PLACES.length + CHILLER_PLACES.length + COLD_PLACES.length + STAGING_PLACES.length + 1;
  const reeferSlots = plantJson.yogurt.coldChain.dockDoors;
  const capacity = palletSlots * 2 + reeferSlots * 3;
  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
  const boxes = new THREE.InstancedMesh(kit.shape('box'), boxMaterial, capacity);
  boxes.name = 'coldChainBoxes';
  // The instances stand all over the wing and its yard; a sphere round both bounds them.
  const centre = new THREE.Vector3((at.TRAY_PACKER.xM + at.COLD_ROOM.xMaxM) / 2, 2, (at.LINE_Z_M + at.COLD_ROOM.zMinM - 20) / 2);
  boxes.boundingSphere = new THREE.Sphere(centre, 32);
  // The rooms' lamps: unlit, so they read as light in both themes.
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const glows = new THREE.InstancedMesh(kit.shape('box'), glowMaterial, 2);
  glows.name = 'roomGlows';
  glows.boundingSphere = new THREE.Sphere(centre, 32);
  const noPick = (): void => {};
  boxes.raycast = noPick;
  glows.raycast = noPick;
  root.add(boxes, glows);
  const release = kit.hold();

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const colorOf = Object.fromEntries(Object.entries(COLORS).map(([key, hex]) => [key, new THREE.Color(hex)])) as Record<keyof typeof COLORS, THREE.Color>;
  // The glows: the warm room's strip along its south wall's top, the chiller's along its roof's underside.
  const glowAt = [
    { xM: (at.WARM_ROOM.xMinM + at.WARM_ROOM.xMaxM) / 2, yM: at.WARM_ROOM.wallM - 0.15, zM: at.WARM_ROOM.zMaxM - 0.15, sizeM: [at.WARM_ROOM.xMaxM - at.WARM_ROOM.xMinM - 0.6, 0.12, 0.08], hex: 0xff9a3c },
    { xM: (at.BLAST_CHILLER.xMinM + at.BLAST_CHILLER.xMaxM) / 2, yM: at.BLAST_CHILLER.heightM - 0.25, zM: (at.BLAST_CHILLER.zMinM + at.BLAST_CHILLER.zMaxM) / 2, sizeM: [at.BLAST_CHILLER.xMaxM - at.BLAST_CHILLER.xMinM - 0.4, 0.06, 1.6], hex: 0x9fd4ff },
  ] as const;

  let shownKey = '';
  const state = { warm: 0, chiller: 0, cold: 0, staging: 0, forming: 0, reefers: 0, warmGlow: false, frostGlow: false };

  function place(snapshot: Snapshot): void {
    const chain = coldChainOf(snapshot);
    const pallets = chain?.pallets ?? [];
    const count = (where: string): number => pallets.reduce((n, pallet) => n + (pallet.place === where ? 1 : 0), 0);
    const warm = chain ? shownPallets(chain.warmRoom.pallets, chain.warmRoom.capacity, WARM_PLACES.length) : 0;
    const chilling = chain ? shownPallets(chain.chiller.pallets, chain.chiller.capacity, CHILLER_PLACES.length) : 0;
    const cold = chain ? shownPallets(chain.coldRoom.positionsUsed, chain.coldRoom.capacity, COLD_PLACES.length) : 0;
    const staging = Math.min(count('staging'), STAGING_PLACES.length);
    const formingFrac = chain?.trays ? chain.trays.openTrays / plantJson.yogurt.coldChain.traysPerPallet : 0;
    const reefers = (chain?.reefers ?? []).map((reefer) => ({ door: reefer.door, offsetM: reeferOffsetM(reefer.state, reefer.untilS, snapshot.timeS) }));
    const key = `${warm}|${chilling}|${cold}|${staging}|${formingFrac.toFixed(3)}|${reefers.map((r) => `${r.door}:${r.offsetM.toFixed(2)}`).join(',')}`;
    if (key === shownKey) return;
    shownKey = key;
    let n = 0;
    const put = (xM: number, yM: number, zM: number, sx: number, sy: number, sz: number, tint: THREE.Color): void => {
      matrix.compose(position.set(xM, yM + sy / 2, zM), quaternion, scale.set(sx, sy, sz));
      boxes.setMatrixAt(n, matrix);
      boxes.setColorAt(n, tint);
      n += 1;
    };
    const pallet = ([xM, yM, zM]: readonly [number, number, number], tint: THREE.Color, loadFrac = 1): void => {
      const { widthM, depthM, baseM, loadM } = YOGURT_PALLET_M;
      put(xM, yM, zM, widthM, baseM, depthM, colorOf.base);
      if (loadFrac > 0) put(xM, yM + baseM, zM, widthM - 0.08, loadM * loadFrac, depthM - 0.06, tint);
    };
    WARM_PLACES.slice(0, warm).forEach((at_) => pallet(at_, colorOf.warm));
    CHILLER_PLACES.slice(0, chilling).forEach((at_) => pallet(at_, colorOf.frost));
    COLD_PLACES.slice(0, cold).forEach((at_) => pallet(at_, colorOf.load));
    STAGING_PLACES.slice(0, staging).forEach((at_) => pallet(at_, colorOf.load));
    if (formingFrac > 0) pallet(FORMING_AT, colorOf.load, formingFrac);
    for (const reefer of reefers) {
      const doorXM = at.DOCK_DOORS_X_M[reefer.door] ?? at.DOCK_DOORS_X_M[0];
      const tailZM = REEFER_M.tailZM - reefer.offsetM;
      const { trailerM, widthM, heightM, tractorM, unitM } = REEFER_M;
      put(doorXM, 1.0, tailZM - trailerM / 2, widthM, heightM, trailerM, colorOf.trailer);
      put(doorXM, 1.0 + heightM - unitM * 1.2, tailZM - trailerM - 0.25, widthM * 0.8, unitM, 0.5, colorOf.unit);
      put(doorXM, 0.3, tailZM - trailerM - tractorM / 2 - 0.4, widthM, 2.6, tractorM, colorOf.tractor);
    }
    boxes.count = n;
    boxes.instanceMatrix.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    // The glows: lit while the room holds pallets.
    let g = 0;
    const lit = [warm > 0, chilling > 0];
    glowAt.forEach((glow, i) => {
      if (!lit[i]) return;
      const [sx, sy, sz] = glow.sizeM;
      matrix.compose(position.set(glow.xM, glow.yM, glow.zM), quaternion, scale.set(sx, sy, sz));
      glows.setMatrixAt(g, matrix);
      glows.setColorAt(g, color.setHex(glow.hex));
      g += 1;
    });
    glows.count = g;
    glows.instanceMatrix.needsUpdate = true;
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    Object.assign(state, { warm, chiller: chilling, cold, staging, forming: formingFrac, reefers: reefers.length, warmGlow: lit[0], frostGlow: lit[1] });
  }

  return {
    id: 'yogurt-pallets',
    stage: 16,
    label: 'Reefer dock',
    object: root,
    labelAnchorM: [at.DOCK_DOORS_X_M[1], 4.6, REEFER_M.tailZM - 2],
    labelText: (snapshot) => {
      const chain = coldChainOf(snapshot);
      if (!chain) return '';
      const loading = chain.reefers?.find((reefer) => reefer.state === 'loading');
      return loading ? `reefer ${loading.id} ${loading.pallets}/${loading.load}` : `${chain.reefersShipped} shipped`;
    },
    update: (snapshot) => place(snapshot),
    debugState: () => ({ ...state }),
    dispose() {
      root.removeFromParent();
      boxMaterial.dispose();
      glowMaterial.dispose();
      boxes.dispose();
      glows.dispose();
      release();
    },
  };
}
