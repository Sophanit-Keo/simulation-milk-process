import { lphToLps, type CleaningFluid, type CleaningReturn, type CleaningStepId, type LiquidSnapshot, type StageId, type Status, type UhtMode } from '../contracts';
import plantJson from '../data/plant.json';
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

/** What each cleaning fluid is (phase 13, D23): the lye is caustic soda, the acid nitric acid, the rinses softened water. */
export const CLEANING_FLUID_TEXT: Readonly<Record<CleaningFluid, string>> = {
  lye: 'Sodium hydroxide (NaOH)',
  acid: 'Nitric acid (HNO₃)',
  water: 'Softened water',
};

/** What each chemical takes off the heated surfaces (Dairy Processing Handbook, D23). */
export const CLEANING_FLUID_REMOVES: Readonly<Record<Exclude<CleaningFluid, 'water'>, string>> = {
  lye: 'fat and protein',
  acid: 'milkstone',
};

const RINSE_HARDNESS_DH = plantJson.cleaning.chemicals.water.hardnessDh;
const PIPE_BORE_M = plantJson.cleaning.pipeBoreMm / 1_000;

/**
 * The chemical circulating now and its strength (contracts v7): "Sodium hydroxide (NaOH) 1.5% · fat and protein", in
 * amber while a chemical circulates; the rinses' softened water unlit. "None" while no programme runs.
 */
export function chemicalText(liquid: Pick<LiquidSnapshot, 'cleaning'>): StateText {
  const cleaning = liquid.cleaning;
  if (!cleaning) return { text: 'None', status: 'idle' };
  if (cleaning.fluid === 'water') return { text: `${CLEANING_FLUID_TEXT.water}, ${formatNumber(RINSE_HARDNESS_DH)} °dH`, status: 'idle' };
  const strength = typeof cleaning.concentrationPct === 'number' ? ` ${formatNumber(cleaning.concentrationPct, 1)}%` : '';
  return { text: `${CLEANING_FLUID_TEXT[cleaning.fluid]}${strength} · ${CLEANING_FLUID_REMOVES[cleaning.fluid]}`, status: 'warn' };
}

/** Where the change-over valve sends the return, in words (contracts v7). */
export const CLEANING_RETURN_TEXT: Readonly<Record<CleaningReturn, string>> = {
  drain: 'to drain',
  waterTank: 'to the water tank',
  lyeTank: 'back to the lye tank',
  acidTank: 'back to the acid tank',
};

/**
 * What the conductivity transmitter on the return reads and where the return goes (contracts v7): "70.9 mS/cm · back to
 * the lye tank", green while it is recovered to a tank, amber while it goes to drain. "None" with no programme running,
 * or from a snapshot older than contracts v7.
 */
export function returnText(liquid: Pick<LiquidSnapshot, 'cleaning'>): StateText {
  const cleaning = liquid.cleaning;
  if (!cleaning || typeof cleaning.returnConductivityMsPerCm !== 'number' || !cleaning.returnTo) return { text: 'None', status: 'idle' };
  const reading = withUnit(formatNumber(cleaning.returnConductivityMsPerCm, 1), 'mS/cm');
  const where = CLEANING_RETURN_TEXT[cleaning.returnTo] ?? cleaning.returnTo;
  return { text: `${reading} · ${where}`, status: cleaning.returnTo === 'drain' ? 'warn' : 'ok' };
}

/** The CIP station's circulation and its velocity in the pipes: "24,000 L/h · 2.0 m/s" (D16, D23); "None" with no programme. */
export function cipFlowText(liquid: Pick<LiquidSnapshot, 'cleaning'>): StateText {
  const cleaning = liquid.cleaning;
  if (!cleaning) return { text: 'None', status: 'idle' };
  const mps = lphToLps(cleaning.flowLph) / 1_000 / (Math.PI * (PIPE_BORE_M / 2) ** 2);
  return { text: `${withUnit(formatNumber(cleaning.flowLph), 'L/h')} · ${withUnit(formatNumber(mps, 1), 'm/s')}`, status: 'ok' };
}

/**
 * What the cleans have used since the plant opened (contracts v7): "6.2 kg NaOH · 3.2 kg HNO₃ · 6,000 L water", the pure
 * chemicals and the rinse water to drain; "None yet" before the first step ends, a dash from an older snapshot.
 */
export function cleaningUseText(liquid: Pick<LiquidSnapshot, 'cleaningUse'>): StateText {
  const use = liquid.cleaningUse;
  if (!use) return { text: NO_VALUE, status: 'idle' };
  if (!(use.lyeKg > 0 || use.acidKg > 0 || use.drainWaterL > 0)) return { text: 'None yet', status: 'idle' };
  return {
    text: `${withUnit(formatNumber(use.lyeKg, 1), 'kg')} NaOH · ${withUnit(formatNumber(use.acidKg, 1), 'kg')} HNO₃ · ${withUnit(formatNumber(use.drainWaterL), 'L')} water`,
    status: 'idle',
  };
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
    { key: 'chemical', label: 'Chemical', read: chemicalText },
    { key: 'cipReturn', label: 'Return', read: returnText },
    { key: 'cipFlow', label: 'CIP flow', read: cipFlowText },
    { key: 'throttle', label: 'Feed', read: feedText },
    { key: 'cleaningUse', label: 'Used since opening', read: cleaningUseText },
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
