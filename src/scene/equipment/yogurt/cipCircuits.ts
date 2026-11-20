// The yogurt wing's CIP station's three circuits (phase 32, D34), as the 3D view reads them from the snapshot: what each
// circulates now, at what temperature and flow, what its return reads and where it goes, and what it cleans. The station's
// parts (cipStation.ts), its label and the pipes (pipes.ts) all read them here, so they always agree.
//
// - The heat treatment: the wing's CIP after a divert (heat.cleaning, contracts v9).
// - The fermentation tanks: a tank's CIP after it is emptied (ferment.tanks[].cleaning, contracts v13). Should two tanks
//   clean at once, the circuit's supply shows the one that started first; each tank's drop shows its own.
// - The buffer and P8: the wing's CIP before set yogurt (buffer.changeover.cleaning, contracts v13), and the rinse of
//   the buffer and the fruit line before a stirred product, water to drain. P8's SIP is its own skid's steam.
//
// A snapshot older than v13 names no step for a tank's clean or P8's CIP: those circuits then show water.
import type { CleaningFluid, CleaningReturn, CleaningSnapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';

export type CipCircuitId = 'heat' | 'tanks' | 'p8';

/** West to east, as the station's lanes stand (layout.ts CIP_STATION). */
export const CIP_CIRCUIT_IDS: readonly CipCircuitId[] = ['heat', 'tanks', 'p8'];

/** Each circuit's name, for its label and the panel. */
export const CIP_CIRCUIT_NAMES: Readonly<Record<CipCircuitId, string>> = {
  heat: 'Heat treatment',
  tanks: 'Fermentation tanks',
  p8: 'Buffer and P8',
};

export interface CipCircuitState {
  running: boolean;
  /** The step's fluid; null while the circuit stands. */
  fluid: CleaningFluid | null;
  /** What the step runs at; null while it stands, or for a rinse given no temperature. */
  tempC: number | null;
  flowLph: number;
  /** The return's conductivity, mS/cm at 20 °C, and where the change-over valve sends it; null while it stands. */
  returnMsPerCm: number | null;
  returnTo: CleaningReturn | null;
  /** The step itself, when the snapshot gives one. */
  step: CleaningSnapshot | null;
  /** What it cleans now: "the heat treatment", "tank 2", "the buffer and P8"; '' while it stands. */
  what: string;
}

const CIRCULATE_LPH = plantJson.yogurt.cip.circulateLph;
const WATER_MS_PER_CM = plantJson.cleaning.chemicals.water.conductivityMsPerCm;
const RINSE_TEMP_C = plantJson.cleaning.cipSteps.find((step) => step.step === 'rinse')?.tempC ?? 45;

const STANDING: CipCircuitState = { running: false, fluid: null, tempC: null, flowLph: 0, returnMsPerCm: null, returnTo: null, step: null, what: '' };

/** A circuit running `step`, or water when the snapshot names no step. */
function runningOn(step: CleaningSnapshot | null | undefined, what: string): CipCircuitState {
  if (!step) return { running: true, fluid: 'water', tempC: RINSE_TEMP_C, flowLph: CIRCULATE_LPH, returnMsPerCm: WATER_MS_PER_CM, returnTo: 'drain', step: null, what };
  return {
    running: true,
    fluid: step.fluid,
    tempC: step.tempC,
    flowLph: step.flowLph,
    returnMsPerCm: step.returnConductivityMsPerCm ?? null,
    returnTo: step.returnTo ?? null,
    step,
    what,
  };
}

/** The tanks that clean now, by index, the one furthest into its clean first. */
export function cleaningTanks(y: YogurtSnapshot): number[] {
  const progress = (i: number): number => {
    const step = y.ferment.tanks[i]?.cleaning;
    return step ? step.stepIndex * 1e6 - step.stepRemainingS : 0;
  };
  return y.ferment.tanks
    .map((tank, i) => (tank.state === 'cleaning' ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => progress(b) - progress(a));
}

/** What each of the station's circuits does now. */
export function cipCircuits(y: YogurtSnapshot): Record<CipCircuitId, CipCircuitState> {
  const heat = y.heat.mode === 'cleaning' ? runningOn(y.heat.cleaning, 'the heat treatment') : STANDING;
  const tankIndex = cleaningTanks(y)[0];
  const tanks = tankIndex === undefined ? STANDING : runningOn(y.ferment.tanks[tankIndex]?.cleaning, `tank ${tankIndex + 1}`);
  const changeover = y.buffer.changeover;
  let p8 = STANDING;
  if (changeover?.kind === 'cip') p8 = runningOn(changeover.cleaning, 'the buffer and P8');
  else if (changeover?.kind === 'rinse') p8 = runningOn(null, 'the buffer and the fruit line');
  return { heat, tanks, p8 };
}

/** The fluid a tank's CIP drop carries now: its own step's, or water from an older snapshot; null while it does not clean. */
export function tankCipFluid(y: YogurtSnapshot, tank: number): CleaningFluid | null {
  const each = y.ferment.tanks[tank];
  if (!each || each.state !== 'cleaning') return null;
  return each.cleaning?.fluid ?? 'water';
}

/** What the pipes show of each circuit (pipes.ts): its fluid and circulation while it runs, null while it stands. */
export function yogurtPipeCleaning(y: YogurtSnapshot): Record<CipCircuitId, { fluid: CleaningFluid; flowLph: number } | null> {
  const circuits = cipCircuits(y);
  const of = (id: CipCircuitId) => {
    const each = circuits[id];
    return each.running && each.fluid ? { fluid: each.fluid, flowLph: each.flowLph } : null;
  };
  return { heat: of('heat'), tanks: of('tanks'), p8: of('p8') };
}
