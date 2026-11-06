// Stage 12 (phase 17, D27): the holding cell as a plug-flow delay, and the wing's CIP programme after a divert.
// The cell is always full: each step pushes the litres the heater passes in at its outlet temperature, and as many
// leave at the far end. A parcel keeps the temperature it entered with (the cell is insulated), so the one at the
// outlet tells the CCP its temperature and how long it was held, and its β-lactoglobulin was denatured for that long.
import {
  cleaningSteps,
  type CleaningSnapshot,
  type CleaningStep,
  type PlantConfig,
} from '../../contracts';
import { displacementS, programChemistry, returnMsPerCm, returnTo, type StepChemistry } from '../liquid/cleaningChemistry';

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
  };
}

/**
 * The wing's CIP programme (D27): the UHT CIP's steps and times (D16), with the lye and the acid at the SOP's
 * temperatures and strengths, through the wing's own circuit, so D23's chemistry gives its returns.
 */
export interface WingCip {
  readonly steps: readonly CleaningStep[];
  readonly totalS: number;
  /** The step and its chemistry `intoS` seconds into the programme. */
  snapshotAt(intoS: number): CleaningSnapshot;
  /** The temperature the step `intoS` into the programme runs at. */
  tempAt(intoS: number): number;
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

export function createWingCip(config: PlantConfig): WingCip {
  const { cip } = config.yogurt;
  const steps = cleaningSteps(config, 'cip').map((step) => ({
    ...step,
    tempC: step.fluid === 'lye' ? cip.lyeTempC : step.fluid === 'acid' ? cip.acidTempC : step.tempC,
  }));
  const wing = wingCleaningConfig(config);
  const chemistry: StepChemistry[] = programChemistry(wing, steps);
  const tauS = displacementS(wing);
  const totalS = steps.reduce((sum, step) => sum + step.durationS, 0);
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
    tempAt: (intoS) => steps[stepAt(intoS).index]?.tempC ?? 20,
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
