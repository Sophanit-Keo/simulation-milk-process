// The sim the app runs. Phase 1: the clock, the event queue with shift changes,
// and every command, over a plant held at its set points (staticPlant.ts).
import type { PlantConfig, Sim } from '../contracts';
import { createCore } from './core';
import { staticPlant, toStages } from './staticPlant';

export function createSim(config: PlantConfig): Sim {
  const core = createCore(config);
  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const plant = staticPlant(config, core.setpoints);
      return core.snapshot(toStages(plant.values), plant.kpis);
    },
  };
}
