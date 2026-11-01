// Phase 12, stage 8 (D22): the palletizer's pick and place and its tray stack (packs/palletizing.ts), the stretch
// wrapper's cycle and film (packs/stretchWrap.ts), and the pallets between them (packs/palletTraffic.ts), checked
// headless against the phase-12 card's exit checklist for lane A.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { HERO_MODELS } from '../../src/scene/equipment/heroes';
import * as at from '../../src/scene/equipment/packs/layout';
import {
  ARM_STEP_S,
  CLAMP_GRIP_M,
  createPalletizing,
  DECK_TOP_M,
  PICK_RAD,
  STACK_CAPACITY,
  STACK_PITCH_M,
  STACK_TRAY_SIZE_M,
  stackSlotM,
  TRAYS_PER_LAYER,
  type ArmPhase,
} from '../../src/scene/equipment/packs/palletizing';
import { POOL } from '../../src/scene/equipment/packs/palletTraffic';
import {
  CARRIAGE_AT_M,
  CARRIAGE_TOP_M,
  CARRIAGE_TRAVEL_M,
  createWrapPose,
  FILM_BOTTOM_M,
  FILM_TOP_M,
  ROLL_AT_M,
  ROLL_HEIGHT_M,
  WRAP_CYCLE_S,
  WRAP_STEPS_S,
  WRAP_TURNS,
  wrapPoseAt,
} from '../../src/scene/equipment/packs/stretchWrap';
import { packsLine } from '../../src/scene/equipment/packsLine';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment/types';
import { motionRate } from '../../src/scene/motion';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

const NAMES: readonly MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];

/** A stand-in hero: a body and the contract's moving nodes at their rest transforms (phase-12 card; assets/hero-specs.md). */
function stubHero(path: string): THREE.Object3D {
  const scene = new THREE.Group();
  const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mesh = (): THREE.Mesh => new THREE.Mesh(box, new THREE.MeshStandardMaterial());
  scene.add(mesh());
  const joint = (name: string, atM: [number, number, number], parent: THREE.Object3D): THREE.Object3D => {
    const node = new THREE.Group();
    node.name = name;
    node.position.set(...atM);
    node.add(mesh());
    parent.add(node);
    return node;
  };
  if (path === HERO_MODELS.palletizer) {
    const arm = joint('arm', [0, 2.35, 0], scene);
    const lift = joint('arm_lift', [2.45, 0, 0], arm);
    const wrist = joint('arm_wrist', [0, -0.63, 0], lift);
    joint('arm_clamp_1', [0, -0.07, -0.225], wrist);
    joint('arm_clamp_2', [0, -0.07, 0.225], wrist);
  } else if (path === HERO_MODELS.stretchWrapper) {
    joint('turntable', [0, 0.125, 0], scene);
    joint('carriage', [-1.25, 0.45, -0.9], scene);
  }
  return scene;
}

/** A host whose kit pieces and vehicles never load; with `heroes`, the stand-in heroes load. */
function makeContext(heroes = false): EquipmentContext {
  return {
    materials: Object.fromEntries(NAMES.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
    heroModels: heroes,
    loadModel: (path) =>
      heroes && (path === HERO_MODELS.palletizer || path === HERO_MODELS.stretchWrapper)
        ? Promise.resolve(stubHero(path))
        : Promise.reject(new Error(`no model ${path} in unit tests`)),
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const byId = (machines: Equipment[], id: string): Equipment => {
  const machine = machines.find((m) => m.id === id);
  if (!machine) throw new Error(`no machine ${id}`);
  return machine;
};
const named = (object: THREE.Object3D, name: string): THREE.Object3D => {
  const found = object.getObjectByName(name);
  if (!found) throw new Error(`${object.name} has no ${name}`);
  return found;
};
const state = (machine: Equipment): Readonly<Record<string, number | string | boolean>> => machine.debugState?.() ?? {};

/** The opening snapshot at ×1, with `trays` on each lane's pallet and its packers as given. */
function snapshot(trays = 0, packerState: 'running' | 'changeover' = 'running'): Snapshot {
  const s = structuredClone(createSim(plantConfig).snapshot());
  s.speed = 1;
  for (const lane of s.packs.packaging.lanes) {
    lane.palletTrays = trays;
    lane.packerState = packerState;
  }
  return s;
}

/** The same snapshot with `made` pallets closed, the last of batch 54. */
function withPallets(s: Snapshot, made: number): Snapshot {
  const next = structuredClone(s);
  next.packs.packaging.palletsMade = made;
  next.packs.packaging.lastPallet = made > 0 ? { batchId: 54, palletNo: made, atS: 0 } : null;
  return next;
}

/** One frame for the whole line, in the factory's order (the wrapper before the pallets, as in the app). */
const frame = (machines: Equipment[], s: Snapshot, realDtS: number): void => machines.forEach((machine) => machine.update(s, realDtS));

/** The pallet riding in pool place `slot`: where it stands and its turn about y. */
function rider(conveyor: Equipment, slot: number, name = 'riding-loads'): { atM: THREE.Vector3; turnRad: number; scale: THREE.Vector3 } {
  const mesh = named(conveyor.object, name) as THREE.InstancedMesh;
  conveyor.object.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(slot, matrix);
  const atM = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  matrix.premultiply(mesh.matrixWorld).decompose(atM, rotation, new THREE.Vector3());
  // decompose() calls a zero-scale (hidden) copy's scale 1: read the scale from the matrix's columns instead.
  const scale = new THREE.Vector3().setFromMatrixScale(matrix);
  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
  return { atM, turnRad: Math.atan2(-xAxis.z, xAxis.x), scale };
}

/** The same angle, whole turns apart. */
const sameTurn = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('palletizer: pick and place', () => {
  it('goes through its four steps in order, one pick and place in 6.2 motion seconds, while a packer lane packs', () => {
    const arm = createPalletizing();
    const dtS = 0.01;
    const steps: [ArmPhase, number][] = [[arm.phase(), 0]];
    for (let i = 1; i <= 2000; i++) {
      arm.update(dtS, true, 10);
      if (arm.phase() !== steps.at(-1)?.[0]) steps.push([arm.phase(), i * dtS]);
    }
    expect(steps.slice(0, 10).map(([phase]) => phase)).toEqual(['idle', 'pick', 'toPlace', 'place', 'toPick', 'pick', 'toPlace', 'place', 'toPick', 'pick']);
    // Each step as long as the card says, and the whole cycle 6.2 s.
    for (let i = 1; i < 9; i++) {
      const [phase, fromS] = steps[i] as [Exclude<ArmPhase, 'idle'>, number];
      expect((steps[i + 1] as [ArmPhase, number])[1] - fromS, phase).toBeCloseTo(ARM_STEP_S[phase], 1);
    }
    expect((steps[5] as [ArmPhase, number])[1] - (steps[1] as [ArmPhase, number])[1]).toBeCloseTo(6.2, 1);
  });

  it('stays parked over the pick point while no packer lane packs, and finishes its move and parks when they stop', () => {
    const idle = createPalletizing();
    const rest = { ...idle.pose };
    for (let i = 0; i < 500; i++) idle.update(0.02, false, 10);
    expect(idle.phase()).toBe('idle');
    expect(idle.pose).toEqual(rest);
    expect(rest).toMatchObject({ armRad: PICK_RAD, liftM: 0, clampM: 0 });

    // Stopped with a tray in the gripper: it sets the tray down, swings back and parks; it never picks again.
    const busy = createPalletizing();
    while (busy.phase() !== 'toPlace') busy.update(0.02, true, 10);
    const seen = new Set<ArmPhase>();
    let laidAt = -1;
    for (let i = 0; i < 1000; i++) {
      busy.update(0.02, false, 10);
      seen.add(busy.phase());
      if (laidAt < 0 && !busy.carrying()) laidAt = busy.traysShown();
    }
    expect([...seen]).toEqual(['toPlace', 'place', 'toPick', 'idle']);
    expect(laidAt).toBe(11); // the tray joined the stack on its place, the 11th
    expect(busy.pose).toEqual(rest);

    // Stopped on the way down to a tray: the gripper comes up empty, the clamps never close.
    const picking = createPalletizing();
    picking.update(0.2, true, 10);
    expect(picking.phase()).toBe('pick');
    for (let i = 0; i < 200; i++) {
      picking.update(0.02, false, 10);
      expect(picking.carrying()).toBe(false);
      expect(picking.pose.clampM).toBe(0);
    }
    expect(picking.phase()).toBe('idle');
  });

  it('closes the clamps only with a tray in the gripper, and holds the tray square to the pallet', () => {
    const arm = createPalletizing();
    let closed = 0;
    for (let i = 0; i < 6000; i++) {
      // Packing on and off, so the arm stops and starts at every step.
      arm.update(0.013, i % 1700 < 1200, 10 + Math.floor(i / 400));
      const { clampM, armRad, wristRad } = arm.pose;
      if (clampM > 0) expect(arm.carrying(), `frame ${i}`).toBe(true);
      if (clampM === CLAMP_GRIP_M) closed += 1;
      if (arm.phase() === 'toPlace') expect(clampM).toBe(CLAMP_GRIP_M);
      // The wrist turns against the arm: the tray keeps its heading all the way.
      expect(armRad + wristRad).toBeCloseTo(0, 9);
    }
    expect(closed).toBeGreaterThan(0);
  });

  it('lowers the tray onto its place in the stack and lifts clear of the stack to swing', () => {
    const { machines } = { machines: packsLine(makeContext()) };
    const palletizer = byId(machines, 'palletizer');
    const carried = named(palletizer.object, 'carried-tray');
    const s = snapshot(30);
    let placedAt: THREE.Vector3 | null = null;
    let lowest = Infinity;
    for (let i = 0; i < 600 && !placedAt; i++) {
      const was = state(palletizer);
      frame(machines, s, 1 / 60);
      const now = state(palletizer);
      expect(carried.visible).toBe(now.carrying);
      if (now.carrying && now.phase === 'toPlace') {
        carried.updateWorldMatrix(true, false);
        const yM = new THREE.Vector3().setFromMatrixPosition(carried.matrixWorld).y;
        lowest = Math.min(lowest, yM - STACK_TRAY_SIZE_M[1] / 2);
      }
      // The frame the clamps let go: the tray stands where its place is.
      if (was.carrying && now.phase === 'place' && (now.clampM as number) < CLAMP_GRIP_M && !placedAt) {
        carried.updateWorldMatrix(true, false);
        placedAt = new THREE.Vector3().setFromMatrixPosition(carried.matrixWorld);
        expect(was.targetSlot).toBe(30);
      }
    }
    expect(placedAt).not.toBeNull();
    const [xM, yM, zM] = stackSlotM(30);
    expect(placedAt?.x).toBeCloseTo(xM, 2);
    expect(placedAt?.y).toBeCloseTo(yM, 2);
    expect(placedAt?.z).toBeCloseTo(zM, 2);
    // Swinging, the tray's underside clears a full stack (7 layers on the deck).
    expect(lowest).toBeGreaterThan(DECK_TOP_M + 7 * STACK_PITCH_M.yM + 0.05);
  });
});

describe('palletizer: the stack', () => {
  it('shows the sim’s trays in layers of 12, and empties when the pallet closes', () => {
    const machines = packsLine(makeContext());
    const palletizer = byId(machines, 'palletizer');
    const stack = named(palletizer.object, 'stack') as THREE.InstancedMesh;
    expect(stack).toBeInstanceOf(THREE.InstancedMesh);
    expect(stack.instanceMatrix.count).toBe(STACK_CAPACITY);
    expect(stack.castShadow).toBe(true);
    // In a batch change the arm stands still, so the stack is the sim's count alone.
    for (const trays of [0, 1, 12, 13, 30, 83]) {
      palletizer.update(snapshot(trays, 'changeover'), 0.1);
      expect(state(palletizer)).toMatchObject({ traysShown: trays, layers: Math.ceil(trays / TRAYS_PER_LAYER), stackFrac: trays / 84, phase: 'idle' });
      expect(stack.count).toBe(trays);
      expect(stack.visible).toBe(trays > 0);
    }
    // Tray 30 is the seventh of the third layer: on the deck, two layers up, in the stack's plan.
    palletizer.object.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4();
    for (const slot of [0, 11, 12, 29, 82]) {
      stack.getMatrixAt(slot, matrix);
      const atM = new THREE.Vector3().setFromMatrixPosition(matrix.premultiply(stack.matrixWorld));
      const layer = Math.floor(slot / TRAYS_PER_LAYER);
      expect(atM.y - STACK_TRAY_SIZE_M[1] / 2, `slot ${slot}`).toBeCloseTo(DECK_TOP_M + layer * STACK_PITCH_M.yM, 6);
      expect(Math.abs(atM.x - at.PLACE_M[0]) + STACK_TRAY_SIZE_M[0] / 2, `slot ${slot}`).toBeLessThanOrEqual(0.6);
      expect(Math.abs(atM.z - at.PLACE_M[1]) + STACK_TRAY_SIZE_M[2] / 2, `slot ${slot}`).toBeLessThanOrEqual(0.5);
    }
    // 12 places a layer, none twice.
    const places = new Set(Array.from({ length: TRAYS_PER_LAYER }, (_, slot) => stackSlotM(slot).map((v) => v.toFixed(3)).join(',')));
    expect(places.size).toBe(TRAYS_PER_LAYER);
    // The pallet closes: the stack is gone, a fresh pallet stands under the place point.
    palletizer.update(snapshot(0, 'changeover'), 0.1);
    expect(state(palletizer)).toMatchObject({ traysShown: 0, layers: 0 });
    expect(stack.visible).toBe(false);
    expect(named(palletizer.object, 'palletizer-wood').visible).toBe(true);
  });

  it('keeps a place the sim counts empty until the tray in the gripper is set down on it', () => {
    const arm = createPalletizing();
    while (arm.phase() !== 'toPlace') arm.update(0.02, true, 10);
    expect(arm.targetSlot()).toBe(10);
    expect(arm.heldSlot()).toBe(-1); // not counted yet
    arm.update(0.02, true, 11);
    expect(arm.traysShown()).toBe(11);
    expect(arm.heldSlot()).toBe(10); // counted, still in the gripper
    while (arm.carrying()) arm.update(0.02, true, 11);
    expect(arm.heldSlot()).toBe(-1);
    expect(arm.traysShown()).toBe(11);
    // Laid before the sim counts it: the stack shows it until the sim catches up or the pallet closes.
    while (arm.phase() !== 'toPlace') arm.update(0.02, true, 11);
    while (arm.carrying()) arm.update(0.02, true, 11);
    expect(arm.traysShown()).toBe(12);
    arm.update(0.02, true, 0);
    expect(arm.traysShown()).toBe(0);
  });
});

describe('stretch wrapper', () => {
  it('runs the card’s cycle: 8 turns at about 24 rpm, the carriage up and down, the film whole by the top wraps', () => {
    const pose = createWrapPose();
    expect(wrapPoseAt(-1, pose)).toMatchObject({ phase: 'idle', turnRad: 0, carriageM: 0, filmFrac: 0, web: false });
    expect(WRAP_CYCLE_S).toBeCloseTo(21, 6);
    const topFromS = WRAP_STEPS_S.base + WRAP_STEPS_S.up;
    let lastFilm = 0;
    let lastCarriage = 0;
    let lastTurn = 0;
    for (let t = 0; t <= WRAP_CYCLE_S + 1e-9; t += 0.05) {
      wrapPoseAt(t, pose);
      // The film only grows, the turntable only turns forward.
      expect(pose.filmFrac, `${t}`).toBeGreaterThanOrEqual(lastFilm - 1e-12);
      expect(pose.turnRad, `${t}`).toBeGreaterThanOrEqual(lastTurn - 1e-12);
      if (t < WRAP_STEPS_S.base) expect(pose.carriageM).toBe(0);
      if (pose.phase === 'up') {
        // Rising with the carriage until it is whole.
        expect(pose.carriageM).toBeGreaterThanOrEqual(lastCarriage);
        if (pose.filmFrac < 1 && pose.carriageM > lastCarriage) expect(pose.filmFrac).toBeGreaterThan(lastFilm);
      }
      if (t >= topFromS) expect(pose.filmFrac, `${t}`).toBe(1);
      lastFilm = pose.filmFrac;
      lastCarriage = pose.carriageM;
      lastTurn = pose.turnRad;
    }
    // The top wraps: the carriage within its travel, where the roll still covers the load's top edge.
    expect(wrapPoseAt(topFromS, pose).carriageM).toBeCloseTo(CARRIAGE_TOP_M, 9);
    expect(CARRIAGE_TOP_M).toBeLessThanOrEqual(CARRIAGE_TRAVEL_M);
    const rollMidM = CARRIAGE_AT_M[1] + CARRIAGE_TOP_M + ROLL_AT_M[1];
    const loadTopM = at.PALLET_ROLLER_TOP_M + FILM_TOP_M;
    expect(rollMidM - ROLL_HEIGHT_M / 2).toBeLessThan(loadTopM);
    expect(rollMidM + ROLL_HEIGHT_M / 2).toBeGreaterThan(loadTopM);
    expect(wrapPoseAt(WRAP_CYCLE_S, pose)).toMatchObject({ phase: 'cut', carriageM: 0, filmFrac: 1, web: false });
    // 8 turns in all, square at the end; 24 rpm on average over the 20 s of turning.
    expect(pose.turnRad).toBeCloseTo(WRAP_TURNS * 2 * Math.PI, 9);
    expect(((WRAP_TURNS / (WRAP_CYCLE_S - WRAP_STEPS_S.cut)) * 60)).toBeCloseTo(24, 6);
    // The base wraps lay the base band on over the first turn and hold it; only the climb takes the film higher.
    const baseBand = wrapPoseAt(WRAP_STEPS_S.base, pose).filmFrac;
    expect(baseBand).toBeLessThan(1);
    expect(wrapPoseAt(WRAP_STEPS_S.base / 2, pose).filmFrac).toBeCloseTo(baseBand, 9);
    expect(wrapPoseAt(WRAP_STEPS_S.base / 4, pose).filmFrac).toBeLessThan(baseBand);
  });

  it('turns only with a pallet on it, turning the pallet with it, while the film rises on the load and stays to quarantine', () => {
    const machines = packsLine(makeContext());
    const wrapper = byId(machines, 'stretch-wrapper');
    const conveyor = byId(machines, 'pallet-conveyor');
    const turntable = named(wrapper.object, 'turntable');
    const web = named(wrapper.object, 'film-web');
    const s = snapshot(40);
    for (let i = 0; i < 300; i++) frame(machines, s, 1 / 30);
    expect(state(wrapper)).toMatchObject({ wrapping: false, turnRad: 0, filmFrac: 0, carriageM: 0 });
    expect(web.visible).toBe(false);

    // A pallet closes: it rides onto the turntable, which turns it through the cycle.
    const closed = withPallets(s, 1);
    let wrapFrames = 0;
    let lastFilm = 0;
    let sawWeb = false;
    for (let i = 0; i < 2000; i++) {
      frame(machines, closed, 1 / 30);
      const now = state(wrapper);
      if (!now.wrapping) {
        if (wrapFrames > 0) break;
        expect(turntable.rotation.y).toBe(0);
        continue;
      }
      wrapFrames += 1;
      const pallet = rider(conveyor, 0);
      // On the turntable, turned as the turntable is.
      expect(Math.hypot(pallet.atM.x - at.WRAPPER_M[0], pallet.atM.z - at.WRAPPER_M[1])).toBeLessThan(1e-6);
      expect(sameTurn(pallet.turnRad, turntable.rotation.y), `frame ${i}`).toBeLessThan(1e-6);
      // The film shell's height on the load is the wrapper's film (none drawn under 5 mm).
      const filmM = (now.filmFrac as number) * (FILM_TOP_M - FILM_BOTTOM_M);
      expect(rider(conveyor, 0, 'riding-films').scale.y, `frame ${i}`).toBeCloseTo(filmM > 0.005 ? filmM : 0, 6);
      expect(now.filmFrac as number).toBeGreaterThanOrEqual(lastFilm);
      lastFilm = now.filmFrac as number;
      sawWeb ||= web.visible;
    }
    // About 21 motion s at ×1.
    expect(wrapFrames / 30).toBeCloseTo(WRAP_CYCLE_S, 0);
    expect(sawWeb).toBe(true);
    expect(web.visible).toBe(false);
    expect(sameTurn(turntable.rotation.y, 0)).toBeLessThan(1e-9); // stopped square
    // Wrapped, it rides on with its film whole until it joins its block in quarantine.
    let rode = 0;
    while (state(conveyor).riding === 1 && rode < 5000) {
      frame(machines, closed, 1 / 30);
      if (state(conveyor).riding === 1) expect(rider(conveyor, 0, 'riding-films').scale.y).toBeCloseTo(FILM_TOP_M - FILM_BOTTOM_M, 6);
      rode += 1;
    }
    expect(state(conveyor).riding).toBe(0);
    expect(rider(conveyor, 0, 'riding-films').atM.x).toBeLessThan(at.QUARANTINE.xMaxM);
  });

  it('never has two pallets on the turntable: the next waits on the rollers before it, and the pool is never exceeded', () => {
    const machines = packsLine(makeContext());
    const conveyor = byId(machines, 'pallet-conveyor');
    const wrapper = byId(machines, 'stretch-wrapper');
    // ×10,000: a pallet closes every frame, far faster than the wrapper wraps.
    let s = snapshot(20);
    s.speed = 10_000;
    frame(machines, s, 1 / 30);
    const riders = (): THREE.Vector3[] => Array.from({ length: state(conveyor).riding as number }, (_, slot) => rider(conveyor, slot, 'riding-pallets').atM);
    /** A pallet on the turntable or still entering or leaving it: within its radius, half a pallet and a gap. */
    const atTurntable = (atM: THREE.Vector3): boolean => Math.abs(atM.x - at.WRAPPER_M[0]) < at.TURNTABLE_RADIUS_M + 0.6 + 0.15 + 1e-6 && Math.abs(atM.z - at.WRAPPER_M[1]) < 0.01;
    let mostQueued = 0;
    for (let i = 1; i < 30 * 120; i++) {
      s = withPallets(s, i);
      s.speed = 10_000;
      frame(machines, s, 1 / 30);
      const now = state(conveyor);
      expect(now.onTurntable as number, `frame ${i}`).toBeLessThanOrEqual(1);
      expect(now.riding as number).toBeLessThanOrEqual(POOL);
      expect(now.queued as number).toBeLessThanOrEqual(2);
      // A pallet waits only while another is on the turntable, entering or leaving it.
      if ((now.queued as number) > 0) expect(riders().some(atTurntable), `frame ${i}`).toBe(true);
      mostQueued = Math.max(mostQueued, now.queued as number);
    }
    expect(mostQueued).toBe(2);
    expect(state(wrapper).wrapping).toBe(true);
    // No more pallets close: the ones waiting stand on the rollers short of the turntable, clear of the palletizer's pallet.
    for (let i = 0; i < 30 * 3; i++) frame(machines, s, 1 / 30);
    expect(state(conveyor).queued as number).toBeGreaterThan(0);
    for (const atM of riders()) {
      if (atM.x <= at.WRAPPER_M[0] + at.TURNTABLE_RADIUS_M + 0.6) continue;
      expect(atM.x).toBeLessThan(at.PLACE_M[0] - 1.2);
    }
  });
});

describe('stage 8 motion', () => {
  it('moves the grey box and a stand-in hero with the contract’s node names the same', async () => {
    const grey = packsLine(makeContext(false));
    const hero = packsLine(makeContext(true));
    await settle();
    const nodesOf = (machines: Equipment[], id: string, names: readonly string[], inHero: boolean): THREE.Object3D[] => {
      const machine = byId(machines, id);
      const root = inHero ? named(machine.object, `${machine.object.name}-hero`) : machine.object;
      return names.map((name) => named(root, name));
    };
    const joints: [string, readonly string[]][] = [
      ['palletizer', ['arm', 'arm_lift', 'arm_wrist', 'arm_clamp_1', 'arm_clamp_2']],
      ['stretch-wrapper', ['turntable', 'carriage']],
    ];
    const pairs = joints.flatMap(([id, names]) => {
      const greyNodes = nodesOf(grey, id, names, false);
      const heroNodes = nodesOf(hero, id, names, true);
      return names.map((name, i) => [`${id} ${name}`, greyNodes[i], heroNodes[i]] as const);
    });
    const carriedGrey = named(byId(grey, 'palletizer').object, 'carried-tray');
    const carriedHero = named(byId(hero, 'palletizer').object, 'carried-tray');
    expect(carriedHero.parent?.name).toBe('arm_wrist');
    expect(carriedHero.parent?.parent?.parent?.parent?.name).toBe('palletizer-hero');
    let s = snapshot(25);
    let carriedFrames = 0;
    for (let i = 0; i < 1500; i++) {
      if (i === 30) s = withPallets(s, 1);
      frame(grey, s, 1 / 30);
      frame(hero, s, 1 / 30);
      for (const [name, a, b] of pairs) {
        expect(b?.position.toArray(), `${name} frame ${i}`).toEqual(a?.position.toArray());
        expect(b?.quaternion.toArray(), `${name} frame ${i}`).toEqual(a?.quaternion.toArray());
      }
      expect(carriedHero.visible).toBe(carriedGrey.visible);
      if (carriedGrey.visible) {
        carriedFrames += 1;
        carriedGrey.updateWorldMatrix(true, false);
        carriedHero.updateWorldMatrix(true, false);
        expect(new THREE.Vector3().setFromMatrixPosition(carriedHero.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(carriedGrey.matrixWorld))).toBeLessThan(1e-9);
      }
    }
    expect(carriedFrames).toBeGreaterThan(0);
    expect(state(byId(hero, 'stretch-wrapper')).filmFrac).toBe(state(byId(grey, 'stretch-wrapper')).filmFrac);
  });

  it('stands still while paused: the arm, the stack, the wrapper and the pallets', () => {
    const machines = packsLine(makeContext());
    const ids = ['palletizer', 'stretch-wrapper', 'pallet-conveyor'];
    let s = snapshot(50);
    frame(machines, s, 1 / 30);
    s = withPallets(s, 1);
    // Mid-cycle: the arm swinging or picking, a pallet on the turntable.
    for (let i = 0; i < 30 * 12; i++) frame(machines, s, 1 / 30);
    expect(state(byId(machines, 'stretch-wrapper')).wrapping).toBe(true);
    const look = (): string =>
      JSON.stringify(
        ids.map((id) => {
          const object = byId(machines, id).object;
          const transforms: number[][] = [];
          object.traverse((child) => {
            transforms.push([...child.position.toArray(), ...child.quaternion.toArray(), ...child.scale.toArray(), child.visible ? 1 : 0]);
            if (child instanceof THREE.InstancedMesh) transforms.push([child.count, ...child.instanceMatrix.array]);
          });
          return [state(byId(machines, id)), transforms];
        }),
      );
    const before = look();
    const paused = { ...s, paused: true };
    for (let i = 0; i < 20; i++) frame(machines, paused, 0.5);
    expect(look()).toBe(before);
    // And it goes on where it stood.
    frame(machines, s, 1 / 30);
    expect(look()).not.toBe(before);
    expect(motionRate(s.speed)).toBe(1);
  });
});
