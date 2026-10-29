import type { CleaningStepId, LiquidSnapshot, StageId, Status, UhtMode } from '../contracts';
import { formatDuration, formatNumber, formatSigned, NO_VALUE, withUnit } from './format';

/** A state the panel shows in words with a lamp, such as "Diverting · 2 min 30 s left". */
export interface StateText {
  text: string;
  status: Status;
}

/**
 * The UHT plant's mode in words, and its lamp (plan 08 colours): green while it makes product, red while
 * it diverts, amber while it cleans or re-sterilizes and makes nothing.
 */
const MODES: Readonly<Record<UhtMode, StateText>> = {
  production: { text: 'Production', status: 'ok' },
  divert: { text: 'Diverting to reject', status: 'bad' },
  cip: { text: 'Cleaning (CIP)', status: 'warn' },
  sterilize: { text: 'Re-sterilizing', status: 'warn' },
  aic: { text: 'Intermediate clean', status: 'warn' },
};

/** "Production", or the step and the time left in it: "Cleaning (CIP) · 1 h 20 min left". */
export function uhtModeText(liquid: Pick<LiquidSnapshot, 'uhtMode' | 'modeRemainingS'>): StateText {
  const mode = MODES[liquid.uhtMode] as StateText | undefined;
  if (!mode) return { text: NO_VALUE, status: 'idle' };
  if (liquid.uhtMode === 'production' || !(liquid.modeRemainingS > 0)) return mode;
  return { text: `${mode.text} · ${formatDuration(liquid.modeRemainingS)} left`, status: mode.status };
}

/** Each cleaning step in words (phase 7): the CIP's handbook steps, and the AIC's water that pushes the milk out. */
export const CLEANING_STEP_TEXT: Readonly<Record<CleaningStepId, string>> = {
  preRinse: 'Pre-rinse',
  lye: 'Lye (NaOH)',
  rinse: 'Rinse',
  acid: 'Acid (HNO₃)',
  postRinse: 'Post-rinse',
  cooling: 'Gradual cooling',
  displace: 'Water displaces milk',
};

/**
 * The cleaning step under way (contracts v5): "Lye (NaOH), 75 °C · 2 of 6 · 29 min left", an AIC step with no
 * temperature of its own. "None" while the plant makes product, diverts or re-sterilizes, or from an older snapshot.
 */
export function cleaningText(liquid: Pick<LiquidSnapshot, 'cleaning'>): StateText {
  const cleaning = liquid.cleaning;
  if (!cleaning) return { text: 'None', status: 'idle' };
  const name = CLEANING_STEP_TEXT[cleaning.step] ?? cleaning.step;
  const temp = cleaning.tempC === null ? '' : `, ${withUnit(formatNumber(cleaning.tempC), '°C')}`;
  return { text: `${name}${temp} · ${cleaning.stepIndex + 1} of ${cleaning.stepCount} · ${formatDuration(cleaning.stepRemainingS)} left`, status: 'warn' };
}

/** The UHT plant's feed: full flow, or held back while the aseptic tank is high (90% on, 60% off). */
export function throttleText(liquid: Pick<LiquidSnapshot, 'throttled'>): StateText {
  return liquid.throttled ? { text: 'Throttled · tank high', status: 'warn' } : { text: 'Full flow', status: 'ok' };
}

/** Stage 4's feed: milk still flows while diverting, none while the plant cleans or re-sterilizes. */
export function feedText(liquid: Pick<LiquidSnapshot, 'throttled' | 'uhtMode'>): StateText {
  if (liquid.uhtMode === 'production' || liquid.uhtMode === 'divert') return throttleText(liquid);
  return { text: 'Stopped · no milk', status: 'idle' };
}

/** What reaches the aseptic tank from the UHT plant (stage 6): product, or nothing while it diverts or cleans. */
export function supplyText(liquid: Pick<LiquidSnapshot, 'throttled' | 'uhtMode'>): StateText {
  if (liquid.uhtMode === 'production') return throttleText(liquid);
  return { text: liquid.uhtMode === 'divert' ? 'No inflow · diverting' : 'No inflow · cleaning', status: 'warn' };
}

/** The fillers' draw on the aseptic tank: how many run, or that they wait for product. */
export function fillersText(liquid: Pick<LiquidSnapshot, 'fillersRunning' | 'fillersStarved'>): StateText {
  if (liquid.fillersStarved) return { text: 'Waiting · tank low', status: 'warn' };
  if (liquid.fillersRunning > 0) return { text: `${liquid.fillersRunning} running`, status: 'ok' };
  return { text: 'None running', status: 'idle' };
}

/** A state row of the info panel, above the stage's values. */
export interface StateRow {
  key: string;
  label: string;
  read(liquid: LiquidSnapshot): StateText;
}

/**
 * The UHT mode where the divert happens (stage 4), the throttle at both of its ends (the UHT plant it
 * slows, stage 4, and the tank that sets it off, stage 6), and the fillers' draw at the tank.
 */
export const STATE_ROWS: Readonly<Partial<Record<StageId, readonly StateRow[]>>> = {
  4: [
    { key: 'uhtMode', label: 'UHT plant', read: uhtModeText },
    { key: 'cleaning', label: 'Cleaning step', read: cleaningText },
    { key: 'throttle', label: 'Feed', read: feedText },
  ],
  6: [
    { key: 'throttle', label: 'UHT plant', read: supplyText },
    { key: 'fillers', label: 'Fillers', read: fillersText },
  ],
};

/** A value row the panel works out from the stage's other values (or the liquid line's), shown right after the row `after`. */
export interface DerivedRow {
  key: string;
  label: string;
  after: string;
  read(values: Readonly<Record<string, number>>, liquid?: Partial<LiquidSnapshot>): string;
}

/**
 * How far the holding-tube outlet runs above the divert limit, e.g. "+0.78 °C" at full flow and 140 °C.
 * The limit follows the hold, and the hold the flow (R6), so throttling to half flow widens the margin to
 * about 3.9 °C. A reading under the limit diverts; so does a set point under it, even while the noise lifts
 * the reading, and the margin, a little over. With no milk in the tube (a clean) there is no margin.
 */
export function marginText(values: Readonly<Record<string, number>>): string {
  const { tempC, divertLimitC, flowLph } = values;
  if (tempC === undefined || divertLimitC === undefined) return NO_VALUE;
  if (flowLph !== undefined && !(flowLph > 0)) return NO_VALUE;
  return withUnit(formatSigned(tempC - divertLimitC, 2), '°C');
}

/**
 * The energy since the plant opened per tonne of raw milk drawn (contracts v6, phase 8), as BAT counts it for
 * dairies: the boiler's gas and the homogenizer's electricity, "92.4 kWh/t" after a day (About says per tonne of
 * what; "raw milk" in the value would wrap the row). "—" before any
 * raw milk is drawn, or from an older snapshot.
 */
export function energyPerTonneText(liquid: Partial<Pick<LiquidSnapshot, 'energy'>> | undefined): string {
  const kwhPerT = liquid?.energy?.kwhPerT;
  if (typeof kwhPerT !== 'number' || !Number.isFinite(kwhPerT)) return NO_VALUE;
  return `${formatNumber(kwhPerT, 1)} kWh/t`;
}

export const DERIVED_ROWS: Readonly<Partial<Record<StageId, readonly DerivedRow[]>>> = {
  4: [
    { key: 'marginC', label: 'Margin over limit', after: 'divertLimitC', read: marginText },
    { key: 'energyPerT', label: 'Energy since opening', after: 'gasKw', read: (_values, liquid) => energyPerTonneText(liquid) },
  ],
};
