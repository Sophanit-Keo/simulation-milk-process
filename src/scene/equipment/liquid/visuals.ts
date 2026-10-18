// What the liquid line shows, read off the snapshot (contracts v2): tank fills, gauge needles, the divert
// valve's lamp, the heat exchanger's glow, steam and vapour. Pure functions, so each mapping is tested
// on its own; liquidLine.ts moves the meshes with them.
import { degToRad, UHT_MODES, type Snapshot, type TankLevel, type UhtMode } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import type { LampStatus } from '../../theme';
import { lineFlowLph, stageValue } from './readings';

/** Full-flow reference for anything that scales with the UHT flow. */
export const UHT_CAPACITY_LPH = plantJson.uht.capacityLph;

export type TankId = 'silo' | 'mixTank' | 'asepticTank' | 'rejectTank';

const clampFrac = (value: number): number => Math.min(Math.max(value, 0), 1);

/** How full a tank is (levelL ÷ capacityL, 0–1); undefined if the snapshot lacks the tank or its numbers. */
export function tankFillFrac(snapshot: Snapshot, tank: TankId): number | undefined {
  const level: Partial<TankLevel> | undefined = snapshot.liquid?.tanks?.[tank];
  const levelL = level?.levelL;
  const capacityL = level?.capacityL;
  if (typeof levelL !== 'number' || typeof capacityL !== 'number' || !Number.isFinite(levelL) || !(capacityL > 0)) return undefined;
  return clampFrac(levelL / capacityL);
}

/** A share of the UHT plant's full flow, 0–1. */
export const flowFrac = (flowLph: number): number => clampFrac(flowLph / UHT_CAPACITY_LPH);

/**
 * The homogenizer's dials: 0 bar at the lower left (seven-thirty, seen from the front), full scale at the
 * lower right, sweeping 270° clockwise past twelve. Stage 1 reads to 300 bar (the slider stops at 250),
 * stage 2 to 60 bar, so both set points sit high on their dials.
 */
export const GAUGE_FULL_SCALE_BAR = { stage1: 300, stage2: 60 } as const;
export const GAUGE_SWEEP_RAD = degToRad(270);
/** The needle's angle about the dial's axis (y, the dials face up) at zero: pointing to the front left. */
export const GAUGE_ZERO_RAD = degToRad(225);

/** The needle's rotation about y for `bar` on a dial of `fullScaleBar`; pinned at both stops. */
export function needleAngleRad(bar: number, fullScaleBar: number): number {
  const frac = Number.isFinite(bar) ? clampFrac(bar / fullScaleBar) : 0;
  return GAUGE_ZERO_RAD - frac * GAUGE_SWEEP_RAD;
}

/**
 * What the UHT plant is doing. A snapshot without contracts v2's liquid part (an older sim) says nothing
 * about cleaning; it diverts while milk flows to the reject tank.
 */
export function uhtModeOf(snapshot: Snapshot): UhtMode {
  const mode = snapshot.liquid?.uhtMode;
  if (mode !== undefined && UHT_MODES.includes(mode)) return mode;
  return lineFlowLph(snapshot, 'divert') > 0 ? 'divert' : 'production';
}

/**
 * The divert valve's lamp: red while it diverts, amber while the plant flushes, cleans or re-sterilizes
 * (no product reaches the aseptic tank), green while it produces.
 */
export function valveLamp(mode: UhtMode): LampStatus {
  if (mode === 'divert') return 'bad';
  if (mode === 'cip' || mode === 'sterilize' || mode === 'aic') return 'warn';
  return 'ok';
}

/** The plates glow from this temperature up, fully at the preheat set point (80 °C). */
export const GLOW_FROM_C = 30;
export const GLOW_FULL_C = plantJson.preheating.preheatTempC;

/** How strongly the plate heat exchanger glows (0–1), from the preheater temperature. */
export function heatGlowFrac(tempC: number): number {
  if (!Number.isFinite(tempC)) return 0;
  return clampFrac((tempC - GLOW_FROM_C) / (GLOW_FULL_C - GLOW_FROM_C));
}

/**
 * Steam at the injector (0–1): the share of full flow while the plant produces, nothing in any other mode
 * or with no flow through the holding tube.
 */
export function steamFrac(snapshot: Snapshot): number {
  if (uhtModeOf(snapshot) !== 'production') return 0;
  return flowFrac(lineFlowLph(snapshot, 'holdingTube'));
}

/**
 * The flash vessel's vapour at full size. Water removed equals steam injected: about a tenth of the milk
 * for 76 → 140 °C by direct steam, some 1,700 L/h at full flow, so 2,000 L/h fills the plume.
 */
export const VAPOUR_FULL_LPH = 2_000;

/**
 * The flash vessel's vapour plume (0–1): from stage 5's waterRemovedLph, or, from a snapshot without that
 * key, the share of full flow reaching the flash vessel.
 */
export function vapourFrac(snapshot: Snapshot): number {
  const waterRemovedLph = stageValue(snapshot, 5, 'waterRemovedLph');
  if (waterRemovedLph !== undefined) return clampFrac(waterRemovedLph / VAPOUR_FULL_LPH);
  return flowFrac(lineFlowLph(snapshot, 'flashVessel'));
}
