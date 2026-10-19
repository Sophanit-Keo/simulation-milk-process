// Drives the liquid-line model (src/sim/liquidLine.ts) directly, step by step, without the clock:
// for model-level tests that need many sim days fast, a chosen step size, or the model's state and totals.
import type { LogKind, PlantConfig } from '../../src/contracts';
import type { Setpoints } from '../../src/sim/core';
import { createLiquidLine, type LiquidLine, type LiquidLineOptions } from '../../src/sim/liquidLine';
import { createRng } from '../../src/sim/rng';
import { copyConfig } from './plantConfig';

export interface LoggedEntry {
  timeS: number;
  kind: LogKind;
  message: string;
  /** The aseptic tank's level when the entry was written. */
  asepticL: number;
}

/** The live set points as the core opens them: plant.json's values. */
export const defaultSetpoints = (config: PlantConfig): Setpoints => ({
  uhtSetpointC: config.uht.setpointC,
  homogenizerStage1Bar: config.homogenizer.stage1Bar,
  fillerRatePacksPerH: config.fillers.ratePacksPerH,
});

/** The shipped config with no display noise, for checks against noise-free hand values. */
export function quietConfig(): PlantConfig {
  const config = copyConfig();
  config.uht.displayNoiseC = 0;
  return config;
}

export interface LiquidRun {
  readonly line: LiquidLine;
  /** Every entry the model wrote, oldest first. */
  readonly log: LoggedEntry[];
  /** Live set points; change them between runs, as a setSetpoint command would. */
  readonly setpoints: Setpoints;
  /** Sim time now, seconds since day 1, 00:00. */
  readonly timeS: number;
  /** Runs whole steps of dtS for `seconds`, calling `each` after every step. */
  run(seconds: number, dtS?: number, each?: () => void): void;
}

export function startLiquid(config: PlantConfig, options: LiquidLineOptions & { seed?: number } = {}): LiquidRun {
  const line = createLiquidLine(config, createRng(options.seed ?? config.seed), options);
  const log: LoggedEntry[] = [];
  const setpoints = defaultSetpoints(config);
  let timeS = config.clock.startTimeS;
  const write = (atS: number, kind: LogKind, message: string) => log.push({ timeS: atS, kind, message, asepticL: line.state.asepticL });
  return {
    line,
    log,
    setpoints,
    get timeS() {
      return timeS;
    },
    run(seconds, dtS = 1, each) {
      const steps = Math.round(seconds / dtS);
      for (let i = 0; i < steps; i++) {
        timeS += dtS;
        line.step(dtS, timeS, setpoints, write);
        each?.();
      }
    },
  };
}
