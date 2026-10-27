// The sim the app runs: the clock, the event queue with shift changes and every command (core.ts), stages
// 1–6 live from the fixed-step liquid-line model (liquidLine.ts), run once per step, and stages 7–10 from the
// discrete packs model (packsLine.ts), whose fillers draw from the liquid line's aseptic tank and whose
// breakdowns, batches, incubations and trucks run through the core's event queue.
import type { PlantConfig, Sim } from '../contracts';
import { createCore } from './core';
import { createLiquidLine, LIQUID_STAGE_IDS, type LiquidLine, type LiquidLineOptions } from './liquidLine';
import { createPacksLine, PACKS_STAGE_IDS, type PacksLine } from './packsLine';
import { createRng, type Rng } from './rng';
import { linePoints, staticPlant, toStages } from './staticPlant';

export interface SimOptions extends Omit<LiquidLineOptions, 'fillers'> {
  /** Every random draw of the liquid line (the display noise); defaults to one seeded from plant.json's seed. */
  rng?: Rng;
  /**
   * Every random draw of the packs model (breakdowns, repairs, incubation results, the opening history);
   * defaults to its own stream from plant.json's seed, so the liquid line's draws, one a step, don't move
   * the breakdowns when the step size changes.
   */
  packsRng?: Rng;
  /** Called once with the liquid-line model, so a test can read its state and totals as the sim runs. */
  onLiquidLine?: (line: LiquidLine) => void;
  /** Called once with the packs model, likewise. */
  onPacksLine?: (line: PacksLine) => void;
}

/** The packs model's seed: plant.json's seed, mixed so its stream never runs in step with the liquid line's. */
export const packsSeed = (seed: number): number => Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1) >>> 0;

export function createSim(config: PlantConfig, options: SimOptions = {}): Sim {
  // The core first, so the packs model can queue its opening events; the hooks reach the models once built.
  const models: { liquid?: LiquidLine; packs?: PacksLine } = {};
  const core = createCore(config, {
    onStep(dtS, timeS) {
      models.liquid?.step(dtS, timeS, core.setpoints, core.log);
      models.packs?.afterStep(timeS, core.setpoints);
    },
    onEvent: (event) => models.packs?.onEvent(event, core.setpoints) ?? false,
    onQaResult: (batchId, result) => models.packs?.setQaResult(batchId, result, core.timeS),
  });
  const packs = createPacksLine(config, options.packsRng ?? createRng(packsSeed(config.seed)), core, core.timeS);
  const liquid = createLiquidLine(config, options.rng ?? createRng(config.seed), { fillers: packs.fillers });
  models.liquid = liquid;
  models.packs = packs;
  options.onLiquidLine?.(liquid);
  options.onPacksLine?.(packs);
  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const plant = staticPlant(config, core.setpoints);
      const live = liquid.view(core.setpoints, core.timeS);
      const discrete = packs.view(core.setpoints, core.timeS);
      const { values } = plant;
      for (const id of LIQUID_STAGE_IDS) values[id] = live.values[id];
      for (const id of PACKS_STAGE_IDS) values[id] = discrete.values[id];
      const statuses = { ...live.statuses, ...discrete.statuses };
      const line = linePoints(values, live.flows);
      return core.snapshot(toStages(values, (id) => statuses[id]), { ...plant.kpis, ...live.kpis, ...discrete.kpis }, line, live.liquid, discrete.packs);
    },
  };
}
