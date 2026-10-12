import { describe, expect, it } from 'vitest';
import { SPEEDS, type Speed } from '../../src/contracts';
import { Clock, type ClockOptions } from '../../src/sim/clock';
import { mulberry32 } from '../helpers/previewMulberry32';
import { plantConfig } from '../helpers/plantConfig';

// Most tests use round numbers instead of plant.json, so the expected step counts can be worked out
// by hand. Fractions are powers of two where a remainder matters, so floating point stays exact.
const OPTIONS: ClockOptions = {
  startTimeS: 0,
  speed: 1,
  baseStepS: 1,
  fastStepS: 10,
  fastStepAboveSpeed: 1_000,
  maxStepsPerFrame: 500,
  maxFrameS: 1,
};

const makeClock = (overrides: Partial<ClockOptions> = {}) => new Clock({ ...OPTIONS, ...overrides });

/** Records every onStep call as [dtS, timeS]. */
function recorder() {
  const calls: [number, number][] = [];
  return { calls, onStep: (dtS: number, timeS: number) => void calls.push([dtS, timeS]) };
}

const shippedClock = (speed: Speed) => new Clock({ ...plantConfig.clock, speed });

describe('Clock: construction', () => {
  it('starts at startTimeS, at the given speed, running', () => {
    const clock = makeClock({ startTimeS: 21_600, speed: 10 });
    expect(clock.timeS).toBe(21_600);
    expect(clock.speed).toBe(10);
    expect(clock.paused).toBe(false);
  });

  it.each([0, 7, 5_000, -10, Number.NaN])('throws a RangeError for speed %s, which is not a preset', (speed) => {
    expect(() => makeClock({ speed: speed as Speed })).toThrow(RangeError);
  });

  it.each([
    ['baseStepS', 0],
    ['baseStepS', -1],
    ['fastStepS', 0],
    ['fastStepS', -10],
  ] as const)('throws a RangeError when %s is %s', (key, value) => {
    expect(() => makeClock({ [key]: value })).toThrow(RangeError);
  });
});

describe('Clock: step size', () => {
  it('uses baseStepS up to and including fastStepAboveSpeed, and fastStepS above it', () => {
    const expected: Record<Speed, number> = { 1: 1, 10: 1, 100: 1, 1_000: 1, 10_000: 10 };
    for (const speed of SPEEDS) expect(makeClock({ speed }).stepS, `at x${speed}`).toBe(expected[speed]);
  });

  it('moves the switch with fastStepAboveSpeed', () => {
    expect(makeClock({ speed: 100, fastStepAboveSpeed: 100 }).stepS).toBe(1);
    expect(makeClock({ speed: 1_000, fastStepAboveSpeed: 100 }).stepS).toBe(10);
  });

  it('follows setSpeed', () => {
    const clock = makeClock({ speed: 1_000 });
    clock.setSpeed(10_000);
    expect(clock.stepS).toBe(10);
    clock.setSpeed(1);
    expect(clock.stepS).toBe(1);
  });

  it('with the shipped settings: 1 s steps up to x1,000, 10 s at x10,000 (D8)', () => {
    expect(shippedClock(1_000).stepS).toBe(1);
    expect(shippedClock(10_000).stepS).toBe(10);
  });
});

describe('Clock: advance', () => {
  it('takes one step per stepS of sim time and reports each as onStep(stepS, new timeS)', () => {
    const clock = makeClock({ speed: 10 });
    const { calls, onStep } = recorder();
    expect(clock.advance(0.5, onStep)).toBe(5);
    expect(calls).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
    ]);
    expect(clock.timeS).toBe(5);
  });

  it('has already moved the clock when onStep runs', () => {
    const clock = makeClock({ speed: 10 });
    const seen: [number, number][] = [];
    clock.advance(0.5, (_dtS, timeS) => seen.push([timeS, clock.timeS]));
    for (const [reported, actual] of seen) expect(actual).toBe(reported);
  });

  it('takes fastStepS steps above fastStepAboveSpeed', () => {
    const clock = makeClock({ speed: 10_000, maxFrameS: 0.1 });
    const { calls, onStep } = recorder();
    expect(clock.advance(0.1, onStep)).toBe(100);
    expect(calls.every(([dtS]) => dtS === 10)).toBe(true);
    expect(clock.timeS).toBe(1_000);
  });

  it('keeps a remainder smaller than one step for the next call', () => {
    const clock = makeClock();
    const { calls, onStep } = recorder();
    expect(clock.advance(0.75, onStep)).toBe(0); // pending 0.75
    expect(clock.advance(0.5, onStep)).toBe(1); // 1.25: one step, 0.25 left
    expect(clock.advance(0.75, onStep)).toBe(1); // 1.0: one step, nothing left
    expect(clock.advance(0, onStep)).toBe(0);
    expect(calls).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it('clamps realDtS to maxFrameS, so a long gap (a hidden tab) counts as one capped frame', () => {
    const clock = makeClock({ speed: 100, maxFrameS: 0.1 });
    const noop = () => {};
    expect(clock.advance(5, noop)).toBe(10); // 0.1 s × 100 = 10 s
    expect(clock.advance(Number.POSITIVE_INFINITY, noop)).toBe(10);
    expect(clock.timeS).toBe(20);
  });

  it('counts NaN and negative realDtS as 0, without losing time already pending', () => {
    const clock = makeClock();
    const { calls, onStep } = recorder();
    clock.advance(0.75, onStep);
    for (const bad of [Number.NaN, -1, -0.5, Number.NEGATIVE_INFINITY]) {
      expect(clock.advance(bad, onStep), `advance(${bad})`).toBe(0);
      expect(clock.timeS).toBe(0);
    }
    expect(clock.advance(0.25, onStep)).toBe(1); // the 0.75 is still there
    expect(calls).toEqual([[1, 1]]);
  });

  it('is not poisoned by a NaN frame', () => {
    const clock = makeClock();
    clock.advance(Number.NaN, () => {});
    expect(clock.advance(1, () => {})).toBe(1);
    expect(clock.timeS).toBe(1);
  });

  it('takes no steps and gathers no time while paused', () => {
    const clock = makeClock();
    const { calls, onStep } = recorder();
    clock.setPaused(true);
    expect(clock.paused).toBe(true);
    expect(clock.advance(1, onStep)).toBe(0);
    expect(clock.advance(1, onStep)).toBe(0);
    expect(clock.timeS).toBe(0);
    expect(calls).toEqual([]);

    clock.setPaused(false);
    expect(clock.paused).toBe(false);
    expect(clock.advance(0, onStep)).toBe(0); // nothing was saved up while paused
    expect(clock.advance(1, onStep)).toBe(1);
    expect(clock.timeS).toBe(1);
  });

  it('takes at most maxStepsPerFrame steps and drops the excess, so a slow frame cannot snowball', () => {
    const clock = makeClock({ speed: 100, maxStepsPerFrame: 5 });
    const { calls, onStep } = recorder();
    expect(clock.advance(1, onStep)).toBe(5); // 100 s pending, 5 steps, 95 s dropped
    expect(clock.timeS).toBe(5);
    expect(clock.advance(0, onStep)).toBe(0);
    expect(clock.advance(0.03, onStep)).toBe(3);
    expect(clock.timeS).toBe(8);
    expect(calls).toHaveLength(8);
  });

  it('with the shipped settings runs 100 steps in a capped 0.1 s frame at x1,000 and at x10,000 (H55)', () => {
    for (const [speed, stepS] of [
      [1_000, 1],
      [10_000, 10],
    ] as const) {
      const clock = shippedClock(speed);
      const { calls, onStep } = recorder();
      expect(clock.advance(0.1, onStep), `x${speed}`).toBe(100);
      expect(clock.advance(1, onStep), `x${speed}, a 1 s frame clamped to 0.1 s`).toBe(100);
      expect(calls.every(([dtS]) => dtS === stepS)).toBe(true);
      expect(clock.timeS).toBe(plantConfig.clock.startTimeS + 200 * stepS);
    }
  });

  it('only ever moves time in whole steps, whatever the frame lengths', () => {
    const random = mulberry32(2_026);
    const clock = makeClock({ speed: 100, maxFrameS: 0.1 });
    let steps = 0;
    for (let frame = 0; frame < 2_000; frame++) {
      steps += clock.advance(random() * 0.15, (dtS) => expect(dtS).toBe(1));
      expect(clock.timeS).toBe(steps);
    }
    expect(steps).toBeGreaterThan(0);
  });
});

describe('Clock: setSpeed', () => {
  it('changes the speed', () => {
    const clock = makeClock();
    for (const speed of SPEEDS) {
      clock.setSpeed(speed);
      expect(clock.speed).toBe(speed);
    }
  });

  it.each([0, 7, 2, 5_000, -10, 100.5, Number.NaN])('throws a RangeError for %s and keeps the old speed', (speed) => {
    const clock = makeClock({ speed: 100 });
    expect(() => clock.setSpeed(speed as Speed)).toThrow(RangeError);
    expect(clock.speed).toBe(100);
  });
});

describe('Clock: jumpTo', () => {
  it('lands exactly on the target, with a shorter last step', () => {
    const clock = makeClock();
    const { calls, onStep } = recorder();
    expect(clock.jumpTo(3.5, onStep)).toBe(4);
    expect(calls).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [0.5, 3.5],
    ]);
    expect(clock.timeS).toBe(3.5);
  });

  it('lands exactly on a target that is not a whole number of fast steps away', () => {
    const clock = makeClock({ startTimeS: 21_600, speed: 10_000 });
    const { calls, onStep } = recorder();
    expect(clock.jumpTo(21_612.3, onStep)).toBe(2);
    expect(clock.timeS).toBe(21_612.3);
    expect(calls[0]).toEqual([10, 21_610]);
    expect(calls[1][0]).toBeCloseTo(2.3, 9);
    expect(calls[1][1]).toBe(21_612.3);
  });

  it('jumps a whole shift at the step size, landing on the boundary (06:00 to 14:00)', () => {
    const clock = makeClock({ startTimeS: 21_600, speed: 10 });
    let sumS = 0;
    expect(clock.jumpTo(50_400, (dtS) => (sumS += dtS))).toBe(28_800);
    expect(clock.timeS).toBe(50_400);
    expect(sumS).toBe(28_800);
  });

  it('ignores pause and maxStepsPerFrame', () => {
    const clock = makeClock({ maxStepsPerFrame: 5 });
    clock.setPaused(true);
    const { calls, onStep } = recorder();
    expect(clock.jumpTo(100, onStep)).toBe(100);
    expect(calls).toHaveLength(100);
    expect(clock.timeS).toBe(100);
    expect(clock.paused).toBe(true);
  });

  it('clears pending time', () => {
    const clock = makeClock();
    clock.advance(0.75, () => {});
    expect(clock.jumpTo(2, () => {})).toBe(2);
    // Had the 0.75 s survived the jump, 0.75 + 0.5 would make one more step.
    expect(clock.advance(0.5, () => {})).toBe(0);
    expect(clock.timeS).toBe(2);
  });

  it('is a no-op returning 0 when the target is not ahead', () => {
    const clock = makeClock({ startTimeS: 500 });
    const { calls, onStep } = recorder();
    expect(clock.jumpTo(500, onStep)).toBe(0);
    expect(clock.jumpTo(499.5, onStep)).toBe(0);
    expect(clock.jumpTo(-1_000, onStep)).toBe(0);
    expect(calls).toEqual([]);
    expect(clock.timeS).toBe(500);
  });
});
