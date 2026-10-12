/** The 10 stages of the UHT line (plan 02). */
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const STAGE_IDS: readonly StageId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Lamp colours used everywhere (plan 08): green running, amber hold or warning, red stopped or blocked. */
export type Status = 'ok' | 'warn' | 'bad' | 'idle';

/** Speed presets of the top bar (plan 06): ×1 to ×10,000. */
export type Speed = 1 | 10 | 100 | 1_000 | 10_000;

export const SPEEDS: readonly Speed[] = [1, 10, 100, 1_000, 10_000];

export const isSpeed = (value: number): value is Speed => (SPEEDS as readonly number[]).includes(value);
