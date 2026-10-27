import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  STAGE_IDS,
  dayToS,
  hToS,
  minToS,
  type Command,
  type Kpis,
  type LogEntry,
  type PlantConfig,
  type Sim,
  type Snapshot,
} from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createCore } from '../../src/sim/core';
import { createMockSim } from '../../src/sim/mock';
import { expectWithin } from '../helpers/expectWithin';
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
  for (const entry of snap.log) {
    expect(LOG_KINDS).toContain(entry.kind);
    expect(entry.message.length).toBeGreaterThan(0);
    expect(Number.isFinite(entry.timeS)).toBe(true);
  }
  expectNewestFirst(snap.log, 'log');
  // Plain data only: survives a JSON round trip, so it holds no NaN, Infinity or functions.
  expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
}

function frames(sim: Sim, count: number): void {
  for (let i = 0; i < count; i++) sim.step(FRAME_S);
}

/** Fails on the first pair of log entries that is not newest first. */
function expectNewestFirst(log: readonly LogEntry[], where: string): void {
  for (let i = 1; i < log.length; i++) {
    if (log[i].timeS > log[i - 1].timeS) expect.fail(`${where}: ${log[i].timeS} is listed below ${log[i - 1].timeS}`);
  }
}

describe('createSim: snapshot', () => {
  it('is well formed at creation, at the start time and default speed, running', () => {
    const snap = createSim(plantConfig).snapshot();
    expectWellFormed(snap);
    expect(snap.timeS).toBe(plantConfig.clock.startTimeS);
    expect(snap.speed).toBe(plantConfig.clock.defaultSpeed);
    expect(snap.paused).toBe(false);
  });

  it('opens running at its set points: every stage ok, but stage 9 amber with its batches on hold (D11)', () => {
    const snap = createSim(plantConfig).snapshot();
    for (const id of STAGE_IDS) expect(snap.stages[id].status, `stage ${id}`).toBe(id === 9 ? 'warn' : 'ok');
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

  it.each([
    ['shorter than clock.fastStepS (5 s)', 5],
    ['too small to move the time (1e-12 s)', 1e-12],
  ])('throws a RangeError for a batch %s, instead of hanging on the first step', (_label, batchS) => {
    const config = copyConfig();
    config.quality.batchS = batchS;
    expect(() => createSim(config).step(FRAME_S)).toThrow(RangeError);
  });

  it('throws a RangeError, instead of hanging, when far out in time a 1 s batch rounds away to nothing', () => {
    const config = copyConfig();
    Object.assign(config.clock, { startTimeS: 2 ** 53 - 4, baseStepS: 1, fastStepS: 1 });
    Object.assign(config.quality, { batchS: 1, firstShiftStartS: 0 });
    const sim = createSim(config);
    // A shift change at 2^53 s would be rescheduled for 2^53 + 1, which rounds back to 2^53.
    expect(() => frames(sim, 5)).toThrow(/batch/);
  });
});

// Hand values from plan/hand-calculations.md, with the tolerance stated there. The plant opens in steady
// production at plant.json's set points, with no display noise yet, so its values follow from the formulas alone.
describe('createSim: the plant as it opens matches the hand calculations', () => {
  const staticSnapshot = () => createSim(plantConfig).snapshot();

  it('stage 1 mixes back 8.636% cream for 3.5% milk (H1)', () => {
    expectWithin(staticSnapshot().stages[1].values.creamShareFrac, 0.08636, 0.00001);
  });

  it('stage 2 leaves the deaerator at 80 − 4 = 76 °C (H6)', () => {
    expect(staticSnapshot().stages[2].values.deaeratorTempC).toBe(76);
  });

  it('stage 3 takes the milk in at 76 °C and out at 81.75 °C after 200 + 30 bar (H7)', () => {
    const { values } = staticSnapshot().stages[3];
    expect(values.inletTempC).toBe(76);
    expectWithin(values.outletTempC, 81.75, 0.001);
  });

  it('stage 4 holds 4 s at the full 16,000 L/h (H9, R6)', () => {
    const { values } = staticSnapshot().stages[4];
    expect(values.flowLph).toBe(16_000);
    expectWithin(values.holdS, 4, 0.001);
  });

  it('stage 4 shows F0 5.175 min (H11), B* 1.1856 (H12) and a 139.224 °C divert limit (H13) at 140 °C', () => {
    const { values } = staticSnapshot().stages[4];
    expectWithin(values.f0Min, 5.175, 0.001);
    expectWithin(values.bStar, 1.1856, 0.0001);
    expectWithin(values.divertLimitC, 139.224, 0.001);
  });

  it('stage 6 starts half full: 10,000 L of 20,000 L, 50%', () => {
    const { values } = staticSnapshot().stages[6];
    expect(values.levelL).toBe(10_000);
    expect(values.levelPct).toBe(50);
  });

  it('stage 8 puts 1,008 packs on a pallet (H26)', () => {
    expect(staticSnapshot().stages[8].values.packsPerPallet).toBe(1_008);
  });

  it('stage 9 takes 16 samples per batch (H29)', () => {
    expect(staticSnapshot().stages[9].values.samplesPerBatch).toBe(16);
  });

  it('the KPIs: 16,000 L/h in, 2 × 7,500 = 15,000 packs/h out, 1,000 L/h to spare (H31), and the tank at 50%', () => {
    const { kpis } = staticSnapshot();
    expect(kpis.uhtFlowLph).toBe(16_000);
    expect(kpis.packsPerH).toBe(15_000);
    expect(kpis.uhtFlowLph - kpis.packsPerH * plantConfig.product.packVolumeL).toBe(1_000);
    expect(kpis.tankLevelPct).toBe(50);
  });

  it("the KPIs show stage 4's F0 and B*", () => {
    const { kpis, stages } = staticSnapshot();
    expect(kpis.f0Min).toBe(stages[4].values.f0Min);
    expect(kpis.bStar).toBe(stages[4].values.bStar);
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

  it('does not jump when switched from x10,000 to x1: time saved up under 10 s steps is dropped', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    sim.step(0.0159); // 159 s: 15 steps of 10 s, 9 s left over
    const switchedS = sim.snapshot().timeS;
    sim.dispatch({ type: 'setSpeed', speed: 1 });
    sim.step(1 / 60); // 0.017 s of sim time, under one step
    expect(sim.snapshot().timeS).toBe(switchedS);
  });
});

// The core's shift grid, through createMockSim: its queue holds only the shift changes, while createSim's
// also holds the packs model's breakdowns, batch changes, releases and trucks (sim/packs.test.ts).
describe('the core: shift changes', () => {
  it('queues the first one at 14:00 on day 1, and nextEvent jumps there and runs it', () => {
    const sim = createMockSim(dayOneConfig());
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
    const sim = createMockSim(dayOneConfig());
    // The mock logs its status windows too, so the shift changes are read after each jump, before they scroll away.
    const shiftsS: number[] = [];
    const jump = () => {
      sim.dispatch({ type: 'nextEvent' });
      shiftsS.unshift(...sim.snapshot().log.filter((entry) => isShiftChange(entry.message) && !shiftsS.includes(entry.timeS)).map((entry) => entry.timeS));
    };
    jump();
    jump();
    expect(sim.snapshot().timeS).toBe(79_200);
    jump();
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(108_000);
    expect(snap.nextEventS).toBe(136_800);
    expect(shiftsS).toEqual([108_000, 79_200, 50_400]);
  });

  it('nextEvent works while paused, and the sim stays paused', () => {
    const sim = createMockSim(dayOneConfig());
    sim.dispatch({ type: 'pause', paused: true });
    sim.dispatch({ type: 'nextEvent' });
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(50_400);
    expect(snap.paused).toBe(true);
  });

  it('first queues the next shift boundary after the shipped start time', () => {
    const { startTimeS } = plantConfig.clock;
    expect(createMockSim(plantConfig).snapshot().nextEventS).toBe(nextShiftChangeS(startTimeS));
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
    const sim = createMockSim(config);
    expect(sim.snapshot().nextEventS).toBe(firstS);
    sim.dispatch({ type: 'nextEvent' });
    expect(sim.snapshot().nextEventS).toBe(firstS + config.quality.batchS);
  });

  it('takes the shift grid from quality.firstShiftStartS: 07:00 gives 07:00, 15:00 and 23:00', () => {
    const config = dayOneConfig();
    config.quality.firstShiftStartS = hToS(7);
    const sim = createMockSim(config);
    const runS: number[] = [];
    for (let i = 0; i < 3; i++) {
      runS.push(sim.snapshot().nextEventS ?? Number.NaN);
      sim.dispatch({ type: 'nextEvent' });
    }
    expect(runS).toEqual([hToS(7), hToS(15), hToS(23)]);
  });

  it('lands a step on every shift change after a speed change moves the steps off the 10 s grid, so each runs at its own time', () => {
    const stepEndsS = new Set<number>();
    const core = createCore(dayOneConfig(), { onStep: (_dtS, timeS) => void stepEndsS.add(timeS) });
    core.dispatch({ type: 'setSpeed', speed: 1_000 });
    core.step(1 / 60); // 16 steps of 1 s
    expect(core.timeS).toBe(21_616);
    core.dispatch({ type: 'setSpeed', speed: 10_000 });
    for (let frame = 0; frame < 2_000; frame++) core.step(1 / 60);

    const passedS: number[] = [];
    for (let shiftS = nextShiftChangeS(21_616); shiftS <= core.timeS; shiftS += plantConfig.quality.batchS) passedS.push(shiftS);
    expect(passedS.length).toBeGreaterThan(10);
    // Each step runs the events due by its end, so a step ending on a shift change runs it at exactly that time.
    for (const shiftS of passedS) expect(stepEndsS.has(shiftS), `a step ends at ${shiftS}`).toBe(true);
  });

  it('never runs the clock past a due event without running it (2 days at x10,000)', () => {
    const sim = createMockSim(dayOneConfig());
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const runS = new Set<number>();
    for (let frame = 0; frame < 173; frame++) {
      sim.step(FRAME_S); // 1,000 sim seconds, as 100 steps of 10 s
      const snap = sim.snapshot();
      expect(snap.nextEventS, `at ${snap.timeS}`).toBe(nextShiftChangeS(snap.timeS));
      for (const entry of snap.log) if (isShiftChange(entry.message)) runS.add(entry.timeS);
    }
    const snap = sim.snapshot();
    expect(snap.timeS).toBe(194_600); // day 3, 06:03:20
    // The steps land on every boundary, so each shift change is logged at its own time.
    expect([...runS].sort((a, b) => a - b)).toEqual([50_400, 79_200, 108_000, 136_800, 165_600, 194_400]);
  });

  it('runs 30 days at x10,000 in 0.1 s frames with finite values and one pending shift change', () => {
    const sim = createMockSim(plantConfig);
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
  });
});

describe('createSim: the event queue', () => {
  it('nextEvent jumps to the earliest queued event, whatever it is, and runs it', () => {
    const sim = createSim(plantConfig);
    for (let jump = 0; jump < 20; jump++) {
      const { nextEventS, timeS } = sim.snapshot();
      if (nextEventS === null) expect.fail('the queue is empty');
      expect(nextEventS, `jump ${jump}`).toBeGreaterThan(timeS);
      sim.dispatch({ type: 'nextEvent' });
      expect(sim.snapshot().timeS, `jump ${jump}`).toBe(nextEventS);
    }
  });

  it('never leaves an event due without running it, and runs every shift change at its own time (30 days at x10,000)', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const startS = plantConfig.clock.startTimeS;
    const frameCount = dayToS(30) / 1_000;
    const shiftsS = new Set<number>();
    for (let frame = 1; frame <= frameCount; frame++) {
      sim.step(FRAME_S);
      const snap = sim.snapshot();
      if (frame % 100 === 0 || frame === frameCount) expectWellFormed(snap);
      if (!(snap.nextEventS !== null && snap.nextEventS > snap.timeS)) expect.fail(`frame ${frame} at ${snap.timeS}: next event ${snap.nextEventS}`);
      for (const entry of snap.log) if (isShiftChange(entry.message)) shiftsS.add(entry.timeS);
    }
    expect(sim.snapshot().timeS).toBe(startS + dayToS(30));
    const expected: number[] = [];
    for (let shiftS = nextShiftChangeS(startS); shiftS <= startS + dayToS(30); shiftS += plantConfig.quality.batchS) expected.push(shiftS);
    expect([...shiftsS].sort((a, b) => a - b)).toEqual(expected);
  });
});

describe('createSim: commands', () => {
  it('setSetpoint uhtSetpointC 140.5 °C shows in stage 4, moves F0 to 5.806 min (H19) and B* to 1.3230 (H18), and is logged', () => {
    const sim = createSim(plantConfig);
    const logBefore = sim.snapshot().log.length;
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 140.5 });
    const snap = sim.snapshot();
    const { values } = snap.stages[4];
    expect(values.setpointC).toBe(140.5);
    expectWithin(values.f0Min, 5.806, 0.001);
    expectWithin(values.bStar, 1.323, 0.0001);
    expectWithin(values.divertLimitC, 139.224, 0.001); // follows the hold, not the set point (H13)
    expect(snap.kpis.f0Min).toBe(values.f0Min);
    expect(snap.kpis.bStar).toBe(values.bStar);
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

  it('setSetpoint applies the homogenizer pressure and filler rate to stages 3 and 7 and the KPIs, logging each', () => {
    const sim = createSim(plantConfig);
    const logBefore = sim.snapshot().log.length;
    sim.dispatch({ type: 'setSetpoint', key: 'homogenizerStage1Bar', value: 180 });
    sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 7_000 });
    const snap = sim.snapshot();
    expectWellFormed(snap);
    expect(snap.stages[3].values.stage1Bar).toBe(180);
    expectWithin(snap.stages[3].values.outletTempC, 81.25, 0.001); // 76 + (180 + 30) ÷ 40, as in H7
    expect(snap.stages[7].values.ratePacksPerH).toBe(7_000);
    expect(snap.kpis.packsPerH).toBe(14_000); // two fillers
    expect(snap.log.length).toBe(logBefore + 2);
  });

  it('triggerScenario starts the run and logs it, and changes no stage before the next step (scenarios.ts, phase 5)', () => {
    const sim = createSim(plantConfig);
    const before = sim.snapshot();
    sim.dispatch({ type: 'triggerScenario', id: 'uhtTempDrop' });
    const snap = sim.snapshot();
    expect(snap.log.length).toBe(before.log.length + 1);
    expect(snap.log[0]).toMatchObject({ kind: 'warn', message: 'Steam supply dips: the UHT outlet falls toward 135.5 °C' });
    expect(snap.scenarios.runs.map((run) => run.id)).toEqual(['uhtTempDrop']);
    expect(snap.stages).toEqual(before.stages);
    expect(snap.timeS).toBe(before.timeS);
  });

  it('setQaResult on a batch that is not in quarantine changes nothing and logs why', () => {
    const sim = createSim(plantConfig);
    const before = sim.snapshot();
    sim.dispatch({ type: 'setQaResult', batchId: 1, result: 'fail' });
    const snap = sim.snapshot();
    expect(snap.log.length).toBe(before.log.length + 1);
    expect(snap.log[0]).toMatchObject({ kind: 'warn', message: 'QA result for batch 1 not applied: it is not in quarantine' });
    expect(snap.packs).toEqual(before.packs);
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

function replay(sim: Sim, script: readonly (Command | number)[] = SCRIPT): string[] {
  return script.map((input) => {
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

  it('has the same clock and commands as createSim (nextEvent aside: it jumps to each sim’s own queue)', () => {
    const pick = (json: string) => {
      const { timeS, speed, paused } = JSON.parse(json) as Snapshot;
      return { timeS, speed, paused };
    };
    const script = SCRIPT.filter((input) => typeof input === 'number' || input.type !== 'nextEvent');
    const mock = replay(createMockSim(plantConfig), script).map(pick);
    const live = replay(createSim(plantConfig), script).map(pick);
    expect(mock.map(({ speed, paused }) => ({ speed, paused }))).toEqual(live.map(({ speed, paused }) => ({ speed, paused })));
    // A step cut short to land on an event leaves the rest of the frame's time for the next frame, so the
    // clocks may stand up to one step apart; createSim queues many more events than the mock.
    mock.forEach(({ timeS }, i) => expect(Math.abs(timeS - (live[i]?.timeS ?? Number.NaN)), `input ${i}`).toBeLessThanOrEqual(plantConfig.clock.fastStepS));
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

  it('shows an occasional warn or bad status (3 days at x10,000, sampled every 100 s; stage 9 is amber while batches are on hold)', () => {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    let alarmed = 0;
    const frameCount = dayToS(3) / 100;
    for (let frame = 0; frame < frameCount; frame++) {
      sim.step(0.01); // 100 sim seconds in 10 s steps
      const { stages } = sim.snapshot();
      if (STAGE_IDS.some((id) => id !== 9 && (stages[id].status === 'warn' || stages[id].status === 'bad'))) alarmed++;
    }
    expect(alarmed, 'frames with a warn or bad stage').toBeGreaterThan(0);
    expect(alarmed, 'frames with a warn or bad stage').toBeLessThan(frameCount);
  });

  it('keeps an amber UHT stage above the divert limit, so stage 4 changes status only between 15 min windows (1 day at x1,000)', () => {
    const statusWindowS = minToS(15); // as in mock.ts
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    const changes: LogEntry[] = [];
    for (let frame = 0; frame < dayToS(1) / 100; frame++) {
      const beforeS = sim.snapshot().timeS;
      sim.step(FRAME_S);
      const fresh = sim.snapshot().log.filter((entry) => entry.timeS > beforeS && /UHT holding tube/.test(entry.message));
      changes.push(...fresh.reverse());
    }
    expect(changes.map((entry) => entry.kind)).toContain('warn');
    for (let i = 1; i < changes.length; i++) {
      const gapS = changes[i].timeS - changes[i - 1].timeS;
      if (gapS < statusWindowS) expect.fail(`stage 4 changed at ${changes[i - 1].timeS} and again ${gapS} s later`);
    }
  });

  it('keeps the log newest first after a speed change moves the steps off the shift grid', () => {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    sim.step(1 / 60); // 16 steps of 1 s
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    for (let frame = 0; frame < 3_000; frame++) {
      sim.step(1 / 60);
      expectNewestFirst(sim.snapshot().log, `frame ${frame}`);
    }
    expectWellFormed(sim.snapshot());
  });

  it('is deterministic: the same inputs give identical snapshots', () => {
    expect(replay(createMockSim(plantConfig))).toEqual(replay(createMockSim(plantConfig)));
  });
});
