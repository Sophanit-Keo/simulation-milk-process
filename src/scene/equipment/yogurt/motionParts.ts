// The pieces the yogurt wing's moving parts are made of (phase 23, split out in phase 26): the part's shape, its
// colours, and the poses and colours it is built from. wingMotion.ts lists the parts of phases 23 and 25,
// hallDetail.ts those of phase 26; wingMotion.ts moves and draws them all.
import * as THREE from 'three';
import type { Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';

const Y = plantJson.yogurt;
export const TURN = Math.PI * 2;

/** Colours: the moving metal, a lamp off and a flash, the temperature ramp of the pipes (tokens.css --t4 … --t140). */
export const HEX = {
  metal: 0x5d6a74,
  blade: 0x8a96a0,
  off: 0x30363c,
  flash: 0xffd84a,
  glassEmpty: 0x2a3036,
  mix: 0xf3f1ea,
  yogurt: 0xe9dcb2,
  // Phase 25: a valve open for product, a gauge's face and needle, the recorder's paper, its grid, its pen and the limit.
  open: 0x34c759,
  dial: 0xf2f0ea,
  needle: 0xc8352a,
  paper: 0xeeeae0,
  grid: 0xbdb6a6,
  ink: 0x2b5fa8,
  bad: 0xd63b26,
  // Phase 26: a tank jacket's warm and chilled water, an operator screen lit and dark, a nameplate, an oil sight glass,
  // a freezer's display.
  warm: 0xea8027,
  chilled: 0x2b7bd0,
  screen: 0x4aa3ff,
  screenDark: 0x1d2328,
  nameplate: 0xcfd5da,
  oil: 0xd9a441,
  frost: 0x7cc4ff,
} as const;
const TEMP_STOPS = [
  { tempC: 4, color: new THREE.Color(0x2b7bd0) },
  { tempC: 20, color: new THREE.Color(0x2aa0c0) },
  { tempC: 60, color: new THREE.Color(0xe3a21c) },
  { tempC: 80, color: new THREE.Color(0xea8027) },
  { tempC: 140, color: new THREE.Color(0xd63b26) },
];

/** The pipes' colour of milk at `tempC` (pipes.ts tempColor), with the light theme's stops, which both themes share. */
export function wingTempColor(tempC: number, out: THREE.Color): THREE.Color {
  const stops = TEMP_STOPS;
  if (tempC <= stops[0].tempC) return out.copy(stops[0].color);
  for (let i = 1; i < stops.length; i++) {
    const lo = stops[i - 1];
    const hi = stops[i];
    if (tempC <= hi.tempC) return out.lerpColors(lo.color, hi.color, (tempC - lo.tempC) / (hi.tempC - lo.tempC));
  }
  return out.copy(stops[stops.length - 1].color);
}

/** A tank's contents seen through its sight glass: the mix's white at the start pH, cream yogurt by the end pH. */
export function contentColor(ph: number, out: THREE.Color): THREE.Color {
  const { startPh, endPh } = Y.ferment;
  const t = Math.min(1, Math.max(0, (startPh - ph) / (startPh - endPh)));
  return out.lerpColors(new THREE.Color(HEX.mix), new THREE.Color(HEX.yogurt), t);
}

/** One moving part as the frame leaves it, for the machine's debugState and the tests. */
export interface PartState {
  /** Turns or strokes so far, or the flash's 0/1; what the part does now. */
  value: number;
  moving: boolean;
  color: number;
  /** What its gauge reads now, in its own unit (phase 25); null for a part that reads nothing. */
  reading: number | null;
}

export interface Part {
  machine: string;
  name: string;
  /** Turns (or strokes) a second at its full rate, on animation time. */
  ratePerS: number;
  /** Where it is, its size and turn, from its phase (0–1 of a turn or stroke) and the live snapshot. */
  pose(phase: number, yogurt: YogurtSnapshot, out: Pose): void;
  /** Its share of its full rate now: 0 stands it still. */
  speed(yogurt: YogurtSnapshot): number;
  /**
   * Phase 27: seconds of animation time it takes to come up to speed from standing, and to run down again; it starts
   * and stops at once if left out. A machine's crank and flywheel take it, so they spin up and down together.
   */
  easeS?: number;
  /**
   * Phase 25: a part that travels to a place instead of turning, a valve's stem or a gauge's needle. Its phase eases to
   * this, 0–1, at ratePerS a second on animation time; `speed` is not used.
   */
  target?(yogurt: YogurtSnapshot): number;
  /** What it shows in its own unit, a gauge's bar or the recorder's °C (phase 25), for its debugState. */
  reading?(yogurt: YogurtSnapshot): number;
  /** Its colour now; the part's metal if left out. */
  color?(yogurt: YogurtSnapshot, phase: number, out: THREE.Color): THREE.Color;
  /**
   * Phase 29: sees each new snapshot once, before any part moves: a part that counts something over sim time, the mix
   * room's powder bag (mixDetail.ts).
   */
  observe?(snapshot: Snapshot): void;
}

export interface Pose {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  size: THREE.Vector3;
}

/** A plunger strokes along x by this much either side of its rest. */
const STROKE_M = 0.06;
export const p8Running = (y: YogurtSnapshot): boolean => y.p8.state === 'running';
export const heating = (y: YogurtSnapshot): number => (y.heat.mode === 'production' || y.heat.mode === 'divert' ? y.heat.flowLph / Y.mix.capacityLph : 0);

/** A box turning about y at (x, y, z), `lengthM` across. */
export const blade = (x: number, yM: number, z: number, lengthM: number, widthM = 0.06, offsetTurn = 0) =>
  (phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(x, yM, z);
    out.rotation.set(0, (phase + offsetTurn) * TURN, 0);
    out.size.set(lengthM, 0.03, widthM);
  };

/** A plunger along x at (x, y, z): out and back once a stroke. */
export const plunger = (x: number, yM: number, z: number, lengthM: number, offsetTurn = 0) =>
  (phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(x + STROKE_M * Math.sin((phase + offsetTurn) * TURN), yM, z);
    out.rotation.set(0, 0, 0);
    out.size.set(lengthM, 0.05, 0.05);
  };

/** A flat strip or plate, still, at (x, y, z). */
export const plate = (x: number, yM: number, z: number, sx: number, sy: number, sz: number, turnY = 0) =>
  (_phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(x, yM, z);
    out.rotation.set(0, turnY, 0);
    out.size.set(sx, sy, sz);
  };

/** A flash once a cycle: lit for the first `litFrac` of each turn of the phase. */
export const flashColor = (litFrac: number) => (y: YogurtSnapshot, phase: number, out: THREE.Color): THREE.Color =>
  out.setHex(p8Running(y) && phase % 1 < litFrac ? HEX.flash : HEX.off);

export const still = (): number => 0;
export const fixed = (hex: number) => (_y: YogurtSnapshot, _phase: number, out: THREE.Color): THREE.Color => out.setHex(hex);
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * A round-faced gauge on a face to the aisle (+z) at (x, y, z), phase 25: its white face, and its needle, which sweeps
 * 270° from the bottom left (0) to the bottom right (full scale) as its phase eases to the reading.
 */
export function gauge(machine: string, name: string, [xM, yM, zM]: readonly [number, number, number], read: (y: YogurtSnapshot) => number, fullScale: number): Part[] {
  const needleM = 0.06;
  return [
    { machine, name: `${name}Face`, ratePerS: 0, pose: plate(xM, yM, zM, 0.11, 0.11, 0.006), speed: still, color: fixed(HEX.dial) },
    {
      machine,
      name,
      ratePerS: 1.5,
      pose(phase, _y, out) {
        const angle = (0.75 - 1.5 * phase) * Math.PI;
        out.position.set(xM - Math.sin(angle) * (needleM / 2), yM + Math.cos(angle) * (needleM / 2), zM + 0.006);
        out.rotation.set(0, 0, angle);
        out.size.set(0.01, needleM, 0.005);
      },
      speed: still,
      target: (y) => read(y) / fullScale,
      reading: read,
      color: fixed(HEX.needle),
    },
  ];
}

/**
 * A gauge on a top cover at (x, y, z), its face up (phase 27): its white face, and its needle, which sweeps 270° as its
 * phase eases to the reading: 0 at seven-thirty and full scale at four-thirty, seen from the aisle (+z) above.
 */
export function topGauge(machine: string, name: string, [xM, yM, zM]: readonly [number, number, number], read: (y: YogurtSnapshot) => number, fullScale: number): Part[] {
  const needleM = 0.055;
  return [
    { machine, name: `${name}Face`, ratePerS: 0, pose: plate(xM, yM, zM, 0.13, 0.004, 0.13), speed: still, color: fixed(HEX.dial) },
    {
      machine,
      name,
      ratePerS: 1.5,
      pose(phase, _y, out) {
        // The clock's angle from twelve (−z, away from the aisle), clockwise seen from above.
        const clockRad = (-0.75 + 1.5 * phase) * Math.PI;
        out.position.set(xM + Math.sin(clockRad) * (needleM / 2), yM + 0.004, zM - Math.cos(clockRad) * (needleM / 2));
        // The needle's length lies along its own x: turned about y, x points along the clock's hand.
        out.rotation.set(0, Math.PI / 2 - clockRad, 0);
        out.size.set(needleM, 0.004, 0.01);
      },
      speed: still,
      target: (y) => read(y) / fullScale,
      reading: read,
      color: fixed(HEX.needle),
    },
  ];
}

/** What a valve lets through while it is open: product (green), a clean (amber), a jacket's warm or chilled water. */
export type OpenFor = 'product' | 'clean' | 'warm' | 'chilled';
const OPEN_HEX: Readonly<Record<OpenFor, number>> = { product: HEX.open, clean: HEX.flash, warm: HEX.warm, chilled: HEX.chilled };

/** A valve's stem on top of its actuator at (x, y, z): it lifts `liftM` as the valve opens, coloured by what flows. */
export function valveStem(machine: string, name: string, [xM, yM, zM]: readonly [number, number, number], open: (y: YogurtSnapshot) => OpenFor | null, liftM = 0.06): Part {
  return {
    machine,
    name,
    ratePerS: 1.2,
    pose(phase, _y, out) {
      out.position.set(xM, yM + phase * liftM, zM);
      out.rotation.set(0, 0, 0);
      out.size.set(0.05, 0.07, 0.05);
    },
    speed: still,
    target: (y) => (open(y) ? 1 : 0),
    color(y, _phase, out) {
      const how = open(y);
      return out.setHex(how ? OPEN_HEX[how] : HEX.off);
    },
  };
}

/** A rotor's blade turning on a pump's face to the aisle (+z), or to the east (+x) with `faceX`. */
export const rotor = (xM: number, yM: number, zM: number, lengthM: number, faceX = false) =>
  (phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(xM, yM, zM);
    if (faceX) out.rotation.set(phase * TURN, 0, 0);
    else out.rotation.set(0, 0, phase * TURN);
    out.size.set(faceX ? 0.02 : lengthM, faceX ? lengthM : 0.04, faceX ? 0.05 : 0.02);
  };

