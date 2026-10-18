// Contracts v2 (phase 3): Snapshot.liquid, the liquid line's modes, tank levels and filler draw that
// the 3D view and the panels read. Checked for both sims the app can run, as contracts v1 is.
import { describe, expect, it } from 'vitest';
import { UHT_MODES, dayToS, type PlantConfig, type Sim, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { plantConfig } from '../helpers/plantConfig';

const SIMS: [string, (config: PlantConfig) => Sim][] = [
  ['createSim', createSim],
  ['createMockSim', createMockSim],
];

function expectWellFormedLiquid(snap: Snapshot, where: string): void {
  const { liquid } = snap;
  expect(UHT_MODES, `${where}: uhtMode`).toContain(liquid.uhtMode);
  expect(typeof liquid.throttled, `${where}: throttled`).toBe('boolean');
  expect(typeof liquid.fillersStarved, `${where}: fillersStarved`).toBe('boolean');
  for (const key of ['modeRemainingS', 'fillersRunning', 'headspaceBar', 'productionSinceCleanS', 'divertCount'] as const) {
    const value = liquid[key];
    if (!(Number.isFinite(value) && value >= 0)) expect.fail(`${where}: liquid.${key} is ${value}`);
  }
  expect(Object.keys(liquid.tanks).sort(), `${where}: tanks`).toEqual(['asepticTank', 'mixTank', 'rejectTank', 'silo']);
  for (const [name, { levelL, capacityL }] of Object.entries(liquid.tanks)) {
    if (!(capacityL > 0 && levelL >= 0 && levelL <= capacityL)) expect.fail(`${where}: ${name} holds ${levelL} of ${capacityL} L`);
  }
}

describe.each(SIMS)('%s: Snapshot.liquid', (name, create) => {
  it('is well formed at creation', () => {
    expectWellFormedLiquid(create(plantConfig).snapshot(), name);
  });

  it('stays well formed over a week at ×10,000', () => {
    const sim = create(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const frames = dayToS(7) / (0.02 * 10_000);
    for (let i = 0; i < frames; i++) {
      sim.step(0.02);
      if (i % 50 === 0) expectWellFormedLiquid(sim.snapshot(), `${name} frame ${i}`);
    }
  });

  it('opens with the plant.json tank sizes (the static plant also with its levels, in production)', () => {
    const { liquid } = create(plantConfig).snapshot();
    const { standardization: std, asepticTank: tank, uht } = plantConfig;
    expect(liquid.tanks.silo.capacityL).toBe(std.siloCapacityL);
    expect(liquid.tanks.mixTank.capacityL).toBe(std.mixTankCapacityL);
    expect(liquid.tanks.asepticTank.capacityL).toBe(tank.capacityL);
    expect(liquid.tanks.rejectTank.capacityL).toBe(uht.rejectTankL);
    if (name !== 'createSim') return;
    expect(liquid.uhtMode).toBe('production');
    expect(liquid.tanks.asepticTank.levelL).toBe(tank.capacityL * tank.startFrac);
    expect(liquid.tanks.silo.levelL).toBe(std.siloCapacityL * std.siloStartFrac);
  });
});
