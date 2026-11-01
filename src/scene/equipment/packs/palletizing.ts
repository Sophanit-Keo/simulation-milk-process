// The palletizer at work (phase 12, D22): the arm picks a tray off the end of the tray line, swings it to the
// pallet and sets it down on its place in the stack, layer by layer. Like the belts, the arm is a sample: the
// stack shows the sim's own count (Snapshot.packs, palletTrays), and the arm lays a tray on the next free place
// about every 6.2 motion seconds. No three.js scene here, only the numbers and the stack's geometry, so the
// cycle runs and is tested headless.
//
// The stack is 7 layers of 12 trays, 3 along the rollers (x) by 4 across (z), each 0.40 × 0.25 m in plan, which
// fills the 1.2 × 1.0 m pallet exactly; the layers stand straight on each other (a column stack). The trays are
// drawn at that real size, not at the belt tokens' twice-real size, so 12 fit a layer as on the real pallet.
//
// The arm's joints are the hero model's nodes (assets/hero-specs.md, Palletizer): `arm` turns on the column,
// `arm_lift` slides down from the boom (and, since phase 12, out along it, so the gripper reaches each tray's
// place: from 1.9 to 3.0 m from the column), `arm_wrist` turns the gripper so the tray stays square to the
// pallet, and the clamps close on the tray's sides.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PointM } from '../../layout';
import type { InstanceM, SizeM } from './builder';
import { ARM_HINGE_Y_M, BELT_M, PALLETIZER_M, PALLET_ROLLER_TOP_M, PICK_M, PLACE_M, type FloorPointM } from './layout';

/* the pallet and its stack */

/** A pallet: 1.2 m along the rollers (x) by 1.0 m across, 0.14 m tall, standing on the rollers. */
export const PALLET_M = { widthM: 1.2, heightM: 0.14, depthM: 1.0 } as const;
/** The top of an empty pallet's deck on the rollers. */
export const DECK_TOP_M = PALLET_ROLLER_TOP_M + PALLET_M.heightM;

/** 84 trays a pallet (traysPerPallet): 7 layers of 12, 3 along x by 4 along z. */
export const STACK_LAYERS = 7;
export const STACK_COLUMNS = 3;
export const STACK_ROWS = 4;
export const TRAYS_PER_LAYER = STACK_COLUMNS * STACK_ROWS;
export const STACK_CAPACITY = STACK_LAYERS * TRAYS_PER_LAYER;
/** A tray's place in the stack: 0.40 × 0.14 × 0.25 m (x, y, z). */
export const STACK_PITCH_M = { xM: PALLET_M.widthM / STACK_COLUMNS, yM: 0.14, zM: PALLET_M.depthM / STACK_ROWS } as const;
/** A tray as drawn: its place less a centimetre or so, so the seams between the trays show. */
export const STACK_TRAY_SIZE_M: SizeM = [0.39, 0.135, 0.24];
/** A full stack's height on the deck. */
export const LOAD_HEIGHT_M = STACK_LAYERS * STACK_PITCH_M.yM;

/**
 * The centre of tray `slot` (0 = the bottom layer's back left), from the centre of the deck's top, into `out`.
 * Each layer fills row by row from the back (-z) toward the camera, each row from -x to +x.
 */
export function stackSlotOffsetM(slot: number, out: THREE.Vector3): THREE.Vector3 {
  const layer = Math.floor(slot / TRAYS_PER_LAYER);
  const inLayer = slot - layer * TRAYS_PER_LAYER;
  const row = Math.floor(inLayer / STACK_COLUMNS);
  const column = inLayer - row * STACK_COLUMNS;
  return out.set(
    (column - (STACK_COLUMNS - 1) / 2) * STACK_PITCH_M.xM,
    layer * STACK_PITCH_M.yM + STACK_TRAY_SIZE_M[1] / 2,
    (row - (STACK_ROWS - 1) / 2) * STACK_PITCH_M.zM,
  );
}

const _offset = new THREE.Vector3();

/** The world centre of tray `slot` on the pallet under the place point. */
export function stackSlotM(slot: number): PointM {
  stackSlotOffsetM(slot, _offset);
  return [PLACE_M[0] + _offset.x, DECK_TOP_M + _offset.y, PLACE_M[1] + _offset.z];
}

/** Every place of the stack, for FixtureBuilder.instanced(): world metres, the trays square to the pallet. */
export function stackInstances(): InstanceM[] {
  return Array.from({ length: STACK_CAPACITY }, (_, slot): InstanceM => ({ atM: stackSlotM(slot), sizeM: STACK_TRAY_SIZE_M }));
}

/**
 * A full stack as one geometry, from the centre of the deck's top: the load of a closed pallet on its way to
 * quarantine (palletTraffic.ts), so it looks like the stack it was on the palletizer. Made from `box` (a unit
 * box, the kit's), 84 copies of it; the caller owns and disposes the result.
 */
export function trayStackGeometry(box: THREE.BufferGeometry): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3(...STACK_TRAY_SIZE_M);
  const parts = Array.from({ length: STACK_CAPACITY }, (_, slot) => box.clone().applyMatrix4(matrix.compose(stackSlotOffsetM(slot, _offset), new THREE.Quaternion(), scale)));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('palletizing: could not merge the tray stack');
  return merged;
}

/* the arm */

/** The joints' rest transforms in their parents' frames (assets/hero-specs.md, Palletizer node table). */
export const ARM_LIFT_AT_M: PointM = [2.45, 0, 0];
export const ARM_WRIST_AT_M: PointM = [0, -0.63, 0];
/** `arm_clamp_1` at -z, `arm_clamp_2` at +z, from the wrist. */
export const ARM_CLAMP_AT_M: PointM = [0, -0.07, 0.225];
/** The gripper's underside, from the wrist, and the top of the boom, from the hinge. */
export const GRIPPER_BOTTOM_M = -0.12;
export const BOOM_TOP_M = 0.1;
/** The clamps' inner faces at rest (open), from the wrist's centre line. */
export const CLAMP_FACE_M = 0.165;
/** How far each clamp moves in to grip a tray: until it touches the tray's side. */
export const CLAMP_GRIP_M = CLAMP_FACE_M - STACK_TRAY_SIZE_M[2] / 2;
/** The tray in the gripper hangs under it, its centre this far below the wrist. */
export const CARRIED_TRAY_Y_M = GRIPPER_BOTTOM_M - STACK_TRAY_SIZE_M[1] / 2;
/**
 * The tray keeps this heading (about y, world) all the way from the belt to the pallet: its 0.40 m side along x,
 * as on the belt's last stretch and in the stack. The wrist turns against the arm to hold it.
 */
export const TRAY_YAW_RAD = 0;

/** The arm's angle (about y) and reach from the column toward a floor point. */
function aim(pointM: FloorPointM): { rad: number; reachM: number } {
  const dxM = pointM[0] - PALLETIZER_M[0];
  const dzM = pointM[1] - PALLETIZER_M[2];
  return { rad: Math.atan2(-dzM, dxM), reachM: Math.hypot(dxM, dzM) };
}

const pick = aim(PICK_M);
/** Pointing at the end of the tray line, as the arm has since phase 2. */
export const PICK_RAD = pick.rad;
export const PICK_REACH_M = pick.reachM;

/** The lift that brings the tray in the gripper to a centre height of `yM`. */
const liftForTrayM = (yM: number): number => ARM_HINGE_Y_M + ARM_WRIST_AT_M[1] + CARRIED_TRAY_Y_M - yM;
/** Down to the tray standing on the belt at the pick point. */
export const PICK_LIFT_M = liftForTrayM(BELT_M + STACK_TRAY_SIZE_M[1] / 2);

/** Where the arm points and reaches to set a tray on `slot`. The long way round, via -z, as the preview swings it. */
export function slotAim(slot: number): { rad: number; reachM: number; liftM: number } {
  const [xM, yM, zM] = stackSlotM(slot);
  const { rad, reachM } = aim([xM, zM]);
  return { rad: rad < PICK_RAD ? rad + 2 * Math.PI : rad, reachM, liftM: liftForTrayM(yM) };
}

/** How far out the lift ever stands: the stack's far corner, about 2.95 m (the nearest place is about 1.9 m out). */
export const MAX_REACH_M = Math.max(PICK_REACH_M, ...Array.from({ length: TRAYS_PER_LAYER }, (_, slot) => slotAim(slot).reachM));

/** The arm's steps (phase-12 card): idle is parked over the pick point, gripper up, clamps open. */
export type ArmPhase = 'idle' | 'toPick' | 'pick' | 'toPlace' | 'place';
type ArmStep = Exclude<ArmPhase, 'idle'>;

/** Each step's length in motion seconds (motion.ts): one pick and place in 6.2. */
export const ARM_STEP_S: Readonly<Record<ArmStep, number>> = { toPick: 1.6, pick: 1.4, toPlace: 1.8, place: 1.4 };
/** Within the pick: down to the tray, the clamps close, then up. */
const PICK_DOWN_S = 0.5;
const PICK_GRIP_S = 0.3;
/** Within the place: down onto its place, the clamps open, then up. */
const PLACE_DOWN_S = 0.6;
const PLACE_RELEASE_S = 0.3;

const NEXT: Readonly<Record<ArmStep, ArmStep>> = { toPick: 'pick', pick: 'toPlace', toPlace: 'place', place: 'toPick' };

/** The arm's joints now: what the palletizer writes into its nodes. */
export interface ArmPose {
  /** `arm.rotation.y`. */
  armRad: number;
  /** `arm_lift.position.x`: how far out along the boom the lift stands. */
  reachM: number;
  /** How far `arm_lift` is down from the boom (`position.y = -liftM`). */
  liftM: number;
  /** `arm_wrist.rotation.y`: -armRad + TRAY_YAW_RAD, so the tray stays square to the pallet. */
  wristRad: number;
  /** How far each clamp has moved in from rest. */
  clampM: number;
}

export interface Palletizing {
  /** The joints now; updated in place, never a new object. */
  readonly pose: Readonly<ArmPose>;
  phase(): ArmPhase;
  /** True while a tray is in the gripper: from the clamps closing on it to their opening over its place. */
  carrying(): boolean;
  /** The place the tray in the gripper goes to; -1 while the gripper is empty. */
  targetSlot(): number;
  /** Trays on the pallet: the sim's count, and for a moment one more when the arm sets a tray down before the sim counts it. */
  traysShown(): number;
  /** Layers begun. */
  layers(): number;
  /** A place the sim has counted while its tray is still in the gripper: drawn empty until the tray is set down. -1 for none. */
  heldSlot(): number;
  /**
   * One frame: `dtS` motion seconds (0 while paused: nothing moves), whether a packer lane packs, and the trays on
   * the pallet being built (the sim's). The arm picks only while a lane packs; idle, it finishes its move and parks.
   */
  update(dtS: number, packing: boolean, simTrays: number): void;
}

/** 0 → 1 with no jump in speed or acceleration at either end (smootherstep). */
export function ease(k: number): number {
  const x = Math.min(Math.max(k, 0), 1);
  return x * x * x * (x * (6 * x - 15) + 10);
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A frame never steps the arm through more than this many moves, however long it was. */
const MAX_STEPS_A_FRAME = 8;

export function createPalletizing(): Palletizing {
  const pose: ArmPose = { armRad: PICK_RAD, reachM: PICK_REACH_M, liftM: 0, wristRad: TRAY_YAW_RAD - PICK_RAD, clampM: 0 };
  let phase: ArmPhase = 'idle';
  let stepS = 0;
  /** Where the current swing started. */
  let fromRad = PICK_RAD;
  let fromReachM = PICK_REACH_M;
  /** The place the tray goes to, and how the arm stands over it. */
  let target = -1;
  let targetRad = PICK_RAD;
  let targetReachM = PICK_REACH_M;
  let targetLiftM = 0;
  let carrying = false;
  let simTrays = 0;
  /** Trays the arm has set down: the stack shows at least these until the pallet closes. */
  let laid = 0;

  const shown = (): number => Math.min(STACK_CAPACITY, Math.max(simTrays, laid));

  function aimAt(slot: number): void {
    target = slot;
    const at = slotAim(slot);
    targetRad = at.rad;
    targetReachM = at.reachM;
    targetLiftM = at.liftM;
  }

  /** Writes the pose for the step and the time into it. */
  function writePose(): void {
    pose.liftM = 0;
    switch (phase) {
      case 'idle':
        pose.armRad = PICK_RAD;
        pose.reachM = PICK_REACH_M;
        pose.clampM = 0;
        break;
      case 'toPick': {
        const k = ease(stepS / ARM_STEP_S.toPick);
        pose.armRad = lerp(fromRad, PICK_RAD, k);
        pose.reachM = lerp(fromReachM, PICK_REACH_M, k);
        pose.clampM = 0;
        break;
      }
      case 'pick': {
        pose.armRad = PICK_RAD;
        pose.reachM = PICK_REACH_M;
        const upS = stepS - PICK_DOWN_S - PICK_GRIP_S;
        pose.liftM = PICK_LIFT_M * (upS > 0 ? 1 - ease(upS / (ARM_STEP_S.pick - PICK_DOWN_S - PICK_GRIP_S)) : ease(stepS / PICK_DOWN_S));
        pose.clampM = carrying ? CLAMP_GRIP_M * ease((stepS - PICK_DOWN_S) / PICK_GRIP_S) : 0;
        break;
      }
      case 'toPlace': {
        const k = ease(stepS / ARM_STEP_S.toPlace);
        pose.armRad = lerp(fromRad, targetRad, k);
        pose.reachM = lerp(fromReachM, targetReachM, k);
        pose.clampM = CLAMP_GRIP_M;
        break;
      }
      case 'place': {
        // Over its place already, unless the place changed on the way (the pallet closed): then it moves there as it lowers.
        const k = ease(stepS / PLACE_DOWN_S);
        pose.armRad = lerp(fromRad, targetRad, k);
        pose.reachM = lerp(fromReachM, targetReachM, k);
        const upS = stepS - PLACE_DOWN_S - PLACE_RELEASE_S;
        pose.liftM = targetLiftM * (upS > 0 ? 1 - ease(upS / (ARM_STEP_S.place - PLACE_DOWN_S - PLACE_RELEASE_S)) : k);
        pose.clampM = CLAMP_GRIP_M * (1 - ease((stepS - PLACE_DOWN_S) / PLACE_RELEASE_S));
        break;
      }
    }
    pose.wristRad = TRAY_YAW_RAD - pose.armRad;
  }

  function begin(next: ArmPhase): void {
    phase = next;
    stepS = 0;
    fromRad = pose.armRad;
    fromReachM = pose.reachM;
    if (next === 'toPlace') {
      // The next free place on the pallet.
      aimAt(Math.min(shown(), STACK_CAPACITY - 1));
    } else if (next === 'place') {
      // While the arm swung over, the pallet may have closed (fewer trays than the place), or, at high speed, the
      // sim may have stacked a layer over the place: then the tray goes to the next free place now.
      const count = shown();
      if (count < target || count > target + TRAYS_PER_LAYER) aimAt(Math.min(count, STACK_CAPACITY - 1));
    }
  }

  return {
    pose,
    phase: () => phase,
    carrying: () => carrying,
    targetSlot: () => (carrying ? target : -1),
    traysShown: shown,
    layers: () => Math.ceil(shown() / TRAYS_PER_LAYER),
    heldSlot: () => (carrying && target >= 0 && target < shown() ? target : -1),
    update(dtS, packing, trays) {
      const count = Math.min(Math.max(Math.round(trays), 0), STACK_CAPACITY);
      // Fewer trays than last frame: the pallet closed and rode off, and a fresh one stands under the place point.
      if (count < simTrays) laid = 0;
      simTrays = count;
      if (!(dtS > 0)) return;
      let leftS = dtS;
      for (let i = 0; i < MAX_STEPS_A_FRAME && leftS > 0; i++) {
        if (phase === 'idle') {
          if (!packing) break;
          begin('pick');
        }
        const step = phase as ArmStep;
        const takeS = Math.min(leftS, ARM_STEP_S[step] - stepS);
        stepS += takeS;
        leftS -= takeS;
        // The clamps close on a tray only while a lane packs; with none, the gripper comes up empty.
        if (step === 'pick' && !carrying && stepS >= PICK_DOWN_S && stepS - takeS <= PICK_DOWN_S) carrying = packing;
        if (step === 'place' && carrying && stepS >= PLACE_DOWN_S + PLACE_RELEASE_S) {
          carrying = false;
          laid = Math.max(laid, target + 1); // the tray joins the stack
        }
        if (stepS < ARM_STEP_S[step]) break;
        writePose(); // the step's end pose, where the next move starts
        if (step === 'pick' && !carrying) begin('idle');
        else if (step === 'toPick' && !packing) begin('idle');
        else begin(NEXT[step]);
      }
      writePose();
    },
  };
}

/* the safety fence (Could) */

/** The fence round the cell: a low rail fence in the floor-marking yellow, with gaps where the trays come in and the pallets leave. */
export const FENCE = { xMinM: 25.0, xMaxM: 31.2, zMinM: 10.2, zMaxM: 15.8, heightM: 1.0 } as const;
const FENCE_POST_M = 0.06;
const FENCE_RAIL_M = 0.05;
const FENCE_RAIL_Y_M = [0.5, FENCE.heightM - FENCE_RAIL_M / 2] as const;
const FENCE_POST_STEP_M = 1.5;
/** The gaps: the tray rollers cross the east side, the pallet rollers the west side. */
const FENCE_GAPS: readonly { side: 'east' | 'west'; fromM: number; toM: number }[] = [
  { side: 'east', fromM: 10.6, toM: 11.8 },
  { side: 'west', fromM: 13.55, toM: 15.25 },
];

/** The fence's posts and rails, as boxes in world metres, for FixtureBuilder.part(). */
export function fenceParts(): InstanceM[] {
  const parts: InstanceM[] = [];
  const run = (fromM: number, toM: number, along: 'x' | 'z', atM: number): void => {
    const lengthM = toM - fromM;
    if (lengthM <= 0) return;
    const posts = Math.max(1, Math.ceil(lengthM / FENCE_POST_STEP_M));
    for (let i = 0; i <= posts; i++) {
      const sM = fromM + (lengthM * i) / posts;
      const atPostM: PointM = along === 'x' ? [sM, FENCE.heightM / 2, atM] : [atM, FENCE.heightM / 2, sM];
      parts.push({ atM: atPostM, sizeM: [FENCE_POST_M, FENCE.heightM, FENCE_POST_M] });
    }
    const midM = (fromM + toM) / 2;
    for (const yM of FENCE_RAIL_Y_M) {
      parts.push(
        along === 'x'
          ? { atM: [midM, yM, atM], sizeM: [lengthM, FENCE_RAIL_M, FENCE_RAIL_M] }
          : { atM: [atM, yM, midM], sizeM: [FENCE_RAIL_M, FENCE_RAIL_M, lengthM] },
      );
    }
  };
  const side = (name: 'east' | 'west', xM: number): void => {
    let fromM: number = FENCE.zMinM;
    for (const gap of FENCE_GAPS.filter((one) => one.side === name)) {
      run(fromM, gap.fromM, 'z', xM);
      fromM = gap.toM;
    }
    run(fromM, FENCE.zMaxM, 'z', xM);
  };
  run(FENCE.xMinM, FENCE.xMaxM, 'x', FENCE.zMinM);
  run(FENCE.xMinM, FENCE.xMaxM, 'x', FENCE.zMaxM);
  side('east', FENCE.xMaxM);
  side('west', FENCE.xMinM);
  return parts;
}
