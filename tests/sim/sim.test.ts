import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  STAGE_IDS,
  dayToS,
  hToS,
  type Command,
  type Kpis,
  type PlantConfig,
  type Sim,
  type Snapshot,
} from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { copyConfig, plantConfig } from '../helpers/plantConfig';

const KPI_KEYS: (keyof Kpis)[] = [
  'uhtFlowLph', 'f0Min', 'bStar', 'divertedL', 'tankLevelPct', 'packsPerH', 'oeePct', 'traysMade',
  'palletsMade', 'batchesOnHold', 'batchesReleased', 'batchesBlocked', 'palletsInStock', 'daysOfCover',
  'orderFillPct', 'trucksShipped',
];
const STATUSES = ['ok', 'warn', 'bad', 'idle'];
const LOG_KINDS = ['info', 'ok', 'warn', 'bad'];
const LOG_LIMIT = 50;
const FRAME_S = 0.1;

/** Day 1, 06:00, the start in D8, set explicitly so these hand values hold if the shipped start moves (D11). */
const dayOneConfig = (): PlantConfig => {
  const config = copyConfig();
  config.clock.startTimeS = hToS(6);
  return config;
};

/** Shift changes fall at 06:00, 14:00 and 22:00: the first one strictly after timeS. */
const nextShiftChangeS = (timeS: number, batchS = plantConfig.quality.batchS): number =>
  hToS(6) + (Math.floor((timeS - hToS(6)) / batchS) + 1) * batchS;

const isShiftChange = (message: string) => /shift change/i.test(message);

/** Every structural rule a snapshot from either sim must keep. */
function expectWellFormed(snap: Snapshot): void {
  expect(snap.version).toBe(CONTRACT_VERSION);
  expect(Number.isFinite(snap.timeS)).toBe(true);
  expect(typeof snap.paused).toBe('boolean');
  expect(snap.nextEventS === null || Number.isFinite(snap.nextEventS)).toBe(true);

  expect(Object.keys(snap.stages).map(Number).sort((a, b) => a - b)).toEqual([...STAGE_IDS]);
  for (const id of STAGE_IDS) {
    const stage = snap.stages[id];
    expect(stage.id).toBe(id);
    expect(STATUSES).toContain(stage.status);
    expect(Object.keys(stage.values).length, `stage ${id} has values`).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(stage.values)) {
      if (!Number.isFinite(value)) expect.fail(`stage ${id} value ${key} is ${value}`);
    }
  }

  expect(Object.keys(snap.kpis).sort()).toEqual([...KPI_KEYS].sort());
  for (const [key, value] of Object.entries(snap.kpis)) {
    if (!Number.isFinite(value)) expect.fail(`KPI ${key} is ${value}`);
  }

  expect(snap.log.length).toBeLessThanOrEqual(LOG_LIMIT);
  for (let i = 0; i < snap.log.length; i++) {
    const entry = snap.log[i];
    expect(LOG_KINDS).toContain(entry.kind);
    expect(entry.message.length).toBeGreaterThan(0);
    expect(Number.isFinite(entry.timeS)).toBe(true);
    if (i > 0) expect(entry.timeS, 'log is newest first').toBeLessThanOrEqual(snap.log[i - 1].timeS);
  }
  // Plain data only: survives a JSON round trip, so it holds no NaN, Infinity or functions.
  expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
}

function frames(sim: Sim, count: number): void {
  for (let i = 0; i < count; i++) sim.step(FRAME_S);
}

describe('createSim: snapshot', () => {
  it('is well formed at creation, at the start time and default speed, running', () => {
    const snap = createSim(plantConfig).snapshot();
    expectWellFormed(snap);
    expect(snap.timeS).toBe(plantConfig.clock.startTimeS);
    expect(snap.speed).toBe(plantConfig.clock.defaultSpeed);
    expect(snap.paused).toBe(false);
  });

  it('shows the static plant: all 10 stages ok', () => {
    const snap = createSim(plantConfig).snapshot();
    for (const id of STAGE_IDS) expect(snap.stages[id].status, `stage ${id}`).toBe('ok');
  });

  it('writes the first log entry at creation', () => {
    const snap = createSim(plantConfig).snapshot();
    expect(snap.log.length).toBeGreaterThanOrEqual(1);
    expect(snap.log[0].timeS).toBe(plantConfig.clock.startTimeS);
  });

  it('shows the UHT set point from plant.json in stage 4', () => {
    expect(createSim(plantConfig).snapshot().stages[4].values.setpointC).toBe(plantConfig.uht.setpointC);
  });

  it('is a fresh object every call: changing one does not change the next', () => {
    const sim = createSim(plantConfig);
    const first = sim.snapshot();
    const second = sim.snapshot();
    expect(second).not.toBe(first);
    expect(second.stages).not.toBe(first.stages);
    expect(second.stages[4]).not.toBe(first.stages[4]);
    expect(second.stages[4].values).not.toBe(first.stages[4].values);
    expect(second.kpis).not.toBe(first.kpis);
    expect(second.log).not.toBe(first.log);

    const before = JSON.stringify(second);
    first.timeS = -1;
    first.stages[4].values.setpointC = 999;
    first.stages[4].values.extraC = 1;
    first.stages[1].status = 'bad';
    first.kpis.uhtFlowLph = -1;
    (first.log as unknown[]).length = 0;
    expect(JSON.stringify(sim.snapshot())).toBe(before);
  });

  it('throws a RangeError when plant.json sets a default speed that is not a preset', () => {
    const config = copyConfig();
    config.clock.defaultSpeed = 7;
    expect(() => createSim(config)).toThrow(RangeError);
  });
});

describe('createSim: clock', () => {
  it('advances exactly 1 s per 0.1 s frame at the default x10', () => {
    expect(plantConfig.clock.defaultSpeed).toBe(10);
    const sim = createSim(plantConfig);
    sim.step(FRAME_S);
    expect(sim.snapshot().timeS).toBe(plantConfig.clock.startTimeS + 1);
    frames(sim, 9);
    expect(sim.snapshot().timeS).toBe(plantConfig.clock.startTimeS + 10);
  });

  it('accepts at most maxFrameS of real time per frame', () => {
    const sim = createSim(plantConfig);
    sim.step(5); // a hidden tab: clamped to 0.1 s
    expect(sim.snapshot().timeS).toBe(plantConfig.clock.startTimeS + plantConfig.clock.maxFrameS * 10);
  });

  it('freezes while paused, and runs again when unpaused', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'pause', paused: true });
    frames(sim, 20);
    let snap = sim.snapshot();
    expect(snap.paused).toBe(true);
    expect(snap.timeS).toBe(plantConfig.clock.startTimeS);

    sim.dispatch({ type: 'pause', paused: false });
    sim.step(FRAME_S);
    snap = sim.snapshot();
    expect(snap.paused).toBe(false);
    expect(snap.timeS).toBe(plantConfig.clock.startTimeS + 1);
  });

  it.each([
    [100, 10],
    [1_000, 100],
    [10_000, 1_000],
  ] as const)('setSpeed x%s advances %s s per 0.1 s frame', (speed, perFrameS) => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed });
    expect(sim.snapshot().speed).toBe(speed);
    sim.step(FRAME_S);
    expect(sim.snapshot().timeS).toBe(plantConfig.clock.startTimeS + perFrameS);
  });
});

describe('createSim: shift changes', () => {
  it('queues the first one at 14:00 on day 1, and nextEvent jumps there and runs it', () => {
    const sim = createSim(dayOneConfig());
    expect(sim.snapshot().nextEventS).toBe(50_400);

    sim.dispatch({ type: 'nextEvent' });
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(50_400);
    expect(isShiftChange(snap.log[0].message)).toBe(true);
    expect(snap.log[0].timeS).toBe(50_400);
    expect(snap.log[0].kind).toBe('info');
    expect(snap.nextEventS).toBe(79_200);
  });

  it('nextEvent keeps walking the shifts: 22:00, then 06:00 on day 2', () => {
    const sim = createSim(dayOneConfig());
    sim.dispatch({ type: 'nextEvent' });
    sim.dispatch({ type: 'nextEvent' });
    expect(sim.snapshot().timeS).toBe(79_200);
    sim.dispatch({ type: 'nextEvent' });
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(108_000);
    expect(snap.nextEventS).toBe(136_800);
    expect(snap.log.filter((entry) => isShiftChange(entry.message)).map((entry) => entry.timeS)).toEqual([
      108_000, 79_200, 50_400,
    ]);
  });

  it('nextEvent works while paused, and the sim stays paused', () => {
    const sim = createSim(dayOneConfig());
    sim.dispatch({ type: 'pause', paused: true });
    sim.dispatch({ type: 'nextEvent' });
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(50_400);
    expect(snap.paused).toBe(true);
  });

  it('first queues the next shift boundary after the shipped start time', () => {
    const { startTimeS } = plantConfig.clock;
    expect(createSim(plantConfig).snapshot().nextEventS).toBe(nextShiftChangeS(startTimeS));
  });

  it.each([
    ['day 1, 00:00', 0, 21_600],
    ['day 1, 10:00', 36_000, 50_400],
    ['day 1, 22:00', 79_200, 108_000],
    ['day 1, 23:00', 82_800, 108_000],
    ['day 8, 06:00 (D11)', 626_400, 655_200],
  ])('keeps shift changes on 06:00, 14:00 and 22:00 when the sim opens on %s', (_label, startTimeS, firstS) => {
    const config = copyConfig();
    config.clock.startTimeS = startTimeS;
    const sim = createSim(config);
    expect(sim.snapshot().nextEventS).toBe(firstS);
    sim.dispatch({ type: 'nextEvent' });
    expect(sim.snapshot().nextEventS).toBe(firstS + config.quality.batchS);
  });

  it('never runs the clock past a due event without running it (2 days at x10,000)', () => {
    const sim = createSim(dayOneConfig());
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    for (let frame = 0; frame < 173; frame++) {
      sim.step(FRAME_S); // 1,000 sim seconds, as 100 steps of 10 s
      const snap = sim.snapshot();
      expect(snap.nextEventS, `at ${snap.timeS}`).toBe(nextShiftChangeS(snap.timeS));
    }
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(194_600); // day 3, 06:03:20
    // The steps land on every boundary, so each shift change is logged at its own time.
    const runS = snap.log.filter((entry) => isShiftChange(entry.message)).map((entry) => entry.timeS).reverse();
    expect(runS).toEqual([50_400, 79_200, 108_000, 136_800, 165_600, 194_400]);
  });

  it('runs 30 days at x10,000 in 0.1 s frames with finite values and one pending shift change', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const startS = plantConfig.clock.startTimeS;
    const frameCount = dayToS(30) / 1_000; // 1,000 sim seconds per frame
    for (let frame = 1; frame <= frameCount; frame++) {
      sim.step(FRAME_S);
      const snap = sim.snapshot();
      if (frame % 100 === 0 || frame === frameCount) expectWellFormed(snap);
      if (snap.nextEventS !== nextShiftChangeS(snap.timeS)) {
        expect.fail(`frame ${frame} at ${snap.timeS}: next event ${snap.nextEventS}, expected ${nextShiftChangeS(snap.timeS)}`);
      }
    }
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(startS + dayToS(30));
    expect(snap.log).toHaveLength(LOG_LIMIT); // 90 shift changes were logged; the cap keeps the newest 50
    expect(isShiftChange(snap.log[0].message)).toBe(true);
  });
});

describe('createSim: commands', () => {
  it('setSetpoint uhtSetpointC shows in stage 4 and is logged', () => {
    const sim = createSim(plantConfig);
    const logBefore = sim.snapshot().log.length;
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 140.5 });
    const snap = sim.snapshot();
    expect(snap.stages[4].values.setpointC).toBe(140.5);
    expect(snap.log.length).toBe(logBefore + 1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'setSetpoint ignores %s, with a warning in the log',
    (value) => {
      const sim = createSim(plantConfig);
      sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 141 });
      sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value });
      const snap = sim.snapshot();
      expect(snap.stages[4].values.setpointC).toBe(141);
      expect(snap.log[0].kind).toBe('warn');
      expectWellFormed(snap);
    },
  );

  it('setSetpoint accepts the other set points, logging each, without breaking the snapshot', () => {
    const sim = createSim(plantConfig);
    const logBefore = sim.snapshot().log.length;
    sim.dispatch({ type: 'setSetpoint', key: 'homogenizerStage1Bar', value: 180 });
    sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 7_000 });
    const snap = sim.snapshot();
    expectWellFormed(snap);
    expect(snap.log.length).toBe(logBefore + 2);
  });

  it('triggerScenario logs a warning that fault scenarios arrive in phase 5, and changes nothing else', () => {
    const sim = createSim(plantConfig);
    const before = sim.snapshot();
    sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
    const snap = sim.snapshot();
    expect(snap.log.length).toBe(before.log.length + 1);
    expect(snap.log[0].kind).toBe('warn');
    expect(snap.stages).toEqual(before.stages);
    expect(snap.timeS).toBe(before.timeS);
  });

  it('setQaResult logs that QA results arrive in phase 4', () => {
    const sim = createSim(plantConfig);
    const logBefore = sim.snapshot().log.length;
    sim.dispatch({ type: 'setQaResult', batchId: 1, result: 'fail' });
    expect(sim.snapshot().log.length).toBe(logBefore + 1);
  });

  it('keeps its speed when sent one that is not a preset (a RangeError, if it throws)', () => {
    const sim = createSim(plantConfig);
    try {
      sim.dispatch({ type: 'setSpeed', speed: 7 as 10 });
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
    }
    expect(sim.snapshot().speed).toBe(plantConfig.clock.defaultSpeed);
  });
});

/** One fixed run of frames and commands, used to compare two sims. */
const SCRIPT: (Command | number)[] = [
  ...Array<number>(30).fill(FRAME_S),
  { type: 'setSpeed', speed: 1_000 },
  ...Array<number>(50).fill(FRAME_S),
  { type: 'setSetpoint', key: 'uhtSetpointC', value: 140.5 },
  { type: 'nextEvent' },
  { type: 'triggerScenario', id: 'fillerBreakdown' },
  { type: 'setSpeed', speed: 10_000 },
  0.016,
  0.033,
  ...Array<number>(200).fill(FRAME_S),
  { type: 'pause', paused: true },
  ...Array<number>(5).fill(FRAME_S),
  { type: 'pause', paused: false },
  { type: 'setQaResult', batchId: 3, result: 'pass' },
  { type: 'nextEvent' },
  ...Array<number>(20).fill(0.05),
];

function replay(sim: Sim): string[] {
  return SCRIPT.map((input) => {
    if (typeof input === 'number') sim.step(input);
    else sim.dispatch(input);
    return JSON.stringify(sim.snapshot());
  });
}

describe('createSim: determinism', () => {
  it('gives identical snapshots for the same inputs', () => {
    expect(replay(createSim(plantConfig))).toEqual(replay(createSim(plantConfig)));
  });

  it('does not change the config it is given', () => {
    const before = JSON.stringify(plantConfig);
    replay(createSim(plantConfig));
    replay(createMockSim(plantConfig));
    expect(JSON.stringify(plantConfig)).toBe(before);
  });
});

describe('createMockSim', () => {
  it('is well formed at creation and through a 2-day run', () => {
    const sim = createMockSim(plantConfig);
    expectWellFormed(sim.snapshot());
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    for (let frame = 0; frame < dayToS(2) / 1_000; frame++) {
      sim.step(FRAME_S);
      if (frame % 10 === 0) expectWellFormed(sim.snapshot());
    }
  });

  it('has the same clock and commands as createSim', () => {
    const pick = (json: string) => {
      const { timeS, speed, paused, nextEventS } = JSON.parse(json) as Snapshot;
      return { timeS, speed, paused, nextEventS };
    };
    expect(replay(createMockSim(plantConfig)).map(pick)).toEqual(replay(createSim(plantConfig)).map(pick));
  });

  it('has stage values and KPIs that change within 5 s of real time at the default speed', () => {
    const sim = createMockSim(plantConfig);
    const values = (snap: Snapshot) => JSON.stringify([snap.stages, snap.kpis]);
    const seen = new Set([values(sim.snapshot())]);
    for (let frame = 0; frame < 50; frame++) {
      sim.step(FRAME_S);
      seen.add(values(sim.snapshot()));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('shows an occasional warn or bad status (3 days at x1,000, sampled every 100 s)', () => {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    let alarmed = 0;
    const frameCount = dayToS(3) / 100;
    for (let frame = 0; frame < frameCount; frame++) {
      sim.step(FRAME_S);
      const { stages } = sim.snapshot();
      if (STAGE_IDS.some((id) => stages[id].status === 'warn' || stages[id].status === 'bad')) alarmed++;
    }
    expect(alarmed, 'frames with a warn or bad stage').toBeGreaterThan(0);
    expect(alarmed, 'frames with a warn or bad stage').toBeLessThan(frameCount);
  });

  it('is deterministic: the same inputs give identical snapshots', () => {
    expect(replay(createMockSim(plantConfig))).toEqual(replay(createMockSim(plantConfig)));
  });
});
