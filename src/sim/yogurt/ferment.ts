// Stage 13 (phase 17, D27): the fermentation tanks' cycle. A tank fills with inoculated mix, ferments once full,
// holds at the end pH, cooled, until P8's stirred product draws it, empties through the cooler, and is cleaned.
// The pH follows H125's curve on a clock that runs at the cardinal factor of the tank's temperature, so a change of
// the fermentation set point mid-way speeds or slows what is left of it.
import type { FermentTank, FermentTankState, YogurtConfig, YogurtProductId } from '../../contracts';
import { cardinalFactor, fermentPh, titratableAcidityPct } from './formulas';

/** What the model keeps of a tank between steps. */
export interface TankState {
  state: FermentTankState;
  levelL: number;
  product: YogurtProductId | null;
  /** Fermentation time at the optimum temperature so far (H125's curve clock). */
  curveS: number;
  startedS: number | null;
  /** When the tank reached its end pH, while ready or emptying; null before. */
  readyS: number | null;
  /** Time left in a clean. */
  cleanLeftS: number;
  /**
   * A bacteriophage hit its culture (phase 20, D30): its curve stalls at the fault's pH; `held` once it is flagged.
   * Absent for a healthy tank.
   */
  phage?: boolean;
  held?: boolean;
}

type Ferment = YogurtConfig['ferment'];

/** The curve's clock factor at the fermentation temperature: 1 at the optimum, 0 where the culture stands. */
export const curveRate = (ferment: Ferment, tempC: number): number => cardinalFactor(tempC, ferment.minC, ferment.optC, ferment.maxC);

/** pH of a tank: the start pH until it ferments, then H125's curve, and the end pH from the moment it is ready. */
export function tankPh(ferment: Ferment, tank: TankState): number {
  if (tank.state === 'fermenting') return fermentPh(ferment, tank.curveS, ferment.optC);
  if (tank.state === 'ready' || tank.state === 'emptying') return ferment.endPh;
  return ferment.startPh;
}

/**
 * Advances a fermenting tank by `dtS` at `tempC`; true if it reached its end pH in this step. A tank that reaches it
 * is cooled at once (the stirred route), so its pH holds there. A tank hit by a phage stops on its curve at
 * `stallCurveS` (the curve's clock at the stall pH, D30) and never reaches it.
 */
export function ferment(fermentConfig: Ferment, tank: TankState, dtS: number, tempC: number, nowS: number, stallCurveS = Infinity): boolean {
  if (tank.state !== 'fermenting') return false;
  const rate = curveRate(fermentConfig, tempC);
  if (tank.phage) {
    tank.curveS = Math.min(Math.max(tank.curveS, Math.min(tank.curveS + rate * dtS, stallCurveS)), fermentConfig.endAtOptS - 1);
    return false;
  }
  const leftS = fermentConfig.endAtOptS - tank.curveS;
  if (rate * dtS < leftS) {
    tank.curveS += rate * dtS;
    return false;
  }
  tank.curveS = fermentConfig.endAtOptS;
  tank.state = 'ready';
  // When, within the step, the curve reached the end pH.
  tank.readyS = rate > 0 ? nowS - dtS + leftS / rate : nowS;
  return true;
}

/** The tank as the snapshot shows it (contracts v8). */
export function tankView(fermentConfig: Ferment, tank: TankState, tempC: number, nowS: number): FermentTank {
  const ph = tankPh(fermentConfig, tank);
  const rate = curveRate(fermentConfig, tempC);
  let readyAtS: number | null = null;
  // A stalled tank shows when it was due: it never gets there (D30).
  if (tank.state === 'fermenting' && tank.phage) readyAtS = rate > 0 && tank.startedS !== null ? tank.startedS + fermentConfig.endAtOptS / rate : null;
  else if (tank.state === 'fermenting') readyAtS = rate > 0 ? nowS + (fermentConfig.endAtOptS - tank.curveS) / rate : null;
  else if (tank.state === 'ready' || tank.state === 'emptying') readyAtS = tank.readyS;
  return {
    levelL: tank.levelL,
    capacityL: fermentConfig.tankL,
    state: tank.state,
    product: tank.product,
    ph,
    taPct: titratableAcidityPct(fermentConfig, ph),
    startedS: tank.startedS,
    // A tank that stands at a temperature the culture does not work at has no time to ready: it shows its start.
    readyAtS: readyAtS ?? tank.startedS,
    ...(tank.held ? { held: true } : {}),
  };
}
