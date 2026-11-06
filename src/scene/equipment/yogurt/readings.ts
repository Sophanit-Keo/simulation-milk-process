// What the yogurt wing shows, read off the snapshot (contracts v8, Snapshot.yogurt): tank fills and the label values.
// A snapshot without the yogurt part (an older sim) reads as undefined, and the machine keeps its grey box as it is.
import type { FermentTank, Snapshot, TankLevel, YogurtHeatMode, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import type { LampStatus } from '../../theme';
import type { FillReading } from '../liquidLine';

const { startPh: START_PH, endPh: END_PH } = plantJson.yogurt.ferment;

const clampFrac = (value: number): number => Math.min(Math.max(value, 0), 1);

/** How full a tank is, 0–1; undefined if the tank or its numbers are missing. */
export function fillOf(level: Partial<TankLevel> | undefined): number | undefined {
  const levelL = level?.levelL;
  const capacityL = level?.capacityL;
  if (typeof levelL !== 'number' || typeof capacityL !== 'number' || !Number.isFinite(levelL) || !(capacityL > 0)) return undefined;
  return clampFrac(levelL / capacityL);
}

/** A reading of one of the yogurt line's tanks, for a level gauge (liquidLine.ts levelGauge). */
export const yogurtFill =
  (pick: (yogurt: YogurtSnapshot) => Partial<TankLevel> | undefined): FillReading =>
  (snapshot: Snapshot) => {
    const { yogurt } = snapshot as Partial<Snapshot>;
    return yogurt ? fillOf(pick(yogurt)) : undefined;
  };

/** The yogurt part of a snapshot, or undefined for an older one. */
export const yogurtOf = (snapshot: Snapshot): YogurtSnapshot | undefined => (snapshot as Partial<Snapshot>).yogurt;

/** What the heat treatment's divert valve says. */
export const HEAT_MODE_TEXT: Readonly<Record<YogurtHeatMode, string>> = {
  production: 'forward',
  divert: 'diverting',
  cleaning: 'cleaning',
  idle: 'standing',
};

/** A finite number or undefined. */
export const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The divert valve's lamp: green forward, red diverting, amber while the wing cleans; off while the line stands. */
export function heatValveLamp(mode: YogurtHeatMode | undefined): LampStatus | 'off' {
  if (mode === 'production') return 'ok';
  if (mode === 'divert') return 'bad';
  if (mode === 'cleaning') return 'warn';
  return 'off';
}

/**
 * Whether a fermentation tank's agitator turns (phase 17): while it fills, to blend in the culture, and once it is
 * ready, to break and cool the coagulum and empty it smoothly. It stands while the yogurt sets, and while the tank
 * is empty or cleaned.
 */
export const tankStirs = (tank: Pick<FermentTank, 'state'> | undefined): boolean =>
  tank?.state === 'filling' || tank?.state === 'ready' || tank?.state === 'emptying';

/**
 * How far a fermentation tank's pH has come, from the start pH (0) to the end pH (1), for the ring on its label;
 * null while it holds nothing (empty or cleaning), so the ring hides.
 */
export function phRingFrac(tank: Pick<FermentTank, 'state' | 'ph'> | undefined): number | null {
  if (!tank || tank.state === 'empty' || tank.state === 'cleaning') return null;
  if (tank.state === 'ready' || tank.state === 'emptying') return 1;
  const ph = finite(tank.ph);
  if (ph === undefined) return null;
  return clampFrac((START_PH - ph) / (START_PH - END_PH));
}
