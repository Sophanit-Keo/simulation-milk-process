// What the stage 7–10 models share: the way into the core's event queue and log.
import type { QueuedEvent } from '../eventQueue';
import type { LogWriter } from '../log';

/** The core's event queue and log, as the discrete model uses them (plan 06: every timed change runs through the queue). */
export interface Scheduler {
  schedule<P>(timeS: number, type: string, payload: P): QueuedEvent<P>;
  /** False if the event already ran or was cancelled. */
  cancel(seq: number): boolean;
  log: LogWriter;
}

/** Times this close count as equal (floating-point slack, far below a step). */
export const TIME_EPS_S = 1e-6;

/** Whole units in a running total that floating-point sums may leave a hair short: 0.9999999999 packs is one. */
export const wholeUnits = (amount: number): number => Math.floor(amount + 1e-9);
