import { dayToS, hToS, sToDay, sToH, sToMin } from '../contracts';

const pad2 = (n: number): string => String(n).padStart(2, '0');

// A fixed locale, so the bar reads "×10,000" (as the plan writes it) on every machine.
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Sim time as the top bar shows it, e.g. "day 1 · 06:00".
 * timeS 0 is day 1, 00:00. Minutes round down, like a wall clock.
 */
export function formatSimTime(timeS: number): string {
  if (!Number.isFinite(timeS)) return '—';
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
