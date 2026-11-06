// What the yogurt wing shows, read off the snapshot (contracts v8, Snapshot.yogurt): tank fills and the label values.
// A snapshot without the yogurt part (an older sim) reads as undefined, and the machine keeps its grey box as it is.
import type { Snapshot, TankLevel, YogurtHeatMode, YogurtSnapshot } from '../../../contracts';
import type { FillReading } from '../liquidLine';

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
