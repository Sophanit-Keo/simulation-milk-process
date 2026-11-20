// The yogurt wing's CIP station in 3D (phase 32, D34, src/scene/equipment/yogurt/cipStation.ts and cipCircuits.ts): its
// circuits read from the live sim, its pumps, heaters, conductivity bars, return valves, drain and lamps following each
// circuit, the tanks' CIP header, drops and sight glasses carrying a cleaning tank's fluid, its label, and its lines
// (yogurtPipes.ts) clear of every machine but where they meet one.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CleaningSnapshot, Sim, Snapshot, YogurtSnapshot } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import { CIP_CIRCUIT_IDS, cipCircuits, cleaningTanks, yogurtPipeCleaning } from '../../src/scene/equipment/yogurt/cipCircuits';
import { cipStationLabelText, cipStationParts, CIP_STATION_ID, FLUID_HEX, tankInUse } from '../../src/scene/equipment/yogurt/cipStation';
import * as at from '../../src/scene/equipment/yogurt/layout';
import { wingTempColor, type Pose } from '../../src/scene/equipment/yogurt/motionParts';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import { ZONES } from '../../src/scene/layout';
import { YOGURT_CIP_LINES } from '../../src/scene/yogurtPipes';
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

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
const OFF = '#30363c';
const METAL = '#5d6a74';

interface Wing {
  sim: Sim;
  items: Map<string, Equipment>;
  frames(count: number, realDtS?: number): Snapshot;
  state(id: string): Record<string, number | string | boolean>;
}

function wing(): Wing {
  stubTheme();
  const sim = createSim(plantConfig);
  const items = new Map(yogurtLine(makeContext()).map((item) => [item.id, item]));
  return {
    sim,
    items,
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

/** Steps the sim alone at ×1,000 until `until` holds, then sets ×1 again so the parts move at their own pace. */
function runUntil(w: Wing, until: (snap: Snapshot) => boolean, maxFrames = 40_000): Snapshot {
  w.sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  let snap = w.sim.snapshot();
  for (let i = 0; i < maxFrames && !until(snap); i++) {
    w.sim.step(0.1);
    snap = w.sim.snapshot();
  }
  w.sim.dispatch({ type: 'setSpeed', speed: 1 });
  return snap;
}

const tankStep = (snap: Snapshot, tank: number): CleaningSnapshot | null | undefined => snap.yogurt.ferment.tanks[tank]?.cleaning;

describe('the station\'s circuits, as the 3D view reads them', () => {
  const opening = createSim(plantConfig).snapshot().yogurt;
  const step = (fluid: CleaningSnapshot['fluid'], over: Partial<CleaningSnapshot> = {}): CleaningSnapshot => ({
    program: 'cip',
    step: fluid === 'water' ? 'rinse' : fluid,
    fluid,
    stepIndex: 1,
    stepCount: 5,
    stepRemainingS: 600,
    tempC: fluid === 'acid' ? 68 : 78,
    flowLph: 12_000,
    concentrationPct: fluid === 'lye' ? 1.8 : fluid === 'acid' ? 0.8 : null,
    returnConductivityMsPerCm: 60,
    returnTo: fluid === 'water' ? 'drain' : `${fluid}Tank`,
    ...over,
  });
  const withTanks = (changes: Record<number, CleaningSnapshot | null>): YogurtSnapshot => ({
    ...opening,
    ferment: {
      ...opening.ferment,
      tanks: opening.ferment.tanks.map((tank, i) => (i in changes ? { ...tank, state: 'cleaning', product: null, levelL: 0, cleaning: changes[i] } : tank)),
    },
  });

  it('all stand as the plant opens: no label but "standing by", no fluid in a pipe', () => {
    const circuits = cipCircuits(opening);
    for (const id of CIP_CIRCUIT_IDS) expect(circuits[id]).toMatchObject({ running: false, fluid: null, what: '' });
    expect(yogurtPipeCleaning(opening)).toEqual({ heat: null, tanks: null, p8: null });
    expect(cipStationLabelText(opening)).toBe('standing by');
    expect(cipStationLabelText(undefined)).toBe('');
  });

  it('runs the tanks\' circuit for the tank furthest into its clean, and names it on the label', () => {
    const y = withTanks({ 0: step('acid', { stepIndex: 3, stepRemainingS: 100 }), 2: step('lye') });
    expect(cleaningTanks(y)).toEqual([0, 2]);
    expect(cipCircuits(y).tanks).toMatchObject({ running: true, fluid: 'acid', tempC: 68, what: 'tank 1', returnTo: 'acidTank' });
    expect(cipStationLabelText(withTanks({ 1: step('lye') }))).toBe('tank 2 · NaOH 1.8% · 78 °C');
    // A tank cleaning in a snapshot older than v13 shows water.
    expect(cipCircuits(withTanks({ 1: null })).tanks).toMatchObject({ running: true, fluid: 'water', returnTo: 'drain' });
    expect(tankInUse(cipCircuits(y), 'acid')).toBe(true);
    expect(tankInUse(cipCircuits(y), 'water')).toBe(false);
  });

  it('runs the heat treatment\'s after a divert and P8\'s in a rinse or a CIP, never in an SIP; two at once share the label', () => {
    const heat: YogurtSnapshot = { ...opening, heat: { ...opening.heat, mode: 'cleaning', cleaning: step('water', { step: 'preRinse', stepIndex: 0, tempC: 45 }) } };
    expect(cipCircuits(heat).heat).toMatchObject({ running: true, fluid: 'water', tempC: 45, what: 'the heat treatment' });
    expect(cipStationLabelText(heat)).toBe('heat treatment · water · 45 °C');
    const rinse: YogurtSnapshot = { ...opening, buffer: { ...opening.buffer, changeover: { kind: 'rinse', remainingS: 600, cleaning: null } } };
    expect(cipCircuits(rinse).p8).toMatchObject({ running: true, fluid: 'water', returnTo: 'drain', what: 'the buffer and the fruit line' });
    const sip: YogurtSnapshot = { ...opening, buffer: { ...opening.buffer, changeover: { kind: 'sip', remainingS: 600, cleaning: null } } };
    expect(cipCircuits(sip).p8.running).toBe(false);
    const both: YogurtSnapshot = { ...heat, buffer: { ...opening.buffer, changeover: { kind: 'cip', remainingS: 4_000, cleaning: step('lye') } } };
    expect(cipStationLabelText(both)).toBe('heat treatment + P8');
    expect(yogurtPipeCleaning(both)).toEqual({ heat: { fluid: 'water', flowLph: 12_000 }, tanks: null, p8: { fluid: 'lye', flowLph: 12_000 } });
  });
});

describe('where the station stands', () => {
  stubTheme();
  const items = yogurtLine(makeContext());
  const machines = items.filter((item) => !item.object.userData.tokens);
  const zone = ZONES.find((each) => each.id === 'yogurtProcess');
  if (!zone) throw new Error('no process hall');

  it('stands in the process hall, between the reprocess tank and tank 1, behind the line', () => {
    const parts = cipStationParts();
    const y = createSim(plantConfig).snapshot().yogurt;
    const pose: Pose = { position: new THREE.Vector3(), rotation: new THREE.Euler(), size: new THREE.Vector3() };
    for (const part of parts) {
      expect(part.machine).toBe(CIP_STATION_ID);
      part.pose(0, y, pose);
      expect(pose.position.x, part.name).toBeGreaterThan(-29.5);
      expect(pose.position.x, part.name).toBeLessThan(-25.4);
      expect(pose.position.z, part.name).toBeGreaterThan(zone.rect.zMinM);
      expect(pose.position.z, part.name).toBeLessThan(at.LINE_Z_M - 3);
    }
    expect(new Set(parts.map((part) => part.name)).size).toBe(parts.length);
  });

  it('keeps each line clear of every machine but where it starts or ends at one', () => {
    const boxes = machines
      .filter((item) => item.id !== 'reprocess-tank')
      .map((item) => {
        item.object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(item.object).expandByScalar(0.06);
        // Under a fermentation tank only its legs reach the floor: its box starts at its cone's tip there, and the
        // legs are checked one by one below.
        if (item.id.startsWith('ferment-tank-')) box.min.y = at.FERMENT_TANK.legsM - 0.06;
        return { id: item.id, box };
      });
    // The fermentation tanks' legs: 0.07 m round, on a circle of 0.72 × the radius (vessel()), the first at 0.4 rad.
    for (const [t, xM] of at.FERMENT_TANK.xsM.entries()) {
      for (let i = 0; i < 4; i++) {
        const a = 0.4 + (i * Math.PI) / 2;
        const lx = xM + at.FERMENT_TANK.radiusM * 0.72 * Math.cos(a);
        const lz = at.FERMENT_TANK.zM + at.FERMENT_TANK.radiusM * 0.72 * Math.sin(a);
        const reach = 0.07 + 0.06;
        boxes.push({ id: `tank ${t + 1} leg ${i + 1}`, box: new THREE.Box3(new THREE.Vector3(lx - reach, 0, lz - reach), new THREE.Vector3(lx + reach, at.FERMENT_TANK.legsM, lz + reach)) });
      }
    }
    // The reprocess tank's own vessel and pump; the station beside it joins its meshes (its box spans both).
    const tank = at.REPROCESS_TANK;
    boxes.push({ id: 'reprocess tank vessel', box: new THREE.Box3(new THREE.Vector3(tank.xM - tank.radiusM - 0.06, 0, tank.zM - tank.radiusM - 0.06), new THREE.Vector3(at.REPROCESS_PUMP.xM + 0.3, 2.3, tank.zM + tank.radiusM + 0.06)) });
    for (const line of YOGURT_CIP_LINES) {
      const points = line.pointsM.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const first = points[0] ?? new THREE.Vector3();
      const last = points.at(-1) ?? new THREE.Vector3();
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i] ?? new THREE.Vector3();
        const b = points[i + 1] ?? new THREE.Vector3();
        const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.1));
        for (let k = 0; k <= steps; k++) {
          const p = a.clone().lerp(b, k / steps);
          // A port: where the line leaves or meets its machine.
          if (p.distanceTo(first) < 0.6 || p.distanceTo(last) < 0.6) continue;
          for (const { id, box } of boxes) expect(box.containsPoint(p), `${line.id} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) in ${id}`).toBe(false);
        }
      }
    }
  });

  it('runs every line inside the wing\'s floor, and its supplies and returns from the station\'s lanes', () => {
    for (const line of YOGURT_CIP_LINES) {
      for (const [x, y, z] of line.pointsM) {
        expect(z, line.id).toBeGreaterThan(-56);
        expect(z, line.id).toBeLessThan(at.LINE_Z_M + 2);
        expect(x, line.id).toBeGreaterThan(-43);
        expect(x, line.id).toBeLessThan(16);
        expect(y, line.id).toBeLessThan(5);
      }
    }
    const lanes = at.CIP_STATION.laneXsM;
    expect(YOGURT_CIP_LINES.filter((line) => line.id.endsWith('-supply')).map((line) => line.pointsM[0]?.[0])).toEqual(lanes.map((x) => x + at.CIP_STATION.supplyDxM));
    expect(YOGURT_CIP_LINES.filter((line) => /^y-cip-(heat|tanks|p8)-return$/.test(line.id)).map((line) => line.pointsM.at(-1)?.[0])).toEqual(lanes.map((x) => x + at.CIP_STATION.returnDxM));
  });
});

describe('the station on the live sim (phase 32)', () => {
  it('stands as the plant opens, with its tanks\' plates in their fluids\' colours and its screen dark', () => {
    const w = wing();
    w.frames(2);
    const state = w.state(CIP_STATION_ID);
    expect(state).toMatchObject({
      waterTankPlateColor: hex(FLUID_HEX.water),
      lyeTankPlateColor: hex(FLUID_HEX.lye),
      acidTankPlateColor: hex(FLUID_HEX.acid),
      waterLampColor: OFF,
      lyeLampColor: OFF,
      heatPumpMoving: false,
      tanksPumpMoving: false,
      p8PumpMoving: false,
      screenColor: '#1d2328',
      screenReading: 0,
    });
    expect(w.items.get(CIP_STATION_ID)?.labelText(w.sim.snapshot())).toBe('standing by');
    expect(w.state('ferment-tank-2').cipHeaderColor).toBe(METAL);
  });

  it('cleans tank 1 when it empties: its pump spins up, its heater shows the step\'s heat, its return goes to drain, then back to the lye tank', () => {
    const w = wing();
    w.frames(1);
    runUntil(w, (snap) => tankStep(snap, 0)?.step === 'lye');
    w.frames(30, 0.1);
    let snap = w.sim.snapshot();
    expect(tankStep(snap, 0)?.step).toBe('lye');
    let state = w.state(CIP_STATION_ID);
    expect(state).toMatchObject({ tanksPumpMoving: true, tanksPumpCrossMoving: true, heatPumpMoving: false, p8PumpMoving: false, lyeLampColor: hex(FLUID_HEX.lye), tanksLampColor: '#ffd84a', screenColor: '#4aa3ff' });
    expect(state.tanksHeaterColor).toBe(`#${wingTempColor(78, new THREE.Color()).getHexString()}`);
    // A few seconds into the lye the return still carries the rinse water out to the drain, and the drain splashes.
    expect(state).toMatchObject({ tanksToDrainColor: hex(FLUID_HEX.lye), tanksToTankColor: OFF, tanksSplashMoving: true });
    expect(Number(state.tanksConductivityReading)).toBeLessThan(42.1);
    // Past the change-over at half the lye's 84.2 mS/cm (about 62 s, H139): back to the lye tank.
    runUntil(w, (each) => (tankStep(each, 0)?.returnTo ?? '') === 'lyeTank');
    w.frames(30, 0.1);
    state = w.state(CIP_STATION_ID);
    expect(state).toMatchObject({ tanksToTankLift: 1, tanksToTankColor: hex(FLUID_HEX.lye), tanksToDrainLift: 0, tanksSplashMoving: false });
    expect(Number(state.tanksConductivityReading)).toBeGreaterThan(42.1);
    // Over the tanks: the header and tank 1's drop carry the lye, its sight glass streams; tank 2's drop is plain.
    expect(w.state('ferment-tank-2').cipHeaderColor).toBe(hex(FLUID_HEX.lye));
    expect(w.state('ferment-tank-1')).toMatchObject({ cipDropColor: hex(FLUID_HEX.lye), cipSpray1Moving: true, cipSpray1Color: hex(FLUID_HEX.lye) });
    expect(w.state('ferment-tank-2')).toMatchObject({ cipDropColor: METAL, cipSpray1Moving: false });
    expect(w.items.get(CIP_STATION_ID)?.labelText(w.sim.snapshot())).toBe('tank 1 · NaOH 1.8% · 78 °C');
    // Paused, it all stands.
    w.sim.dispatch({ type: 'pause', paused: true });
    w.frames(1);
    const paused = w.state(CIP_STATION_ID);
    w.frames(5);
    expect(w.state(CIP_STATION_ID).tanksPumpTurns).toBe(paused.tanksPumpTurns);
    w.sim.dispatch({ type: 'pause', paused: false });
    // The acid: its tank's lamp lights; the clean's end: all stand again, the pump running down over a second.
    runUntil(w, (each) => tankStep(each, 0)?.step === 'acid');
    w.frames(2);
    expect(w.state(CIP_STATION_ID)).toMatchObject({ acidLampColor: hex(FLUID_HEX.acid) });
    snap = runUntil(w, (each) => each.yogurt.ferment.tanks[0]?.state !== 'cleaning');
    expect(tankStep(snap, 0)).toBeNull();
    w.frames(20, 0.1);
    expect(w.state(CIP_STATION_ID)).toMatchObject({ tanksPumpMoving: false, tanksLampColor: OFF, screenColor: '#1d2328' });
    expect(w.state('ferment-tank-1')).toMatchObject({ cipDropColor: METAL, cipSpray1Moving: false });
  });

  it('runs P8\'s circuit with water to the drain in the rinse at 14:00', () => {
    const w = wing();
    w.frames(1);
    runUntil(w, (snap) => snap.yogurt.buffer.changeover?.kind === 'rinse');
    w.frames(20, 0.1);
    expect(w.state(CIP_STATION_ID)).toMatchObject({ p8PumpMoving: true, p8ToDrainLift: 1, p8ToDrainColor: hex(FLUID_HEX.water), p8SplashMoving: true, waterLampColor: hex(FLUID_HEX.water) });
  });
});
