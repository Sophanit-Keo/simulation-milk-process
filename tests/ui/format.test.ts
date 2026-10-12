import { describe, expect, it } from 'vitest';
import { formatSimTime, formatSpeed } from '../../src/ui/format';

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
