import { ZONE_NAMES, type StageId, type ZoneId } from '../contracts';

/**
 * The plant's floor layout, ported from the preview (uht-plant-preview.html: ZONES, the apron,
 * FOCUS, CAMOFF, BADGE, RING_R and the overview camera). It sizes the floor, aims the camera and
 * fits the shadow (world.ts), lays the zone slabs (zones.ts) and holds the camera stops (cameraFlight.ts).
 *
 * Positions are three.js world units, 1 unit = 1 m, hence the `M` suffix (units rule R8).
 * Axes: x runs along the milk flow, silos at -x and fillers at +x; y is up; z runs from the
 * milk row (-z, top of the floor plan) to the pallet row and the truck docks (+z, bottom).
 *
 * Machine positions live with each machine (equipment/), and the pipe routes that join them in pipes.ts.
 */

export type PointM = readonly [xM: number, yM: number, zM: number];

/** A rectangle on the floor. */
export interface RectM {
  xMinM: number;
  xMaxM: number;
  zMinM: number;
  zMaxM: number;
}

/** CSS custom properties for floor tints; `ui` ports them from the preview with the light and dark themes. */
export type ZoneColorVar = '--zone-proc' | '--zone-pack' | '--zone-quar' | '--zone-ware' | '--apron';

export type { ZoneId } from '../contracts';

export interface Zone {
  id: ZoneId;
  label: string;
  stages: readonly StageId[];
  colorVar: ZoneColorVar;
  rect: RectM;
  /**
   * Which end of the zone's near (+z) edge its name lines up with (zones.ts puts the name just outside
   * that edge). Left, unless something stands in front of the zone there: the warehouse's docked truck.
   */
  labelAlign: 'left' | 'right';
}

/** The seven zones in a U (plan 05): milk runs left to right along the top row, pallets come back along the bottom. */
export const ZONES: readonly Zone[] = [
  { id: 'silo', label: ZONE_NAMES.silo, stages: [1], colorVar: '--zone-proc', rect: { xMinM: -63, xMaxM: -38, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'process', label: ZONE_NAMES.process, stages: [2, 3, 4, 5], colorVar: '--zone-proc', rect: { xMinM: -35, xMaxM: -6, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'aseptic', label: ZONE_NAMES.aseptic, stages: [6], colorVar: '--zone-proc', rect: { xMinM: -3, xMaxM: 11, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'filling', label: ZONE_NAMES.filling, stages: [7], colorVar: '--zone-pack', rect: { xMinM: 14, xMaxM: 37, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'packaging', label: ZONE_NAMES.packaging, stages: [8], colorVar: '--zone-pack', rect: { xMinM: 14, xMaxM: 37, zMinM: 2, zMaxM: 19 }, labelAlign: 'left' },
  { id: 'quarantine', label: ZONE_NAMES.quarantine, stages: [9], colorVar: '--zone-quar', rect: { xMinM: -11, xMaxM: 11, zMinM: 2, zMaxM: 19 }, labelAlign: 'left' },
  { id: 'warehouse', label: ZONE_NAMES.warehouse, stages: [10], colorVar: '--zone-ware', rect: { xMinM: -63, xMaxM: -14, zMinM: 2, zMaxM: 19 }, labelAlign: 'right' },
];

/**
 * Truck yard in front of the warehouse's dock doors. Deeper than the preview's 14 m, whose 12 m truck fit
 * it: a docked 16.5 m articulated truck (packs/layout.ts, TRUCK_SIZE_M) reaches z 36.1, and the yard
 * leaves about 2 m clear round its cab.
 */
export const APRON: { colorVar: ZoneColorVar; rect: RectM } = {
  colorVar: '--apron',
  rect: { xMinM: -63, xMaxM: -14, zMinM: 19, zMaxM: 38 },
};

/** Where the camera and the labels go for each stage. One table, so the guided tour can reuse it (phase 2, "Watch for"). */
export interface StageView {
  /** What the camera looks at when the stage is selected (preview FOCUS). */
  focusM: PointM;
  /** Camera position relative to focusM (preview CAMOFF). */
  cameraOffsetM: PointM;
  /** Anchor of the stage's numbered label (preview BADGE). */
  badgeM: PointM;
  /** Selection ring on the floor around focusM (preview RING_R). */
  ringRadiusM: number;
}

export const STAGE_VIEWS: Readonly<Record<StageId, StageView>> = {
  1: { focusM: [-50, 1.5, -14], cameraOffsetM: [3, 15, 21], badgeM: [-50.5, 3.6, -14], ringRadiusM: 10.5 },
  2: { focusM: [-28, 1.5, -14], cameraOffsetM: [1, 7.5, 12], badgeM: [-28.9, 3.0, -14], ringRadiusM: 4.4 },
  3: { focusM: [-20.5, 1, -14], cameraOffsetM: [1, 5, 9], badgeM: [-20.5, 2.2, -14], ringRadiusM: 2.6 },
  4: { focusM: [-15, 1.4, -13], cameraOffsetM: [1, 6, 10], badgeM: [-14.8, 3.4, -14], ringRadiusM: 3.6 },
  5: { focusM: [-9, 1.8, -13], cameraOffsetM: [1, 7, 11], badgeM: [-10, 5.3, -14], ringRadiusM: 3.4 },
  6: { focusM: [4, 3, -14], cameraOffsetM: [1, 8, 14], badgeM: [4, 7.2, -14], ringRadiusM: 3.2 },
  7: { focusM: [23, 1.4, -14], cameraOffsetM: [2, 12, 17], badgeM: [20, 4.6, -14], ringRadiusM: 7 },
  8: { focusM: [28, 1, 10.5], cameraOffsetM: [2, 13, 16], badgeM: [27.5, 3.8, 12], ringRadiusM: 7.5 },
  9: { focusM: [-1.5, 1, 10.3], cameraOffsetM: [1, 19, 22], badgeM: [-1.8, 3.6, 10.3], ringRadiusM: 11.5 },
  10: { focusM: [-39, 1.5, 11.5], cameraOffsetM: [2, 27, 33], badgeM: [-40, 5.4, 10.6], ringRadiusM: 25 },
};

/** Smallest rectangle around the given ones. */
export function boundsOf(rects: readonly RectM[]): RectM {
  return {
    xMinM: Math.min(...rects.map((r) => r.xMinM)),
    xMaxM: Math.max(...rects.map((r) => r.xMaxM)),
    zMinM: Math.min(...rects.map((r) => r.zMinM)),
    zMaxM: Math.max(...rects.map((r) => r.zMaxM)),
  };
}

export function padRect(rect: RectM, marginM: number): RectM {
  return { xMinM: rect.xMinM - marginM, xMaxM: rect.xMaxM + marginM, zMinM: rect.zMinM - marginM, zMaxM: rect.zMaxM + marginM };
}

/** Everything built on the floor: the zones and the apron. */
export const PLANT_BOUNDS: RectM = boundsOf([...ZONES.map((z) => z.rect), APRON.rect]);

/** Floor beyond the plant, so its edge doesn't cut through the outer zones. */
export const FLOOR_MARGIN_M = 12;

export const FLOOR: RectM = padRect(PLANT_BOUNDS, FLOOR_MARGIN_M);

/** Tallest thing on the floor: the raw-milk silos with their domes, about 11.4 m (preview stage 1). */
export const PLANT_HEIGHT_M = 12;

/**
 * The whole-plant view (preview OV_TARGET, OV_DIR, overviewPos). The target is the preview's: near the
 * centre of its zones and 14 m apron (-13, 5), 2 m toward the milk row where the tall machines stand.
 * The deeper apron here only adds floor nearest the camera, which the view has room for.
 */
export const OVERVIEW = {
  targetM: [-13, 0, 3] as PointM,
  /** Direction from the target to the camera, unitless: about 48° above the floor, seen from the dock side. */
  direction: [0, 0.74, 0.67] as const,
  /** Half the width that must fit across the view: the plant is 100 m wide, plus a little room. */
  halfWidthM: 58,
  minDistanceM: 105,
  maxDistanceM: 290,
};

/**
 * Camera distance from OVERVIEW.targetM that fits the plant's width in view, clamped so a very
 * wide or very narrow view stays readable. `viewHalfWidthPerM` is the view's half-width one metre
 * in front of the camera (tan of half the horizontal field of view), so no angle units are needed.
 */
export function overviewDistanceM(viewHalfWidthPerM: number): number {
  const fitM = OVERVIEW.halfWidthM / viewHalfWidthPerM;
  return Math.min(Math.max(fitM, OVERVIEW.minDistanceM), OVERVIEW.maxDistanceM);
}
