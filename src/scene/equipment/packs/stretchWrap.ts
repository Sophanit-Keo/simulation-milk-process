// The stretch wrapper at work (phase 12, D22): a closed pallet stops on the turntable, which turns at about
// 24 rpm while the film carriage winds 2 turns round the base, climbs the mast over 3, winds 1 at the top and
// comes down over 2; then the turntable stops square, the film is cut and the pallet rides on, wrapped. About
// 21 motion seconds a pallet (real wrappers take about a minute at 10–15 rpm; this one is twice as fast so it
// still shows at ×10). The pallet's wrap clock lives with the pallets (palletTraffic.ts); the wrapper and the
// pallet on it both read it through wrapPoseAt(), so the turntable and its pallet turn as one.
//
// The film shows twice: a translucent web from the roll on the carriage to the load's corner (here), and a film
// shell round the load that grows up with the carriage and is whole by the top wraps (palletTraffic.ts, on the
// pallet itself, so a wrapped pallet keeps it all the way to quarantine). Both are clear film: one colour in both
// themes, lit by the scene like the shared glass.
import * as THREE from 'three';
import type { PointM } from '../../layout';
import { PALLET_ROLLER_TOP_M } from './layout';
import { ease, LOAD_HEIGHT_M, PALLET_M } from './palletizing';

/* the machine, in its own frame: origin at the turntable's centre on the floor (layout.ts, WRAPPER_M) */

/** The hero model's nodes (phase-12 card, Contracts): the turntable's centre, top flush with the rollers. */
export const TURNTABLE_AT_M: PointM = [0, PALLET_ROLLER_TOP_M / 2, 0];
/** The carriage's foot on the mast; it slides up +y by up to CARRIAGE_TRAVEL_M. */
export const CARRIAGE_AT_M: PointM = [-1.25, 0.45, -0.9];
export const CARRIAGE_TRAVEL_M = 1.05;
/**
 * Where the carriage winds the top wraps: the roll covers the load's top edge only between about 0.37 and 0.90 m
 * up (the model's film geometry, assets/scripts/make-heroes.mjs WRAPPER_FILM), so it climbs to 0.88 m, not the
 * mast's full 1.05.
 */
export const CARRIAGE_TOP_M = 0.88;
/** The mast behind the turntable, on the far side from the stage cameras. */
export const MAST_AT_M: PointM = [-1.45, 0, -1.05];
export const MAST_HEIGHT_M = 2.7;
/** The film roll on the carriage, toward the turntable (the model's WRAPPER_FILM): its axis in the carriage's frame, and its size. */
export const ROLL_AT_M: PointM = [0.194, 0.31, 0.005];
export const ROLL_RADIUS_M = 0.12;
export const ROLL_HEIGHT_M = 0.53;
/** The exit roller the film leaves the carriage from, in the carriage's frame (x, z), and its radius. */
export const FILM_EXIT_AT_M = [0.059, 0.191] as const;
export const FILM_EXIT_RADIUS_M = 0.025;

/* the film on a pallet, from the pallet's underside */

/** From just above the pallet's underside (the film takes in the deck boards) to just over the load's top. */
export const FILM_BOTTOM_M = 0.02;
export const FILM_TOP_M = PALLET_M.heightM + LOAD_HEIGHT_M + 0.02;
/** The film shell's plan: the load's and a centimetre round it. */
export const FILM_PLAN_M = { widthM: PALLET_M.widthM + 0.02, depthM: PALLET_M.depthM + 0.02 } as const;
/** Where a pallet's underside stands on the turntable. */
const PALLET_BOTTOM_M = PALLET_ROLLER_TOP_M;

/* the cycle */

/** The steps in motion seconds (phase-12 card): 2 base turns, 3 up, 1 at the top, 2 down, then the cut. */
export const WRAP_STEPS_S = { base: 5, up: 7.5, top: 2.5, down: 5, cut: 1 } as const;
export const WRAP_TURNS = 8;
const TURNING_S = WRAP_STEPS_S.base + WRAP_STEPS_S.up + WRAP_STEPS_S.top + WRAP_STEPS_S.down;
/** One pallet's wrap, from stopping on the turntable to riding off. */
export const WRAP_CYCLE_S = TURNING_S + WRAP_STEPS_S.cut;
/** On average 24 rpm (8 turns in 20 s); the turntable speeds up and slows down over this long, so it starts and stops smoothly. */
const SPIN_RAMP_S = 0.8;
const CRUISE_RAD_PER_S = (WRAP_TURNS * 2 * Math.PI) / (TURNING_S - SPIN_RAMP_S);
/** The film is cut halfway through the last step: the web goes, the shell stays. */
const CUT_AT_S = TURNING_S + WRAP_STEPS_S.cut / 2;
/** The first turn lays the base band on: the shell grows round to it over this long. */
const FIRST_TURN_S = WRAP_STEPS_S.base / 2;

export type WrapPhase = 'idle' | 'base' | 'up' | 'top' | 'down' | 'cut';

/** The wrapper and its pallet at one moment of the cycle. */
export interface WrapPose {
  phase: WrapPhase;
  /** The turntable's turn since the pallet stopped on it: 0 to 8 turns, square again at the end. */
  turnRad: number;
  /** The carriage above its foot, 0 to CARRIAGE_TRAVEL_M. */
  carriageM: number;
  /** How far up the load the film reaches, 0 (none) to 1 (whole). */
  filmFrac: number;
  /** True while the web runs from the roll to the load (until the cut). */
  web: boolean;
}

export const createWrapPose = (): WrapPose => ({ phase: 'idle', turnRad: 0, carriageM: 0, filmFrac: 0, web: false });

/** The turntable's turn at `tS` into the cycle: ramps up, turns steadily, ramps down to exactly 8 turns. */
function turnAt(tS: number): number {
  const t = Math.min(Math.max(tS, 0), TURNING_S);
  if (t < SPIN_RAMP_S) return (CRUISE_RAD_PER_S * t * t) / (2 * SPIN_RAMP_S);
  const leftS = TURNING_S - t;
  if (leftS < SPIN_RAMP_S) return WRAP_TURNS * 2 * Math.PI - (CRUISE_RAD_PER_S * leftS * leftS) / (2 * SPIN_RAMP_S);
  return CRUISE_RAD_PER_S * (t - SPIN_RAMP_S / 2);
}

const UP_FROM_S = WRAP_STEPS_S.base;
const TOP_FROM_S = UP_FROM_S + WRAP_STEPS_S.up;
const DOWN_FROM_S = TOP_FROM_S + WRAP_STEPS_S.top;

/** The carriage at `tS`: at its foot for the base wraps, eased up the mast, at the top wraps' height, eased down. */
function carriageAt(tS: number): number {
  if (tS < UP_FROM_S) return 0;
  if (tS < TOP_FROM_S) return CARRIAGE_TOP_M * ease((tS - UP_FROM_S) / WRAP_STEPS_S.up);
  if (tS < DOWN_FROM_S) return CARRIAGE_TOP_M;
  if (tS < TURNING_S) return CARRIAGE_TOP_M * (1 - ease((tS - DOWN_FROM_S) / WRAP_STEPS_S.down));
  return 0;
}

/** The top of the roll's band, from the pallet's underside, with the carriage `carriageM` up. */
const bandTopM = (carriageM: number): number => CARRIAGE_AT_M[1] + carriageM + ROLL_AT_M[1] + ROLL_HEIGHT_M / 2 - PALLET_BOTTOM_M;

/**
 * The wrap `wrapS` motion seconds after the pallet stopped on the turntable, into `out`; a negative time is no
 * pallet (the turntable at rest), a time past the cycle a pallet wrapped.
 */
export function wrapPoseAt(wrapS: number, out: WrapPose): WrapPose {
  if (wrapS < 0) {
    out.phase = 'idle';
    out.turnRad = 0;
    out.carriageM = 0;
    out.filmFrac = 0;
    out.web = false;
    return out;
  }
  const t = Math.min(wrapS, WRAP_CYCLE_S);
  out.phase = t < UP_FROM_S ? 'base' : t < TOP_FROM_S ? 'up' : t < DOWN_FROM_S ? 'top' : t < TURNING_S ? 'down' : 'cut';
  out.turnRad = turnAt(t);
  out.carriageM = carriageAt(t);
  out.web = t < CUT_AT_S;
  // The film reaches as high as the roll's band has been: the base band first, then up with the carriage.
  const highestM = Math.min(FILM_TOP_M, bandTopM(t < TOP_FROM_S ? out.carriageM : CARRIAGE_TOP_M));
  const topM = t < FIRST_TURN_S ? FILM_BOTTOM_M + (highestM - FILM_BOTTOM_M) * ease(t / FIRST_TURN_S) : highestM;
  out.filmFrac = (topM - FILM_BOTTOM_M) / (FILM_TOP_M - FILM_BOTTOM_M);
  return out;
}

/* the film */

/** Clear stretch film: a faint blue-white, glossy. */
const FILM_COLOR = 0xe6eff4;

/** The web's and the shell's material; the caller owns and disposes it. The web is seen from both sides. */
export function createFilmMaterial(kind: 'web' | 'shell'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: FILM_COLOR,
    roughness: 0.25,
    metalness: 0,
    transparent: true,
    opacity: kind === 'web' ? 0.5 : 0.38,
    depthWrite: false,
    side: kind === 'web' ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = kind === 'web' ? 'film-web' : 'film-shell';
  return material;
}

export interface FilmWeb {
  /** The web, in the wrapper's frame; hidden while no pallet is wrapped. */
  readonly mesh: THREE.Mesh;
  /** Stretches the web from the roll to the load's corner for the pose; no allocation. */
  update(pose: Readonly<WrapPose>): void;
  dispose(): void;
}

/** Where the film leaves the carriage, on the floor plan: the exit roller, at rest (-1.191, -0.709). */
const WEB_X_M = CARRIAGE_AT_M[0] + FILM_EXIT_AT_M[0];
const WEB_Z_M = CARRIAGE_AT_M[2] + FILM_EXIT_AT_M[1];
const HALF_W = FILM_PLAN_M.widthM / 2;
const HALF_D = FILM_PLAN_M.depthM / 2;
const CORNERS: readonly (readonly [number, number])[] = [
  [HALF_W, HALF_D],
  [HALF_W, -HALF_D],
  [-HALF_W, HALF_D],
  [-HALF_W, -HALF_D],
];

/**
 * The web: one quad from the roll's band to the load's corner where the film winds on. The load turns +y (its
 * surface moves as (z, -x) per radian), so the film winds on at the outline corner on the side where that motion
 * pulls film off the roll: of the corners seen from the roll, the one furthest round on that side.
 */
export function createFilmWeb(): FilmWeb {
  const positions = new Float32Array(12);
  const normals = new Float32Array(12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  // The web stays within the exit roller, the mast side of the turntable and the load: fixed bounds for culling and picking.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(-0.4, 1, -0.3), 1.9);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1.25, 0.2, -0.8), new THREE.Vector3(0.8, 2.0, 0.8));
  const material = createFilmMaterial('web');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'film-web';
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const write = (i: number, xM: number, yM: number, zM: number): void => {
    positions[i * 3] = xM;
    positions[i * 3 + 1] = yM;
    positions[i * 3 + 2] = zM;
  };

  return {
    mesh,
    update(pose) {
      mesh.visible = pose.web;
      if (!pose.web) return;
      const cos = Math.cos(pose.turnRad);
      const sin = Math.sin(pose.turnRad);
      let bestX = 0;
      let bestZ = 0;
      let best = -Infinity;
      for (const [cx, cz] of CORNERS) {
        // The corner turned with the load (three.js: +y turns x toward -z).
        const xM = cx * cos + cz * sin;
        const zM = -cx * sin + cz * cos;
        // How far round it is on the winding side, as seen from the roll.
        const score = (xM * WEB_Z_M - zM * WEB_X_M) / Math.hypot(xM - WEB_X_M, zM - WEB_Z_M);
        if (score > best) {
          best = score;
          bestX = xM;
          bestZ = zM;
        }
      }
      const rollBottomM = CARRIAGE_AT_M[1] + pose.carriageM + ROLL_AT_M[1] - ROLL_HEIGHT_M / 2;
      const rollTopM = rollBottomM + ROLL_HEIGHT_M;
      const loadBottomM = Math.max(rollBottomM, PALLET_BOTTOM_M + FILM_BOTTOM_M);
      const loadTopM = Math.max(loadBottomM, Math.min(rollTopM, PALLET_BOTTOM_M + FILM_TOP_M));
      write(0, WEB_X_M, rollBottomM, WEB_Z_M);
      write(1, bestX, loadBottomM, bestZ);
      write(2, bestX, loadTopM, bestZ);
      write(3, WEB_X_M, rollTopM, WEB_Z_M);
      // One normal for the flat quad: across the web, level.
      const dxM = bestX - WEB_X_M;
      const dzM = bestZ - WEB_Z_M;
      const lengthM = Math.hypot(dxM, dzM) || 1;
      for (let i = 0; i < 4; i++) {
        normals[i * 3] = -dzM / lengthM;
        normals[i * 3 + 1] = 0;
        normals[i * 3 + 2] = dxM / lengthM;
      }
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
