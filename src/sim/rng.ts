// Seeded randomness. Every random draw in the sim goes through here, so a seed
// from plant.json repeats a demo or a test exactly (review R2).

/** mulberry32, written out exactly as in uht-plant-preview.html. Values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Exponential draw with the given mean, such as a time between failures. */
  exponential(mean: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    // 1 - next() lies in (0, 1], so the log never sees 0.
    exponential: (mean) => -Math.log(1 - next()) * mean,
    chance: (probability) => next() < probability,
  };
}
