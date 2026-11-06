// The yogurt line in phase 15 (D25): the live sim reports it standing, the mock fills it, and both take the new
// set points and the setYogurtProduct command. The UHT line's mock draws what it drew before.
import { describe, expect, it } from 'vitest';
import { hToS, SETPOINT_RANGES, UHT_STAGE_IDS, YOGURT_STAGE_IDS, type Command, type Sim, type Snapshot } from '../../../src/contracts';
import { createSim } from '../../../src/sim';
import { createMockSim } from '../../../src/sim/mock';
import { uhtFingerprint } from '../../fixtures/uhtPart';
import { expectWellFormedYogurt } from '../../helpers/yogurtShape';
import { plantConfig } from '../../helpers/plantConfig';

const run = (sim: Sim, commands: Command[], seconds: number): Snapshot => {
  for (const command of commands) sim.dispatch(command);
  sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  for (let s = 0; s < seconds / 100; s++) sim.step(0.1);
  return sim.snapshot();
};

describe('the live sim (phase 17)', () => {
  it('opens with the recipe from plant.json, P8 on plain stirred, and a well-formed yogurt snapshot', () => {
    const sim = createSim(plantConfig);
    sim.step(0.1);
    const snap = sim.snapshot();
    expectWellFormedYogurt(snap, plantConfig, 'opening');
    expect(snap.yogurt.mix.powderKgPerT).toBeCloseTo(26.95, 2);
    expect(snap.yogurt.product).toEqual({ id: 'plainStirred', route: 'stirred', fruit: false, next: 'strawberryStirred' });
    expect(snap.yogurt.ferment.tanks.map((tank) => tank.state)).toEqual(['emptying', 'ready', 'fermenting']);
  });

  it('follows the product day at the shift changes: strawberry stirred from 14:00, plain set from 22:00', () => {
    const sim = createSim(plantConfig);
    expect(run(sim, [], hToS(8.5)).yogurt.product).toMatchObject({ id: 'strawberryStirred', next: 'plainSet' });
    expect(run(sim, [], hToS(8)).yogurt.product).toMatchObject({ id: 'plainSet', route: 'set', next: 'plainStirred' });
  });

  it('setYogurtProduct changes the next shift only, logs it, and refuses a product the line does not make', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setYogurtProduct', product: 'plainSet' });
    let snap = sim.snapshot();
    expect(snap.yogurt.product).toMatchObject({ id: 'plainStirred', next: 'plainSet' });
    expect(snap.log.find((entry) => entry.message.startsWith('Yogurt line: the next shift'))).toMatchObject({ kind: 'info', message: 'Yogurt line: the next shift (day 8, 14:00) makes plain set yogurt' });
    snap = run(sim, [], hToS(8.5));
    expect(snap.yogurt.product).toMatchObject({ id: 'plainSet', route: 'set', next: 'plainSet' });
    snap = run(sim, [], hToS(8));
    expect(snap.yogurt.product).toMatchObject({ id: 'plainSet', next: 'plainStirred' });
    sim.dispatch({ type: 'setYogurtProduct', product: 'kefir' as never });
    expect(sim.snapshot().log.find((entry) => /Yogurt product "kefir" not set/.test(entry.message))?.kind).toBe('warn');
  });

  it('takes the yogurt set points inside their ranges and refuses them outside', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'yogurtHeatC', value: 90 });
    sim.dispatch({ type: 'setSetpoint', key: 'fermentTempC', value: 40 });
    sim.dispatch({ type: 'setSetpoint', key: 'p8RateCupsPerH', value: 18_000 });
    let snap = sim.snapshot();
    expect(snap.stages[12].values.setpointC).toBe(90);
    expect(snap.stages[13].values.setpointC).toBe(40);
    // At 40 °C the end pH comes 4 h 16 min after the start (H125).
    expect(snap.stages[13].values.timeToEndS).toBeCloseTo(15_353.9, 1);
    expect(snap.stages[15].values.setRateCupsPerH).toBe(18_000);
    sim.dispatch({ type: 'setSetpoint', key: 'yogurtHeatC', value: SETPOINT_RANGES.yogurtHeatC.max + 1 });
    snap = sim.snapshot();
    expect(snap.stages[12].values.setpointC).toBe(90);
    expect(snap.log[0]).toMatchObject({ kind: 'warn', message: 'Yogurt heat-treatment set point not changed: 96 °C is outside 80–95 °C' });
  });

  it('leaves the UHT line as it is: a yogurt set point and product change no UHT value', () => {
    const plain = createSim(plantConfig);
    const touched = createSim(plantConfig);
    const a = run(plain, [], hToS(6));
    const b = run(touched, [{ type: 'setSetpoint', key: 'yogurtHeatC', value: 82 }, { type: 'setYogurtProduct', product: 'plainSet' }], hToS(6));
    for (const id of UHT_STAGE_IDS) expect(b.stages[id], `stage ${id}`).toEqual(a.stages[id]);
    expect(b.liquid).toEqual(a.liquid);
    expect(b.packs).toEqual(a.packs);
    expect(b.kpis).toEqual(a.kpis);
  });
});

describe('the mock (?mock)', () => {
  it('opens with three tanks at different pH, P8 running and the cold room part full', () => {
    const snap = createMockSim(plantConfig).snapshot();
    expectWellFormedYogurt(snap, plantConfig, 'mock');
    const [first, second, third] = snap.yogurt.ferment.tanks;
    expect(first).toMatchObject({ state: 'fermenting', product: 'plainStirred' });
    expect(first?.ph).toBeCloseTo(5.575, 2);
    expect(second).toMatchObject({ state: 'emptying', ph: 4.55 });
    expect(third).toMatchObject({ state: 'filling', ph: 6.6 });
    expect(snap.yogurt.p8.state).toBe('running');
    expect(snap.yogurt.p8.cupsPerH).toBeGreaterThan(21_000);
    const { positionsUsed } = snap.yogurt.coldChain.coldRoom;
    expect(positionsUsed).toBeGreaterThan(100);
    expect(positionsUsed).toBeLessThan(240);
    for (const id of YOGURT_STAGE_IDS) expect(snap.stages[id].status, `stage ${id}`).toBe('ok');
  });

  it('fills the live line\'s v9 fields: the steam near H125d\'s 255 kg/h at 92 °C, the buffer\'s product, no changeover', () => {
    const sim = createMockSim(plantConfig);
    let snap = sim.snapshot();
    expect(snap.yogurt.energy?.steamKgPerH).toBeGreaterThan(250);
    expect(snap.yogurt.energy?.steamKgPerH).toBeLessThan(260);
    expect(snap.yogurt.buffer).toMatchObject({ product: 'plainStirred', changeover: null });
    expect(snap.yogurt.heat).toMatchObject({ modeRemainingS: 0, cleaning: null });
    snap = run(sim, [], hToS(1));
    expect(snap.yogurt.energy?.steamKg).toBeCloseTo(snap.yogurt.energy?.steamKgPerH ?? 0, -1);
  });

  it('keeps well-formed as the tanks turn over a day, at every shift', () => {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const states = new Set<string>();
    for (let frame = 0; frame < 864; frame++) {
      sim.step(0.01);
      const snap = sim.snapshot();
      expectWellFormedYogurt(snap, plantConfig, `frame ${frame}`);
      for (const tank of snap.yogurt.ferment.tanks) states.add(tank.state);
    }
    expect([...states].sort()).toEqual(['cleaning', 'emptying', 'fermenting', 'filling', 'ready']);
  });

  it('diverts the mix below the CCP\'s 85 °C and counts it, stage 12 red', () => {
    const sim = createMockSim(plantConfig);
    const snap = run(sim, [{ type: 'setSetpoint', key: 'yogurtHeatC', value: 82 }], 600);
    expect(snap.yogurt.heat.mode).toBe('divert');
    expect(snap.stages[12].status).toBe('bad');
    expect(snap.yogurt.heat.divertCount).toBe(1);
    expect(snap.yogurt.kpis.divertedL).toBeCloseTo(1_000, -1);
    expect(snap.yogurt.heat.reprocessTank.levelL).toBeCloseTo(1_000, -1);
  });

  it('draws what it drew before for the UHT line: its own stream feeds the yogurt line', () => {
    // The milk mock's UHT part (tests/fixtures/uhtPart.ts) at opening and after 1 h at ×1,000, as it was at contracts v7.
    const sim = createMockSim(plantConfig);
    const plain = (snap: Snapshot): unknown => JSON.parse(JSON.stringify(snap));
    expect(uhtFingerprint(plain(sim.snapshot()))).toBe('15fb277c58b0ca97566387257c1297c9b12e698dc25a8558ffa8d2ed017ac63c');
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    for (let frame = 0; frame < 360; frame++) sim.step(0.1);
    expect(uhtFingerprint(plain(sim.snapshot()))).toBe('d64cf8eef567206fd991ea9355ab0701a8b892c9aa49bb60840a7ffecd404c7b');
  });
});
