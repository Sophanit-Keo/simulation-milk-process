import { describe, expect, it } from 'vitest';
import { createRng, mulberry32 } from '../../src/sim/rng';
import { mulberry32 as previewMulberry32 } from '../helpers/previewMulberry32';
import { plantConfig } from '../helpers/plantConfig';

// 4294967295 and -1 are the same 32-bit seed; both are listed to check the |0 wrap matches the preview's.
const SEEDS = [plantConfig.seed, 0, 1, 42, 123_456_789, 2_147_483_647, 4_294_967_295, -1];

const draws = (next: () => number, n: number) => Array.from({ length: n }, () => next());

describe('mulberry32', () => {
  it.each(SEEDS)('matches the preview for the first 1,000 values of seed %s', (seed) => {
    expect(draws(mulberry32(seed), 1_000)).toEqual(draws(previewMulberry32(seed), 1_000));
  });

  it('gives values in [0, 1)', () => {
    for (const seed of [plantConfig.seed, 0, 7]) {
      const next = mulberry32(seed);
      for (let i = 0; i < 100_000; i++) {
        const value = next();
        if (!(value >= 0 && value < 1)) expect.fail(`seed ${seed}, draw ${i}: ${value}`);
      }
    }
  });

  it('gives different sequences for different seeds', () => {
    expect(draws(mulberry32(1), 10)).not.toEqual(draws(mulberry32(2), 10));
  });
});

describe('createRng', () => {
  it('next() is mulberry32(seed)', () => {
    const rng = createRng(plantConfig.seed);
    expect(draws(() => rng.next(), 1_000)).toEqual(draws(previewMulberry32(plantConfig.seed), 1_000));
  });

  it('exponential(mean) is -ln(1 - next()) × mean, one draw per call', () => {
    const rng = createRng(plantConfig.seed);
    const reference = previewMulberry32(plantConfig.seed);
    for (let i = 0; i < 1_000; i++) expect(rng.exponential(720)).toBeCloseTo(-Math.log(1 - reference()) * 720, 9);
  });

  it('chance(p) is next() < p, one draw per call', () => {
    const rng = createRng(plantConfig.seed);
    const reference = previewMulberry32(plantConfig.seed);
    for (let i = 0; i < 1_000; i++) {
      const probability = (i % 11) / 10; // 0, 0.1, …, 1
      expect(rng.chance(probability)).toBe(reference() < probability);
    }
  });

  it('repeats exactly for the same seed, whatever mix of calls', () => {
    const run = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 3_000 }, (_, i) =>
        i % 3 === 0 ? rng.next() : i % 3 === 1 ? rng.exponential(28_800) : rng.chance(0.3),
      );
    };
    expect(run(plantConfig.seed)).toEqual(run(plantConfig.seed));
    expect(run(plantConfig.seed)).not.toEqual(run(plantConfig.seed + 1));
  });

  it.each([1, 720, plantConfig.fillers.mtbfMeanS])('exponential(%s) has its mean within 2% over 100,000 draws', (mean) => {
    const rng = createRng(plantConfig.seed);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const value = rng.exponential(mean);
      if (!(value >= 0 && Number.isFinite(value))) expect.fail(`draw ${i}: ${value}`);
      sum += value;
    }
    // The standard error of the mean is mean ÷ √100,000 ≈ 0.32%, so 2% is a wide margin.
    expect(Math.abs(sum / 100_000 - mean) / mean).toBeLessThan(0.02);
  });

  it('chance(0) is never true and chance(1) always is', () => {
    const rng = createRng(plantConfig.seed);
    for (let i = 0; i < 10_000; i++) {
      if (rng.chance(0)) expect.fail(`chance(0) was true on call ${2 * i}`);
      if (!rng.chance(1)) expect.fail(`chance(1) was false on call ${2 * i + 1}`);
    }
  });

  it('chance(0.25) comes true about a quarter of the time', () => {
    const rng = createRng(plantConfig.seed);
    let hits = 0;
    for (let i = 0; i < 100_000; i++) if (rng.chance(0.25)) hits++;
    expect(Math.abs(hits / 100_000 - 0.25)).toBeLessThan(0.01);
  });
});
