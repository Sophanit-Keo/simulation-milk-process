// The yogurt wing's pallet line (phase 24, src/scene/equipment/yogurt/palletLine.ts): the stack's places, the gantry's
// cycle within its model's travel (make-heroes.mjs GANTRY), and on the live sim the trays laid while P8 fills, a closed
// pallet's ride to the wrapper, its wrap and its departure, and a fresh pallet from the dispenser.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { WRAP_CYCLE_S } from '../../src/scene/equipment/packs/stretchWrap';
import { PALLETIZER, PALLET_LINE, WRAPPER } from '../../src/scene/equipment/yogurt/layout';
import {
  createPalletLine,
  DECK_TOP_M,
  GANTRY,
  GANTRY_STEP_S,
  gantryPoseAt,
  LAYER_M,
  PALLET,
  placeM,
  slotOffsetM,
  STACK_CAPACITY,
  TRAY_M,
  TRAYS_PER_LAYER,
  type GantryPose,
} from '../../src/scene/equipment/yogurt/palletLine';
import { createSim } from '../../src/sim';
import { GANTRY as MODEL } from '../../assets/scripts/make-heroes.mjs';
import { plantConfig } from '../helpers/plantConfig';

const v = new THREE.Vector3();

describe('the stack (phase 24)', () => {
  it('holds the 120 trays of a pallet, 8 a layer and 15 layers, inside the pallet\'s plan and 0.85 m tall', () => {
    expect(STACK_CAPACITY).toBe(plantConfig.yogurt.coldChain.traysPerPallet);
    expect(TRAYS_PER_LAYER).toBe(8);
    const seen = new Set<string>();
    for (let slot = 0; slot < STACK_CAPACITY; slot++) {
      slotOffsetM(slot, v);
      expect(Math.abs(v.x) + TRAY_M[0] / 2, `slot ${slot} x`).toBeLessThanOrEqual(PALLET.widthM / 2 + 1e-9);
      expect(Math.abs(v.z) + TRAY_M[2] / 2, `slot ${slot} z`).toBeLessThanOrEqual(PALLET.depthM / 2 + 1e-9);
      seen.add(v.toArray().map((n) => n.toFixed(4)).join());
    }
    expect(seen.size).toBe(STACK_CAPACITY);
    expect(placeM(STACK_CAPACITY - 1) - DECK_TOP_M).toBeCloseTo(PALLET.loadM - (LAYER_M - TRAY_M[1]), 6);
    // Each layer fills from the line's far end (+x) back toward the infeed.
    expect(slotOffsetM(0, v).x).toBeCloseTo(0.45, 9);
    expect(slotOffsetM(TRAYS_PER_LAYER - 1, v).x).toBeCloseTo(-0.45, 9);
  });

  it('keeps the gantry\'s scene numbers the model\'s: its rest, its pick point, its lowest place and its travel', () => {
    expect(GANTRY.bridgeYM).toBe(MODEL.bridgeYM);
    expect(GANTRY.restM).toBeCloseTo(MODEL.bridgeYM + MODEL.liftRestM, 9);
    expect(GANTRY.pickXM).toBeCloseTo(MODEL.pickXM, 9);
    expect(placeM(0)).toBeCloseTo(MODEL.lowestM, 3);
    expect(PALLET_LINE.infeed.topM).toBe(MODEL.infeed.topM);
    expect(PALLET_LINE.rollerTopM).toBe(MODEL.rollerTopM);
  });
});

describe('the gantry\'s cycle', () => {
  const rest: GantryPose = { step: 'idle', bridgeXM: GANTRY.bridgeRestXM, trolleyZM: 0, liftM: GANTRY.restM, carrying: false };
  const pose: GantryPose = { ...rest };

  it('picks at the infeed\'s end on the tray\'s top, and sets the tray on its place, never outside the model\'s travel', () => {
    gantryPoseAt('pickDown', GANTRY_STEP_S.pickDown, 5, rest, pose);
    expect(pose).toMatchObject({ bridgeXM: GANTRY.pickXM, trolleyZM: 0, carrying: false });
    expect(pose.liftM).toBeCloseTo(PALLET_LINE.infeed.topM + TRAY_M[1], 9);
    for (let slot = 0; slot < STACK_CAPACITY; slot++) {
      for (const step of ['toPlace', 'placeDown', 'placeUp'] as const) {
        for (const k of [0, 0.5, 1]) {
          gantryPoseAt(step, GANTRY_STEP_S[step] * k, slot, { ...rest, bridgeXM: GANTRY.pickXM }, pose);
          expect(pose.bridgeXM).toBeGreaterThanOrEqual(MODEL.bridgeTravelM[0] - 1e-9);
          expect(pose.bridgeXM).toBeLessThanOrEqual(MODEL.bridgeTravelM[1] + 1e-9);
          expect(Math.abs(pose.trolleyZM)).toBeLessThanOrEqual(MODEL.trolleyTravelM[1] + 1e-9);
          expect(pose.liftM).toBeGreaterThanOrEqual(MODEL.lowestM - 1e-3);
          expect(pose.liftM).toBeLessThanOrEqual(GANTRY.restM + 1e-9);
        }
      }
      gantryPoseAt('placeDown', GANTRY_STEP_S.placeDown, slot, rest, pose);
      expect(pose.liftM).toBeCloseTo(placeM(slot), 9);
      expect(pose.carrying).toBe(true);
    }
  });
});

describe('the line on the live sim', () => {
  /** Frames of `realDtS` at ×10, the line advanced each, as the palletizer and the wrapper do. */
  function harness() {
    const sim = createSim(plantConfig);
    const line = createPalletLine();
    sim.dispatch({ type: 'setSpeed', speed: 10 });
    let snap: Snapshot = sim.snapshot();
    const frames = (count: number, realDtS = 0.1, each?: () => void): Snapshot => {
      for (let i = 0; i < count; i++) {
        sim.step(realDtS);
        snap = sim.snapshot();
        line.advance(snap, realDtS);
        each?.();
      }
      return snap;
    };
    return { sim, line, frames };
  }

  it('lays trays while P8 fills: the gantry cycles, and the stack follows the sim\'s count of the open pallet', () => {
    const { line, frames } = harness();
    const steps = new Set<string>();
    let carried = false;
    const snap = frames(300, 0.1, () => {
      steps.add(line.gantry.step);
      carried ||= line.gantry.carrying;
    });
    expect(snap.yogurt.p8.state).toBe('running');
    for (const step of ['toPick', 'pickDown', 'pickUp', 'toPlace', 'placeDown', 'placeUp']) expect(steps, step).toContain(step);
    expect(carried).toBe(true);
    expect(line.laid).toBeGreaterThan(3);
    const open = snap.yogurt.coldChain.trays?.openTrays ?? 0;
    expect(line.stacked).toBeGreaterThanOrEqual(open);
    expect(line.stacked).toBeLessThanOrEqual(open + 1);
  });

  it('rides a closed pallet to the wrapper, wraps it in 8 turns with its film growing, rides it on, and slides a fresh pallet on', () => {
    const { line, frames } = harness();
    // Until the open pallet closes: at most 8 sim minutes, 48 s at ×10.
    for (let i = 0; i < 1_200 && line.closed === 0; i++) frames(1);
    expect(line.closed).toBe(1);
    expect(line.rider).toMatchObject({ phase: 'toWrapper', xM: expect.closeTo(PALLETIZER.xM, 0) });
    expect(line.place.slideFrac).toBeLessThan(1);
    const seen: Record<string, number> = {};
    let maxFilm = 0;
    let maxTurn = 0;
    for (let i = 0; i < 600 && line.rider; i++) {
      frames(1);
      const rider = line.rider;
      if (!rider) break;
      seen[rider.phase] = (seen[rider.phase] ?? 0) + 1;
      if (rider.phase === 'wrapping') {
        expect(rider.xM).toBe(WRAPPER.xM);
        maxFilm = Math.max(maxFilm, line.wrap.filmFrac);
        maxTurn = Math.max(maxTurn, line.wrap.turnRad);
      }
    }
    expect(Object.keys(seen)).toEqual(['toWrapper', 'wrapping', 'toStaging']);
    expect(line.rider).toBeNull();
    expect(maxFilm).toBe(1);
    expect(maxTurn).toBeCloseTo(8 * 2 * Math.PI, 6);
    // The wrap lasts its cycle: at ×10 the motion runs 1.5 times as fast, 10 frames a second.
    expect((seen.wrapping ?? 0) / 10).toBeCloseTo(WRAP_CYCLE_S / 1.5, 0);
    expect(line.place.slideFrac).toBe(1);
  });

  it('stands still while the sim is paused', () => {
    const { sim, line, frames } = harness();
    frames(40);
    sim.dispatch({ type: 'pause', paused: true });
    const before = { ...line.gantry };
    frames(20);
    expect(line.gantry).toEqual(before);
  });
});
