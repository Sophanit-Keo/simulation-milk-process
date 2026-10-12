/**
 * Units rule (decision R8 in plan/DECISIONS.md).
 *
 * Every quantity is a plain `number` whose name ends in its unit, and unit
 * conversions happen only in this file. Suffixes:
 *
 *   S, Min, H, Day     seconds, minutes, hours, days (sim time)
 *   L, Lph, Lps        litres, litres per hour, litres per second
 *   C, Bar, Kw         degrees Celsius, bar, kilowatts
 *   Pct, Frac          percent (0–100), fraction (0–1)
 *   Packs, Trays, Pallets, PacksPerH    counts and count rates
 *
 * Examples: `flowLph`, `holdS`, `levelL`, `setpointC`, `tankLevelPct`.
 */

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;

export const minToS = (min: number): number => min * SECONDS_PER_MINUTE;
export const hToS = (h: number): number => h * SECONDS_PER_HOUR;
export const dayToS = (day: number): number => day * SECONDS_PER_DAY;
export const sToMin = (s: number): number => s / SECONDS_PER_MINUTE;
export const sToH = (s: number): number => s / SECONDS_PER_HOUR;
export const sToDay = (s: number): number => s / SECONDS_PER_DAY;

export const lphToLps = (flowLph: number): number => flowLph / SECONDS_PER_HOUR;
export const lpsToLph = (flowLps: number): number => flowLps * SECONDS_PER_HOUR;

export const fracToPct = (frac: number): number => frac * 100;
export const pctToFrac = (pct: number): number => pct / 100;
