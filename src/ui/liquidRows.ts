import type { LiquidSnapshot, StageId, Status, UhtMode } from '../contracts';
import { formatDuration, formatSigned, NO_VALUE, withUnit } from './format';

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

/** The UHT plant's feed: full flow, or held back while the aseptic tank is high (90% on, 60% off). */
export function throttleText(liquid: Pick<LiquidSnapshot, 'throttled'>): StateText {
  return liquid.throttled ? { text: 'Throttled · tank high', status: 'warn' } : { text: 'Full flow', status: 'ok' };
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
    { key: 'throttle', label: 'Feed', read: throttleText },
  ],
  6: [
    { key: 'throttle', label: 'UHT plant', read: throttleText },
    { key: 'fillers', label: 'Fillers', read: fillersText },
  ],
};

/** A value row the panel works out from the stage's other values, shown right after the row `after`. */
export interface DerivedRow {
  key: string;
  label: string;
  after: string;
  read(values: Readonly<Record<string, number>>): string;
}

/**
 * How far the holding-tube outlet runs above the divert limit, e.g. "+0.78 °C" at full flow and 140 °C.
 * The limit follows the hold, and the hold the flow (R6), so throttling to half flow widens the margin to
 * about 3.9 °C; below 0 the plant diverts.
 */
export function marginText(values: Readonly<Record<string, number>>): string {
  const { tempC, divertLimitC } = values;
  if (tempC === undefined || divertLimitC === undefined) return NO_VALUE;
  return withUnit(formatSigned(tempC - divertLimitC, 2), '°C');
}

export const DERIVED_ROWS: Readonly<Partial<Record<StageId, readonly DerivedRow[]>>> = {
  4: [{ key: 'marginC', label: 'Margin over limit', after: 'divertLimitC', read: marginText }],
};
