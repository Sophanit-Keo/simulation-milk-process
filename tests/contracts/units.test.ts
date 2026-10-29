// The unit conversions (decision D6): the only place in the app where one unit becomes another.
import { describe, expect, it } from 'vitest';
import {
  MS_PER_SECOND,
  dayToS,
  degToRad,
  fracToPct,
  hToS,
  kgPerHToKgPerS,
  kjToKwh,
  kwSToKwh,
  lToT,
  lphToLps,
  lpsToLph,
  minToS,
  msToS,
  pctToFrac,
  radToDeg,
  sToDay,
  sToH,
  sToMin,
} from '../../src/contracts';

describe('msToS', () => {
  it('turns browser milliseconds into seconds', () => {
    expect(MS_PER_SECOND).toBe(1_000);
    expect(msToS(0)).toBe(0);
    expect(msToS(1_000)).toBe(1);
    expect(msToS(250)).toBe(0.25);
    expect(msToS(16.5)).toBeCloseTo(0.0165, 12);
    // A frame gap read from two timestamps can come out negative; the conversion keeps the sign.
    expect(msToS(-40)).toBe(-0.04);
  });

  it('agrees with the other time units', () => {
    expect(msToS(60 * MS_PER_SECOND)).toBe(minToS(1));
    expect(msToS(3_600 * MS_PER_SECOND)).toBe(hToS(1));
  });
});

describe('the other conversions', () => {
  it('go there and back', () => {
    for (const value of [0, 0.5, 3, 1_234.5]) {
      expect(sToMin(minToS(value))).toBeCloseTo(value, 12);
      expect(sToH(hToS(value))).toBeCloseTo(value, 12);
      expect(sToDay(dayToS(value))).toBeCloseTo(value, 12);
      expect(lpsToLph(lphToLps(value))).toBeCloseTo(value, 12);
      expect(pctToFrac(fracToPct(value))).toBeCloseTo(value, 12);
      expect(radToDeg(degToRad(value))).toBeCloseTo(value, 12);
    }
  });

  it('use the right factors', () => {
    expect(hToS(2)).toBe(7_200);
    expect(dayToS(1)).toBe(86_400);
    expect(lphToLps(36_000)).toBe(10);
    expect(fracToPct(0.25)).toBe(25);
    expect(degToRad(180)).toBe(Math.PI);
  });
});

describe('the energy conversions (phase 8)', () => {
  it('turn steam per hour into per second, kilowatts held for a time and kilojoules into kWh, litres into tonnes', () => {
    expect(kgPerHToKgPerS(3_600)).toBe(1);
    expect(kwSToKwh(1, 3_600)).toBe(1);
    expect(kwSToKwh(124.66, 1_800)).toBeCloseTo(62.33, 12);
    expect(kjToKwh(3_600)).toBe(1);
    // Litres of milk count as kilograms (D13): 16,222.22 L of raw milk is 16.22 t.
    expect(lToT(16_222.22)).toBeCloseTo(16.22222, 12);
  });

  it('agree with each other: a kilowatt for an hour is 3,600 kJ', () => {
    expect(kwSToKwh(2.5, hToS(2))).toBe(kjToKwh(2.5 * hToS(2)));
  });
});
