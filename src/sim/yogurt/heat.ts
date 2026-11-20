// Stage 12 (phase 17, D27): the holding cell as a plug-flow delay, and the wing's CIP programme after a divert. Since
// phase 32 (D34) the same model runs every programme of the wing's CIP station: the CIP of the heat treatment after a
// divert and of the buffer and P8 before set yogurt, and each fermentation tank's shorter CIP, and counts what each
// step uses as it ends.
// The cell is always full: each step pushes the litres the heater passes in at its outlet temperature, and as many
// leave at the far end. A parcel keeps the temperature it entered with (the cell is insulated), so the one at the
// outlet tells the CCP its temperature and how long it was held, and its β-lactoglobulin was denatured for that long.
import {
  cleaningSteps,
  sToH,
  yogurtTankCipSteps,
  type CleaningSnapshot,
  type CleaningStep,
  type CleaningUseSnapshot,
  type PlantConfig,
} from '../../contracts';
import { displacementS, programChemistry, programUse, returnMsPerCm, returnTo, type StepChemistry } from '../liquid/cleaningChemistry';

/** One parcel of mix in the cell: where it ends in the litres the heater has passed, its temperature and when it entered. */
export interface CellParcel {
  cumL: number;
  tempC: number;
  enteredS: number;
}

export interface HoldingCell {
  readonly volumeL: number;
  /** Pushes `litres` in at `tempC`, at `atS`; as many leave at the outlet. */
  push(litres: number, tempC: number, atS: number): void;
  /** The parcel at the outlet now. */
  outlet(): CellParcel;
  /** Fills the cell afresh at `tempC`, as if it entered `heldS` before `atS`: after a clean, with water at the set point. */
  refill(tempC: number, atS: number, heldS: number): void;
}

/** Litres this close count as the same place in the cell. */
const CELL_EPS_L = 1e-9;

/** A cell of `volumeL`, full of mix at `tempC` that entered `heldS` before `atS`. */
export function createHoldingCell(volumeL: number, tempC: number, atS: number, heldS: number): HoldingCell {
  let cumInL = volumeL;
  let parcels: CellParcel[] = [{ cumL: volumeL, tempC, enteredS: atS - heldS }];
  return {
    volumeL,
    push(litres, parcelTempC, parcelAtS) {
      if (!(litres > 0)) return;
      cumInL += litres;
      parcels.push({ cumL: cumInL, tempC: parcelTempC, enteredS: parcelAtS });
      // Parcels wholly past the outlet are gone.
      const exitL = cumInL - volumeL;
      const first = parcels.findIndex((parcel) => parcel.cumL >= exitL - CELL_EPS_L);
      if (first > 0) parcels = parcels.slice(first);
    },
    outlet() {
      const exitL = cumInL - volumeL;
      return parcels.find((parcel) => parcel.cumL >= exitL - CELL_EPS_L) ?? parcels[parcels.length - 1];
    },
    refill(refillTempC, refillAtS, refillHeldS) {
      parcels = [{ cumL: cumInL, tempC: refillTempC, enteredS: refillAtS - refillHeldS }];
    },
  };
}

/**
 * A programme of the wing's CIP station (D27; since phase 32, D34, any of them): its steps through the wing's circuit,
 * with D23's chemistry giving each step's return and what it uses.
 */
export interface WingCip {
  readonly steps: readonly CleaningStep[];
  readonly totalS: number;
  /** The step and its chemistry `intoS` seconds into the programme. */
  snapshotAt(intoS: number): CleaningSnapshot;
  /** The temperature the step `intoS` into the programme runs at. */
  tempAt(intoS: number): number;
  /**
   * What the steps that end after `fromS` and by `toS` into the programme use (phase 32): each step counts as it ends, as
   * the UHT station's do (D23), so successive calls over a programme's time count each step once.
   */
  useBetween(fromS: number, toS: number): CleaningUseSnapshot;
  /** What the whole programme uses (H140). */
  readonly use: CleaningUseSnapshot;
}

export function wingCleaningConfig(config: PlantConfig): PlantConfig {
  const { cip } = config.yogurt;
  return {
    ...config,
    cleaning: {
      ...config.cleaning,
      circulateLph: cip.circulateLph,
      circuitL: cip.circuitL,
      chemicals: {
        ...config.cleaning.chemicals,
        lye: { concentrationPct: cip.lyePct, conductivityMsPerCm: cip.lyeConductivityMsPerCm },
        acid: { concentrationPct: cip.acidPct, conductivityMsPerCm: cip.acidConductivityMsPerCm },
      },
    },
  };
}

/** Two times this close are the same moment: a step that ends at `toS` counts now, not again from `toS` on. */
const STEP_END_EPS_S = 1e-6;

/** Any programme of `steps` through the wing's circuit, starting from a circuit full of milk (D23). */
export function createCipProgramme(config: PlantConfig, steps: readonly CleaningStep[]): WingCip {
  const { cip } = config.yogurt;
  const wing = wingCleaningConfig(config);
  const chemistry: StepChemistry[] = programChemistry(wing, steps);
  const tauS = displacementS(wing);
  const ends: number[] = [];
  for (const step of steps) ends.push((ends.at(-1) ?? 0) + step.durationS);
  const totalS = ends.at(-1) ?? 0;
  const stepAt = (intoS: number): { index: number; intoStepS: number } => {
    let startS = 0;
    for (const [index, step] of steps.entries()) {
      if (intoS < startS + step.durationS || index === steps.length - 1) return { index, intoStepS: Math.max(0, intoS - startS) };
      startS += step.durationS;
    }
    return { index: 0, intoStepS: 0 };
  };
  return {
    steps,
    totalS,
    use: programUse(chemistry),
    tempAt: (intoS) => steps[stepAt(intoS).index]?.tempC ?? 20,
    useBetween(fromS, toS) {
      const sum: CleaningUseSnapshot = { lyeKg: 0, acidKg: 0, drainWaterL: 0 };
      ends.forEach((endS, i) => {
        if (!(endS > fromS + STEP_END_EPS_S && endS <= toS + STEP_END_EPS_S)) return;
        const use = chemistry[i]?.use;
        if (!use) return;
        sum.lyeKg += use.lyeKg;
        sum.acidKg += use.acidKg;
        sum.drainWaterL += use.drainWaterL;
      });
      return sum;
    },
    snapshotAt(intoS) {
      const { index, intoStepS } = stepAt(intoS);
      const step = steps[index];
      const chem = chemistry[index];
      const msPerCm = returnMsPerCm(chem, intoStepS, tauS);
      return {
        program: 'cip',
        step: step.step,
        fluid: step.fluid,
        stepIndex: index,
        stepCount: steps.length,
        stepRemainingS: Math.max(0, step.durationS - intoStepS),
        tempC: step.tempC,
        flowLph: cip.circulateLph,
        concentrationPct: step.fluid === 'lye' ? cip.lyePct : step.fluid === 'acid' ? cip.acidPct : null,
        returnConductivityMsPerCm: msPerCm,
        returnTo: returnTo(wing, chem, step.fluid, msPerCm),
      };
    },
  };
}

/** The wing's CIP (D27): the UHT CIP's steps and times (D16), the lye and the acid at the SOP's temperatures. */
export function createWingCip(config: PlantConfig): WingCip {
  const { cip } = config.yogurt;
  return createCipProgramme(
    config,
    cleaningSteps(config, 'cip').map((step) => ({
      ...step,
      tempC: step.fluid === 'lye' ? cip.lyeTempC : step.fluid === 'acid' ? cip.acidTempC : step.tempC,
    })),
  );
}

/** A fermentation tank's CIP after it is emptied (phase 32, D34): yogurt.cip.tankSteps, filling ferment.tankCleanS. */
export function createTankCip(config: PlantConfig): WingCip {
  return createCipProgramme(config, yogurtTankCipSteps(config));
}

/** What a rinse of the buffer and the fruit line uses (phase 32, D34): water at the wing's circulation, all to drain. */
export function rinseUse(config: PlantConfig, durationS: number): CleaningUseSnapshot {
  return { lyeKg: 0, acidKg: 0, drainWaterL: config.yogurt.cip.circulateLph * sToH(durationS) };
}
