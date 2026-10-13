import { dayToS, hToS, sToDay, sToH, sToMin, type Kpis, type StageValueInfo } from '../contracts';

const pad2 = (n: number): string => String(n).padStart(2, '0');

// A fixed locale, so the bar reads "×10,000" (as the plan writes it) on every machine.
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** What the HUD shows for a value it can't show: missing, NaN or infinite. */
export const NO_VALUE = '—';

/**
 * Sim time as the top bar shows it, e.g. "day 1 · 06:00".
 * timeS 0 is day 1, 00:00. Minutes round down, like a wall clock.
 */
export function formatSimTime(timeS: number): string {
  if (!Number.isFinite(timeS)) return NO_VALUE;
  // Whole seconds first, so the day and hour splits below are exact.
  const wholeS = Math.floor(timeS);
  const dayIndex = Math.floor(sToDay(wholeS));
  const ofDayS = wholeS - dayToS(dayIndex);
  const hourH = Math.floor(sToH(ofDayS));
  const minuteMin = Math.floor(sToMin(ofDayS - hToS(hourH)));
  return `day ${dayIndex + 1} · ${pad2(hourH)}:${pad2(minuteMin)}`;
}

/** A speed preset as the top bar shows it, e.g. "×10,000". */
export function formatSpeed(speed: number): string {
  return `×${wholeNumber.format(speed)}`;
}

// One formatter per number of decimals, made on first use: the HUD formats dozens of values 4 times a second.
const fixedFormats = new Map<number, Intl.NumberFormat>();

/**
 * A number with exactly `decimals` decimals and en-US thousands separators, e.g. "16,000" or "139.50".
 * Rounding never shows "-0": a reading of -0.02 °C with one decimal reads "0.0", not "-0.0".
 */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  let format = fixedFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    fixedFormats.set(decimals, format);
  }
  // signDisplay 'negative' would do this, but it is newer than the ES2022 lib the project targets.
  return format.format(value).replace(/^-(?=0(\.0+)?$)/, '');
}

/** A number and its unit, separated by a space ("140.0 °C", "52 %"); a plain count has no unit. */
export function withUnit(number: string, unit: string): string {
  return unit && number !== NO_VALUE ? `${number} ${unit}` : number;
}

/**
 * A live stage value as the info panel shows it, from its stages.json entry: times `scale`
 * (e.g. 100 to show a fraction as %), rounded to `decimals`, then the unit. Missing reads "—".
 */
export function formatValue(value: number | undefined, info: Pick<StageValueInfo, 'unit' | 'decimals' | 'scale'>): string {
  if (value === undefined) return NO_VALUE;
  // A display scale written next to the value in stages.json, not a unit conversion (those live in units.ts).
  return withUnit(formatNumber(value * (info.scale ?? 1), info.decimals), info.unit);
}

/** The slots of the KPI strip (index.html, data-kpi), in strip order. */
export type KpiId = 'uht' | 'sterility' | 'tank' | 'packs' | 'oee' | 'hold' | 'stock' | 'trucks';

export const KPI_IDS: readonly KpiId[] = ['uht', 'sterility', 'tank', 'packs', 'oee', 'hold', 'stock', 'trucks'];

/**
 * One KPI as the strip shows it: text runs, the `small` ones (units and names) set smaller and
 * lighter, so the numbers fit a narrow card. Joined, the runs read as one line ("16,000 L/h").
 */
export type KpiText = readonly { text: string; small?: true }[];

/** A number and its unit as KPI runs; a count, or a value it can't show, has no unit run. */
function kpiNumber(number: string, unit = ''): KpiText {
  return unit && number !== NO_VALUE ? [{ text: number }, { text: ` ${unit}`, small: true }] : [{ text: number }];
}

/** The text of one KPI slot from the snapshot's KPIs (plan 06, KPIs on screen). */
export function formatKpi(id: KpiId, kpis: Kpis): KpiText {
  switch (id) {
    case 'uht':
      return kpiNumber(formatNumber(kpis.uhtFlowLph), 'L/h');
    case 'sterility':
      // Both numbers in one slot: F0 is the lethality in minutes, B* the spore kill (≥ 1 is sterile enough).
      return [
        { text: 'F0 ', small: true },
        { text: formatNumber(kpis.f0Min, 2) },
        { text: ' · B* ', small: true },
        { text: formatNumber(kpis.bStar, 2) },
      ];
    case 'tank':
      return kpiNumber(formatNumber(kpis.tankLevelPct), '%');
    case 'packs':
      return kpiNumber(formatNumber(kpis.packsPerH), '/h');
    case 'oee':
      return kpiNumber(formatNumber(kpis.oeePct), '%');
    case 'hold':
      return kpiNumber(formatNumber(kpis.batchesOnHold));
    case 'stock':
      return kpiNumber(formatNumber(kpis.palletsInStock));
    case 'trucks':
      return kpiNumber(formatNumber(kpis.trucksShipped));
  }
}

/** formatKpi as one line of text, e.g. "F0 5.17 · B* 1.19": what the slot's [data-kpi-value] reads. */
export function kpiText(id: KpiId, kpis: Kpis): string {
  return formatKpi(id, kpis)
    .map((run) => run.text)
    .join('');
}
