// The sim the app runs. Phase 1: the clock, the event queue with shift changes,
// and every command, over a plant held at its set points (staticPlant.ts).
import type { PlantConfig, Sim } from '../contracts';
import { createCore } from './core';
import { fillerDrawLph, linePoints, staticPlant, toStages } from './staticPlant';

export function createSim(config: PlantConfig): Sim {
  const core = createCore(config);
  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const plant = staticPlant(config, core.setpoints);
      const { values } = plant;
      const line = linePoints(values, {
        uhtLph: values[4].flowLph,
        divertLph: 0,
        fillerLph: fillerDrawLph(config, config.fillers.count, values[7].ratePacksPerH),
      });
      return core.snapshot(toStages(values), plant.kpis, line);
    },
  };
}
