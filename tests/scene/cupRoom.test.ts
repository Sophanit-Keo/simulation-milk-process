// The cup filling room and Line P8 in more detail (phase 30, D32, src/scene/equipment/yogurt/cupRoomDetail.ts): the
// machine's feed valve, ionizer, dosing crossheads, foil strip, index drive and wash lances, the check gates' displays
// and the reject heap, and the room round it: the cup and foil supplies, the operator, the air unit, the CIP/SIP skid,
// the QA bench and the hygiene line. Every part follows the live sim and stands while it is paused.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sim, Snapshot, YogurtSnapshot } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import {
  createCupRoomWatch,
  CUP_PALLET,
  CUP_ROOM_FACES,
  cupRoomParts,
  fillInLimits,
  FOIL_CART,
  HYGIENE_LINE,
  OPERATOR,
  operatorStationXM,
  SAMPLE_SHOWN_S,
} from '../../src/scene/equipment/yogurt/cupRoomDetail';
import * as at from '../../src/scene/equipment/yogurt/layout';
import type { Pose } from '../../src/scene/equipment/yogurt/motionParts';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import { ZONES } from '../../src/scene/layout';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

afterEach(() => vi.unstubAllGlobals());

function makeContext(): EquipmentContext {
  const names: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
  return {
    materials: Object.fromEntries(names.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
    loadModel: () => Promise.reject(new Error('no models in unit tests')),
  };
}

interface Room {
  sim: Sim;
  frames(count: number, realDtS?: number): Snapshot;
  state(id: string): Record<string, number | string | boolean>;
}

function room(): Room {
  stubTheme();
  const sim = createSim(plantConfig);
  const items = new Map<string, Equipment>(yogurtLine(makeContext()).map((item) => [item.id, item]));
  return {
    sim,
    frames(count, realDtS = 0.1) {
      let snap = sim.snapshot();
      for (let i = 0; i < count; i++) {
        sim.step(realDtS);
        snap = sim.snapshot();
        for (const item of items.values()) item.update(snap, realDtS);
      }
      return snap;
    },
    state: (id) => ({ ...(items.get(id)?.debugState?.() ?? {}) }),
  };
}

/** Steps the sim alone at ×1,000 until `until` holds, then sets ×1 again. */
function runUntil(r: Room, until: (snap: Snapshot) => boolean, maxFrames = 20_000): Snapshot {
  r.sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  let snap = r.sim.snapshot();
  for (let i = 0; i < maxFrames && !until(snap); i++) {
    r.sim.step(0.1);
    snap = r.sim.snapshot();
  }
  r.sim.dispatch({ type: 'setSpeed', speed: 1 });
  return snap;
}

const P8 = plantConfig.yogurt.p8;
const running = (snap: Snapshot): boolean => snap.yogurt.p8.state === 'running';

/** A snapshot with only what the room's watch reads. */
function p8At(timeS: number, p8: Partial<YogurtSnapshot['p8']>, paused = false): Snapshot {
  return { timeS, paused, yogurt: { p8: { state: 'running', ...p8 } } } as unknown as Snapshot;
}

describe('the cup filling room\'s own counts', () => {
  it('takes a layer of cup cartons with each refill of the magazine, and stands a full pallet there after the last', () => {
    const watch = createCupRoomWatch();
    const full = CUP_PALLET.layers * CUP_PALLET.perLayer;
    watch.observe(p8At(0, { magazines: { cupsPct: 100, foilsPct: 100 } }));
    expect(watch.cupCartons).toBe(full);
    let timeS = 0;
    const refill = (): void => {
      watch.observe(p8At((timeS += 600), { magazines: { cupsPct: 24, foilsPct: 100 } }));
      watch.observe(p8At((timeS += 600), { magazines: { cupsPct: 100, foilsPct: 100 } }));
    };
    refill();
    expect(watch.cupCartons).toBe(full - CUP_PALLET.perLayer);
    refill();
    expect(watch.cupCartons).toBe(full - 2 * CUP_PALLET.perLayer);
    refill();
    expect(watch.cupCartons).toBe(full);
    // The foils' cart was not touched, and the level falling as P8 fills takes nothing.
    expect(watch.foilBoxes).toBe(FOIL_CART.stacks * FOIL_CART.perStack);
    watch.observe(p8At((timeS += 600), { magazines: { cupsPct: 100, foilsPct: 20 } }));
    watch.observe(p8At((timeS += 600), { magazines: { cupsPct: 60, foilsPct: 100 } }));
    expect(watch.foilBoxes).toBe(FOIL_CART.stacks * FOIL_CART.perStack - FOIL_CART.perStack);
    expect(watch.cupCartons).toBe(full);
  });

  it('shows a gate throwing a cup out for a moment, and holds it while the sim is paused', () => {
    const watch = createCupRoomWatch();
    const rejects = (vision: number) => ({ underFill: 0, overFill: 0, metal: 0, vision, sealHold: 0 });
    watch.observe(p8At(0, { rejects: rejects(0) }));
    expect(watch.rejecting('vision')).toBe(false);
    watch.observe(p8At(1, { rejects: rejects(1) }));
    expect(watch.rejecting('vision')).toBe(true);
    expect(watch.rejecting('checkweigher')).toBe(false);
    for (let i = 0; i < 40; i++) watch.observe(p8At(2 + i, { rejects: rejects(1) }, true));
    expect(watch.rejecting('vision')).toBe(true);
    for (let i = 0; i < 100; i++) watch.observe(p8At(50 + i, { rejects: rejects(1) }));
    expect(watch.rejecting('vision')).toBe(false);
  });

  it('remembers the last seal test, keeps its cups on the bench for ten minutes, and starts over when the clock goes back', () => {
    const watch = createCupRoomWatch();
    const tests = (passed: number, failed: number) => ({ passed, failed, cupsTaken: 5 * (passed + failed) });
    watch.observe(p8At(1_000, { sealTests: tests(0, 0), nextSealTestS: 1_000 + P8.sealTest.everyS / 2 }));
    expect(watch.lastSealTest).toBeNull();
    expect(watch.samplesOut).toBe(false);
    expect(watch.sealTestDueFrac).toBeCloseTo(0.5, 9);
    watch.observe(p8At(2_000, { sealTests: tests(1, 0), nextSealTestS: null }));
    expect(watch.lastSealTest).toBe('passed');
    expect(watch.samplesOut).toBe(true);
    expect(watch.sealTestDueFrac).toBe(0);
    watch.observe(p8At(2_000 + SAMPLE_SHOWN_S + 1, { sealTests: tests(1, 0) }));
    expect(watch.samplesOut).toBe(false);
    watch.observe(p8At(9_000, { sealTests: tests(1, 1) }));
    expect(watch.lastSealTest).toBe('failed');
    watch.observe(p8At(500, { sealTests: tests(0, 0) }));
    expect(watch.lastSealTest).toBeNull();
  });
});

describe('what the room reads from the snapshot', () => {
  it('sends the operator to the magazine that calls, the cups first, and to the screen otherwise', () => {
    const y = (p8: Partial<YogurtSnapshot['p8']>): YogurtSnapshot => ({ p8: { state: 'running', ...p8 } }) as unknown as YogurtSnapshot;
    expect(operatorStationXM(y({ magazines: { cupsPct: 80, foilsPct: 80 } }))).toBe(OPERATOR.screenXM);
    expect(operatorStationXM(y({ magazines: { cupsPct: 80, foilsPct: 25 } }))).toBe(OPERATOR.foilsXM);
    expect(operatorStationXM(y({ magazines: { cupsPct: 20, foilsPct: 20 } }))).toBe(OPERATOR.cupsXM);
    expect(operatorStationXM(y({ state: 'stopped', stopReason: 'foils', magazines: { cupsPct: 80, foilsPct: 80 } }))).toBe(OPERATOR.foilsXM);
    expect(operatorStationXM(y({}))).toBe(OPERATOR.screenXM);
  });

  it('holds the last cup\'s weight to the checkweigher\'s limits', () => {
    const p8 = (lastFillG: number | null) => ({ lastFillG }) as unknown as YogurtSnapshot['p8'];
    expect(fillInLimits(p8(null))).toBeNull();
    expect(fillInLimits(p8(P8.fill.targetG))).toBe(true);
    expect(fillInLimits(p8(P8.fill.underBelowG - 0.1))).toBe(false);
    expect(fillInLimits(p8(P8.fill.overAboveG + 0.1))).toBe(false);
  });
});

describe('where the room\'s parts stand', () => {
  const parts = cupRoomParts();
  const yogurt = createSim(plantConfig).snapshot().yogurt;
  const poseOf = (name: string): Pose => {
    const part = parts.find((each) => each.name === name);
    if (!part) throw new Error(`no part ${name}`);
    const pose: Pose = { position: new THREE.Vector3(), rotation: new THREE.Euler(), size: new THREE.Vector3() };
    part.pose(0, yogurt, pose);
    return pose;
  };

  it('names every part once, on a machine of stage 15', () => {
    const keys = parts.map((part) => `${part.machine}/${part.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(parts.map((part) => part.machine))).toEqual(new Set(['p8-filler', 'p8-checkweigher', 'p8-metal-detector', 'p8-vision', 'p8-reject-bin']));
  });

  it('keeps every part inside the cup filling room and under the machine\'s label', () => {
    const zone = ZONES.find((each) => each.id === 'p8');
    if (!zone) throw new Error('no p8 zone');
    for (const part of parts) {
      const { position, size } = poseOf(part.name);
      expect(position.x - size.x / 2, part.name).toBeGreaterThanOrEqual(zone.rect.xMinM);
      expect(position.x + size.x / 2, part.name).toBeLessThanOrEqual(zone.rect.xMaxM);
      expect(position.z - size.z / 2, part.name).toBeGreaterThanOrEqual(zone.rect.zMinM);
      expect(position.z + size.z / 2, part.name).toBeLessThanOrEqual(zone.rect.zMaxM);
      expect(position.y + size.y / 2, part.name).toBeLessThan(3);
    }
  });

  it('stands the supplies, the operator and the QA bench on the aisle side clear of the hood, and the utilities behind it', () => {
    for (const name of ['cupPallet', 'cupCarton1', 'foilCartDeck', 'foilBox1', 'operator', 'qaBenchTop']) {
      const { position, size } = poseOf(name);
      expect(position.z - Math.max(size.x, size.z) / 2, name).toBeGreaterThan(CUP_ROOM_FACES.hoodFrontZM + 0.2);
      expect(position.z, name).toBeLessThan(HYGIENE_LINE.zMaxM);
    }
    for (const name of ['airUnit', 'cipSkid']) {
      const { position, size } = poseOf(name);
      expect(position.z + size.z / 2, name).toBeLessThan(CUP_ROOM_FACES.hoodBackZM - 1);
      expect(position.z, name).toBeGreaterThan(HYGIENE_LINE.zMinM);
    }
    // The operator's walk along the machine passes the pallet and the cart.
    expect(OPERATOR.zM + 0.25).toBeLessThan(CUP_PALLET.zM - 0.4);
    expect(OPERATOR.zM + 0.25).toBeLessThan(FOIL_CART.zM - 0.225);
    // The reject bin and the gates stand inside the hygiene line.
    expect(at.REJECT_BIN.zM).toBeGreaterThan(HYGIENE_LINE.zMinM);
    expect(at.CHECK_GATES.vision + 0.45).toBeLessThan(HYGIENE_LINE.xMaxM);
  });
});

describe('the cup filling room on the live sim (phase 30)', () => {
  it('opens the feed valve, strokes the dosing heads, carries the foil and steps the index drive while P8 runs, and stands paused', () => {
    const r = room();
    r.frames(1);
    runUntil(r, running);
    const dose: number[] = [];
    const foil: number[] = [];
    const jet: number[] = [];
    const before = Number(r.state('p8-filler').indexDriveReading);
    for (let i = 0; i < 40; i++) {
      r.frames(1, 0.1);
      const state = r.state('p8-filler');
      dose.push(Number(state.doseHeadFrontReading));
      foil.push(Number(state.foilStripReading));
      jet.push(Number(state.ionJetReading));
    }
    // Over 4 s at 30 cycles a minute: each station through its whole cycle.
    expect(Math.max(...dose)).toBeGreaterThan(0.95);
    expect(Math.min(...dose)).toBe(0);
    expect(new Set(foil)).toEqual(new Set([0, 1]));
    expect(new Set(jet)).toEqual(new Set([0, 1]));
    const state = r.state('p8-filler');
    expect(Number(state.indexDriveReading)).toBeGreaterThanOrEqual(before + 1);
    expect(state).toMatchObject({ feedValveLift: 1, feedValveColor: '#34c759', shroudFanMoving: true, shroudFanCrossMoving: true, airUnitFanMoving: true, sealPlatenColor: '#ea8027' });
    expect(state.cabinGaugeReading).toBeGreaterThan(P8.hepa.minPa);
    expect(r.state('p8-checkweigher')).toMatchObject({ beltRollerMoving: true, rejectLampColor: '#34c759', weighDisplayColor: '#34c759' });
    expect(Number(r.state('p8-checkweigher').weighDisplayReading)).toBeGreaterThan(P8.fill.underBelowG);
    expect(r.state('p8-metal-detector')).toMatchObject({ beltRollerMoving: true });
    expect(r.state('p8-vision')).toMatchObject({ beltRollerMoving: true });

    r.sim.dispatch({ type: 'pause', paused: true });
    r.frames(1, 0.1);
    const paused = r.state('p8-filler');
    const pausedRoller = r.state('p8-checkweigher').beltRollerTurns;
    r.frames(5, 0.1);
    const later = r.state('p8-filler');
    for (const key of ['doseHeadFrontReading', 'indexDriveReading', 'shroudFanTurns', 'airUnitFanTurns', 'operatorReading']) expect(later[key], key).toBe(paused[key]);
    expect(r.state('p8-checkweigher').beltRollerTurns).toBe(pausedRoller);
  });

  it('walks the operator to the de-nester while the cup magazine calls, takes a layer of cartons with the refill, and walks back', () => {
    const r = room();
    r.frames(2);
    expect(r.state('p8-filler')).toMatchObject({ operatorReading: OPERATOR.screenXM, operatorMoving: false, cupCarton1Reading: CUP_PALLET.layers * CUP_PALLET.perLayer });
    runUntil(r, (snap) => (snap.yogurt.p8.magazines?.cupsPct ?? 100) < 25);
    r.frames(5, 0.1);
    const walking = r.state('p8-filler');
    expect(walking.operatorMoving).toBe(true);
    expect(Number(walking.operatorReading)).toBeLessThan(OPERATOR.screenXM);
    expect(Number(walking.operatorReading)).toBeGreaterThan(OPERATOR.cupsXM);
    // 7.7 m at 1.2 m/s: there within 7 s, and standing.
    r.frames(70, 0.1);
    expect(r.state('p8-filler')).toMatchObject({ operatorReading: OPERATOR.cupsXM, operatorMoving: false });
    runUntil(r, (snap) => (snap.yogurt.p8.magazines?.cupsPct ?? 0) > 90);
    r.frames(80, 0.1);
    expect(r.state('p8-filler')).toMatchObject({ operatorReading: OPERATOR.screenXM, operatorMoving: false, cupCarton1Reading: (CUP_PALLET.layers - 1) * CUP_PALLET.perLayer });
  });

  it('stops the air unit\'s fans and drops the cabin gauge in a HEPA loss', () => {
    const r = room();
    runUntil(r, running);
    r.frames(20, 0.1);
    expect(r.state('p8-filler').airUnitFanMoving).toBe(true);
    r.sim.dispatch({ type: 'triggerScenario', id: 'yogurtHepaLoss' });
    r.frames(40, 0.1);
    const state = r.state('p8-filler');
    expect(state).toMatchObject({ airUnitFanMoving: false, airUnitFanCrossMoving: false, shroudFanMoving: false, feedValveLift: 0, feedValveColor: '#30363c' });
    expect(Number(state.cabinGaugeReading)).toBeLessThan(P8.hepa.minPa);
  });

  it('opens the CIP valve and blinks the wash lances in the clean, then opens the steam valve for the SIP', () => {
    const r = room();
    r.frames(1);
    runUntil(r, (snap) => snap.yogurt.p8.state === 'cleaning');
    r.frames(20, 0.1);
    const cleaning = r.state('p8-filler');
    expect(cleaning).toMatchObject({ cipValveLift: 1, cipValveColor: '#ffd84a', steamValveLift: 0, feedValveColor: '#ffd84a', washLance1Moving: true, sipDisplayColor: '#ffd84a', sipDisplayReading: 0 });
    runUntil(r, (snap) => snap.yogurt.p8.state === 'sterilizing');
    r.frames(20, 0.1);
    const sip = r.state('p8-filler');
    expect(sip).toMatchObject({ cipValveLift: 0, steamValveLift: 1, steamValveColor: '#ea8027', feedValveColor: '#ea8027', washLance1Moving: false, washLance1Color: '#ea8027', sipDisplayReading: P8.sip.runC });
  });

  it('lights the seal tester green after a test that passed, with its cups on the bench, and heaps the rejects on the bin', () => {
    const r = room();
    r.frames(1);
    expect(r.state('p8-filler')).toMatchObject({ sealTestLampColor: '#30363c', sampleCup1Reading: 0 });
    expect(r.state('p8-reject-bin').heapReading).toBe(0);
    const due = runUntil(r, (snap) => (snap.yogurt.p8.sealTests?.passed ?? 0) > 0);
    r.frames(1);
    expect(r.state('p8-filler')).toMatchObject({ sealTestLampColor: '#34c759', sampleCup1Reading: P8.sealTest.cups });
    expect(Number(r.state('p8-filler').sealTestDueReading)).toBeLessThan(5);
    // In the seal drift the next test fails and holds every cup since the last: the lamp red, the heap on the bin.
    r.sim.dispatch({ type: 'triggerScenario', id: 'yogurtSealDrift' });
    runUntil(r, (snap) => (snap.yogurt.p8.sealTests?.failed ?? 0) > 0);
    r.frames(1);
    expect(r.state('p8-filler').sealTestLampColor).toBe('#d63b26');
    expect(Number(r.state('p8-reject-bin').heapReading)).toBeGreaterThan(due.yogurt.p8.cupsRejected);
  });
});
