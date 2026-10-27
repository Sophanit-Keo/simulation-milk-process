// Contracts v3 (phase 4): Snapshot.packs, stages 7–10 as the 3D view and the panels read them. Checked for
// both sims the app can run, as contracts v1 and v2 are.
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, dayToS, type PlantConfig, type Sim } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { expectPacksMatchKpis, expectWellFormedPacks } from '../helpers/packsShape';
import { plantConfig } from '../helpers/plantConfig';

const SIMS: [string, (config: PlantConfig) => Sim][] = [
  ['createSim', createSim],
  ['createMockSim', createMockSim],
];

describe('contracts v3', () => {
  it('was frozen at G2: since then fields are only added, and the version is 4 (phase 5)', () => {
    expect(CONTRACT_VERSION).toBe(4);
  });
});

describe.each(SIMS)('%s: Snapshot.packs', (name, create) => {
  it('is well formed at creation, and the KPIs repeat it', () => {
    const snap = create(plantConfig).snapshot();
    expectWellFormedPacks(snap, plantConfig, name);
    expectPacksMatchKpis(snap, name);
  });

  it('stays well formed over a week at ×10,000, and survives a JSON round trip', () => {
    const sim = create(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const frames = dayToS(7) / (0.05 * 10_000);
    for (let i = 0; i < frames; i++) {
      sim.step(0.05);
      if (i % 40 !== 0) continue;
      const snap = sim.snapshot();
      expectWellFormedPacks(snap, plantConfig, `${name} frame ${i}`);
      expectPacksMatchKpis(snap, `${name} frame ${i}`);
      expect(JSON.parse(JSON.stringify(snap.packs))).toEqual(snap.packs);
    }
  });

  it('shows batches on hold, stock and a truck schedule from the opening on (D11)', () => {
    const { packs } = create(plantConfig).snapshot();
    expect(packs.batches.filter((batch) => batch.status === 'hold').length).toBeGreaterThan(0);
    expect(packs.warehouse.palletsInStock).toBeGreaterThan(0);
    expect(packs.fillers.map((filler) => filler.name)).toEqual(['A', 'B']);
  });

  it('is a fresh object every call', () => {
    const sim = create(plantConfig);
    const [a, b] = [sim.snapshot(), sim.snapshot()];
    expect(b.packs).not.toBe(a.packs);
    expect(b.packs.batches).not.toBe(a.packs.batches);
    expect(b.packs.warehouse.stock).not.toBe(a.packs.warehouse.stock);
    expect(b.packs).toEqual(a.packs);
  });
});
