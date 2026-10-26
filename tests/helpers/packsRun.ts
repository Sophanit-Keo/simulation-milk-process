// Drives createSim for the stage 7–10 tests: the packs model's totals beside the snapshot, a scripted
// random stream for exact breakdowns, and runs to a sim time in whole frames.
import type { PlantConfig, Sim, Snapshot, Speed } from '../../src/contracts';
import { createSim } from '../../src/sim';
import type { LiquidLine } from '../../src/sim/liquidLine';
import type { PacksLine } from '../../src/sim/packsLine';
import type { Rng } from '../../src/sim/rng';
import { copyConfig, NO_BREAKDOWNS_MTBF_S } from './plantConfig';

/**
 * A packs random stream with chosen draws: each breakdown after `toFailureS` of running (one value per
 * draw, in draw order; NO_BREAKDOWNS_MTBF_S once the list runs out), each repair `repairS` (the random part;
 * its mean once the list runs out), and incubation samples that never spoil unless `spoil` says so.
 */
export function scriptedRng(config: PlantConfig, script: { toFailureS?: number[]; repairS?: number[]; spoil?: boolean[] } = {}): Rng {
  const toFailureS = [...(script.toFailureS ?? [])];
  const repairS = [...(script.repairS ?? [])];
  const spoil = [...(script.spoil ?? [])];
  return {
    next: () => 0.5,
    exponential(mean) {
      if (mean === config.fillers.mtbfMeanS) return toFailureS.shift() ?? NO_BREAKDOWNS_MTBF_S;
      if (mean === config.fillers.repairRandomMeanS) return repairS.shift() ?? mean;
      return mean;
    },
    chance: () => spoil.shift() ?? false,
  };
}

/** The shipped config with no opening history and no opening stock: the plant starts empty on day 8. */
export function emptyPlantConfig(): PlantConfig {
  const config = copyConfig();
  config.quality.historyDays = 0;
  config.warehouse.startStockPallets = 0;
  return config;
}

export interface PacksRun {
  readonly sim: Sim;
  readonly packs: PacksLine;
  readonly liquid: LiquidLine;
  readonly openS: number;
  /** Sim seconds since the plant opened. */
  t(): number;
  /** Runs frames until t ≥ tS (within one step after it), calling `each` with every frame's snapshot. */
  runTo(tS: number, each?: (snap: Snapshot) => void): Snapshot;
}

export function startPacks(config: PlantConfig, options: { speed?: Speed; packsRng?: Rng } = {}): PacksRun {
  let packs: PacksLine | undefined;
  let liquid: LiquidLine | undefined;
  const sim = createSim(config, { packsRng: options.packsRng, onPacksLine: (made) => (packs = made), onLiquidLine: (made) => (liquid = made) });
  if (!packs || !liquid) throw new Error('createSim made no models');
  const speed = options.speed ?? 10;
  if (speed !== config.clock.defaultSpeed) sim.dispatch({ type: 'setSpeed', speed });
  const openS = sim.snapshot().timeS;
  const t = () => sim.snapshot().timeS - openS;
  return {
    sim,
    packs,
    liquid,
    openS,
    t,
    runTo(tS, each) {
      while (t() < tS) {
        sim.step(Math.min(config.clock.maxFrameS, Math.max(tS - t(), 1e-6) / speed));
        each?.(sim.snapshot());
      }
      return sim.snapshot();
    },
  };
}
