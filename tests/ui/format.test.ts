import { describe, expect, it } from 'vitest';
import type { Kpis } from '../../src/contracts';
import {
  formatDuration,
  formatKpi,
  formatNumber,
  formatSigned,
  formatSimTime,
  formatSpeed,
  formatValue,
  KPI_IDS,
  KPI_SUB_IDS,
  kpiSubText,
  kpiText,
  sterilityStatus,
  withUnit,
} from '../../src/ui/format';

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

describe('kpiSubText (secondary values of the KPI strip)', () => {
  const kpis: Kpis = {
    uhtFlowLph: 16_000,
    f0Min: 5.17,
    bStar: 1.19,
    divertedL: 12_345.6,
    tankLevelPct: 52,
    packsPerH: 15_000,
    oeePct: 85,
    traysMade: 855_000,
    palletsMade: 10_178,
    batchesOnHold: 21,
    batchesReleased: 1_234,
    batchesBlocked: 2,
    palletsInStock: 520,
    daysOfCover: 1.64,
    orderFillPct: 97.6,
    trucksShipped: 3,
  };

  it.each([
    ['diverted', '12,346 L diverted'],
    ['trays', '855,000 trays made'],
    ['pallets', '10,178 pallets made'],
    ['released', '1,234 released'],
    ['blocked', '2 blocked'],
    ['cover', '1.6 days of cover'],
    ['fill', 'order fill 98 %'],
  ] as const)('%s reads "%s"', (id, text) => {
    expect(kpiSubText(id, kpis)).toBe(text);
  });

  it('counts one tray and one pallet in the singular', () => {
    expect(kpiSubText('trays', { ...kpis, traysMade: 1 })).toBe('1 tray made');
    expect(kpiSubText('pallets', { ...kpis, palletsMade: 1 })).toBe('1 pallet made');
  });

  it('keeps the words but drops the unit when a value cannot be shown', () => {
    expect(kpiSubText('diverted', { ...kpis, divertedL: Number.NaN })).toBe('— diverted');
    expect(kpiSubText('cover', { ...kpis, daysOfCover: Number.POSITIVE_INFINITY })).toBe('— days of cover');
    expect(kpiSubText('fill', { ...kpis, orderFillPct: Number.NaN })).toBe('order fill —');
  });

  it('puts every KPI of the snapshot on screen, in a card or in a secondary value', () => {
    const strip = (values: Kpis): string[] => [
      ...KPI_IDS.map((id) => kpiText(id, values)),
      ...KPI_SUB_IDS.map((id) => kpiSubText(id, values)),
    ];
    const shown = strip(kpis);
    for (const key of Object.keys(kpis) as (keyof Kpis)[]) {
      expect(strip({ ...kpis, [key]: Number.NaN }), `${key} shows in the strip`).not.toEqual(shown);
    }
    expect(KPI_SUB_IDS).toEqual(['diverted', 'trays', 'pallets', 'released', 'blocked', 'cover', 'fill']);
  });

  it('reads the zeros the model gives before it can produce a KPI', () => {
    const zero = Object.fromEntries(Object.keys(kpis).map((key) => [key, 0])) as unknown as Kpis;
    expect(KPI_SUB_IDS.map((id) => kpiSubText(id, zero))).toEqual([
      '0 L diverted',
      '0 trays made',
      '0 pallets made',
      '0 released',
      '0 blocked',
      '0.0 days of cover',
      'order fill 0 %',
    ]);
  });
});

describe('formatSigned (the margin over the divert limit)', () => {
  it.each([
    [0.78, 2, '+0.78'],
    [3.88, 2, '+3.88'],
    [-0.404, 2, '-0.40'],
    [1_234.5, 1, '+1,234.5'],
    [0, 2, '0.00'],
    [-0.001, 2, '0.00'],
    [0.004, 2, '0.00'],
  ])('%s with %s decimals reads "%s"', (value, decimals, text) => {
    expect(formatSigned(value, decimals)).toBe(text);
  });

  it('shows a dash, with no sign, for a value it cannot show', () => {
    expect(formatSigned(Number.NaN, 2)).toBe('—');
  });
});

describe('formatDuration (time left in a UHT step)', () => {
  it.each([
    [0, '0 s'],
    [0.2, '1 s'],
    [45, '45 s'],
    [59.5, '1 min 00 s'],
    [150, '2 min 30 s'],
    [599, '9 min 59 s'],
    [600, '10 min'],
    [1_800, '30 min'],
    [3_599, '59 min'],
    [3_600, '1 h 00 min'],
    [4_800, '1 h 20 min'],
    [36_000, '10 h 00 min'],
  ])('%s s reads "%s"', (durationS, text) => {
    expect(formatDuration(durationS)).toBe(text);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('shows a dash for %s', (durationS) => {
    expect(formatDuration(durationS)).toBe('—');
  });
});

describe('sterilityStatus (the sterility card, D4)', () => {
  it('turns red below B* 1, whatever F0 says', () => {
    expect(sterilityStatus(0.99)).toBe('bad');
    expect(sterilityStatus(0.4)).toBe('bad');
  });

  it('stays unmarked from B* 1 up, even where F0 is under its 5 min target', () => {
    // 139.5 °C at 4 s: F0 about 4.6 min, under the target, but B* about 1.06 is sterile enough (D4).
    expect(sterilityStatus(1.06)).toBeNull();
    expect(sterilityStatus(1)).toBeNull();
    expect(sterilityStatus(2.4)).toBeNull();
  });

  it('leaves a B* of 0 (no product in the holding tube) and a missing one unmarked', () => {
    expect(sterilityStatus(0)).toBeNull();
    expect(sterilityStatus(Number.NaN)).toBeNull();
  });

  it('turns red while stage 4 is red (diverting), even when the noisy reading puts B* over 1', () => {
    expect(sterilityStatus(1.02, 'bad')).toBe('bad');
    expect(sterilityStatus(0, 'bad')).toBe('bad');
    expect(sterilityStatus(1.02, 'warn')).toBeNull();
    expect(sterilityStatus(1.19, 'ok')).toBeNull();
  });
});

describe('the KPI strip at the values a live run reaches', () => {
  const live: Kpis = {
    uhtFlowLph: 8_000,
    f0Min: 10.3349,
    bStar: 2.3846,
    divertedL: 1_234_567.4,
    tankLevelPct: 89.6,
    packsPerH: 15_000,
    oeePct: 85,
    traysMade: 0,
    palletsMade: 0,
    batchesOnHold: 0,
    batchesReleased: 0,
    batchesBlocked: 0,
    palletsInStock: 0,
    daysOfCover: 0,
    orderFillPct: 0,
    trucksShipped: 0,
  };

  it('shows the throttled UHT plant of R6, with two-digit F0', () => {
    expect(kpiText('uht', live)).toBe('8,000 L/h');
    expect(kpiText('sterility', live)).toBe('F0 10.33 · B* 2.38');
    expect(kpiText('tank', live)).toBe('90 %');
  });

  it('groups a long run of diverted milk', () => {
    expect(kpiSubText('diverted', live)).toBe('1,234,567 L diverted');
  });
});
