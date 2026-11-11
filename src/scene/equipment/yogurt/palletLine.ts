// Stage 16's pallet line in motion (phase 24): the gantry palletizer picks each tray of 24 cups off the infeed belt
// and sets it on the pallet, 8 to a layer and 15 layers; the closed pallet rides on rollers to the stretch wrapper,
// turns there while the film is wound up and down it (the UHT wrapper's cycle, packs/stretchWrap.ts), and rides on to
// the staging row, where the cold chain's tokens take it over; a fresh pallet slides on from the dispenser.
//
// Like the UHT palletizer (packs/palletizing.ts) the gantry is a sample: the stack shows the sim's own count of the
// open pallet's trays (coldChain.trays.openTrays), and the gantry lays one on the next free place about every 3.6
// motion seconds while P8 fills, a tray every 4 s at ×1. A pallet closes when the sim's newest pallet does.
//
// The pallets, the stack, the tray in the head and the dispenser's stack are boxes drawn in the cold chain's box mesh
// (coldChainScene.ts SharedBoxes), so the line costs no draw call of its own. The numbers live here, with no scene,
// so the cycle runs and is tested headless.
import * as THREE from 'three';
import type { Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import { motionDtS } from '../../motion';
import { createWrapPose, FILM_BOTTOM_M, WRAP_CYCLE_S, wrapPoseAt, type WrapPose } from '../packs/stretchWrap';
import type { SharedBoxes } from './coldChainScene';
import * as at from './layout';
import { yogurtOf } from './readings';

/* the pallet and its stack */

/** A yogurt pallet as the cold chain draws it (coldChainScene.ts YOGURT_PALLET_M): 1.2 × 1.0 m, its load 0.85 m tall. */
export const PALLET = { widthM: 1.2, depthM: 1.0, baseM: 0.14, loadM: 0.85 } as const;
/** 8 trays a layer, 4 along the line (x) by 2 across, 15 layers: the 120 trays a pallet of plant.json. */
export const STACK = { columns: 4, rows: 2, layers: 15, pitchXM: 0.3, pitchZM: 0.5 } as const;
export const TRAYS_PER_LAYER = STACK.columns * STACK.rows;
export const STACK_CAPACITY = TRAYS_PER_LAYER * STACK.layers;
/** A layer's height: the load drawn 0.85 m tall, as downstream (the real 75 mm trays stack about 1.1 m). */
export const LAYER_M = PALLET.loadM / STACK.layers;
/** A tray as drawn: its place less a centimetre, so the seams between the trays show. */
export const TRAY_M = [0.29, LAYER_M - 0.003, 0.44] as const;
/** The deck's top on the rollers. */
export const DECK_TOP_M = at.PALLET_LINE.rollerTopM + PALLET.baseM;
/** The film on a wrapped load, from the pallet's underside to just over the load's top. */
export const FILM_TOP_M = PALLET.baseM + PALLET.loadM + 0.02;

if (STACK_CAPACITY !== plantJson.yogurt.coldChain.traysPerPallet) throw new Error('palletLine: the stack must hold coldChain.traysPerPallet trays');

/**
 * The centre of tray `slot` (0 = the first laid) from the centre of the deck's top, into `out`. Each layer fills from
 * the far end of the line (+x) back toward the infeed, the back row (−z) before the front, so the head never passes
 * low over a tray it has laid.
 */
export function slotOffsetM(slot: number, out: THREE.Vector3): THREE.Vector3 {
  const layer = Math.floor(slot / TRAYS_PER_LAYER);
  const inLayer = slot - layer * TRAYS_PER_LAYER;
  const column = STACK.columns - 1 - Math.floor(inLayer / STACK.rows);
  const row = inLayer % STACK.rows;
  return out.set((column - (STACK.columns - 1) / 2) * STACK.pitchXM, layer * LAYER_M + TRAY_M[1] / 2, (row - (STACK.rows - 1) / 2) * STACK.pitchZM);
}

/* the gantry, in its frame: origin at the centre of the pallet place on the floor (make-heroes.mjs GANTRY) */

export const GANTRY = {
  bridgeYM: 2.1,
  /** The head's underside at rest: over a full stack with a tray in the head. */
  restM: 1.55,
  pickXM: at.PALLET_LINE.pickXM - at.PALLETIZER.xM,
  bridgeRestXM: -0.6,
  /** The head's underside on a tray on the infeed belt. */
  pickM: at.PALLET_LINE.infeed.topM + TRAY_M[1],
} as const;

/** The gantry's steps, in motion seconds: one tray in 3.6. */
export const GANTRY_STEP_S = { toPick: 0.8, pickDown: 0.45, pickUp: 0.4, toPlace: 1.0, placeDown: 0.55, placeUp: 0.4 } as const;
export type GantryStep = keyof typeof GANTRY_STEP_S | 'idle';
const NEXT: Readonly<Record<keyof typeof GANTRY_STEP_S, keyof typeof GANTRY_STEP_S>> = {
  toPick: 'pickDown',
  pickDown: 'pickUp',
  pickUp: 'toPlace',
  toPlace: 'placeDown',
  placeDown: 'placeUp',
  placeUp: 'toPick',
};

export interface GantryPose {
  step: GantryStep;
  /** The bridge along x and the trolley along z, from the place's centre; the head's underside above the floor. */
  bridgeXM: number;
  trolleyZM: number;
  liftM: number;
  /** A tray hangs in the head. */
  carrying: boolean;
}

/** Smooth start and stop over a move, 0–1. */
export function ease(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const _slot = new THREE.Vector3();

/** The head's underside on tray `slot` of the stack: the tray's top. */
export const placeM = (slot: number): number => DECK_TOP_M + slotOffsetM(slot, _slot).y + TRAY_M[1] / 2;

/**
 * Where the gantry stands `tS` motion seconds into `step`, moving from `from` toward the step's target for `slot`,
 * into `out`.
 */
export function gantryPoseAt(step: GantryStep, tS: number, slot: number, from: Readonly<GantryPose>, out: GantryPose): GantryPose {
  out.step = step;
  if (step === 'idle') {
    Object.assign(out, { bridgeXM: from.bridgeXM, trolleyZM: from.trolleyZM, liftM: GANTRY.restM, carrying: false });
    return out;
  }
  const k = ease(tS / GANTRY_STEP_S[step]);
  slotOffsetM(slot, _slot);
  switch (step) {
    case 'toPick':
      return Object.assign(out, { bridgeXM: lerp(from.bridgeXM, GANTRY.pickXM, k), trolleyZM: lerp(from.trolleyZM, 0, k), liftM: GANTRY.restM, carrying: false });
    case 'pickDown':
      return Object.assign(out, { bridgeXM: GANTRY.pickXM, trolleyZM: 0, liftM: lerp(GANTRY.restM, GANTRY.pickM, k), carrying: false });
    case 'pickUp':
      return Object.assign(out, { bridgeXM: GANTRY.pickXM, trolleyZM: 0, liftM: lerp(GANTRY.pickM, GANTRY.restM, k), carrying: true });
    case 'toPlace':
      return Object.assign(out, { bridgeXM: lerp(GANTRY.pickXM, _slot.x, k), trolleyZM: lerp(0, _slot.z, k), liftM: GANTRY.restM, carrying: true });
    case 'placeDown':
      return Object.assign(out, { bridgeXM: _slot.x, trolleyZM: _slot.z, liftM: lerp(GANTRY.restM, placeM(slot), k), carrying: true });
    case 'placeUp':
      return Object.assign(out, { bridgeXM: _slot.x, trolleyZM: _slot.z, liftM: lerp(placeM(slot), GANTRY.restM, k), carrying: false });
  }
}

/* the pallets' ride */

/** Pallets ride at this speed on the rollers, in motion seconds; a fresh pallet slides on from the dispenser in this long. */
export const RIDE_MPS = 0.4;
export const SLIDE_S = 3;
/** Where a pallet stands on the turntable, and where it leaves the line for the staging row's tokens. */
export const WRAP_X_M = at.WRAPPER.xM;
export const LEAVE_X_M = at.PALLET_LINE.outfeed.xMinM + 0.75;

export type RiderPhase = 'toWrapper' | 'wrapping' | 'toStaging';

/** The closed pallet on its way from the gantry to the staging row. */
export interface Rider {
  /** The sim's pallet it is (coldChain.pallets[].id): the stackers carry it on from the staging row (phase 29). */
  id: number;
  trays: number;
  phase: RiderPhase;
  xM: number;
  /** Motion seconds into its wrap, while it wraps and after. */
  wrapS: number;
}

/** The place's pallet: on the place, or sliding on from the dispenser (0 → 1). */
export interface PlacePallet {
  slideFrac: number;
}

/* the line */

/** Box instances the line draws (SharedBoxes): the place's pallet and its stack, the tray in the head, the rider and its stack, the dispenser's stack. */
const DISPENSER_STACK = 5;
const INSTANCES = 1 + STACK_CAPACITY + 1 + 1 + STACK_CAPACITY + DISPENSER_STACK;

const COLORS = { base: 0x9a7a52, tray: 0xece6d6, trayAlt: 0xddd6c3 } as const;

export interface PalletLine extends SharedBoxes {
  /** Moves the line on, once a snapshot: the palletizer and the wrapper both call it, a second call does nothing. */
  advance(snapshot: Snapshot, realDtS: number): void;
  readonly gantry: Readonly<GantryPose>;
  /** The wrap of the pallet on the turntable now (idle without one). */
  readonly wrap: Readonly<WrapPose>;
  readonly rider: Readonly<Rider> | null;
  readonly place: Readonly<PlacePallet>;
  /** Trays shown on the place's pallet. */
  readonly stacked: number;
  /** Trays the gantry has laid, and pallets it has seen closed, since the plant was built. */
  readonly laid: number;
  readonly closed: number;
}

export function createPalletLine(): PalletLine {
  let mesh: THREE.InstancedMesh | null = null;
  let offset = 0;
  let last: Snapshot | null = null;
  // The gantry.
  let step: GantryStep = 'idle';
  let stepS = 0;
  let slot = 0;
  const from: GantryPose = { step: 'idle', bridgeXM: GANTRY.bridgeRestXM, trolleyZM: 0, liftM: GANTRY.restM, carrying: false };
  const gantry: GantryPose = { ...from };
  let laid = 0;
  // Trays the gantry laid on this pallet: the stack never shows fewer, nor more than one past the sim's count.
  let laidHere = 0;
  // The pallets.
  let newest: number | null = null;
  let closed = 0;
  let rider: Rider | null = null;
  const place: PlacePallet = { slideFrac: 1 };
  let simOpen = 0;
  let stacked = 0;
  const wrap = createWrapPose();

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const offsetM = new THREE.Vector3();

  function closePallet(yogurt: YogurtSnapshot, id: number): void {
    closed += 1;
    const trays = yogurt.coldChain.pallets?.find((pallet) => pallet.id === id)?.trays ?? Math.max(stacked, simOpen);
    // A pallet still on its way finishes its ride and wrap: at a high speed pallets close faster than one rides, and the
    // stack under the gantry simply starts again (the line is a sample, as the UHT palletizer is).
    if (!rider) rider = { id, trays: Math.min(STACK_CAPACITY, Math.max(1, trays)), phase: 'toWrapper', xM: at.PALLETIZER.xM, wrapS: -1 };
    if (place.slideFrac >= 1) place.slideFrac = 0;
    laidHere = 0;
    if (gantry.carrying) step = 'idle';
  }

  function moveRider(dtS: number): void {
    if (!rider) return;
    if (rider.phase === 'toWrapper') {
      rider.xM = Math.min(WRAP_X_M, rider.xM + RIDE_MPS * dtS);
      if (rider.xM >= WRAP_X_M) {
        rider.phase = 'wrapping';
        rider.wrapS = 0;
      }
    } else if (rider.phase === 'wrapping') {
      rider.wrapS = Math.min(WRAP_CYCLE_S, rider.wrapS + dtS);
      if (rider.wrapS >= WRAP_CYCLE_S) rider.phase = 'toStaging';
    } else {
      rider.xM += RIDE_MPS * dtS;
      if (rider.xM >= LEAVE_X_M) rider = null;
    }
  }

  function moveGantry(dtS: number, filling: boolean): void {
    let leftS = dtS;
    // A few steps at most a frame, so a slow frame at a high speed never loops long.
    for (let n = 0; n < 8 && leftS > 0; n++) {
      if (step === 'idle') {
        if (!filling || place.slideFrac < 1) return;
        Object.assign(from, gantry);
        step = 'toPick';
        stepS = 0;
      }
      const lengthS = GANTRY_STEP_S[step as keyof typeof GANTRY_STEP_S];
      const takeS = Math.min(leftS, lengthS - stepS);
      stepS += takeS;
      leftS -= takeS;
      if (stepS < lengthS - 1e-9) break;
      // The step is over: the next one starts where this one ended.
      gantryPoseAt(step, lengthS, slot, from, gantry);
      Object.assign(from, gantry);
      if (step === 'pickUp') slot = Math.min(STACK_CAPACITY - 1, Math.max(stacked, simOpen));
      if (step === 'placeDown') {
        laid += 1;
        laidHere = Math.min(STACK_CAPACITY, Math.max(laidHere, slot + 1));
      }
      step = step === 'placeUp' && !filling ? 'idle' : NEXT[step as keyof typeof GANTRY_STEP_S];
      stepS = 0;
    }
  }

  function put(i: number, xM: number, yM: number, zM: number, sx: number, sy: number, sz: number, hex: number, turnRad = 0, pivotX = 0, pivotZ = 0): void {
    if (!mesh) return;
    // Turned about the y axis through (pivotX, pivotZ): the turntable's for the pallet on it.
    turn.setFromAxisAngle(up, turnRad);
    position.set(xM - pivotX, yM, zM - pivotZ).applyQuaternion(turn).add(offsetM.set(pivotX, 0, pivotZ));
    matrix.compose(position, quaternion.copy(turn), scale.set(sx, sy, sz));
    mesh.setMatrixAt(offset + i, matrix);
    mesh.setColorAt(offset + i, color.setHex(hex));
  }
  const hide = (i: number): void => put(i, 0, -10, 0, 0, 0, 0, COLORS.base);

  /** A pallet and `trays` of its stack at (x, z), turned about the turntable when `turnRad` says. */
  function pallet(first: number, trays: number, xM: number, zM: number, turnRad = 0, pivotX = 0, pivotZ = 0): void {
    const baseY = at.PALLET_LINE.rollerTopM + PALLET.baseM / 2;
    put(first, xM, baseY, zM, PALLET.widthM, PALLET.baseM, PALLET.depthM, COLORS.base, turnRad, pivotX, pivotZ);
    for (let s = 0; s < STACK_CAPACITY; s++) {
      if (s >= trays) {
        hide(first + 1 + s);
        continue;
      }
      slotOffsetM(s, _slot);
      const layer = Math.floor(s / TRAYS_PER_LAYER);
      put(first + 1 + s, xM + _slot.x, DECK_TOP_M + _slot.y, zM + _slot.z, TRAY_M[0], TRAY_M[1], TRAY_M[2], layer % 2 === 0 ? COLORS.tray : COLORS.trayAlt, turnRad, pivotX, pivotZ);
    }
  }

  function draw(): void {
    if (!mesh) return;
    const lineZ = at.PALLETIZER.zM;
    // The place's pallet, sliding on from the dispenser behind it.
    const placeZ = lerp(at.PALLET_LINE.dispenserZM, lineZ, ease(place.slideFrac));
    pallet(0, stacked, at.PALLETIZER.xM, placeZ);
    // The tray in the head.
    const carriedIndex = 1 + STACK_CAPACITY;
    if (gantry.carrying) put(carriedIndex, at.PALLETIZER.xM + gantry.bridgeXM, gantry.liftM - TRAY_M[1] / 2, lineZ + gantry.trolleyZM, TRAY_M[0], TRAY_M[1], TRAY_M[2], COLORS.tray);
    else hide(carriedIndex);
    // The rider, turned with the turntable while it stands on it.
    const riderFirst = carriedIndex + 1;
    if (rider) pallet(riderFirst, rider.trays, rider.xM, lineZ, rider.phase === 'wrapping' || rider.phase === 'toStaging' ? (rider.phase === 'wrapping' ? wrap.turnRad : 0) : 0, WRAP_X_M, lineZ);
    else for (let i = 0; i <= STACK_CAPACITY; i++) hide(riderFirst + i);
    // The dispenser's stack of empty pallets, one fewer while one slides out.
    const stackFirst = riderFirst + 1 + STACK_CAPACITY;
    const inStack = DISPENSER_STACK - (place.slideFrac < 1 ? 1 : 0);
    for (let i = 0; i < DISPENSER_STACK; i++) {
      if (i < inStack) put(stackFirst + i, at.PALLETIZER.xM, 0.06 + PALLET.baseM * (i + 0.5), at.PALLET_LINE.dispenserZM, PALLET.widthM, PALLET.baseM - 0.004, PALLET.depthM, COLORS.base);
      else hide(stackFirst + i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    count: INSTANCES,
    bind(target, first) {
      mesh = target;
      offset = first;
      draw();
    },
    advance(snapshot, realDtS) {
      if (snapshot === last) return;
      last = snapshot;
      const yogurt = yogurtOf(snapshot);
      if (!yogurt) return;
      const chain = yogurt.coldChain;
      simOpen = Math.min(STACK_CAPACITY, chain.trays?.openTrays ?? 0);
      const id = (chain.pallets ?? []).reduce((most, each) => Math.max(most, each.id), 0);
      if (newest !== null && id > newest) closePallet(yogurt, id);
      newest = id;
      const dtS = motionDtS(snapshot, realDtS);
      if (place.slideFrac < 1) place.slideFrac = Math.min(1, place.slideFrac + dtS / SLIDE_S);
      moveRider(dtS);
      moveGantry(dtS, yogurt.p8.state === 'running');
      gantryPoseAt(step, stepS, slot, from, gantry);
      stacked = Math.min(STACK_CAPACITY, Math.max(simOpen, Math.min(laidHere, simOpen + 1)));
      wrapPoseAt(rider && rider.phase !== 'toWrapper' ? rider.wrapS : -1, wrap, FILM_TOP_M);
      draw();
    },
    get gantry() {
      return gantry;
    },
    get wrap() {
      return wrap;
    },
    get rider() {
      return rider;
    },
    get place() {
      return place;
    },
    get stacked() {
      return stacked;
    },
    get laid() {
      return laid;
    },
    get closed() {
      return closed;
    },
  };
}

/** The film shell's height on a wrapped load at `filmFrac` of the way up. */
export const filmHeightM = (filmFrac: number): number => (FILM_TOP_M - FILM_BOTTOM_M) * Math.min(1, Math.max(0, filmFrac));
