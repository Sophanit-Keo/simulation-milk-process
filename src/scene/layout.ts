import { ZONE_NAMES, type StageId, type ZoneId } from '../contracts';

/**
 * The plant's floor layout, ported from the preview (uht-plant-preview.html: ZONES, the apron,
 * FOCUS, CAMOFF, BADGE, RING_R and the overview camera). It sizes the floor, aims the camera and
 * fits the shadow (world.ts), lays the zone slabs (zones.ts) and holds the camera stops (cameraFlight.ts).
 *
 * Positions are three.js world units, 1 unit = 1 m, hence the `M` suffix (units rule R8).
 * Axes: x runs along the milk flow, silos at -x and fillers at +x; y is up; z runs from the yogurt wing (phase 16:
 * the row north of the milk row, the far -z) over the milk row (-z, top of the floor plan) to the pallet row and
 * the truck docks (+z, bottom).
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
export type ZoneColorVar = '--zone-proc' | '--zone-pack' | '--zone-quar' | '--zone-ware' | '--zone-yog' | '--zone-clean' | '--zone-cold' | '--apron';

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

/**
 * The seven zones in a U (plan 05): milk runs left to right along the top row, pallets come back along the bottom.
 * Then the yogurt wing's four (phase 16, plan 12, D25), a row north of the milk row, behind a 9 m aisle, running left
 * to right like the milk: mix room, process hall, the P8 cup filling room and the incubation and cold store, whose
 * dock faces north onto a reefer yard of its own. Its near edges alternate between z −32 and −38.5, so the four names,
 * longer together than the wing is wide at that distance from the overview camera, stand on two lines.
 */
export const ZONES: readonly Zone[] = [
  { id: 'silo', label: ZONE_NAMES.silo, stages: [1], colorVar: '--zone-proc', rect: { xMinM: -63, xMaxM: -38, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'process', label: ZONE_NAMES.process, stages: [2, 3, 4, 5], colorVar: '--zone-proc', rect: { xMinM: -35, xMaxM: -6, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'aseptic', label: ZONE_NAMES.aseptic, stages: [6], colorVar: '--zone-proc', rect: { xMinM: -3, xMaxM: 11, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'filling', label: ZONE_NAMES.filling, stages: [7], colorVar: '--zone-pack', rect: { xMinM: 14, xMaxM: 37, zMinM: -23, zMaxM: -5 }, labelAlign: 'left' },
  { id: 'packaging', label: ZONE_NAMES.packaging, stages: [8], colorVar: '--zone-pack', rect: { xMinM: 14, xMaxM: 37, zMinM: 2, zMaxM: 19 }, labelAlign: 'left' },
  { id: 'quarantine', label: ZONE_NAMES.quarantine, stages: [9], colorVar: '--zone-quar', rect: { xMinM: -11, xMaxM: 11, zMinM: 2, zMaxM: 19 }, labelAlign: 'left' },
  { id: 'warehouse', label: ZONE_NAMES.warehouse, stages: [10], colorVar: '--zone-ware', rect: { xMinM: -63, xMaxM: -14, zMinM: 2, zMaxM: 19 }, labelAlign: 'right' },
  // The wing starts 2 m east of the milk row, so the overview sees its first name past the 11 m silos, not behind them.
  { id: 'yogurtMix', label: ZONE_NAMES.yogurtMix, stages: [11], colorVar: '--zone-yog', rect: { xMinM: -61, xMaxM: -46, zMinM: -56, zMaxM: -32 }, labelAlign: 'left' },
  { id: 'yogurtProcess', label: ZONE_NAMES.yogurtProcess, stages: [12, 13, 14], colorVar: '--zone-yog', rect: { xMinM: -43, xMaxM: -3, zMinM: -56, zMaxM: -38.5 }, labelAlign: 'left' },
  { id: 'p8', label: ZONE_NAMES.p8, stages: [15], colorVar: '--zone-clean', rect: { xMinM: 0, xMaxM: 16, zMinM: -56, zMaxM: -38.5 }, labelAlign: 'left' },
  // Its name ends at its east end: begun at the west one it would run past the view's edge.
  { id: 'coldChain', label: ZONE_NAMES.coldChain, stages: [16], colorVar: '--zone-cold', rect: { xMinM: 19, xMaxM: 37, zMinM: -56, zMaxM: -32 }, labelAlign: 'right' },
];

/**
 * Truck yard in front of the warehouse's dock doors. Deeper than the preview's 14 m, whose 12 m truck fit
 * it: a docked 16.5 m articulated truck (packs/layout.ts, TRUCK_SIZE_M) reaches z 36.1. Since phase 12 the
 * trucks drive in along a lane behind the docked ones (z 39.5 to 42) and back into the dock along a curve
 * whose cab swings out to z 45.6 (packs/truckMoves.ts), so the yard runs to z 47.
 */
export const APRON: { colorVar: ZoneColorVar; rect: RectM } = {
  colorVar: '--apron',
  rect: { xMinM: -63, xMaxM: -14, zMinM: 19, zMaxM: 47 },
};

/**
 * The yogurt wing's reefer yard (phase 16): north of the cold store, whose dock doors face it, so the chilled
 * pallets never cross the UHT halls (plan 12). Since phase 29 the reefers drive in from the east along a lane
 * behind the docked ones (z −78.6 to −76.1), stop past their door and back in along a curve (yogurt/reeferTruck.ts):
 * the cab swings out to z −84.3 and stops as far west as x −1.5, so the yard runs to z −86 and west to x −4, behind
 * the cup hall.
 */
export const REEFER_YARD: { colorVar: ZoneColorVar; rect: RectM } = {
  colorVar: '--apron',
  rect: { xMinM: -4, xMaxM: 37, zMinM: -86, zMaxM: -56 },
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

/** Every stage's stop: the UHT line's from the preview, the yogurt wing's from phase 16. */
export const STAGE_VIEWS: Readonly<Record<StageId, StageView>> = {
  1: { focusM: [-50, 1.5, -14], cameraOffsetM: [3, 15, 21], badgeM: [-50.5, 3.6, -14], ringRadiusM: 10.5 },
  2: { focusM: [-28, 1.5, -14], cameraOffsetM: [1, 7.5, 12], badgeM: [-28.9, 3.0, -14], ringRadiusM: 4.4 },
  3: { focusM: [-20.5, 1, -14], cameraOffsetM: [1, 5, 9], badgeM: [-20.5, 2.2, -14], ringRadiusM: 2.6 },
  4: { focusM: [-15, 1.4, -13], cameraOffsetM: [1, 6, 10], badgeM: [-14.8, 3.4, -14], ringRadiusM: 3.6 },
  5: { focusM: [-9, 1.8, -13], cameraOffsetM: [1, 7, 11], badgeM: [-10, 5.3, -14], ringRadiusM: 3.4 },
  6: { focusM: [4, 3, -14], cameraOffsetM: [1, 8, 14], badgeM: [4, 7.2, -14], ringRadiusM: 3.2 },
  7: { focusM: [23, 1.4, -14], cameraOffsetM: [2, 12, 17], badgeM: [20, 4.6, -14], ringRadiusM: 7 },
  8: { focusM: [26, 1, 11.5], cameraOffsetM: [2, 14, 17.5], badgeM: [27.5, 3.8, 12], ringRadiusM: 7.5 },
  9: { focusM: [-1.5, 1, 10.3], cameraOffsetM: [1, 19, 22], badgeM: [-1.8, 3.6, 10.3], ringRadiusM: 11.5 },
  10: { focusM: [-45, 1.5, 19], cameraOffsetM: [2, 32, 38], badgeM: [-40, 5.4, 10.6], ringRadiusM: 25 },
  // The yogurt wing (phase 16): each stop looks north at its stage from the aisle side, as the milk row's do.
  11: { focusM: [-53, 1.8, -46], cameraOffsetM: [2, 13, 19], badgeM: [-57, 6.4, -46], ringRadiusM: 8 },
  12: { focusM: [-36, 1.0, -49], cameraOffsetM: [1, 9, 13.5], badgeM: [-35, 2.4, -47], ringRadiusM: 6.5 },
  13: { focusM: [-21, 2.0, -48], cameraOffsetM: [1, 10, 15], badgeM: [-20, 4.8, -48.5], ringRadiusM: 7 },
  14: { focusM: [-8, 1.0, -49], cameraOffsetM: [1, 7.5, 12], badgeM: [-5.5, 3.4, -47], ringRadiusM: 5 },
  15: { focusM: [8.3, 1.2, -47.5], cameraOffsetM: [1, 9, 15], badgeM: [6.5, 3.1, -47], ringRadiusM: 8.5 },
  16: { focusM: [28, 1.5, -46], cameraOffsetM: [2, 20, 25], badgeM: [28, 4.5, -46], ringRadiusM: 10.5 },
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

/** Everything built on the floor: the zones, the apron and the reefer yard. */
export const PLANT_BOUNDS: RectM = boundsOf([...ZONES.map((z) => z.rect), APRON.rect, REEFER_YARD.rect]);

/** Floor beyond the plant, so its edge doesn't cut through the outer zones. */
export const FLOOR_MARGIN_M = 12;

export const FLOOR: RectM = padRect(PLANT_BOUNDS, FLOOR_MARGIN_M);

/** Tallest thing on the floor: the raw-milk silos with their domes, about 11.4 m (preview stage 1). */
export const PLANT_HEIGHT_M = 12;

/**
 * The whole-plant view (preview OV_TARGET, OV_DIR, overviewPos). The target was the preview's, near the centre of
 * its zones and 14 m apron (-13, 5), 2 m toward the milk row where the tall machines stand. Phase 16 moves it 7 m
 * further north, to z −4, for the yogurt wing: at the width-fitted distance (129 m at 1280 × 720, 138 m at
 * 1440 × 900) the reefer yard's far edge then shows about 47 px below the view's top, and the docked truck's tail
 * 54 px above its bottom.
 */
export const OVERVIEW = {
  targetM: [-13, 0, -4] as PointM,
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
