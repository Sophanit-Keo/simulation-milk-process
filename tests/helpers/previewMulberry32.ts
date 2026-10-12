// The preview's generator (uht-plant-preview.html, line 293), copied as is apart from the type annotation.
// It is the reference src/sim/rng.ts must match, and the seeded source of random test inputs (tests never
// use Math.random, so a failure always repeats).
export function mulberry32(a: number): () => number { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
