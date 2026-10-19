// src/data/stages.json (process lane) and parseStages (contracts v1): the text and the list of live
// values the stage rail and the info panel show.
import { describe, expect, it } from 'vitest';
import { SECONDS_PER_HOUR, STAGE_IDS, ZONE_IDS, ZONE_NAMES, parseStages, type PlantConfig, type Sim, type StageInfo } from '../../src/contracts';
import stagesJson from '../../src/data/stages.json';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { plantConfig } from '../helpers/plantConfig';

const SIMS: [string, (config: PlantConfig) => Sim][] = [
  ['createSim', createSim],
  ['createMockSim', createMockSim],
];

/**
 * The phase 3 value keys agreed for stages 1–6, which the panel lists (stages.json) and the sim lane adds
 * to the snapshot in parallel. Until a key is in a sim's snapshot it is let off "every value key is in the
 * snapshot" for that sim (the panel shows "—"). Once both sims give a key, the test below fails until the
 * key is taken off this list, so the check is strict again after the merge. Empty since the sim lane merged.
 */
const AWAITING_SIM = new Set<string>([]);

/** The phase 3 keys agreed per stage (contracts v2 notes); stages.json must list every one. */
const PHASE_3_KEYS: Record<number, string[]> = {
  1: ['rawMilkLph', 'surplusCreamLph', 'siloLevelPct', 'mixTankLevelPct'],
  2: ['airPct', 'heatRecoveredKw'],
  3: ['globuleUm', 'creamingRiskPct', 'powerKw'],
  4: ['setpointC', 'tempC', 'flowLph', 'holdS', 'f0Min', 'bStar', 'divertLimitC', 'rejectLevelL'],
  5: ['waterRemovedLph', 'condenserKw'],
  6: ['levelL', 'levelPct', 'capacityL', 'tempC', 'inflowLph', 'outflowLph', 'headspaceBar', 'nextCleanS'],
};

/** A deep copy of stages.json as plain data, for a test to break one thing in. */
const rawStages = (): Record<string, unknown>[] => structuredClone(stagesJson) as unknown as Record<string, unknown>[];

/** The raw entry for a stage, wherever it sits in the array. */
function entryFor(raw: Record<string, unknown>[], id: number): Record<string, unknown> {
  const entry = raw.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`stages.json has no stage ${id} to change`);
  return entry;
}

function valuesOf(entry: Record<string, unknown>): Record<string, unknown>[] {
  return entry.values as Record<string, unknown>[];
}

/** Matches the path parseStages names a problem by, e.g. `stages.json[2].zone`, for the entry of a stage. */
function pathOf(raw: Record<string, unknown>[], id: number, field: string): RegExp {
  const escaped = `[${raw.indexOf(entryFor(raw, id))}].${field}`.replace(/[[\].]/g, '\\$&');
  return new RegExp(`stages\\.json${escaped}`);
}

/** The error parseStages throws for raw, so a test can check what it names. */
function problemsWith(raw: unknown): string {
  try {
    parseStages(raw);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return expect.fail('parseStages accepted it');
}

describe('stages.json', () => {
  const stages: StageInfo[] = parseStages(stagesJson);

  it('parses into 10 stages, in stage order', () => {
    expect(stages.map((stage) => stage.id)).toEqual([...STAGE_IDS]);
  });

  it('puts every stage in one of the seven zones, and every zone has a stage', () => {
    for (const stage of stages) expect(ZONE_IDS, `stage ${stage.id}`).toContain(stage.zone);
    expect(new Set(stages.map((stage) => stage.zone))).toEqual(new Set(ZONE_IDS));
  });

  it('visits the zones in milk-flow order, so the rail runs along the U', () => {
    const zoneIndexes = stages.map((stage) => ZONE_IDS.indexOf(stage.zone));
    expect(zoneIndexes).toEqual([...zoneIndexes].sort((a, b) => a - b));
  });

  it('gives every stage a name, a rail label, a description, two caption lines and at least one value', () => {
    for (const stage of stages) {
      expect(stage.name.trim(), `stage ${stage.id} name`).not.toBe('');
      expect(stage.shortName.trim(), `stage ${stage.id} shortName`).not.toBe('');
      expect(stage.description.trim(), `stage ${stage.id} description`).not.toBe('');
      expect(stage.tourCaption, `stage ${stage.id} tourCaption`).toHaveLength(2);
      expect(stage.values.length, `stage ${stage.id} values`).toBeGreaterThan(0);
    }
  });

  it('has unique names and rail labels, so a test or a viewer can tell the stages apart by text', () => {
    expect(new Set(stages.map((stage) => stage.name)).size).toBe(stages.length);
    expect(new Set(stages.map((stage) => stage.shortName)).size).toBe(stages.length);
  });

  it('lists each value key once per stage (one panel row per key)', () => {
    for (const stage of stages) {
      const keys = stage.values.map((value) => value.key);
      expect(new Set(keys).size, `stage ${stage.id} keys ${keys.join(', ')}`).toBe(keys.length);
    }
  });

  it('scales every fraction shown in % by 100', () => {
    for (const stage of stages) {
      for (const value of stage.values) {
        if (value.key.endsWith('Frac') && value.unit === '%') expect(value.scale, `stage ${stage.id} ${value.key}`).toBe(100);
      }
    }
  });

  describe.each(SIMS)('every value key is in the %s snapshot', (_name, create) => {
    it.each(stages.map((stage) => [stage.id, stage] as const))('stage %s', (id, stage) => {
      const sim = create(plantConfig);
      const values = sim.snapshot().stages[id].values;
      // A key still awaited from the sim may be missing, but if the sim gives it, it must be a number.
      const required = stage.values.filter(({ key }) => !AWAITING_SIM.has(key) || key in values);
      for (const { key } of required) {
        expect(values, `stage ${id} needs "${key}"`).toHaveProperty([key]);
        expect(Number.isFinite(values[key]), `stage ${id} ${key} is ${values[key]}`).toBe(true);
      }
      // Still there after a day at ×10,000, when the mock's values have moved and stages have changed status.
      sim.dispatch({ type: 'setSpeed', speed: 10_000 });
      for (let frame = 0; frame < 86; frame++) sim.step(0.1);
      const later = sim.snapshot().stages[id].values;
      for (const { key } of required) expect(later, `stage ${id} needs "${key}" a day later`).toHaveProperty([key]);
    });
  });

  it('lists every agreed phase 3 key of stages 1–6, with a unit wherever it has one', () => {
    for (const [id, keys] of Object.entries(PHASE_3_KEYS)) {
      const listed = stages[Number(id) - 1].values.map((value) => value.key);
      for (const key of keys) expect(listed, `stage ${id} lists "${key}"`).toContain(key);
    }
    for (const stage of stages) {
      for (const value of stage.values) {
        if (/(Lph|Kw|Bar|Um|C|L|S)$/.test(value.key)) expect(value.unit, `stage ${stage.id} ${value.key} has a unit`).not.toBe('');
      }
    }
  });

  it('shows the time to the next intermediate clean in hours, scaled by exactly 1 ÷ 3,600', () => {
    const nextClean = stages[5].values.find((value) => value.key === 'nextCleanS');
    expect(nextClean).toMatchObject({ unit: 'h' });
    expect((nextClean?.scale ?? 0) * SECONDS_PER_HOUR).toBeCloseTo(1, 12);
  });

  it('lists the stage 4 values in the order that tells R6: flow, hold, temperature, limit, then B* and F0', () => {
    expect(stages[3].values.map((value) => value.key)).toEqual([
      'flowLph', 'holdS', 'tempC', 'setpointC', 'divertLimitC', 'bStar', 'f0Min', 'rejectLevelL',
    ]);
  });

  it('lets off only keys the sims still lack: take a key off AWAITING_SIM once both sims give it', () => {
    const snapshots = SIMS.map(([, create]) => create(plantConfig).snapshot());
    const given = [...AWAITING_SIM].filter((key) =>
      snapshots.every((snapshot) => STAGE_IDS.some((id) => key in snapshot.stages[id].values)),
    );
    expect(given, 'keys both sims now give').toEqual([]);
  });
});

describe('ZONE_NAMES', () => {
  // The 3D zone labels (src/scene/layout.ts) and the panel's subtitle both read this table, so a zone
  // missing here would show "undefined" in both places.
  it('names every zone, and only the seven zones', () => {
    expect(Object.keys(ZONE_NAMES).sort()).toEqual([...ZONE_IDS].sort());
    for (const zone of ZONE_IDS) expect(ZONE_NAMES[zone].trim(), `zone ${zone}`).not.toBe('');
  });

  it('gives each zone its own name', () => {
    expect(new Set(Object.values(ZONE_NAMES)).size).toBe(ZONE_IDS.length);
  });

  it("names the zones as the floor plan does (plan 05; the G1 checklist's zone headings)", () => {
    expect(ZONE_IDS.map((zone) => ZONE_NAMES[zone])).toEqual([
      'Silo yard & mixing',
      'UHT process hall',
      'Aseptic tank',
      'Filling hall',
      'Packaging hall',
      'Quarantine & QA lab',
      'Warehouse & dispatch',
    ]);
  });
});

describe('parseStages', () => {
  it('accepts an untouched copy of stages.json', () => {
    expect(() => parseStages(rawStages())).not.toThrow();
  });

  it('returns stage order even when the file lists the stages out of order', () => {
    expect(parseStages(rawStages().reverse()).map((stage) => stage.id)).toEqual([...STAGE_IDS]);
  });

  it('throws for anything but an array', () => {
    expect(() => parseStages({ stages: rawStages() })).toThrow(/array/);
  });

  it('throws, naming the stage, when a stage is missing', () => {
    const raw = rawStages().filter((entry) => entry.id !== 7);
    expect(problemsWith(raw)).toMatch(/stage 7\b/);
  });

  it('throws, naming the id, when two entries share an id', () => {
    const raw = rawStages();
    const index = raw.findIndex((entry) => entry.id === 5);
    raw[index] = { ...structuredClone(entryFor(raw, 4)) };
    const message = problemsWith(raw);
    expect(message).toMatch(/\b4\b.*twice|twice.*\b4\b|duplicate/i);
    // Stage 5 is now missing too, and the error lists every problem, not just the first.
    expect(message).toMatch(/stage 5\b/);
  });

  it('throws, naming the entry and the field, for a zone that is not one of the seven', () => {
    const raw = rawStages();
    entryFor(raw, 3).zone = 'cellar';
    expect(problemsWith(raw)).toMatch(pathOf(raw, 3, 'zone'));
  });

  it('throws, naming the entry and the field, for a one-line tour caption', () => {
    const raw = rawStages();
    entryFor(raw, 1).tourCaption = ['Raw milk waits cold in the silos.'];
    expect(problemsWith(raw)).toMatch(pathOf(raw, 1, 'tourCaption'));
  });

  it('throws for a tour caption with an empty second line', () => {
    const raw = rawStages();
    const entry = entryFor(raw, 1);
    entry.tourCaption = [(entry.tourCaption as string[])[0], '  '];
    expect(problemsWith(raw)).toMatch(pathOf(raw, 1, 'tourCaption'));
  });

  it('throws, naming the value, for a value without a unit', () => {
    const raw = rawStages();
    delete valuesOf(entryFor(raw, 2))[1].unit;
    const message = problemsWith(raw);
    expect(message).toMatch(pathOf(raw, 2, 'values[1]'));
    expect(message).toMatch(/unit/);
  });

  it("accepts an empty unit (a plain count such as stage 7's filler count)", () => {
    const raw = rawStages();
    valuesOf(entryFor(raw, 2))[1].unit = '';
    expect(() => parseStages(raw)).not.toThrow();
  });

  it.each([-1, 1.5])('throws, naming the value, for %s decimals', (decimals) => {
    const raw = rawStages();
    valuesOf(entryFor(raw, 4))[2].decimals = decimals;
    expect(problemsWith(raw)).toMatch(pathOf(raw, 4, 'values[2].decimals'));
  });

  it('throws, naming the value, for a scale that is not a finite number', () => {
    const raw = rawStages();
    valuesOf(entryFor(raw, 1))[5].scale = '100';
    expect(problemsWith(raw)).toMatch(pathOf(raw, 1, 'values[5].scale'));
  });

  it('throws, naming the field, for an empty name', () => {
    const raw = rawStages();
    entryFor(raw, 6).name = ' ';
    expect(problemsWith(raw)).toMatch(pathOf(raw, 6, 'name'));
  });

  it('lists every problem in one error, not just the first', () => {
    const raw = rawStages();
    entryFor(raw, 3).zone = 'cellar';
    valuesOf(entryFor(raw, 8))[0].decimals = -2;
    const message = problemsWith(raw);
    expect(message).toMatch(pathOf(raw, 3, 'zone'));
    expect(message).toMatch(pathOf(raw, 8, 'values[0].decimals'));
  });

  it('does not change the data it is given', () => {
    const raw = rawStages();
    const before = JSON.stringify(raw);
    parseStages(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
