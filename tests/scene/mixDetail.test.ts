// The yogurt mix room's fittings and motion (phase 29, D31, src/scene/equipment/yogurt/mixDetail.ts): stage 11's
// machines keep their meshes (the grey fittings join them), and their new parts move with the mix flow: the silo's
// pump, valve and agitator, the powder station's filter fan, bag gauge and panel, the mixer's motor fan and powder
// specks, the stabilizer drums' agitators and levels, and the mix tank's valves.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sim, Snapshot } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import * as at from '../../src/scene/equipment/yogurt/layout';
import { bagFrac, createMixUse, drumFrac, mixDetailParts, onSilo, POWDER_BAG_KG, SILO_FITTINGS, STABILIZER_DRUM_L } from '../../src/scene/equipment/yogurt/mixDetail';
import { HEX } from '../../src/scene/equipment/yogurt/motionParts';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
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

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const STAGE_11 = ['yogurt-silo', 'powder-station', 'high-shear-mixer', 'stabilizer-skid', 'yogurt-mix-tank'] as const;

interface Room {
  sim: Sim;
  items: Map<string, Equipment>;
  frames(count: number, realDtS?: number): Snapshot;
  state(id: string): Record<string, number | string | boolean>;
}

function room(): Room {
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

describe('the mix room\'s count of what it has used', () => {
  it('adds the mix flow up over sim time, and starts over when the clock goes back', () => {
    const use = createMixUse();
    const at_ = (timeS: number, flowLph: number): Snapshot => ({ timeS, yogurt: { mix: { flowLph } } }) as unknown as Snapshot;
    use.observe(at_(1_000, 6_000));
    expect(use.mixL).toBe(0);
    use.observe(at_(1_600, 6_000));
    expect(use.mixL).toBeCloseTo(1_000, 9); // 6,000 L/h for 10 min
    use.observe(at_(2_200, 0));
    expect(use.mixL).toBeCloseTo(1_000, 9); // standing: nothing more
    use.observe(at_(500, 6_000));
    expect(use.mixL).toBe(0);
  });

  it('empties a 1,000 kg bag in about 6 h at 27 kg a tonne and 6,000 L/h, and hangs a new one', () => {
    expect(POWDER_BAG_KG).toBe(1_000);
    expect(bagFrac(0, 27)).toBe(1);
    expect(bagFrac(18_518.5, 27)).toBeCloseTo(0.5, 4); // half the bag: 500 kg ÷ 27 kg/t = 18.5 t of mix
    // The whole bag at 37,037 L, 6.17 h at 6,000 L/h; the next bag starts full.
    expect(bagFrac(37_000, 27)).toBeCloseTo(0.001, 3);
    expect(bagFrac(37_100, 27)).toBeGreaterThan(0.99);
  });

  it('draws the duty drum down in about an hour and switches to the other, which then stands refilled', () => {
    // 0.3% stabilizer as a 10% solution: 3 L of solution to 100 L of mix, so a 200 L drum does 6,667 L of mix.
    expect(STABILIZER_DRUM_L).toBe(200);
    expect([drumFrac(0, 0), drumFrac(1, 0)]).toEqual([1, 1]);
    expect(drumFrac(0, 3_333.33)).toBeCloseTo(0.5, 4);
    expect(drumFrac(1, 3_333.33)).toBe(1);
    expect(drumFrac(0, 7_000)).toBe(1);
    expect(drumFrac(1, 7_000)).toBeCloseTo(0.95, 3);
  });
});

describe('the mix room\'s parts (phase 29)', () => {
  it('belong to stage 11\'s five machines, with names of their own in each', () => {
    const parts = mixDetailParts();
    expect([...new Set(parts.map((part) => part.machine))].sort()).toEqual([...STAGE_11].sort());
    const names = parts.map((part) => `${part.machine}/${part.name}`);
    expect(new Set(names).size).toBe(names.length);
    expect(parts.length).toBe(30);
  });

  it('cost no draw call: each stage 11 machine keeps the meshes it had, and the parts are the shared boxes\'', () => {
    const r = room();
    // Meshes, and those of them that cast a shadow, as before phase 29.
    const expected: Record<(typeof STAGE_11)[number], [number, number]> = {
      'yogurt-silo': [3, 1],
      'powder-station': [3, 1],
      'high-shear-mixer': [2, 0],
      'stabilizer-skid': [2, 0],
      'yogurt-mix-tank': [4, 1],
    };
    for (const id of STAGE_11) {
      let meshes = 0;
      let casters = 0;
      r.items.get(id)?.object.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes += 1;
        if (object.castShadow) casters += 1;
      });
      expect([meshes, casters], id).toEqual(expected[id]);
    }
  });

  it('stand the silo\'s fittings on its shell and its outlet pipe, clear of its gauge and ladder', () => {
    const { xM, zM, radiusM } = at.SILO;
    // The pump and the valve are on the pipe east of the shell, before the mixer.
    expect(SILO_FITTINGS.valveXM).toBeGreaterThan(xM + radiusM + 0.1);
    expect(SILO_FITTINGS.pumpXM).toBeGreaterThan(SILO_FITTINGS.valveXM + 0.3);
    expect(SILO_FITTINGS.pumpXM).toBeLessThan(at.MIXER.xM - 0.9);
    for (const rad of [SILO_FITTINGS.agitatorRad, SILO_FITTINGS.manwayRad, SILO_FITTINGS.riserRad]) {
      const [px, pz] = onSilo(rad);
      expect(Math.hypot(px - xM, pz - zM)).toBeCloseTo(radiusM, 9);
      // Not on the gauge (straight to the aisle, rad 0) nor the ladder (rad −π/2).
      expect(Math.abs(rad)).toBeGreaterThan(0.3);
      expect(Math.abs(rad + Math.PI / 2)).toBeGreaterThan(0.3);
    }
  });

  it('move with the mix flow at the opening: the pump, the fans, the agitators and the powder turn, the valves stand open', () => {
    const r = room();
    const snap = r.frames(40);
    expect(snap.yogurt.mix.flowLph).toBeGreaterThan(0);
    const silo = r.state('yogurt-silo');
    expect(silo.pumpRotorMoving).toBe(true);
    expect(silo.pumpRotorTurns).toBeGreaterThan(0);
    expect(silo.agitatorFanMoving).toBe(true);
    expect(silo.outletValveLift).toBe(1);
    expect(silo.outletValveColor).toBe(css(HEX.open));
    expect(silo.tempDisplayColor).toBe(css(HEX.chilled));
    const powder = r.state('powder-station');
    expect(powder.filterFanMoving).toBe(true);
    expect(powder.screenColor).toBe(css(HEX.screen));
    expect(powder.runLampColor).toBe(css(HEX.open));
    const mixer = r.state('high-shear-mixer');
    expect(mixer.motorFanMoving).toBe(true);
    for (const speck of ['speck1', 'speck2', 'speck3']) expect(mixer[`${speck}Moving`], speck).toBe(true);
    expect(mixer.outletValveLift).toBe(1);
    const skid = r.state('stabilizer-skid');
    expect(skid.agitator1Moving).toBe(true);
    expect(skid.agitator2Moving).toBe(true);
    expect(r.state('yogurt-mix-tank').inletValveLift).toBe(1);
  });

  it('show the bag and the duty drum falling as mix is made, by the room\'s own count', () => {
    const r = room();
    r.frames(5);
    const first = r.state('powder-station');
    expect(first.bagLevelReading).toBeGreaterThan(99);
    // An hour of mixing at ×1,000, every machine updated each frame so the count sees it.
    r.sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    const before = r.sim.snapshot().timeS;
    let mixL = 0;
    let lastS = before;
    for (let i = 0; i < 36; i++) {
      const snap = r.frames(1);
      mixL += (snap.yogurt.mix.flowLph * (snap.timeS - lastS)) / 3_600;
      lastS = snap.timeS;
    }
    expect(mixL).toBeGreaterThan(1_000);
    const snap = r.sim.snapshot();
    // The reading is the room's count; the count is what the sim's flow adds up to over the frames (it reads the flow
    // at each frame's end, as this sum does), to the display's 0.1.
    expect(Number(r.state('powder-station').bagLevelReading)).toBeCloseTo(bagFrac(mixL, snap.yogurt.mix.powderKgPerT) * 100, 0);
    expect(Number(r.state('stabilizer-skid').drum1LevelReading)).toBeCloseTo(drumFrac(0, mixL) * 100, 0);
    expect(Number(r.state('stabilizer-skid').drum1LevelReading)).toBeLessThan(100);
    expect(r.state('stabilizer-skid').drum2LevelReading).toBe(100);
  });

  it('stand still once the mix line stands, with the valves shut and the screen dark; the agitator turns on', () => {
    const r = room();
    r.frames(5);
    const snap = runUntil(r, (s) => s.yogurt.mix.flowLph === 0);
    expect(snap.yogurt.mix.flowLph).toBe(0);
    // A few seconds at ×1 for the stems to come down.
    r.frames(30);
    const silo = r.state('yogurt-silo');
    expect(silo.pumpRotorMoving).toBe(false);
    expect(silo.outletValveLift).toBe(0);
    expect(silo.outletValveColor).toBe(css(HEX.off));
    // The silo still holds milk: its agitator turns on.
    expect(silo.agitatorFanMoving).toBe(true);
    expect(r.state('powder-station').filterFanMoving).toBe(false);
    expect(r.state('powder-station').screenColor).toBe(css(HEX.screenDark));
    expect(r.state('high-shear-mixer').motorFanMoving).toBe(false);
    expect(r.state('stabilizer-skid').agitator1Moving).toBe(false);
    expect(r.state('yogurt-mix-tank').inletValveLift).toBe(0);
  });

  it('open the mix tank\'s outlet valve only while the heat treatment draws', () => {
    const r = room();
    r.frames(5);
    const idle = r.sim.snapshot().yogurt.heat.flowLph === 0;
    if (idle) expect(r.state('yogurt-mix-tank').outletValveLift).toBe(0);
    runUntil(r, (s) => s.yogurt.heat.mode === 'production' && s.yogurt.heat.flowLph > 0);
    r.frames(30);
    expect(r.state('yogurt-mix-tank').outletValveLift).toBe(1);
    expect(r.state('yogurt-mix-tank').outletValveColor).toBe(css(HEX.open));
  });

  it('stand still while the sim is paused', () => {
    const r = room();
    r.frames(20);
    r.sim.dispatch({ type: 'pause', paused: true });
    r.frames(1);
    const held = STAGE_11.map((id) => JSON.stringify(r.state(id)));
    r.frames(20);
    expect(STAGE_11.map((id) => JSON.stringify(r.state(id)))).toEqual(held);
  });
});
