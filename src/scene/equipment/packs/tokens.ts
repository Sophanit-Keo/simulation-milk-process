// Where the 1 L cartons and the trays stand on the belts (Must items of the asset list): static at G1,
// spaced as the preview fills its lines at start-up (uht-plant-preview.html, "fill the lines so the first
// frame already shows the flow"). Phase 4 moves the same tokens along the same lines, so the path maths
// (lineLengthM, pointAlong) lives here, next to the places it gives.
import type { PointM } from '../../layout';
import type { InstanceM, SizeM } from './builder';
import { BELT_M, LINE_A, LINE_B, TRAY_LINE } from './layout';

/**
 * A 1 L brick (95 × 195 × 64 mm) drawn about twice real size, as in the preview, so it reads from the
 * stage 7 camera: length along the belt × height × width across it. Its print faces across the belt.
 */
export const CARTON_SIZE_M: SizeM = [0.2, 0.44, 0.17];
/** A shrink-wrapped tray of 12 packs (preview): length along the rollers × height × width. */
export const TRAY_SIZE_M: SizeM = [0.6, 0.4, 0.5];

/** Spacing along each pack line (preview: 0.58 m), and where line B's first carton stands, half a pitch in, so the lines don't run in step. */
export const CARTON_PITCH_M = 0.58;
export const LINE_A_START_M = 0;
export const LINE_B_START_M = 0.29;
/** Spacing along the tray line (preview: 0.84 m), from the tunnel's exit. */
export const TRAY_PITCH_M = 0.84;

/** A token's place: its centre and the heading (rotation about y) that points its length along the line. */
export interface TokenPlace {
  atM: PointM;
  headingRad: number;
}

/** Length of a polyline along the floor. */
export function lineLengthM(line: readonly PointM[]): number {
  let lengthM = 0;
  for (let i = 1; i < line.length; i++) lengthM += floorDistanceM(line[i - 1] as PointM, line[i] as PointM);
  return lengthM;
}

/**
 * The point `sM` metres along a line (clamped to its ends) and the line's heading there: the rotation
 * about y that turns +x along the line (three.js turns +x toward -z for a positive angle). At a corner the
 * heading is the next stretch's.
 */
export function pointAlong(line: readonly PointM[], sM: number): { xM: number; zM: number; headingRad: number } {
  let restM = Math.max(sM, 0);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as PointM;
    const b = line[i] as PointM;
    const stretchM = floorDistanceM(a, b);
    if (restM < stretchM || i === line.length - 1) {
      const k = stretchM > 0 ? Math.min(restM / stretchM, 1) : 0;
      // a − b rather than −(b − a), so a stretch along x heads 0 or π, never −0 or −π.
      return { xM: a[0] + (b[0] - a[0]) * k, zM: a[2] + (b[2] - a[2]) * k, headingRad: Math.atan2(a[2] - b[2], b[0] - a[0]) };
    }
    restM -= stretchM;
  }
  const only = line[0];
  if (!only) throw new Error('pointAlong: the line has no points');
  return { xM: only[0], zM: only[2], headingRad: 0 };
}

/** A token every `pitchM` along the line from `startM`, short of its end, standing on the belt. */
export function placesAlong(line: readonly PointM[], startM: number, pitchM: number, heightM: number): TokenPlace[] {
  const lengthM = lineLengthM(line);
  const places: TokenPlace[] = [];
  // k × pitch rather than a running sum, so the last places don't drift with rounding.
  for (let k = 0; startM + k * pitchM < lengthM; k++) {
    const { xM, zM, headingRad } = pointAlong(line, startM + k * pitchM);
    places.push({ atM: [xM, BELT_M + heightM / 2, zM], headingRad });
  }
  return places;
}

/** The cartons on each filler's outfeed: line A from filler A (back row), line B from filler B. */
export function cartonPlaces(): { a: TokenPlace[]; b: TokenPlace[] } {
  return {
    a: placesAlong(LINE_A, LINE_A_START_M, CARTON_PITCH_M, CARTON_SIZE_M[1]),
    b: placesAlong(LINE_B, LINE_B_START_M, CARTON_PITCH_M, CARTON_SIZE_M[1]),
  };
}

/** The trays on the tray conveyor, from the tunnel's exit to the palletizer's pick point. */
export function trayPlaces(): TokenPlace[] {
  return placesAlong(TRAY_LINE, 0, TRAY_PITCH_M, TRAY_SIZE_M[1]);
}

/** Instances for FixtureBuilder.instanced(): each token turned to its line. */
export function tokenInstances(places: readonly TokenPlace[], sizeM: SizeM): InstanceM[] {
  return places.map(({ atM, headingRad }) => ({ atM, sizeM, rotationRad: [0, headingRad, 0] }));
}

function floorDistanceM(a: PointM, b: PointM): number {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}
