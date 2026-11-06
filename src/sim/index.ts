// The sim the app runs: the clock, the event queue with shift changes and every command (core.ts), stages
// 1–6 live from the fixed-step liquid-line model (liquidLine.ts), run once per step, and stages 7–10 from the
// discrete packs model (packsLine.ts), whose fillers draw from the liquid line's aseptic tank and whose
// breakdowns, batches, incubations and trucks run through the core's event queue. Stages 11–15, the yogurt line's
// liquid side (phase 17) and Line P8 (phase 18), run in the same step after them (yogurt/yogurtLine.ts), the cold chain
// standing until phase 19.
import type { PlantConfig, Sim } from '../contracts';
import { createCore } from './core';
import { createLiquidLine, LIQUID_STAGE_IDS, type LiquidLine, type LiquidLineOptions } from './liquidLine';
import { createPacksLine, PACKS_STAGE_IDS, type PacksLine } from './packsLine';
import { createRng, type Rng } from './rng';
import { createScenarios, type Scenarios } from './scenarios';
import { linePoints, staticPlant, toStages } from './staticPlant';
import type { P8Conditions } from './yogurt/p8';
import { createYogurtLine, yogurtSeed, type YogurtLine } from './yogurt/yogurtLine';

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
  /** Called once with the yogurt line's model, likewise (phase 17). */
  onYogurtLine?: (line: YogurtLine) => void;
  /** Line P8's random draws (phase 18); defaults to its own stream from plant.json's seed (D28). */
  yogurtRng?: Rng;
  /** P8's readings in place of plant.json's (the HEPA cabin, the SIP, the swab, the seal), for tests (D28). */
  p8Conditions?: Partial<P8Conditions>;
}

/** The packs model's seed: plant.json's seed, mixed so its stream never runs in step with the liquid line's. */
export const packsSeed = (seed: number): number => Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1) >>> 0;

export function createSim(config: PlantConfig, options: SimOptions = {}): Sim {
  // The core first, so the packs model can queue its opening events; the hooks reach the models once built.
  const models: { liquid?: LiquidLine; packs?: PacksLine; scenarios?: Scenarios; yogurt?: YogurtLine } = {};
  const core = createCore(config, {
    onStep(dtS, timeS) {
      models.liquid?.step(dtS, timeS, core.setpoints, core.log);
      models.packs?.afterStep(timeS, core.setpoints);
      models.scenarios?.afterStep(timeS);
      // Last, reading the UHT line's tanker so the yogurt silo's waits while the bay's UHT lane is in use.
      models.yogurt?.step(dtS, timeS, core.setpoints, (models.liquid?.state.tankerLeftL ?? 0) > 0, core.log);
    },
    onEvent: (event) => (models.packs?.onEvent(event, core.setpoints) || models.scenarios?.onEvent(event)) ?? false,
    onQaResult: (batchId, result) => models.packs?.setQaResult(batchId, result, core.timeS),
    onScenario: (id, variant) => models.scenarios?.trigger(id, variant, core.timeS),
    onResetScenarios: () => models.scenarios?.reset(core.timeS),
    onYogurtProduct: (product) => models.yogurt?.setNextProduct(product, core.timeS, core.log),
    annotateLog: (entry, tag) => models.scenarios?.annotate(entry, tag),
  });
  const packs = createPacksLine(config, options.packsRng ?? createRng(packsSeed(config.seed)), core, core.timeS);
  const liquid = createLiquidLine(config, options.rng ?? createRng(config.seed), { fillers: packs.fillers });
  models.liquid = liquid;
  models.packs = packs;
  const scenarios = createScenarios(config, {
    liquid,
    packs,
    setpoints: core.setpoints,
    schedule: (timeS, type, payload) => core.schedule(timeS, type, payload),
    cancel: (seq) => core.cancel(seq),
    log: core.log,
  });
  models.scenarios = scenarios;
  // Last, queueing no events, and P8 drawing from a stream of its own, so the UHT line's steps, draws and numbers stay
  // as they were (D25, D28).
  const yogurt = createYogurtLine(config, core.timeS, { rng: options.yogurtRng ?? createRng(yogurtSeed(config.seed)), p8Conditions: options.p8Conditions });
  models.yogurt = yogurt;
  options.onLiquidLine?.(liquid);
  options.onPacksLine?.(packs);
  options.onYogurtLine?.(yogurt);
  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const plant = staticPlant(config, core.setpoints);
      const live = liquid.view(core.setpoints, core.timeS);
      const discrete = packs.view(core.setpoints, core.timeS);
      const wing = yogurt.view(core.setpoints, core.timeS);
      const { values } = plant;
      for (const id of LIQUID_STAGE_IDS) values[id] = live.values[id];
      for (const id of PACKS_STAGE_IDS) values[id] = discrete.values[id];
      const statuses = { ...live.statuses, ...discrete.statuses };
      scenarios.adjustStatuses(statuses);
      const allStatuses = { ...statuses, ...wing.statuses };
      const line = { ...linePoints(values, live.flows), ...wing.line };
      return core.snapshot(
        toStages({ ...values, ...wing.values }, (id) => allStatuses[id]),
        { ...plant.kpis, ...live.kpis, ...discrete.kpis },
        line,
        live.liquid,
        discrete.packs,
        scenarios.snapshot(core.timeS),
        wing.yogurt,
      );
    },
  };
}
