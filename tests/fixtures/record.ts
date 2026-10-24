// Recorded snapshots of the live sim in states the 3D view and the panels must show (agent plan,
// "Contracts": qa keeps recorded snapshot fixtures), so `scene` and `ui` can build and test a state's
// visuals without running the model to it. Each one comes from createSim with the shipped plant.json
// (seed 81006), driven only through the Sim interface: commands, then 0.1 s frames.
//
// Re-record after a model change, then review the JSON diff:
//
//   RECORD_FIXTURES=1 npx vitest run tests/fixtures
//
// Without RECORD_FIXTURES, tests/fixtures/fixtures.test.ts records each state afresh and fails if it no
// longer matches its file, so a model change shows up as a fixture diff rather than going unnoticed.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Command, PlantConfig, Snapshot, Speed } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

export type FixtureName = 'production' | 'divert' | 'throttled';

export interface FixtureSpec {
  /** What the snapshot shows, for the file's readers. */
  description: string;
  /** Sim seconds after the plant opens (21,600 s, day 1 06:00) at which the snapshot is taken. */
  atS: number;
  /** Commands sent at given sim seconds after opening, in order; the clock runs at `speed` in between. */
  commands: { atS: number; command: Command }[];
  /** The speed the clock runs at while recording; the snapshot is taken after setting ×10 back. */
  speed: Speed;
}

/** One 0.1 s frame, as main.ts runs them (plant.json's maxFrameS). */
const FRAME_S = 0.1;

export const FIXTURES: Readonly<Record<FixtureName, FixtureSpec>> = {
  production: {
    description: 'Steady production 10 min after opening: full flow, 140 °C, the aseptic tank filling at 1,000 L/h.',
    atS: 600,
    commands: [],
    speed: 10,
  },
  divert: {
    description:
      'Diverting: the UHT set point went to 138.9 °C at 600 s (under the 139.22 °C limit whatever the noise, H88), ' +
      'so the plant diverted on that step; 90 s into the 3 min divert, about 400 L in the reject tank.',
    atS: 690,
    commands: [{ atS: 600, command: { type: 'setSetpoint', key: 'uhtSetpointC', value: 138.9 } }],
    speed: 10,
  },
  throttled: {
    description:
      'Throttled: the aseptic tank passed 90% at 8 h (H33), so the UHT plant runs at 50% (8,000 L/h, 8 s hold, ' +
      'B* 2.37, H15); 8.5 h after opening, before it falls back to 60% at 8 h 51 min (H34).',
    atS: 30_600,
    commands: [],
    speed: 1_000,
  },
};

/** Runs a fresh createSim to the fixture's state and returns its snapshot as plain JSON data. */
export function recordFixture(name: FixtureName, config: PlantConfig = plantConfig): Snapshot {
  const spec = FIXTURES[name];
  const sim = createSim(config);
  const openS = sim.snapshot().timeS;
  const sinceOpenS = () => sim.snapshot().timeS - openS;
  sim.dispatch({ type: 'setSpeed', speed: spec.speed });
  const runTo = (targetS: number) => {
    // Whole frames, and a shorter last one, so the run lands on the target without overshooting it.
    while (sinceOpenS() < targetS) sim.step(Math.min(FRAME_S, (targetS - sinceOpenS()) / spec.speed));
  };
  for (const { atS, command } of spec.commands) {
    runTo(atS);
    sim.dispatch(command);
  }
  runTo(spec.atS);
  sim.dispatch({ type: 'setSpeed', speed: 10 });
  return JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot;
}

export const fixtureUrl = (name: FixtureName): URL => new URL(`snapshot-${name}.json`, import.meta.url);

/** A recorded fixture as stored in tests/fixtures/snapshot-<name>.json. */
export function loadFixture(name: FixtureName): Snapshot {
  return JSON.parse(readFileSync(fixtureUrl(name), 'utf8')) as Snapshot;
}

export function writeFixture(name: FixtureName, snapshot: Snapshot): void {
  writeFileSync(fixtureUrl(name), `${JSON.stringify(snapshot, null, 2)}\n`);
}
