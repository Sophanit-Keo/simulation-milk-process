import { describe, expect, it } from 'vitest';
import type { PointM } from '../../src/scene/layout';
import * as at from '../../src/scene/equipment/packs/layout';
import {
  CARTON_PITCH_M,
  CARTON_SIZE_M,
  LINE_B_START_M,
  TRAY_PITCH_M,
  TRAY_SIZE_M,
  cartonPlaces,
  lineLengthM,
  placesAlong,
  pointAlong,
  tokenInstances,
  trayPlaces,
  type TokenPlace,
} from '../../src/scene/equipment/packs/tokens';

// Where the static cartons and trays stand (packs/tokens.ts): the preview's start-up fill of its lines
// (uht-plant-preview.html, LINE_A from 0 and LINE_B from 0.29 every 0.58 m, TRAY_LINE every 0.84 m).

const EAST = 0; // heading of a token whose length runs along +x
const SOUTH = -Math.PI / 2; // along +z, toward the docks
const WEST = Math.PI; // along -x

/** The straight stretches of a line, as [from, to] pairs. */
const stretches = (line: readonly PointM[]): [PointM, PointM][] => line.slice(1).map((to, i) => [line[i] as PointM, to]);

/** True if the point lies on the stretch from a to b, on the floor plan. */
function onStretch([a, b]: [PointM, PointM], xM: number, zM: number): boolean {
  const lengthM = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const along = ((xM - a[0]) * (b[0] - a[0]) + (zM - a[2]) * (b[2] - a[2])) / lengthM;
  const across = Math.abs((xM - a[0]) * (b[2] - a[2]) - (zM - a[2]) * (b[0] - a[0])) / lengthM;
  return across < 1e-9 && along >= -1e-9 && along <= lengthM + 1e-9;
}

const sameHeading = (aRad: number, bRad: number): boolean => Math.abs(Math.cos(aRad) - Math.cos(bRad)) < 1e-9 && Math.abs(Math.sin(aRad) - Math.sin(bRad)) < 1e-9;

describe('pack-line paths', () => {
  it('measures the preview lines along the floor', () => {
    expect(lineLengthM(at.LINE_A)).toBeCloseTo(12.25 + 22.4, 9);
    expect(lineLengthM(at.LINE_B)).toBeCloseTo(10.25 + 15.4, 9);
    expect(lineLengthM(at.TRAY_LINE)).toBeCloseTo(2.8 + 3.15, 9);
  });

  it('finds a point along a line and the heading there, turning at the corners', () => {
    expect(pointAlong(at.LINE_A, 0)).toEqual({ xM: 21.75, zM: -17.5, headingRad: EAST });
    const beforeCorner = pointAlong(at.LINE_A, 12);
    expect(beforeCorner.xM).toBeCloseTo(33.75, 9);
    expect(beforeCorner.zM).toBeCloseTo(-17.5, 9);
    expect(sameHeading(beforeCorner.headingRad, EAST)).toBe(true);
    const afterCorner = pointAlong(at.LINE_A, 13.25);
    expect(afterCorner.xM).toBeCloseTo(34, 9);
    expect(afterCorner.zM).toBeCloseTo(-16.5, 9);
    expect(sameHeading(afterCorner.headingRad, SOUTH)).toBe(true);
    const trayEnd = pointAlong(at.TRAY_LINE, 5);
    expect(trayEnd.xM).toBeCloseTo(30.8, 9);
    expect(sameHeading(trayEnd.headingRad, WEST)).toBe(true);
    // Clamped to the line's ends.
    expect(pointAlong(at.LINE_A, -1)).toEqual(pointAlong(at.LINE_A, 0));
    const past = pointAlong(at.LINE_A, 100);
    expect(past.xM).toBeCloseTo(34, 9);
    expect(past.zM).toBeCloseTo(4.9, 9);
  });
});

describe('cartons on the outfeeds', () => {
  const { a, b } = cartonPlaces();

  it('stands one every 0.58 m along each line, line A from its start and line B half a pitch in', () => {
    // 34.65 m of line A from 0; 25.65 m of line B from 0.29 m.
    expect(a.length).toBe(60);
    expect(b.length).toBe(44);
    for (const [line, places, startM] of [
      [at.LINE_A, a, 0],
      [at.LINE_B, b, LINE_B_START_M],
    ] as const) {
      places.forEach((place, k) => {
        const expected = pointAlong(line, startM + k * CARTON_PITCH_M);
        expect(place.atM[0], `carton ${k}`).toBeCloseTo(expected.xM, 9);
        expect(place.atM[2], `carton ${k}`).toBeCloseTo(expected.zM, 9);
        expect(place.headingRad, `carton ${k}`).toBe(expected.headingRad);
      });
      // Within the line, and the next pitch would pass its end.
      expect(startM + (places.length - 1) * CARTON_PITCH_M).toBeLessThan(lineLengthM(line));
      expect(startM + places.length * CARTON_PITCH_M).toBeGreaterThanOrEqual(lineLengthM(line));
    }
    expect(a[0]?.atM).toEqual([21.75, at.BELT_M + CARTON_SIZE_M[1] / 2, -17.5]);
    expect(b[0]?.atM[0]).toBeCloseTo(21.75 + LINE_B_START_M, 9);
  });

  it('spaces neighbours on the same stretch exactly a pitch apart', () => {
    for (const [line, places] of [
      [at.LINE_A, a],
      [at.LINE_B, b],
    ] as const) {
      for (const stretch of stretches(line)) {
        const on = places.filter((p) => onStretch(stretch, p.atM[0], p.atM[2]));
        expect(on.length).toBeGreaterThan(10);
        for (let i = 1; i < on.length; i++) {
          const [p, q] = [on[i - 1] as TokenPlace, on[i] as TokenPlace];
          expect(Math.hypot(q.atM[0] - p.atM[0], q.atM[2] - p.atM[2])).toBeCloseTo(CARTON_PITCH_M, 9);
        }
      }
    }
  });

  it('stands every carton on the belt, turned to its stretch, and short of the tray-shrink tunnel', () => {
    const tunnelInZM = at.TUNNEL.centreM[2] - at.TUNNEL.sizeM[2] / 2;
    for (const [line, places] of [
      [at.LINE_A, a],
      [at.LINE_B, b],
    ] as const) {
      const [east, south] = stretches(line) as [[PointM, PointM], [PointM, PointM]];
      for (const place of places) {
        // Its bottom face on the belt.
        expect(place.atM[1] - CARTON_SIZE_M[1] / 2).toBeCloseTo(at.BELT_M, 9);
        const onEast = onStretch(east, place.atM[0], place.atM[2]);
        expect(onEast || onStretch(south, place.atM[0], place.atM[2])).toBe(true);
        expect(sameHeading(place.headingRad, onEast ? EAST : SOUTH)).toBe(true);
        // Its front end (half its length ahead) stays out of the tunnel the packs enter at phase 4.
        expect(place.atM[2] + (onEast ? 0 : CARTON_SIZE_M[0] / 2)).toBeLessThan(tunnelInZM);
      }
    }
  });

  it('keeps the two lines apart: no carton stands on the other filler’s line', () => {
    for (const place of a) expect(place.atM[2] === at.FILLER_Z_M.a || place.atM[0] === 34).toBe(true);
    for (const place of b) expect(place.atM[2] === at.FILLER_Z_M.b || place.atM[0] === 32).toBe(true);
  });
});

describe('trays on the tray conveyor', () => {
  const trays = trayPlaces();

  it('stands one every 0.84 m from the tunnel’s exit to the palletizer’s pick point', () => {
    // 5.95 m of line: 0, 0.84 … 5.88 m.
    expect(trays.length).toBe(8);
    trays.forEach((place, k) => {
      const expected = pointAlong(at.TRAY_LINE, k * TRAY_PITCH_M);
      expect(place.atM[0], `tray ${k}`).toBeCloseTo(expected.xM, 9);
      expect(place.atM[2], `tray ${k}`).toBeCloseTo(expected.zM, 9);
      expect(place.atM[1] - TRAY_SIZE_M[1] / 2, `tray ${k}`).toBeCloseTo(at.BELT_M, 9);
    });
    expect(trays[0]?.atM[2]).toBeCloseTo(at.TRAY_LINE[0]?.[2] as number, 9);
    // The last one waits at the pick point.
    const last = trays.at(-1) as TokenPlace;
    expect(Math.hypot(last.atM[0] - at.PICK_M[0], last.atM[2] - at.PICK_M[1])).toBeLessThan(TRAY_PITCH_M / 2);
  });

  it('turns each tray to its stretch, south out of the tunnel, then west', () => {
    const [south, west] = stretches(at.TRAY_LINE) as [[PointM, PointM], [PointM, PointM]];
    for (const place of trays) {
      const onSouth = onStretch(south, place.atM[0], place.atM[2]);
      expect(onSouth || onStretch(west, place.atM[0], place.atM[2])).toBe(true);
      expect(sameHeading(place.headingRad, onSouth ? SOUTH : WEST)).toBe(true);
    }
  });
});

describe('token instances', () => {
  it('turns each copy about y only, to its place’s heading, at the token size', () => {
    const places = placesAlong(at.LINE_A, 0, 5, 0.3);
    const copies = tokenInstances(places, CARTON_SIZE_M);
    expect(copies).toHaveLength(places.length);
    copies.forEach((copy, i) => {
      expect(copy.atM).toBe(places[i]?.atM);
      expect(copy.sizeM).toBe(CARTON_SIZE_M);
      expect(copy.rotationRad).toEqual([0, places[i]?.headingRad, 0]);
    });
  });
});
