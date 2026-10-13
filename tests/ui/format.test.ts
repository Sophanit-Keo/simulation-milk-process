import { describe, expect, it } from 'vitest';
import type { Kpis } from '../../src/contracts';
import { formatKpi, formatNumber, formatSimTime, formatSpeed, formatValue, KPI_IDS, kpiText, withUnit } from '../../src/ui/format';

describe('formatSimTime', () => {
  it.each([
    [0, 'day 1 · 00:00'],
    [59, 'day 1 · 00:00'],
    [60, 'day 1 · 00:01'],
    [21_600, 'day 1 · 06:00'],
    [86_399, 'day 1 · 23:59'],
    [86_400, 'day 2 · 00:00'],
    [626_400, 'day 8 · 06:00'],
    [21_659.9, 'day 1 · 06:00'],
  ])('%s s reads "%s"', (timeS, text) => {
    expect(formatSimTime(timeS)).toBe(text);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('shows a dash for %s', (timeS) => {
    expect(formatSimTime(timeS)).toBe('—');
  });
});

describe('formatSpeed', () => {
  it.each([
    [1, '×1'],
    [10, '×10'],
    [1_000, '×1,000'],
    [10_000, '×10,000'],
  ])('%s reads "%s"', (speed, text) => {
    expect(formatSpeed(speed)).toBe(text);
  });
});

describe('formatNumber', () => {
  it.each([
    [16_000, 0, '16,000'],
    [1_234_567.891, 2, '1,234,567.89'],
    [140, 1, '140.0'],
    [139.96, 1, '140.0'],
    [5.1749, 2, '5.17'],
    [0.5, 0, '1'],
    [999.6, 0, '1,000'],
    [-12.34, 1, '-12.3'],
    [-1_500, 0, '-1,500'],
  ])('%s with %s decimals reads "%s"', (value, decimals, text) => {
    expect(formatNumber(value, decimals)).toBe(text);
  });

  it('defaults to whole numbers', () => {
    expect(formatNumber(15_000.4)).toBe('15,000');
  });

  it.each([
    [-0, 0, '0'],
    [-0.02, 1, '0.0'],
    [-0.004, 2, '0.00'],
    [-0.4, 0, '0'],
  ])('never shows a minus on zero: %s with %s decimals reads "%s"', (value, decimals, text) => {
    expect(formatNumber(value, decimals)).toBe(text);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('shows a dash for %s', (value) => {
    expect(formatNumber(value, 1)).toBe('—');
  });
});

describe('withUnit', () => {
  it('puts a space between number and unit', () => {
    expect(withUnit('140.0', '°C')).toBe('140.0 °C');
    expect(withUnit('52', '%')).toBe('52 %');
  });

  it('leaves a plain count alone, and a dash without a unit', () => {
    expect(withUnit('12', '')).toBe('12');
    expect(withUnit('—', 'L/h')).toBe('—');
  });
});

describe('formatValue (info panel rows, from stages.json)', () => {
  it('rounds to the given decimals and adds the unit', () => {
    expect(formatValue(140, { unit: '°C', decimals: 1 })).toBe('140.0 °C');
    expect(formatValue(16_000, { unit: 'L/h', decimals: 0 })).toBe('16,000 L/h');
    expect(formatValue(3.986, { unit: 's', decimals: 1 })).toBe('4.0 s');
    expect(formatValue(1.1923, { unit: '', decimals: 2 })).toBe('1.19');
  });

  it('applies the display scale before rounding', () => {
    expect(formatValue(0.0145, { unit: '%', decimals: 2, scale: 100 })).toBe('1.45 %');
    expect(formatValue(0.5, { unit: '%', decimals: 0, scale: 100 })).toBe('50 %');
  });

  it('shows a dash for a value the snapshot lacks or cannot give', () => {
    expect(formatValue(undefined, { unit: '°C', decimals: 1 })).toBe('—');
    expect(formatValue(Number.NaN, { unit: '°C', decimals: 1 })).toBe('—');
  });
});

describe('formatKpi (KPI strip)', () => {
  const kpis: Kpis = {
    uhtFlowLph: 16_000,
    f0Min: 5.1749,
    bStar: 1.1923,
    divertedL: 0,
    tankLevelPct: 52.4,
    packsPerH: 15_000,
    oeePct: 85.3,
    traysMade: 0,
    palletsMade: 0,
    batchesOnHold: 21,
    batchesReleased: 0,
    batchesBlocked: 0,
    palletsInStock: 1_520,
    daysOfCover: 0,
    orderFillPct: 0,
    trucksShipped: 3,
  };

  it.each([
    ['uht', '16,000 L/h'],
    ['sterility', 'F0 5.17 · B* 1.19'],
    ['tank', '52 %'],
    ['packs', '15,000 /h'],
    ['oee', '85 %'],
    ['hold', '21'],
    ['stock', '1,520'],
    ['trucks', '3'],
  ] as const)('%s reads "%s"', (id, text) => {
    expect(kpiText(id, kpis)).toBe(text);
  });

  it('sets units and names small, numbers large', () => {
    expect(formatKpi('uht', kpis)).toEqual([{ text: '16,000' }, { text: ' L/h', small: true }]);
    expect(formatKpi('sterility', kpis)).toEqual([
      { text: 'F0 ', small: true },
      { text: '5.17' },
      { text: ' · B* ', small: true },
      { text: '1.19' },
    ]);
    expect(formatKpi('hold', kpis)).toEqual([{ text: '21' }]);
  });

  it('drops the unit when a KPI cannot be shown', () => {
    expect(kpiText('uht', { ...kpis, uhtFlowLph: Number.NaN })).toBe('—');
    expect(kpiText('sterility', { ...kpis, bStar: Number.NaN })).toBe('F0 5.17 · B* —');
  });

  it('covers every slot of the strip, in strip order', () => {
    expect(KPI_IDS).toEqual(['uht', 'sterility', 'tank', 'packs', 'oee', 'hold', 'stock', 'trucks']);
  });

  it('reads the zeros the model gives before it can produce a KPI', () => {
    const zero = Object.fromEntries(Object.keys(kpis).map((key) => [key, 0])) as unknown as Kpis;
    expect(KPI_IDS.map((id) => kpiText(id, zero))).toEqual(['0 L/h', 'F0 0.00 · B* 0.00', '0 %', '0 /h', '0 %', '0', '0', '0']);
  });
});
