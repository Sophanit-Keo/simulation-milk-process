// The CIP station's chemistry (phase 13, D23) as pure functions of plant.json: what each cleaning step
// circulates and at what strength, what the conductivity transmitter on the return reads as the step's fluid
// displaces what the circuit held, where the change-over valve sends the return, and what each step uses.
// The return is one well-mixed volume, the circuit, turned over by the circulation: its conductivity moves
// first-order toward the step's fluid's with τ = circuitL ÷ circulateLph (90 s at the defaults, H120). Litres of
// solution count as kilograms, as for the energy. Nothing here models soil, nor the strength falling as it cleans.
import { hToS, lphToLps, sToH, type CleaningFluid, type CleaningReturn, type CleaningStep, type CleaningUseSnapshot, type PlantConfig } from '../../contracts';

/** The two cleaning chemicals; water is the third fluid. */
export type CleaningChemical = Exclude<CleaningFluid, 'water'>;

const isChemical = (fluid: CleaningFluid): fluid is CleaningChemical => fluid === 'lye' || fluid === 'acid';

/** One step of a programme as the CIP station runs it. */
export interface StepChemistry {
  /** The step's chemical strength by weight; null for water. */
  concentrationPct: number | null;
  /** What the return reads as the step starts (the end of the step before, or milk for the first) and what it tends to. */
  startMsPerCm: number;
  fluidMsPerCm: number;
  /**
   * The solution whose tank the return goes back to while it reads above that solution's change-over: the step's own
   * chemical, or in a water step the chemical just before it. Null in a water step after water.
   */
  solution: CleaningChemical | null;
  /** In a water step, where the return goes once it is below the change-over: the water tank if recovered, else drain. */
  waterReturn: 'drain' | 'waterTank';
  /** What the step has used once it is done. */
  use: CleaningUseSnapshot;
}

/** The time constant of the circuit's displacement: its volume over the circulation, in seconds. */
export function displacementS(config: PlantConfig): number {
  return hToS(config.cleaning.circuitL / config.cleaning.circulateLph);
}

/** A fluid's conductivity at 20 °C (plant.json cleaning.chemicals). */
export function fluidMsPerCm(config: PlantConfig, fluid: CleaningFluid): number {
  return config.cleaning.chemicals[fluid].conductivityMsPerCm;
}

/** The circulation's mean velocity in the circuit's pipes, from its flow and bore: about 2.0 m/s at the defaults (D16). */
export function circulationMps(config: PlantConfig, flowLph: number): number {
  const radiusM = config.cleaning.pipeBoreMm / 2_000;
  return lphToLps(flowLph) / 1_000 / (Math.PI * radiusM * radiusM);
}

/** What the return reads `intoS` into a step: first-order from the step's start toward its fluid's (H120). */
export function returnMsPerCm(step: StepChemistry, intoS: number, tauS: number): number {
  return step.fluidMsPerCm + (step.startMsPerCm - step.fluidMsPerCm) * Math.exp(-Math.max(0, intoS) / tauS);
}

/** Where the change-over valve sends a return that reads `msPerCm` in a step of `fluid` (D23). */
export function returnTo(config: PlantConfig, step: StepChemistry, fluid: CleaningFluid, msPerCm: number): CleaningReturn {
  const above = (chemical: CleaningChemical): boolean => msPerCm >= config.cleaning.changeOverFrac * fluidMsPerCm(config, chemical);
  if (isChemical(fluid)) return above(fluid) ? `${fluid}Tank` : 'drain';
  if (step.solution && above(step.solution)) return `${step.solution}Tank`;
  return step.waterReturn;
}

/**
 * The solution a chemical step loses at its two interfaces (H121), in litres: at its start the return goes to drain
 * until it reaches the change-over, carrying the solution that has come round with it; at the rinse after it the
 * return goes back to the tank until it falls below the change-over, and what is still in the circuit then is lost.
 * The return's solution share is taken from its conductivity, between the solution's and the other fluid's.
 */
function solutionLostL(config: PlantConfig, chemicalMsPerCm: number, startMsPerCm: number, nextMsPerCm: number | null): number {
  const circuitL = config.cleaning.circuitL;
  const changeOverMsPerCm = config.cleaning.changeOverFrac * chemicalMsPerCm;
  // At the start: the share of the circuit still to displace when the return reaches the change-over.
  const leftFrac = Math.min(1, Math.max(0, (chemicalMsPerCm - changeOverMsPerCm) / (chemicalMsPerCm - startMsPerCm)));
  const startLossL = leftFrac > 0 && leftFrac < 1 ? circuitL * (-Math.log(leftFrac) - (1 - leftFrac)) : 0;
  // At the end: the solution left in the circuit when the rinse after it changes over, or all of it with no step after.
  const endLossL = nextMsPerCm === null ? circuitL : circuitL * Math.min(1, Math.max(0, (changeOverMsPerCm - nextMsPerCm) / (chemicalMsPerCm - nextMsPerCm)));
  return startLossL + endLossL;
}

/** A programme's steps as the CIP station runs them, starting from a circuit full of milk (D23). */
export function programChemistry(config: PlantConfig, steps: readonly CleaningStep[]): StepChemistry[] {
  const { cleaning } = config;
  const tauS = displacementS(config);
  const recovered = new Set(cleaning.recoverSteps);
  const out: StepChemistry[] = [];
  let startMsPerCm = cleaning.milkConductivityMsPerCm;
  for (const [index, step] of steps.entries()) {
    const fluidK = fluidMsPerCm(config, step.fluid);
    const before = steps[index - 1];
    const solution = isChemical(step.fluid) ? step.fluid : before && isChemical(before.fluid) ? before.fluid : null;
    const use: CleaningUseSnapshot = { lyeKg: 0, acidKg: 0, drainWaterL: 0 };
    let concentrationPct: number | null = null;
    if (isChemical(step.fluid)) {
      concentrationPct = cleaning.chemicals[step.fluid].concentrationPct;
      const next = steps[index + 1];
      const lostL = solutionLostL(config, fluidK, startMsPerCm, next ? fluidMsPerCm(config, next.fluid) : null);
      use[step.fluid === 'lye' ? 'lyeKg' : 'acidKg'] = (lostL * concentrationPct) / 100;
    } else if (!recovered.has(step.step)) {
      use.drainWaterL = cleaning.circulateLph * sToH(step.durationS);
    }
    const chemistry: StepChemistry = {
      concentrationPct,
      startMsPerCm,
      fluidMsPerCm: fluidK,
      solution,
      waterReturn: recovered.has(step.step) ? 'waterTank' : 'drain',
      use,
    };
    out.push(chemistry);
    startMsPerCm = returnMsPerCm(chemistry, step.durationS, tauS);
  }
  return out;
}

/** What a whole programme uses: the sum of its steps' (H121). */
export function programUse(chemistry: readonly StepChemistry[]): CleaningUseSnapshot {
  return chemistry.reduce<CleaningUseSnapshot>(
    (sum, step) => ({ lyeKg: sum.lyeKg + step.use.lyeKg, acidKg: sum.acidKg + step.use.acidKg, drainWaterL: sum.drainWaterL + step.use.drainWaterL }),
    { lyeKg: 0, acidKg: 0, drainWaterL: 0 },
  );
}
