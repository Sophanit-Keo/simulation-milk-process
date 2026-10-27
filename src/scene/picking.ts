// Clicking a machine selects its stage. A click is a press and release that barely moves, so the
// release after orbiting, panning or a pinch never selects anything; dragging or zooming instead
// tells the world that the viewer has taken the camera.
import * as THREE from 'three';
import type { StageId } from '../contracts';

/** An object a click may hit, with every mesh inside it selecting `stage`. */
export interface PickTarget {
  readonly object: THREE.Object3D;
  readonly stage: StageId;
  /** The batch a hit on one of its meshes picks, if any (a quarantine block, contracts v3). */
  batchAt?(object: THREE.Object3D, instanceId: number | undefined): number | null;
}

/** What a click picked: a stage, and a batch when it hit one. */
export interface Pick {
  stage: StageId;
  batchId: number | null;
}

/** A press that moves further than this is a drag, not a click (the preview allowed 6 px). */
const CLICK_SLOP_PX = 6;
/** Where stageScreenPoint tries a mesh: its box centre first, then points around it. */
const PROBE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 0.3, 0],
  [0, -0.3, 0],
  [0.3, 0, 0],
  [-0.3, 0, 0],
  [0, 0, 0.3],
  [0, 0, -0.3],
];
/** Probes this close to the view's edge are skipped, so a click there can't land on the border. */
const EDGE_NDC = 0.96;

export interface Picker {
  /** The stage whose machine is under a client-pixel point, or null. */
  stageAt(clientX: number, clientY: number): StageId | null;
  /** The stage, and the batch if a quarantine block is hit, under a client-pixel point; null for nothing. */
  pickAt(clientX: number, clientY: number): Pick | null;
  /** Client pixels of a point on one of the stage's machines that a click would pick, or null if none shows. */
  stageScreenPoint(stage: StageId): { x: number; y: number } | null;
  /** Client pixels of `pointM`, or a point beside it, where a click would pick `batchId`; null if none does. */
  batchScreenPoint(pointM: readonly [number, number, number], batchId: number): { x: number; y: number } | null;
  /** Once per frame: updates the hover cursor if the pointer moved. */
  update(): void;
  dispose(): void;
}

export interface PickerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  targets: readonly PickTarget[];
  /** A click landed on a machine; batchId is the batch when it landed on a quarantine block, else null. */
  onPick(stage: StageId, batchId: number | null): void;
  /** The viewer started to orbit, pan or zoom. */
  onTakeCamera(): void;
}

export function createPicker({ canvas, camera, targets, onPick, onTakeCamera }: PickerOptions): Picker {
  const targetOf = new Map<THREE.Object3D, PickTarget>(targets.map((target) => [target.object, target]));
  const roots = targets.map(({ object }) => object);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /** The target owning an object, or null if it is in none or is hidden. */
  const owner = (object: THREE.Object3D): PickTarget | null => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return null; // the raycaster ignores visibility, so hidden parts must not catch clicks
      const target = targetOf.get(node);
      if (target !== undefined) return target;
    }
    return null;
  };

  const pickAtNdc = (x: number, y: number): Pick | null => {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue; // lines and points have loose hit tests
      const target = owner(hit.object);
      if (target !== null) return { stage: target.stage, batchId: target.batchAt?.(hit.object, hit.instanceId) ?? null };
    }
    return null;
  };
  const stageAtNdc = (x: number, y: number): StageId | null => pickAtNdc(x, y)?.stage ?? null;

  const toNdc = (clientX: number, clientY: number): [number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return [((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1];
  };

  const pickAt = (clientX: number, clientY: number): Pick | null => {
    const point = toNdc(clientX, clientY);
    return point ? pickAtNdc(...point) : null;
  };
  const stageAt = (clientX: number, clientY: number): StageId | null => pickAt(clientX, clientY)?.stage ?? null;

  // Press and hover state. Only the gesture's first pointer can click; a second one makes it a pinch.
  let press: { id: number; x: number; y: number; dragged: boolean } | null = null;
  const down = new Set<number>();
  let hover: { x: number; y: number } | null = null;
  let hoverDirty = false;

  const takeCamera = (): void => {
    if (!press || press.dragged) return;
    press.dragged = true;
    onTakeCamera();
  };
  const onPointerDown = (event: PointerEvent): void => {
    // The primary pointer starts every gesture (a mouse press always is one), so a release that went
    // missing can't leave a stale pointer behind that turns every later click into a pinch.
    if (event.isPrimary) {
      down.clear();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
      if (event.button !== 0) takeCamera(); // a right or middle drag pans or orbits
    }
    down.add(event.pointerId);
    if (down.size > 1) takeCamera();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (press) {
      if (event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) {
        takeCamera();
      }
      return;
    }
    hover = { x: event.clientX, y: event.clientY };
    hoverDirty = true;
  };
  const endPress = (event: PointerEvent, click: boolean): void => {
    down.delete(event.pointerId);
    if (!press || event.pointerId !== press.id) return;
    const clicked = click && !press.dragged;
    press = null;
    hover = { x: event.clientX, y: event.clientY };
    hoverDirty = true;
    if (!clicked) return;
    const pick = pickAt(event.clientX, event.clientY);
    if (pick) onPick(pick.stage, pick.batchId);
  };
  const onPointerUp = (event: PointerEvent): void => endPress(event, true);
  const onPointerCancel = (event: PointerEvent): void => endPress(event, false);
  const onPointerLeave = (): void => {
    hover = null;
    hoverDirty = true;
  };
  const onWheel = (): void => {
    onTakeCamera();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: true });

  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  const probe = new THREE.Vector3();

  return {
    stageAt,
    pickAt,
    stageScreenPoint(stage) {
      const rect = canvas.getBoundingClientRect();
      // Normally a no-op (the last render did it); it matters only for a call before the first frame.
      camera.updateMatrixWorld();
      for (const target of targets) {
        if (target.stage !== stage) continue;
        target.object.updateWorldMatrix(true, true);
        const meshes: THREE.Mesh[] = [];
        target.object.traverseVisible((node) => {
          if (node instanceof THREE.Mesh) meshes.push(node);
        });
        for (const mesh of meshes) {
          box.setFromObject(mesh);
          if (box.isEmpty()) continue;
          box.getCenter(centre);
          box.getSize(size);
          for (const [fx, fy, fz] of PROBE_OFFSETS) {
            probe.set(centre.x + fx * size.x, centre.y + fy * size.y, centre.z + fz * size.z).project(camera);
            if (Math.abs(probe.x) > EDGE_NDC || Math.abs(probe.y) > EDGE_NDC || probe.z > 1) continue;
            if (stageAtNdc(probe.x, probe.y) !== stage) continue;
            const x = rect.left + ((probe.x + 1) / 2) * rect.width;
            const y = rect.top + ((1 - probe.y) / 2) * rect.height;
            // Something on top of the canvas (a panel, or a label that catches the pointer) would take the click.
            if (document.elementFromPoint(x, y) !== canvas) continue;
            return { x, y };
          }
        }
      }
      return null;
    },
    batchScreenPoint([xM, yM, zM], batchId) {
      const rect = canvas.getBoundingClientRect();
      camera.updateMatrixWorld();
      for (const [fx, fy, fz] of PROBE_OFFSETS) {
        probe.set(xM + fx, yM + fy, zM + fz).project(camera);
        if (Math.abs(probe.x) > EDGE_NDC || Math.abs(probe.y) > EDGE_NDC || probe.z > 1) continue;
        if (pickAtNdc(probe.x, probe.y)?.batchId !== batchId) continue;
        const x = rect.left + ((probe.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - probe.y) / 2) * rect.height;
        if (document.elementFromPoint(x, y) !== canvas) continue;
        return { x, y };
      }
      return null;
    },
    update() {
      if (!hoverDirty) return;
      hoverDirty = false;
      const over = hover !== null && stageAt(hover.x, hover.y) !== null;
      canvas.style.cursor = over ? 'pointer' : '';
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.style.cursor = '';
    },
  };
}
