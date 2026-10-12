// Sim time (plan 06, "How time works"). Real frame time times the speed piles up
// as pending time, and the sim only ever moves in whole fixed steps, so the model
// sees the same steps whatever the frame rate.
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
    this.currentSpeed = speed;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  /** Turns one frame of real time into whole sim steps. Returns the number of steps taken. */
  advance(realDtS: number, onStep: StepHandler): number {
    if (this.isPaused) return 0;
    // NaN, negative or huge frame times (a hidden tab) must not jump or rewind the sim.
    const frameS = realDtS > 0 ? Math.min(realDtS, this.options.maxFrameS) : 0;
    this.pendingS += frameS * this.currentSpeed;

    const stepS = this.stepS;
    const wholeStepS = stepS * (1 - STEP_TOLERANCE_FRAC);
    let steps = 0;
    while (this.pendingS >= wholeStepS && steps < this.options.maxStepsPerFrame) {
      this.pendingS = Math.max(0, this.pendingS - stepS);
      this.currentTimeS += stepS;
      steps += 1;
      onStep(stepS, this.currentTimeS);
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
      this.currentTimeS = nextS >= targetS ? targetS : nextS;
      steps += 1;
      onStep(dtS, this.currentTimeS);
    }
    return steps;
  }
}
