/**
 * Units rule (decision D6 in plan/DECISIONS.md, from review note R8).
 *
 * Every quantity is a plain `number` whose name ends in its unit, and unit
 * conversions happen only in this file. Suffixes:
 *
 *   S, Min, H, Days    seconds, minutes, hours, days (sim time)
 *   Ms                 milliseconds (browser timestamps: performance.now, requestAnimationFrame)
 *   L, Lph, Lps        litres, litres per hour, litres per second
 *   Kg, KgPerH, KgPerS kilograms, per hour, per second (steam, phase 8); litres of milk count as kilograms (D13)
 *   T                  tonnes (raw milk for the energy per tonne, phase 8)
 *   C, Bar, Kw, Kwh    degrees Celsius, bar, kilowatts, kilowatt-hours
 *   Um                 micrometres (fat-globule size)
 *   KjPerKg, KjPerKgK  kilojoules per kilogram (latent heat), per kilogram and kelvin (specific heat)
 *   KwhPerT            kilowatt-hours per tonne (energy per tonne of raw milk, phase 8)
 *   Pct, Frac          percent (0–100), fraction (0–1)
 *   Packs, Trays, Pallets, PacksPerH    counts and count rates
 *   PerPack            a probability (0–1) per pack, such as failurePerPack
 *   M, Rad, Deg, Px    metres (three.js world units), radians, degrees, CSS pixels
 *
 * Examples: `flowLph`, `holdS`, `levelL`, `setpointC`, `tankLevelPct`.
 */

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;
export const MS_PER_SECOND = 1_000;

export const minToS = (min: number): number => min * SECONDS_PER_MINUTE;
export const hToS = (h: number): number => h * SECONDS_PER_HOUR;
export const dayToS = (day: number): number => day * SECONDS_PER_DAY;
export const sToMin = (s: number): number => s / SECONDS_PER_MINUTE;
export const sToH = (s: number): number => s / SECONDS_PER_HOUR;
export const sToDay = (s: number): number => s / SECONDS_PER_DAY;
export const msToS = (ms: number): number => ms / MS_PER_SECOND;

export const lphToLps = (flowLph: number): number => flowLph / SECONDS_PER_HOUR;
export const lpsToLph = (flowLps: number): number => flowLps * SECONDS_PER_HOUR;

export const kgPerHToKgPerS = (kgPerH: number): number => kgPerH / SECONDS_PER_HOUR;

/** Energy of a power held for a time: 1 kW for 3,600 s is 1 kWh. */
export const kwSToKwh = (kw: number, durationS: number): number => (kw * durationS) / SECONDS_PER_HOUR;
/** 1 kWh is 3,600 kJ. */
export const kjToKwh = (kj: number): number => kj / SECONDS_PER_HOUR;
/** Litres of milk as tonnes: litres count as kilograms (D13), and a tonne is 1,000 kg. */
export const lToT = (litres: number): number => litres / 1_000;

export const fracToPct = (frac: number): number => frac * 100;
export const pctToFrac = (pct: number): number => pct / 100;

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Power of a flow of flowLps litres per second against a pressure rise of bar: 1 L/s at 1 bar is 0.001 m³/s × 100,000 Pa = 100 W. */
export const lpsBarToKw = (flowLps: number, bar: number): number => flowLps * bar * 0.1;
