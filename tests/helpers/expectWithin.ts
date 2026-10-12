import { expect } from 'vitest';

/**
 * Checks |actual − expected| ≤ tolerance. Hand values carry a stated precision (plan/hand-calculations.md),
 * so the tolerance is written next to each one instead of toBeCloseTo's decimal-digit rule.
 */
export function expectWithin(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected), `${actual} should be ${expected} ± ${tolerance}`).toBeLessThanOrEqual(tolerance);
}
