// How fast the plant's animations run (phase 3): bowls, agitators, pistons, puffs, bubbles and the flowing
// pipe stripes. They run on real time, as the preview's do, a little faster at a higher sim speed so ×1,000
// looks busier than ×1, but capped so ×10,000 doesn't turn them into a strobe. Paused, they stand still.
import type { Snapshot } from '../contracts';

/** The most an animation speeds up: ×10,000 runs it 3 times as fast as ×1. */
export const MAX_MOTION_RATE = 3;

/**
 * Animation speed at a sim speed: 1 at ×1, half a step more per tenfold (×10 1.5, ×100 2, ×1,000 2.5), and
 * MAX_MOTION_RATE from ×10,000 up. The sim itself runs thousands of times faster; the animations only hint at it.
 */
export function motionRate(speed: number): number {
  if (!(speed > 1)) return 1;
  return Math.min(MAX_MOTION_RATE, 1 + Math.log10(speed) / 2);
}

/**
 * Animation seconds for one frame: the frame's real time (main.ts already counts no frame as longer than
 * maxFrameS) times motionRate, and 0 while the sim is paused.
 */
export function motionDtS(snapshot: Pick<Snapshot, 'paused' | 'speed'>, realDtS: number): number {
  if (snapshot.paused || !(realDtS > 0)) return 0;
  return realDtS * motionRate(snapshot.speed);
}

/**
 * A cyclic phase (an angle, a stripe offset) moved on by `step`, but by no more than `maxStep` in one frame,
 * and wrapped into [0, period). On slow frames the cap keeps a spinning part from jumping most of a turn,
 * which would look like it stands still or runs backwards.
 */
export function advancePhase(phase: number, step: number, maxStep: number, period: number): number {
  const next = phase + Math.min(Math.max(step, 0), maxStep);
  return next % period;
}
