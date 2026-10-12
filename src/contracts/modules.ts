import type { Command } from './commands';
import type { Snapshot } from './snapshot';

/** Implemented by src/sim (createSim, createMockSim). */
export interface Sim {
  /** Advance by one frame of real time; the sim turns it into fixed sim steps and due events. */
  step(realDtS: number): void;
  dispatch(command: Command): void;
  snapshot(): Snapshot;
}

/** Implemented by src/scene (createWorld). */
export interface World {
  update(snapshot: Snapshot, realDtS: number): void;
  render(): void;
  dispose(): void;
}

/** Implemented by src/ui (createHud). Updated about 4 times a second (plan 07). */
export interface Hud {
  update(snapshot: Snapshot): void;
  dispose(): void;
}
