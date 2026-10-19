// The sim the app runs: the clock, the event queue with shift changes and every command (core.ts),
// with stages 1–6 live from the fixed-step liquid-line model (liquidLine.ts), run once per step.
// Stages 7–10 stay at their set points (staticPlant.ts) until phase 4.
import type { PlantConfig, Sim, StageId, Status } from '../contracts';
import { createCore } from './core';
import { createLiquidLine, LIQUID_STAGE_IDS, type LiquidLine, type LiquidLineOptions } from './liquidLine';
import { createRng, type Rng } from './rng';
import { linePoints, staticPlant, toStages } from './staticPlant';

export interface SimOptions extends LiquidLineOptions {
  /** Every random draw of the model; defaults to one seeded from plant.json's seed. */
  rng?: Rng;
  /** Called once with the liquid-line model, so a test can read its state and totals as the sim runs. */
  onLiquidLine?: (line: LiquidLine) => void;
}

export function createSim(config: PlantConfig, options: SimOptions = {}): Sim {
  const liquidLine = createLiquidLine(config, options.rng ?? createRng(config.seed), options);
  options.onLiquidLine?.(liquidLine);
  const core = createCore(config, {
    onStep: (dtS, timeS) => liquidLine.step(dtS, timeS, core.setpoints, core.log),
  });
  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const plant = staticPlant(config, core.setpoints);
      const live = liquidLine.view(core.setpoints, core.timeS);
      const { values } = plant;
      for (const id of LIQUID_STAGE_IDS) values[id] = live.values[id];
      const statusOf = (id: StageId): Status => (id <= 6 ? live.statuses[id as keyof typeof live.statuses] : 'ok');
      const line = linePoints(values, live.flows);
      return core.snapshot(toStages(values, statusOf), { ...plant.kpis, ...live.kpis }, line, live.liquid);
    },
  };
}
