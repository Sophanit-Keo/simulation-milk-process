// The quarantine as R9 asks for it: a week on hold is about 2,500 pallets, too many to read one lamp a pallet,
// so each batch is one block of its pallets with one lamp, and the pallets are tinted by the batch's status
// with InstancedMesh.setColorAt (amber on hold, red blocked, green while the batch still fills). A batch keeps
// its block from its first pallet until it leaves: blocks sit on a grid of 4 rows of 12 (D1's phase 2 note
// asks for a denser grid than the preview's 28), and batch n takes place (n − 1) mod 48, so the grid fills in
// order like a ring and never shuffles. A click on a block picks its batch. A batch under investigation (a
// fault scenario, phase 5) blinks its lamp until it is judged.
import * as THREE from 'three';
import type { BatchSnapshot, BatchStatus } from '../../../contracts';
import { createLampPalette, DARK_LAMP_GLOW } from '../../lamps';
import { LAMP_COLOR_VAR, readSceneColor, type LampStatus } from '../../theme';
import { QUARANTINE, QUARANTINE_ROW_Z_M, type FloorPointM } from './layout';

/** Blocks along a row and rows: 48 places, room for the 44 a full week needs (H49) and a blocked batch or two. */
export const BLOCK_COLUMNS = 12;
export const BLOCK_ROWS = QUARANTINE_ROW_Z_M.length;
export const BLOCK_PLACES = BLOCK_COLUMNS * BLOCK_ROWS;
/** Block pitch along a row, and the block's footprint. */
export const BLOCK_PITCH_M = 1.5;
export const BLOCK_SIZE_M = { widthM: 1.2, depthM: 2.6 } as const;

/** Pallets in a block: 2 across, 4 deep and up to 8 high, 64 places, a batch at the 8,000 packs/h maximum. */
export const BLOCK_GRID = { across: 2, deep: 4, high: 8 } as const;
export const PALLETS_PER_BLOCK = BLOCK_GRID.across * BLOCK_GRID.deep * BLOCK_GRID.high;
/** One pallet and its load, drawn small: a block of 60 stands about 1.6 m tall. */
export const BLOCK_PALLET_M = { widthM: 0.52, heightM: 0.2, depthM: 0.6 } as const;
/** The pallets stand on the zone floor, just above its slab and the floor markings. */
const MARK_Y_M = 0.05;

/** Lamp colours: the light theme's --ok, --warn, --bad (plan 08), as the other lamps in the scene. The pallets' tint, in both themes. */
const STATUS_COLOR: Record<BatchStatus, number> = { filling: 0x1f8f57, hold: 0xa87400, released: 0x1f8f57, blocked: 0xc63a2b };
/** The lamp a batch's status lights; the lamps glow in the dark theme's colours there (lamps.ts). */
const STATUS_LAMP: Record<BatchStatus, LampStatus> = { filling: 'ok', hold: 'warn', released: 'ok', blocked: 'bad' };
const LIGHT_LAMP_HEX: Record<LampStatus, number> = { ok: STATUS_COLOR.filling, warn: STATUS_COLOR.hold, bad: STATUS_COLOR.blocked };
/** How far a pallet's tint goes from the carton's white toward its lamp colour: enough to read, not a wall of paint. */
const TINT_FRAC = 0.6;
/** A batch under investigation blinks its lamp: lit, then pale, each half of this many real seconds. */
export const INVESTIGATION_BLINK_S = 1;
/** The blink's off half: toward white in the light theme; in the dark theme the lamp dims to this share of its glow. */
const PALE_TO_WHITE = 0.75;
const DARK_PALE = 0.22;

/** The centre of block place `place` on the floor: rows from the back (z 4.6) forward, columns west to east. */
export function blockCentreM(place: number): FloorPointM {
  const row = Math.floor(place / BLOCK_COLUMNS) % BLOCK_ROWS;
  const column = place % BLOCK_COLUMNS;
  const spanM = BLOCK_COLUMNS * BLOCK_PITCH_M;
  const firstXM = (QUARANTINE.xMinM + QUARANTINE.xMaxM) / 2 - spanM / 2 + BLOCK_PITCH_M / 2;
  return [firstXM + column * BLOCK_PITCH_M, QUARANTINE_ROW_Z_M[row] as number];
}

/** The block place of a batch: batch ids run on without gaps, so consecutive batches take consecutive places. */
export const blockPlaceOf = (batchId: number): number => (((batchId - 1) % BLOCK_PLACES) + BLOCK_PLACES) % BLOCK_PLACES;

/** The centre of pallet `index` (0 = bottom layer, back left) of the block at `centreM`. */
export function blockPalletM(centreM: FloorPointM, index: number): [xM: number, yM: number, zM: number] {
  const { across, deep } = BLOCK_GRID;
  const perLayer = across * deep;
  const layer = Math.floor(index / perLayer);
  const inLayer = index % perLayer;
  const x = inLayer % across;
  const z = Math.floor(inLayer / across);
  const stepXM = BLOCK_SIZE_M.widthM / across;
  const stepZM = BLOCK_SIZE_M.depthM / deep;
  return [
    centreM[0] - BLOCK_SIZE_M.widthM / 2 + (x + 0.5) * stepXM,
    MARK_Y_M + (layer + 0.5) * BLOCK_PALLET_M.heightM,
    centreM[1] - BLOCK_SIZE_M.depthM / 2 + (z + 0.5) * stepZM,
  ];
}

export interface QuarantineBlocks {
  /** Pallet loads, tinted; one draw. */
  readonly pallets: THREE.InstancedMesh;
  /** One lamp a block, over it; one draw. */
  readonly lamps: THREE.InstancedMesh;
  /** A plate under the picked batch's block. */
  readonly mark: THREE.Mesh;
  /** Shows the batches; only the blocks whose batch, status or pallets changed are rewritten. */
  /** The batches in quarantine; realDtS moves the blink of those under investigation on. */
  update(batches: readonly BatchSnapshot[], realDtS?: number): void;
  /** Re-reads the theme: the lamps' colours and glow (lamps.ts) and the picked block's mark, in the accent. */
  applyTheme(): void;
  /** The batch a hit on the pallets or lamps picks. */
  batchAt(object: THREE.Object3D, instanceId: number | undefined): number | null;
  select(batchId: number | null): void;
  /** Tops of the blocks, by batch, for the moving pallets to aim at. */
  blockTopM(batchId: number): [xM: number, yM: number, zM: number];
  state(): { blocks: number; pallets: number; blocked: number; investigated: number; selected: number | null };
  dispose(): void;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _noTurn = new THREE.Quaternion();
const _color = new THREE.Color();
const _white = new THREE.Color(0xffffff);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * The blocks on the shared box and sphere and the near-white shared carton material, which the tints
 * multiply; the lamps are unlit, so each shows its colour at full strength, and the mark under a picked block
 * takes the accent (light theme's blue until applyTheme reads the theme). Both materials are the module's own and go with dispose().
 */
export function createQuarantineBlocks(boxGeometry: THREE.BufferGeometry, sphereGeometry: THREE.BufferGeometry, palletMaterial: THREE.Material): QuarantineBlocks {
  const pallets = new THREE.InstancedMesh(boxGeometry, palletMaterial, BLOCK_PLACES * PALLETS_PER_BLOCK);
  pallets.name = 'quarantine-pallets';
  pallets.castShadow = true;
  pallets.receiveShadow = true;
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lamps = new THREE.InstancedMesh(sphereGeometry, lampMaterial, BLOCK_PLACES);
  lamps.name = 'quarantine-lamps';
  const palette = createLampPalette(LIGHT_LAMP_HEX, LAMP_COLOR_VAR);
  const pale = new THREE.Color();
  const paintPale = (): void => {
    pale.copy(palette.color('warn'));
    if (palette.dark) pale.multiplyScalar(DARK_PALE);
    else pale.lerp(_white, PALE_TO_WHITE);
  };
  paintPale();
  const markMaterial = new THREE.MeshStandardMaterial({ color: 0x1767b0, roughness: 0.6 });
  const mark = new THREE.Mesh(boxGeometry, markMaterial);
  mark.name = 'quarantine-mark';
  mark.scale.set(BLOCK_SIZE_M.widthM + 0.3, 0.02, BLOCK_SIZE_M.depthM + 0.3);
  mark.visible = false;

  // Every place starts empty; the bounds cover the whole grid at full height, so culling and picking never miss a block.
  for (let i = 0; i < pallets.count; i++) pallets.setMatrixAt(i, HIDDEN);
  for (let i = 0; i < lamps.count; i++) lamps.setMatrixAt(i, HIDDEN);
  for (const mesh of [pallets, lamps]) {
    mesh.setColorAt(0, _white); // allocates instanceColor
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  const fullHeightM = MARK_Y_M + BLOCK_GRID.high * BLOCK_PALLET_M.heightM + 0.6;
  const bounds = new THREE.Box3(
    new THREE.Vector3(QUARANTINE.xMinM, 0, QUARANTINE.zMinM),
    new THREE.Vector3(QUARANTINE.xMaxM, fullHeightM, QUARANTINE.zMaxM),
  );
  for (const mesh of [pallets, lamps]) {
    mesh.boundingBox = bounds.clone();
    mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  }

  /** What each place shows now: its batch, status, pallets, and whether it is under investigation. */
  const shown: ({ batchId: number; status: BatchStatus; pallets: number; flagged: boolean } | null)[] = Array.from({ length: BLOCK_PLACES }, () => null);
  let selected: number | null = null;
  let blinkS = 0;

  function writeBlock(place: number, batch: BatchSnapshot | null): void {
    const centreM = blockCentreM(place);
    const count = batch ? Math.min(batch.pallets, PALLETS_PER_BLOCK) : 0;
    if (batch) _color.setHex(STATUS_COLOR[batch.status]).lerp(_white, 1 - TINT_FRAC);
    for (let i = 0; i < PALLETS_PER_BLOCK; i++) {
      const index = place * PALLETS_PER_BLOCK + i;
      if (i < count) {
        _position.set(...blockPalletM(centreM, i));
        // A little shorter than the layer, so the layers read as separate pallets.
        _scale.set(BLOCK_PALLET_M.widthM, BLOCK_PALLET_M.heightM * 0.92, BLOCK_PALLET_M.depthM);
        _matrix.compose(_position, _noTurn, _scale);
        pallets.setMatrixAt(index, _matrix);
        pallets.setColorAt(index, _color);
      } else {
        pallets.setMatrixAt(index, HIDDEN);
      }
    }
    if (batch) {
      const layers = Math.max(1, Math.ceil(count / (BLOCK_GRID.across * BLOCK_GRID.deep)));
      const topM = MARK_Y_M + layers * BLOCK_PALLET_M.heightM;
      _matrix.compose(_position.set(centreM[0], topM + 0.3, centreM[1]), _noTurn, _scale.setScalar(0.18));
      lamps.setMatrixAt(place, _matrix);
      lamps.setColorAt(place, palette.color(STATUS_LAMP[batch.status]));
    } else {
      lamps.setMatrixAt(place, HIDDEN);
    }
  }

  function placeMark(): void {
    const place = selected === null ? -1 : shown.findIndex((entry) => entry?.batchId === selected);
    mark.visible = place >= 0;
    if (place < 0) return;
    const [xM, zM] = blockCentreM(place);
    mark.position.set(xM, MARK_Y_M - 0.005, zM);
  }

  return {
    pallets,
    lamps,
    mark,
    update(batches, realDtS = 0) {
      const byPlace = new Map<number, BatchSnapshot>();
      // The newest batch wins a place, should more than 48 be in quarantine at once (a long incubation).
      for (const batch of batches) byPlace.set(blockPlaceOf(batch.id), batch);
      let changed = false;
      for (let place = 0; place < BLOCK_PLACES; place++) {
        const batch = byPlace.get(place) ?? null;
        const was = shown[place];
        // A batch's flags are read as a whole: older snapshots (contracts v3) have none.
        const flagged = (batch?.flags?.length ?? 0) > 0 && batch?.status !== 'blocked';
        if (batch && was && was.batchId === batch.id && was.status === batch.status && was.pallets === batch.pallets && was.flagged === flagged) continue;
        if (!batch && !was) continue;
        writeBlock(place, batch);
        shown[place] = batch && { batchId: batch.id, status: batch.status, pallets: batch.pallets, flagged };
        changed = true;
      }
      // Investigated batches blink on real time, paused or not: it is a cue to look, not the plant moving.
      blinkS = (blinkS + Math.max(0, realDtS)) % INVESTIGATION_BLINK_S;
      const lit = blinkS < INVESTIGATION_BLINK_S / 2;
      let blinking = false;
      shown.forEach((entry, place) => {
        if (!entry?.flagged) return;
        lamps.setColorAt(place, lit ? palette.color(STATUS_LAMP[entry.status]) : pale);
        blinking = true;
      });
      if (blinking && lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      if (!changed) return;
      pallets.instanceMatrix.needsUpdate = true;
      lamps.instanceMatrix.needsUpdate = true;
      if (pallets.instanceColor) pallets.instanceColor.needsUpdate = true;
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      placeMark();
    },
    applyTheme() {
      palette.applyTheme();
      paintPale();
      // Unlit, the lamps show their colour as it is; in the dark theme a little over, as the other lamps glow.
      lampMaterial.color.setScalar(palette.dark ? DARK_LAMP_GLOW : 1);
      markMaterial.color.set(readSceneColor('--accent'));
      shown.forEach((entry, place) => {
        if (entry) lamps.setColorAt(place, palette.color(STATUS_LAMP[entry.status]));
      });
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    },
    batchAt(object, instanceId) {
      if (instanceId === undefined) return null;
      const place = object === pallets ? Math.floor(instanceId / PALLETS_PER_BLOCK) : object === lamps ? instanceId : -1;
      return shown[place]?.batchId ?? null;
    },
    select(batchId) {
      selected = batchId;
      placeMark();
    },
    blockTopM(batchId) {
      const place = blockPlaceOf(batchId);
      const [xM, zM] = blockCentreM(place);
      const count = Math.min(shown[place]?.batchId === batchId ? (shown[place]?.pallets ?? 0) : 0, PALLETS_PER_BLOCK);
      return [xM, MARK_Y_M + Math.ceil(count / (BLOCK_GRID.across * BLOCK_GRID.deep)) * BLOCK_PALLET_M.heightM, zM];
    },
    state() {
      const entries = shown.filter((entry) => entry !== null);
      return {
        blocks: entries.length,
        pallets: entries.reduce((sum, entry) => sum + Math.min(entry?.pallets ?? 0, PALLETS_PER_BLOCK), 0),
        blocked: entries.filter((entry) => entry?.status === 'blocked').length,
        investigated: entries.filter((entry) => entry?.flagged).length,
        selected: mark.visible ? selected : null,
      };
    },
    dispose() {
      pallets.dispose();
      lamps.dispose();
      lampMaterial.dispose();
      markMaterial.dispose();
    },
  };
}
