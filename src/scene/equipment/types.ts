// The contract between world.ts (scene core) and the equipment modules (one per half of the line),
// so they can be built in parallel. Machines stand where the preview puts them, so the pipe routes
// in pipes.ts meet them (uht-plant-preview.html is the reference for every position).
import type { Material, Object3D, Texture } from 'three';
import type { Snapshot, StageId } from '../../contracts';
import type { PointM } from '../layout';

/** Shared, theme-aware materials. world.ts owns and re-colours them; equipment never disposes them. */
export type MaterialName =
  | 'steel' // stainless vessels and frames
  | 'steelDark' // motors, legs, gauges, conveyor frames
  | 'milk' // visible milk surfaces and level indicators
  | 'glass' // sight glasses and the filler's aseptic zone (transparent)
  | 'rubber' // belts, hoses, seals
  | 'concrete' // plinths and kerbs
  | 'wood' // pallets
  | 'carton' // packs and trays
  | 'rack' // warehouse racking
  | 'paint' // painted drives, pumps and frames (the preview's blue-grey)
  | 'gauge'; // gauge faces and dials

export interface EquipmentContext {
  readonly materials: Readonly<Record<MaterialName, Material>>;
  /**
   * Loads a GLB from public/models (e.g. 'kenney/conveyor-sides.glb'), base-URL aware and cached.
   * Returns a fresh clone each call. Rejects if the file is missing, so callers keep their grey box.
   */
  loadModel(path: string): Promise<Object3D>;
  /**
   * Loads an image from public/textures (e.g. 'carton.png') as a colour texture (sRGB), base-URL aware
   * and cached: every caller gets the same Texture, which the host owns, so equipment never disposes it.
   * Rejects if the file is missing, so callers keep their plain material. Optional: an older host has none.
   */
  loadTexture?(path: string): Promise<Texture>;
  /**
   * Optional: swap the hero machines' grey boxes (separator, homogenizer, fillers, palletizer) for their
   * models in public/models/hero once those load (heroes.ts). Off by default until phase 5; ?heroes turns it on.
   */
  readonly heroModels?: boolean;
}

/** One machine or fixture in the plant, tagged with its stage for picking and status. */
export interface Equipment {
  /** Unique, kebab-case, e.g. 'separator', 'filler-a'. */
  readonly id: string;
  readonly stage: StageId;
  /** Shown in the floating label, e.g. 'Separator'. */
  readonly label: string;
  /** Added to the scene by world.ts. A click on any mesh inside selects `stage`. */
  readonly object: Object3D;
  /** World position of the floating label and the status lamp, just above the machine. */
  readonly labelAnchorM: PointM;
  /** Optional: where the label stands now, for a machine that drives about (a forklift); read every frame. */
  labelAnchorNowM?(): PointM;
  /** One key value for the label, e.g. '200 bar'; '' for none. Called a few times a second. */
  labelText(snapshot: Snapshot): string;
  /** Per-frame animation from the snapshot; grey boxes may do nothing yet. */
  update(snapshot: Snapshot, realDtS: number): void;
  /**
   * Optional: what the machine shows right now, for tests and the ?debug hook (window.__scene.equipmentState),
   * e.g. { fillFrac: 0.5 } or { diverting: true, lamp: 'bad' }. Called rarely; it may build a fresh object.
   */
  debugState?(): Readonly<Record<string, number | string | boolean>>;
  /**
   * Optional: the batch a click on one of the machine's meshes picks (a block or pallet in quarantine), from
   * the mesh hit and the instance of it, or null for none. A click that picks a batch selects its stage too.
   */
  batchAt?(object: Object3D, instanceId: number | undefined): number | null;
  /** Optional: marks the batch picked last (the view bus's selectBatch), or none. */
  selectBatch?(batchId: number | null): void;
  /** Optional: a point on the batch's block, in world metres, for the ?debug hook's batchScreenPoint; null for none. */
  batchPointM?(batchId: number): PointM | null;
  /** Disposes the module's own geometries and materials (never the shared ones). */
  dispose(): void;
}

export type EquipmentFactory = (ctx: EquipmentContext) => Equipment[];
