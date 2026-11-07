// The yogurt line's process flow (src/ui/processFlow.ts, phase 22): the steps of src/data/yogurtFlow.json, each with a
// reading, and the states they show on the live sim: at the opening, on the set route, in a divert and with P8 stopped.
import { describe, expect, it } from 'vitest';
import { hToS, YOGURT_STAGE_IDS, type Sim, type Snapshot, type YogurtStageId } from '../../src/contracts';
import flowJson from '../../src/data/yogurtFlow.json';
import { createSim } from '../../src/sim';
import { dotPeriodS, FLOW_READERS, parseYogurtFlow, processFlow, YOGURT_FLOW, type FlowState } from '../../src/ui/processFlow';
import { plantConfig } from '../helpers/plantConfig';

/** Each step's state, by id, for one stage. */
const states = (stage: YogurtStageId, snap: Snapshot): Record<string, FlowState> =>
  Object.fromEntries((processFlow(stage, snap)?.steps ?? []).map((step) => [step.id, step.state]));
const textOf = (stage: YogurtStageId, snap: Snapshot, id: string): string => processFlow(stage, snap)?.steps.find((step) => step.id === id)?.text ?? '';

/** Runs the sim at ×1,000 for `seconds`, or until `until` holds. */
function run(sim: Sim, seconds: number, until?: (snap: Snapshot) => boolean): Snapshot {
  sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  const endS = sim.snapshot().timeS + seconds;
  let snap = sim.snapshot();
  while (snap.timeS < endS && !until?.(snap)) {
    sim.step(0.1);
    snap = sim.snapshot();
  }
  return snap;
}

describe('src/data/yogurtFlow.json', () => {
  it('gives each yogurt stage its steps, each with a name and what happens there, and the panel a reading for each', () => {
    expect([...YOGURT_FLOW.keys()]).toEqual([...YOGURT_STAGE_IDS]);
    for (const stage of YOGURT_STAGE_IDS) {
      expect(YOGURT_FLOW.get(stage)?.map((step) => step.id), `stage ${stage}`).toEqual(FLOW_READERS[stage]);
      for (const step of YOGURT_FLOW.get(stage) ?? []) expect(step.does, `${stage}.${step.id}`).toMatch(/^[A-Z0-9].{20,}[.]$/);
    }
  });

  it('refuses a file that misses a stage, repeats a step or leaves out what one does', () => {
    const copy = () => structuredClone(flowJson) as { stages: { stage: number; steps: Record<string, unknown>[] }[] };
    const missing = copy();
    missing.stages.pop();
    expect(() => parseYogurtFlow(missing)).toThrow(/has no stage 16/);
    const twice = copy();
    twice.stages[0]?.steps.push({ ...twice.stages[0]?.steps[0] });
    expect(() => parseYogurtFlow(twice)).toThrow(/appears twice/);
    const mute = copy();
    delete mute.stages[2]?.steps[1]?.does;
    expect(() => parseYogurtFlow(mute)).toThrow(/needs an id, a name and what it does/);
    const uht = copy();
    if (uht.stages[0]) uht.stages[0].stage = 4;
    expect(() => parseYogurtFlow(uht)).toThrow(/is not a yogurt stage/);
  });
});

describe('the process flow on the live sim', () => {
  it('opens with tank 1 emptying into the buffer, tank 2 ready, tank 3 fermenting, the heat treatment idle, set yogurt\'s route skipped', () => {
    const sim = createSim(plantConfig);
    sim.step(0.1);
    const snap = sim.snapshot();
    expect(states(13, snap)).toMatchObject({ inoculation: 'idle', valveMatrix: 'flow', setRoute: 'skip', tank1: 'flow', tank2: 'hold', tank3: 'hold' });
    expect(textOf(13, snap, 'valveMatrix')).toBe('tank 1 emptying');
    expect(textOf(12, snap, 'hotWater')).toBe('Standing: no steam');
    expect(Object.values(states(12, snap)).every((state) => state === 'idle' || state === 'skip')).toBe(true);
    expect(states(12, snap).reprocess).toBe('skip');
    expect(states(14, snap)).toMatchObject({ smoothing: 'flow', cooler: 'flow', fruit: 'skip', buffer: 'flow' });
    expect(textOf(14, snap, 'cooler')).toBe('out at 18 °C');
    expect(states(16, snap)).toMatchObject({ warmRoom: 'hold', chiller: 'hold', coldRoom: 'hold' });
    expect(textOf(16, snap, 'coldRoom')).toBe('180 of 360 positions · 3.0 °C');
  });

  it('reads the hot-water set\'s steam and the valve matrix\'s open valves in production (phase 25)', () => {
    const sim = createSim(plantConfig);
    const snap = run(sim, hToS(8), (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0 && each.yogurt.ferment.tanks.some((tank) => tank.state === 'filling'));
    expect(states(12, snap)).toMatchObject({ heating: 'flow', hotWater: 'flow' });
    expect(textOf(12, snap, 'hotWater')).toBe(`${Math.round(snap.yogurt.energy?.steamKgPerH ?? 0)} kg/h of steam into the circuit`);
    const filling = snap.yogurt.ferment.tanks.findIndex((tank) => tank.state === 'filling');
    expect(states(13, snap).valveMatrix).toBe('flow');
    expect(textOf(13, snap, 'valveMatrix')).toContain(`tank ${filling + 1} filling`);
  });

  it('runs P8\'s stations once it fills, with a reading at each, and a flow rate for the dots', () => {
    const sim = createSim(plantConfig);
    const snap = run(sim, 120, (each) => each.yogurt.p8.state === 'running');
    const p8 = processFlow(15, snap);
    expect(p8?.steps.every((step) => step.state === 'flow' && step.text.length > 0)).toBe(true);
    expect(p8?.rateFrac).toBe(1);
    expect(textOf(15, snap, 'coder')).toMatch(/^batch P8-008-1$/);
    expect(textOf(15, snap, 'filler')).toMatch(/^last cup 1\d\d\.\d g · 30 cycles a min$/);
    expect(dotPeriodS(p8?.rateFrac ?? 0)).toBe(1.6);
  });

  it('reads the palletizer\'s layer and trays and the wrapper\'s last pallet (phase 24)', () => {
    const sim = createSim(plantConfig);
    const snap = run(sim, 600, (each) => each.yogurt.p8.state === 'running' && (each.yogurt.coldChain.trays?.openTrays ?? 0) > 8);
    const trays = snap.yogurt.coldChain.trays?.openTrays ?? 0;
    expect(textOf(16, snap, 'palletizer')).toBe(`layer ${Math.floor(trays / 8) + 1} of 15 · ${trays} of 120 trays`);
    expect(textOf(16, snap, 'wrapper')).toMatch(/^last: pallet \d+ of P8-00\d-\d, \d+ trays · closed .+ ago$/);
    expect(states(16, snap)).toMatchObject({ palletizer: 'flow', wrapper: 'flow' });
  });

  it('on the set route skips the smoothing and the cooler, sends the mix straight to the buffer, and fills the warm room', () => {
    const sim = createSim(plantConfig);
    // Plain set yogurt from 22:00; the wing's CIP and P8's SIP first.
    const snap = run(sim, hToS(20), (each) => each.yogurt.product.route === 'set' && each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    expect(snap.yogurt.product.id).toBe('plainSet');
    expect(states(13, snap)).toMatchObject({ inoculation: 'flow', setRoute: 'flow' });
    expect(states(14, snap)).toMatchObject({ smoothing: 'skip', cooler: 'skip', fruit: 'skip' });
    expect(textOf(14, snap, 'cooler')).toBe('Set yogurt skips it');
  });

  it('shows a divert on the valve and the reprocess tank, red, with nothing forward; then the clean, amber', () => {
    const sim = createSim(plantConfig);
    run(sim, hToS(8), (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    sim.dispatch({ type: 'setSetpoint', key: 'yogurtHeatC', value: 80 });
    const divert = run(sim, 1_800, (each) => each.yogurt.heat.mode === 'divert');
    expect(states(12, divert)).toMatchObject({ divertValve: 'bad', reprocess: 'bad', cooling: 'idle', holdingCell: 'bad' });
    expect(textOf(12, divert, 'divertValve')).toBe('Diverting: the mix under 85 °C or held too short');
    const cleaning = run(sim, 1_800, (each) => each.yogurt.heat.mode === 'cleaning');
    expect(states(12, cleaning)).toMatchObject({ divertValve: 'warn', deaerator: 'warn', hotWater: 'warn' });
    expect(textOf(12, cleaning, 'divertValve')).toMatch(/^Cleaning after a divert · \d+ (min|h)/);
  });

  it('shows the HEPA loss on the ionized air and UV-C step, red, and every station stopped', () => {
    const sim = createSim(plantConfig);
    run(sim, 120, (each) => each.yogurt.p8.state === 'running');
    sim.dispatch({ type: 'triggerScenario', id: 'yogurtHepaLoss' });
    const snap = run(sim, 30);
    expect(states(15, snap)).toMatchObject({ decontamination: 'bad', filler: 'bad', coder: 'bad' });
    expect(textOf(15, snap, 'decontamination')).toBe('HEPA cabin +5.0 Pa, under +15 Pa');
    expect(textOf(15, snap, 'filler')).toBe('Stopped: the HEPA cabin');
    expect(processFlow(15, snap)?.rateFrac).toBe(0);
    expect(dotPeriodS(0)).toBe(0);
  });

  it('slows the dots with the flow, to at most 6 s a dash', () => {
    expect(dotPeriodS(0.5)).toBeCloseTo(3.2, 6);
    expect(dotPeriodS(0.05)).toBe(6);
    expect(dotPeriodS(1.2)).toBeCloseTo(1.333, 3);
  });
});
