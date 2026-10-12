// Sim time (plan 06, "How time works"). Real frame time times the speed piles up
// as pending time, and the sim only ever moves in whole fixed steps (cut short only to
// land on a queued event), so the model sees the same steps whatever the frame rate.
import { isSpeed, type Speed } from '../contracts';

export interface ClockOptions {
  startTimeS: number;
  speed: Speed;
  baseStepS: number;
  fastStepS: number;
  fastStepAboveSpeed: number;
  maxStepsPerFrame: number;
  maxFrameS: number;
}

export type StepHandler = (dtS: number, timeS: number) => void;

/** Sim time of the next point a step must not cross (the next queued event), or undefined for none. */
export type NextBoundary = () => number | undefined;

// Frame times like 0.1 s don't add up exactly in floating point (ten of them make
// 0.9999999999999999), so pending time this close to a whole step counts as one.
const STEP_TOLERANCE_FRAC = 1e-9;

const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;

export class Clock {
  private readonly options: ClockOptions;
  private currentTimeS: number;
  private currentSpeed: Speed;
  private isPaused = false;
  private pendingS = 0;

  constructor(options: ClockOptions) {
    if (!isSpeed(options.speed)) throw new RangeError(`Speed must be one of the presets, got ${options.speed}`);
    if (!isPositive(options.baseStepS) || !isPositive(options.fastStepS)) {
      throw new RangeError(`Clock steps must be positive, got ${options.baseStepS} s and ${options.fastStepS} s`);
    }
    if (!(options.maxStepsPerFrame > 0)) {
      throw new RangeError(`maxStepsPerFrame must be positive, got ${options.maxStepsPerFrame}`);
    }
    if (!Number.isFinite(options.startTimeS)) throw new RangeError(`startTimeS must be finite, got ${options.startTimeS}`);
    if (!(options.maxFrameS >= 0)) throw new RangeError(`maxFrameS must not be negative, got ${options.maxFrameS}`);
    this.options = { ...options };
    this.currentTimeS = options.startTimeS;
    this.currentSpeed = options.speed;
  }

  get timeS(): number {
    return this.currentTimeS;
  }

  get speed(): Speed {
    return this.currentSpeed;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  /** Fixed step: 1 s up to the fast-step speed, longer above it, since tank levels change slowly. */
  get stepS(): number {
    const { baseStepS, fastStepS, fastStepAboveSpeed } = this.options;
    return this.currentSpeed <= fastStepAboveSpeed ? baseStepS : fastStepS;
  }

  setSpeed(speed: Speed): void {
    if (!isSpeed(speed)) throw new RangeError(`Speed must be one of the presets, got ${speed}`);
    const oldStepS = this.stepS;
    this.currentSpeed = speed;
    // Time saved up under the old step size would come out in steps of the new one: 9 s saved at x10,000
    // is a 9 s jump in the first frame at x1. Dropping it loses less than one old step of sim time.
    if (this.stepS !== oldStepS) this.pendingS = 0;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  /**
   * Turns one frame of real time into whole sim steps. Returns the number of steps taken.
   * With nextBoundaryS, a step that would cross the boundary is cut short to land on it exactly, so an
   * event runs at its own time rather than at the end of a step that passed it. The boundary is read
   * again before every step, because a step's handlers may queue new events.
   */
  advance(realDtS: number, onStep: StepHandler, nextBoundaryS?: NextBoundary): number {
    if (this.isPaused) return 0;
    // NaN, negative or huge frame times (a hidden tab) must not jump or rewind the sim.
    const frameS = realDtS > 0 ? Math.min(realDtS, this.options.maxFrameS) : 0;
    this.pendingS += frameS * this.currentSpeed;

    const stepS = this.stepS;
    const wholeStepS = stepS * (1 - STEP_TOLERANCE_FRAC);
    let steps = 0;
    while (this.pendingS >= wholeStepS && steps < this.options.maxStepsPerFrame) {
      const fullS = this.currentTimeS + stepS;
      const boundaryS = nextBoundaryS?.();
      const cutShort = boundaryS !== undefined && boundaryS > this.currentTimeS && boundaryS < fullS;
      const dtS = cutShort ? boundaryS - this.currentTimeS : stepS;
      this.moveTo(cutShort ? boundaryS : fullS);
      this.pendingS = Math.max(0, this.pendingS - dtS);
      steps += 1;
      onStep(dtS, this.currentTimeS);
    }
    // Hit the step cap: drop the backlog so one slow frame can't snowball into the next.
    if (steps >= this.options.maxStepsPerFrame) this.pendingS = 0;
    return steps;
  }

  /** Steps straight to targetS (used by "next event"), landing on it exactly. Returns the number of steps. */
  jumpTo(targetS: number, onStep: StepHandler): number {
    if (!(targetS > this.currentTimeS)) return 0;
    if (!Number.isFinite(targetS)) throw new RangeError(`Can't jump to ${targetS}`);
    this.pendingS = 0;
    const stepS = this.stepS;
    let steps = 0;
    while (this.currentTimeS < targetS) {
      const dtS = Math.min(stepS, targetS - this.currentTimeS);
      const nextS = this.currentTimeS + stepS;
      // Land the last step on targetS itself, so rounding can't leave the clock a hair off it.
      this.moveTo(nextS >= targetS ? targetS : nextS);
      steps += 1;
      onStep(dtS, this.currentTimeS);
    }
    return steps;
  }

  private moveTo(nextS: number): void {
    // A step too small for the time's floating-point resolution leaves the time where it is, and the
    // loops above would then never end. checkPlantConfig keeps plant.json far from this.
    if (!(nextS > this.currentTimeS)) {
      throw new RangeError(`A ${this.stepS} s step does not move the clock at ${this.currentTimeS} s`);
    }
    this.currentTimeS = nextS;
  }
}
