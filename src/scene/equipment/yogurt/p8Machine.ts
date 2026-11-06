// Line P8 in the 3D view (phase 18, D28): the filler's stations moving per cycle, and its cups.
//
// - The machine: the cup magazines over the de-nester, the ionizer's shroud, the UV-C tunnel (glowing while P8 runs),
//   the piston filler, the foil pick and the sealing heads, which stroke once a cycle, the coder, all under the HEPA
//   hood, whose lamp is green while the cabin holds its overpressure and red when it falls under.
// - The cups: one InstancedMesh of cup bodies and one of what tops them (the yogurt's surface after the filler, the
//   foil after the lidder), riding the carrier in rows of 12, down a ramp to the check gates and on, four abreast, to
//   the tray packer. A cup the checks reject is kicked by the flap off the belt into the bin. Their label shows the
//   code the cups carry.
//
// Both follow one carrier clock: a cycle at P8's rate on animation time (motion.ts), so at ×1 the carrier indexes
// with the sim's own cycles, every 2 s; faster speeds only hint at it. The carrier indexes in the first part of each
// cycle and dwells for the rest, while the stations act. After a clean the line is empty and fills again row by row.
import * as THREE from 'three';
import { sToDay, type P8Snapshot, type Snapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import { createLampPalette, DARK_LAMP_BODY_HEX, glowInDark } from '../../lamps';
import { motionDtS } from '../../motion';
import { LAMP_COLOR_VAR, LAMP_GLOW_HEX, type LampStatus } from '../../theme';
import { MachineBuilder } from '../liquid/builder';
import type { Kit } from '../liquid/kit';
import { labelValue, stageValue } from '../liquid/readings';
import { ease, machine } from '../liquidLine';
import type { Equipment } from '../types';
import * as at from './layout';
import { yogurtOf } from './readings';

/** The share of a cycle the carrier spends indexing one pitch; it dwells for the rest while the stations act. */
export const MOVE_FRAC = 0.35;
/** At most this much of a cycle a frame, so a slow frame at a high speed never skips a whole index. */
const MAX_CYCLE_PER_FRAME = 0.45;
/** The cycles a minute shown while the snapshot lacks them (contracts v9 and older): the default 21,600 cups/h. */
const DEFAULT_CYCLES_PER_MIN = 30;
const LANES = 12;
/** How far the pistons, the foil pick and the sealing heads stroke down. */
const PISTON_STROKE_M = 0.12;
const SEAL_STROKE_M = 0.09;
/** A kicked cup's flight to the bin, s of animation time; at most this many wait their turn. */
const KICK_S = 0.8;
const MAX_KICKS_WAITING = 3;

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** Down over the dwell's [from, from + 0.15], held, and up again over [to − 0.15, to]: a station's stroke, 0–1. */
const stroke = (dwell: number, from: number, to: number): number => smooth((dwell - from) / 0.15) * (1 - smooth((dwell - (to - 0.15)) / 0.15));

/** P8's state, or undefined for a snapshot without the yogurt line. */
const p8Of = (snapshot: Snapshot): P8Snapshot | undefined => yogurtOf(snapshot)?.p8;

/** The carrier rows on P8 and the gate-belt rows past it (four cups each, three for each carrier row). */
const CARRIER_ROWS = Math.round((at.P8.xMaxM - at.P8_STATIONS.denesterXM) / at.P8_CARRIER.pitchM);
const BELT_ROWS = Math.round((at.OUTFEED.xMaxM - at.P8.xMaxM) / at.P8_GATE_BELT.pitchM);
const BELT_ROWS_PER_CYCLE = LANES / at.P8_GATE_BELT.lanes;
/** The rows of cups the line holds when it is full: a cycle's worth of rows for each carrier row and three gate-belt rows. */
const FULL_CYCLES = CARRIER_ROWS + Math.ceil(BELT_ROWS / BELT_ROWS_PER_CYCLE);
/** The carrier rows (counted from the de-nester) where the filler and the foil pick act during the dwell. */
const rowAt = (xM: number): number => Math.round((xM - at.P8_STATIONS.denesterXM) / at.P8_CARRIER.pitchM) - 1;
export const FILL_ROW = rowAt(at.P8_STATIONS.fillerXM);
export const FOIL_ROW = rowAt(at.P8_STATIONS.foilXM);

/** The clock both P8's machine and its cups follow; it moves on once a frame, whichever asks first. */
export interface P8Carrier {
  advance(snapshot: Snapshot, realDtS: number): void;
  /** How far through the cycle, 0–1. */
  readonly phase: number;
  /** Cycles shown since the plant was built. */
  readonly cycles: number;
  /** Cycles since the line was last emptied, up to FULL_CYCLES: the rows that hold cups. */
  readonly loaded: number;
  readonly running: boolean;
  /** The carrier's progress through its index, 0–1 (1 for the whole dwell). */
  moveFrac(): number;
  /** The dwell's progress, 0–1 (0 while it indexes). */
  dwellFrac(): number;
}

export function createP8Carrier(): P8Carrier {
  let phase = 0;
  let cycles = 0;
  // The night left the line full, running as it opens.
  let loaded = FULL_CYCLES;
  let running = false;
  let last: Snapshot | null = null;
  return {
    advance(snapshot, realDtS) {
      if (snapshot === last) return;
      last = snapshot;
      const p8 = p8Of(snapshot);
      running = p8?.state === 'running';
      // A clean empties the line; it fills again as it runs.
      if (p8?.state === 'cleaning' || p8?.state === 'sterilizing') {
        loaded = 0;
        phase = 0;
      }
      if (!running) return;
      const perMin = p8?.cyclesPerMin ?? DEFAULT_CYCLES_PER_MIN;
      phase += Math.min(MAX_CYCLE_PER_FRAME, (motionDtS(snapshot, realDtS) * perMin) / 60);
      while (phase >= 1) {
        phase -= 1;
        cycles += 1;
        loaded = Math.min(FULL_CYCLES, loaded + 1);
      }
    },
    get phase() {
      return phase;
    },
    get cycles() {
      return cycles;
    },
    get loaded() {
      return loaded;
    },
    get running() {
      return running;
    },
    moveFrac: () => smooth(phase / MOVE_FRAC),
    dwellFrac: () => Math.max(0, (phase - MOVE_FRAC) / (1 - MOVE_FRAC)),
  };
}

/* The machine */

/** The HEPA lamp: green while the cabin holds its overpressure, red under it, off without a reading. */
export function hepaLamp(p8: P8Snapshot | undefined, minPa: number): LampStatus | 'off' {
  if (!p8 || p8.hepaPa === undefined || !Number.isFinite(p8.hepaPa)) return 'off';
  return p8.hepaPa < minPa ? 'bad' : 'ok';
}

const VALVE_LAMP_OFF_HEX = 0x2a3036;
const UV_HEX = 0x8a5cff;

const HEPA_MIN_PA = plantJson.yogurt.p8.hepa.minPa;

export function p8Filler(kit: Kit, carrier: P8Carrier): Equipment {
  const { xMinM, xMaxM, zM, widthM, bodyM, hoodM } = at.P8;
  const xM = (xMinM + xMaxM) / 2;
  const lengthM = xMaxM - xMinM;
  const topM = at.P8_CARRIER.topM;
  const st = at.P8_STATIONS;
  const laneSpanM = (LANES - 1) * at.P8_CARRIER.lanePitchM;
  const b = new MachineBuilder(kit, 'p8-filler', [xM, 0, zM]);
  b.part('box', 'paint', [xM, bodyM / 2, zM], [lengthM, bodyM, widthM - 0.4]);
  b.part('box', 'steelDark', [xM, bodyM + 0.04, zM], [lengthM, 0.08, widthM - 0.3]); // the carrier chain
  // The de-nester: a magazine tube over each lane, its stack of cups inside.
  for (let lane = 0; lane < LANES; lane++) {
    const laneZM = zM - laneSpanM / 2 + lane * at.P8_CARRIER.lanePitchM;
    b.part('cylLo', 'steel', [st.denesterXM, topM + 0.62, laneZM], [0.042, 0.7, 0.042]);
  }
  b.part('box', 'steelDark', [st.denesterXM, topM + 0.24, zM], [0.22, 0.06, laneSpanM + 0.16]); // the suction bar's rail
  for (const dz of [-1, 1]) b.part('box', 'steelDark', [st.denesterXM, topM + 0.5, zM + dz * (laneSpanM / 2 + 0.12)], [0.1, 1.0, 0.06]);
  // Ionized air and the vacuum shroud, then the UV-C tunnel's shell over the carrier.
  b.part('box', 'steel', [st.ionizerXM, topM + 0.28, zM], [0.4, 0.12, laneSpanM + 0.2]);
  const uvLengthM = st.uvToXM - st.uvFromXM;
  const uvXM = (st.uvFromXM + st.uvToXM) / 2;
  b.part('box', 'steel', [uvXM, topM + 0.3, zM], [uvLengthM, 0.08, laneSpanM + 0.24]);
  for (const dz of [-1, 1]) b.part('box', 'steel', [uvXM, topM + 0.15, zM + dz * (laneSpanM / 2 + 0.12)], [uvLengthM, 0.3, 0.04]);
  // The piston filler's manifold and the foil magazine, fixed; the pistons, the pick and the heads move.
  b.part('box', 'steel', [st.fillerXM, topM + 0.62, zM], [0.42, 0.3, laneSpanM + 0.2]);
  b.part('box', 'steel', [st.foilXM, topM + 0.68, zM], [0.32, 0.26, laneSpanM + 0.2]);
  b.part('box', 'steel', [st.sealerXM, topM + 0.66, zM], [0.4, 0.24, laneSpanM + 0.2]);
  b.part('box', 'steelDark', [st.coderXM, topM + 0.3, zM - laneSpanM / 2 - 0.05], [0.22, 0.22, 0.16]); // the coder's head
  b.part('box', 'glass', [xM, bodyM + hoodM / 2, zM], [lengthM + 0.2, hoodM, widthM]);
  b.part('box', 'steel', [xM, bodyM + hoodM + 0.15, zM], [lengthM - 1, 0.3, widthM - 0.4]); // HEPA filter housing
  // The ramp from the carrier down to the check gates' belt.
  const rampFromXM = xMaxM;
  const rampToXM = at.P8_GATE_BELT.rampToXM;
  const rampRad = Math.atan2(topM - at.P8_GATE_BELT.topM, rampToXM - rampFromXM);
  const rampLengthM = Math.hypot(rampToXM - rampFromXM, topM - at.P8_GATE_BELT.topM);
  b.part('box', 'steelDark', [(rampFromXM + rampToXM) / 2, (topM + at.P8_GATE_BELT.topM) / 2 - 0.02, zM], [rampLengthM, 0.04, 0.42], {
    rotationRad: [0, 0, -rampRad],
  });

  // The pistons: a nozzle over each lane, stroking down into the cups below them.
  const pistons = b.pivot('pistons', [st.fillerXM, topM + 0.36, zM]);
  for (let lane = 0; lane < LANES; lane++) {
    b.part('cylLo', 'steelDark', [0, 0, -laneSpanM / 2 + lane * at.P8_CARRIER.lanePitchM], [0.018, 0.22, 0.018], { parent: pistons });
  }
  // The lidder: the foil pick and the sealing heads on one beam, one stroke a cycle (one draw call, not two).
  const lidder = b.pivot('lidder', [st.sealerXM, topM + 0.38, zM]);
  b.part('box', 'steelDark', [st.foilXM - st.sealerXM, 0.02, 0], [0.12, 0.04, laneSpanM + 0.08], { parent: lidder });
  b.part('box', 'steelDark', [0, 0, 0], [0.16, 0.08, laneSpanM + 0.08], { parent: lidder });
  b.part('box', 'steelDark', [(st.foilXM - st.sealerXM) / 2, 0.06, 0], [st.sealerXM - st.foilXM, 0.03, 0.1], { parent: lidder });
  const pistonRestY = pistons.position.y;
  const lidderRestY = lidder.position.y;

  // The UV-C lamps' glow under the tunnel's roof, and the HEPA lamp on its housing: materials of their own.
  const uvMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1530, emissive: UV_HEX, emissiveIntensity: 0, roughness: 0.4 });
  const uv = new THREE.Mesh(kit.shape('box'), uvMaterial);
  uv.name = 'uvGlow';
  uv.position.copy(b.local([uvXM, topM + 0.25, zM]));
  uv.scale.set(uvLengthM - 0.1, 0.02, laneSpanM);
  b.root.add(uv);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.3, emissiveIntensity: 1 });
  const lampMesh = new THREE.Mesh(kit.shape('sphere'), lampMaterial);
  lampMesh.name = 'hepaLamp';
  lampMesh.position.copy(b.local([xMaxM - 0.8, bodyM + hoodM + 0.36, zM]));
  lampMesh.scale.setScalar(0.07);
  b.root.add(lampMesh);
  const palette = createLampPalette(LAMP_GLOW_HEX, LAMP_COLOR_VAR);
  let lamp: LampStatus | 'off' | null = null;
  const paintLamp = (status: LampStatus | 'off'): void => {
    if (status === 'off') {
      lampMaterial.color.setHex(palette.dark ? DARK_LAMP_BODY_HEX : VALVE_LAMP_OFF_HEX);
      lampMaterial.emissiveIntensity = 0;
    } else if (palette.dark) {
      glowInDark(lampMaterial, palette.color(status));
    } else {
      lampMaterial.color.setHex(0x000000);
      lampMaterial.emissive.copy(palette.color(status));
      lampMaterial.emissiveIntensity = 1;
    }
  };
  const showLamp = (status: LampStatus | 'off'): void => {
    if (status === lamp) return;
    lamp = status;
    paintLamp(status);
  };
  showLamp('off');
  let uvOn = false;

  return machine(b, {
    id: 'p8-filler',
    stage: 15,
    label: 'Line P8',
    labelAnchorM: [xM, bodyM + hoodM + 0.8, zM],
    labelText: (s) => labelValue(stageValue(s, 15, 'cupsPerH'), 0, 'cups/h'),
    update(s, realDtS) {
      carrier.advance(s, realDtS);
      const p8 = p8Of(s);
      showLamp(hepaLamp(p8, HEPA_MIN_PA));
      // The stations stroke during the dwell, and stand up while P8 does.
      const dwell = carrier.running ? carrier.dwellFrac() : 0;
      pistons.position.y = pistonRestY - PISTON_STROKE_M * stroke(dwell, 0.1, 0.75);
      lidder.position.y = lidderRestY - SEAL_STROKE_M * stroke(dwell, 0.25, 0.8);
      const wantUv = carrier.running ? 1.4 : 0;
      uvMaterial.emissiveIntensity = ease(uvMaterial.emissiveIntensity, wantUv, 6, realDtS);
      uvOn = uvMaterial.emissiveIntensity > 0.05;
    },
    debugState: () => ({
      running: carrier.running,
      cycles: carrier.cycles,
      phase: carrier.phase,
      pistonDownM: pistonRestY - pistons.position.y,
      sealDownM: lidderRestY - lidder.position.y,
      uvOn,
      lamp: lamp ?? 'off',
    }),
    applyTheme() {
      palette.applyTheme();
      paintLamp(lamp ?? 'off');
    },
    dispose() {
      uvMaterial.dispose();
      lampMaterial.dispose();
    },
  });
}

/* The cups */

/** Where a carrier row's cups stand, by its row and the index in progress. */
const carrierXM = (row: number, moveFrac: number): number => at.P8_STATIONS.denesterXM + (row + moveFrac) * at.P8_CARRIER.pitchM;
/** The belt's height at x: down the ramp from the carrier, then the gates' belts. */
function beltTopM(xM: number): number {
  const { rampToXM, topM } = at.P8_GATE_BELT;
  if (xM <= at.P8.xMaxM) return at.P8_CARRIER.topM;
  if (xM >= rampToXM) return topM;
  const t = (xM - at.P8.xMaxM) / (rampToXM - at.P8.xMaxM);
  return at.P8_CARRIER.topM + (topM - at.P8_CARRIER.topM) * t;
}

/** "P8-008-1 · best before day 36": the code the coder prints on each cup, for the cups' label. */
export function cupCodeText(p8: P8Snapshot | undefined): string {
  const batch = p8?.currentBatch;
  if (!batch) return '';
  return `${batch.code} · best before day ${Math.floor(sToDay(batch.expiresS)) + 1}`;
}

/**
 * A cup body, its base on y = 0: tapered, as a yogurt cup is. Eight sides and no ends, 16 triangles, since 1,400-odd of
 * them stand in the overview (software GL counts every triangle); its top is drawn apart.
 */
function cupGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(at.CUP_M.rimRadiusM, at.CUP_M.baseRadiusM, at.CUP_M.heightM, 8, 1, true);
  geometry.translate(0, at.CUP_M.heightM / 2, 0);
  return geometry;
}

/** A cup's top, the foil or the yogurt's surface: a disc of 8 triangles facing up. */
function topGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(at.CUP_M.rimRadiusM * 0.98, 8);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** A sphere round every place a cup can stand, from the de-nester to the outfeed's end, so the cups are culled with it. */
function lineSphere(): THREE.Sphere {
  const fromXM = at.P8_STATIONS.denesterXM;
  const toXM = at.OUTFEED.xMaxM;
  const centre = new THREE.Vector3((fromXM + toXM) / 2, at.P8_CARRIER.topM, at.P8.zM);
  return new THREE.Sphere(centre, (toXM - fromXM) / 2 + 1);
}

const FILL_HEX = 0xf1ead8;
const FOIL_HEX = 0xc8ccd2;

export function p8Cups(kit: Kit, carrier: P8Carrier): Equipment {
  const root = new THREE.Group();
  root.name = 'p8-cups';
  // Not a machine: a stream of tokens that rides through P8, the gates and the outfeed (tests skip it as a machine).
  root.userData = { equipmentId: 'p8-cups', stage: 15, tokens: true };
  const capacity = (CARRIER_ROWS + 1) * LANES + BELT_ROWS * at.P8_GATE_BELT.lanes;
  const bodyGeometry = cupGeometry();
  // Both sides, so an empty cup shows its inside from above, not the carrier through it.
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.55, side: THREE.DoubleSide });
  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
  bodies.name = 'cups';
  // The instances move about the line; its sphere bounds them all, so the cups are culled when the camera looks away.
  bodies.boundingSphere = lineSphere();
  const capGeometry = topGeometry();
  const topMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2 });
  const tops = new THREE.InstancedMesh(capGeometry, topMaterial, capacity);
  tops.name = 'cupTops';
  tops.boundingSphere = lineSphere();
  const fillColor = new THREE.Color(FILL_HEX);
  const foilColor = new THREE.Color(FOIL_HEX);
  for (let i = 0; i < capacity; i++) tops.setColorAt(i, foilColor);
  // The kicked cup and the flap that kicks it, at the gap between the metal detector and the vision check.
  const kicked = new THREE.Mesh(bodyGeometry, bodyMaterial);
  kicked.name = 'kickedCup';
  kicked.visible = false;
  const flapPivot = new THREE.Group();
  flapPivot.name = 'rejectFlap';
  flapPivot.position.set(at.REJECT_KICK_XM, at.P8_GATE_BELT.topM + 0.05, at.P8.zM + 0.22);
  const flap = new THREE.Mesh(kit.shape('box'), kit.material('paint'));
  flap.scale.set(0.16, 0.06, 0.02);
  flap.position.set(0, 0, 0);
  flapPivot.add(flap);
  // Drawn only while it kicks: a draw call less the rest of the time.
  flapPivot.visible = false;
  root.add(bodies, tops, kicked, flapPivot);
  // The cups take no clicks: a click on one picks the machine it rides on (the carrier, a gate, the tray packer's
  // belt), so a moving cup never steals the click meant for what is under it, and no click tests 1,450 instances.
  const noPick = (): void => {};
  for (const mesh of [bodies, tops, kicked, flap]) mesh.raycast = noPick;
  // The flap uses the kit's shared box and paint, so the cups hold the kit as the machines do.
  const release = kit.hold();

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Matrix4();
  const laneSpanM = (LANES - 1) * at.P8_CARRIER.lanePitchM;
  const beltSpanM = (at.P8_GATE_BELT.lanes - 1) * at.P8_GATE_BELT.lanePitchM;
  let shownKey = '';
  let cupsShown = 0;
  let filledShown = 0;
  let lidsShown = 0;
  let rejectsSeen: number | null = null;
  let kicksWaiting = 0;
  let kickS = -1;
  let kicks = 0;

  function place(snapshotRunning: boolean): void {
    const moveFrac = carrier.moveFrac();
    const dwell = carrier.dwellFrac();
    const key = `${carrier.cycles}|${carrier.loaded}|${moveFrac.toFixed(4)}|${dwell.toFixed(3)}|${snapshotRunning}`;
    if (key === shownKey) return;
    shownKey = key;
    let cup = 0;
    let top = 0;
    let filled = 0;
    let lids = 0;
    const put = (xM: number, yM: number, zM: number): void => {
      bodies.setMatrixAt(cup, matrix.makeTranslation(xM, yM, zM));
      cup += 1;
    };
    // A top: the foil at the rim, or the yogurt's surface, growing across the cup as the piston fills it.
    const cap = (xM: number, yM: number, zM: number, lid: boolean, radiusFrac = 1): void => {
      matrix.makeTranslation(xM, yM, zM);
      if (radiusFrac !== 1) matrix.multiply(scale.makeScale(radiusFrac, 1, radiusFrac));
      tops.setMatrixAt(top, matrix);
      tops.setColorAt(top, lid ? foilColor : fillColor);
      top += 1;
      if (lid) lids += 1;
      else filled += 1;
    };
    // The row the de-nester drops into the empty pocket during the dwell.
    if (snapshotRunning && dwell > 0) {
      const dropM = 0.22 * (1 - smooth(dwell / 0.5));
      for (let lane = 0; lane < LANES; lane++) put(at.P8_STATIONS.denesterXM, at.P8_CARRIER.topM + dropM, at.P8.zM - laneSpanM / 2 + lane * at.P8_CARRIER.lanePitchM);
    }
    // The carrier's rows, the oldest farthest on; a row holds cups once the line has run it full.
    const rows = Math.min(CARRIER_ROWS, carrier.loaded);
    for (let row = 0; row < rows; row++) {
      const xM = carrierXM(row, moveFrac);
      // Filled at the filler's row during the dwell, sealed from the foil pick's on.
      const fillFrac = row > FILL_ROW ? 1 : row === FILL_ROW ? smooth((dwell - 0.25) / 0.45) : 0;
      const lid = row > FOIL_ROW || (row === FOIL_ROW && dwell > 0.45);
      for (let lane = 0; lane < LANES; lane++) {
        const zM = at.P8.zM - laneSpanM / 2 + lane * at.P8_CARRIER.lanePitchM;
        put(xM, at.P8_CARRIER.topM, zM);
        if (lid) cap(xM, at.P8_CARRIER.topM + at.CUP_M.heightM, zM, true);
        else if (fillFrac > 0.02) cap(xM, at.P8_CARRIER.topM + at.CUP_M.heightM * 0.8, zM, false, Math.max(0.3, fillFrac));
      }
    }
    // Past P8: three belt rows for each carrier row that left it, four cups abreast, sealed.
    const beltRows = Math.min(BELT_ROWS, Math.max(0, (carrier.loaded - CARRIER_ROWS) * BELT_ROWS_PER_CYCLE));
    for (let row = 0; row < beltRows; row++) {
      const xM = at.P8.xMaxM + (row + BELT_ROWS_PER_CYCLE * moveFrac) * at.P8_GATE_BELT.pitchM;
      if (xM > at.OUTFEED.xMaxM) continue;
      const yM = beltTopM(xM);
      for (let lane = 0; lane < at.P8_GATE_BELT.lanes; lane++) {
        const zM = at.P8.zM - beltSpanM / 2 + lane * at.P8_GATE_BELT.lanePitchM;
        put(xM, yM, zM);
        cap(xM, yM + at.CUP_M.heightM, zM, true);
      }
    }
    bodies.count = cup;
    tops.count = top;
    bodies.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    if (tops.instanceColor) tops.instanceColor.needsUpdate = true;
    cupsShown = cup;
    filledShown = filled;
    lidsShown = lids;
  }

  function animateKick(snapshot: Snapshot, realDtS: number): void {
    const rejected = p8Of(snapshot)?.cupsRejected;
    if (typeof rejected === 'number') {
      if (rejectsSeen !== null && rejected > rejectsSeen) kicksWaiting = Math.min(MAX_KICKS_WAITING, kicksWaiting + (rejected - rejectsSeen));
      rejectsSeen = rejected;
    }
    const dtS = motionDtS(snapshot, realDtS);
    if (kickS < 0 && kicksWaiting > 0) {
      kicksWaiting -= 1;
      kickS = 0;
      kicks += 1;
    }
    if (kickS >= 0) {
      kickS += dtS;
      const t = Math.min(1, kickS / KICK_S);
      // Off the belt toward the bin, in an arc, falling in.
      const fromZM = at.P8.zM;
      kicked.position.set(
        at.REJECT_KICK_XM + (at.REJECT_BIN.xM - at.REJECT_KICK_XM) * t,
        at.P8_GATE_BELT.topM + 0.25 * Math.sin(Math.PI * t) - 0.3 * t * t,
        fromZM + (at.REJECT_BIN.zM - fromZM) * t,
      );
      kicked.rotation.z = 3 * t;
      kicked.visible = t < 1;
      flapPivot.visible = t < 1;
      flapPivot.rotation.y = -1.1 * Math.sin(Math.PI * Math.min(1, t * 3));
      if (t >= 1) {
        kickS = -1;
        flapPivot.rotation.y = 0;
      }
    }
  }

  return {
    id: 'p8-cups',
    stage: 15,
    label: 'Coded cups',
    object: root,
    labelAnchorM: [(at.OUTFEED.xMinM + at.OUTFEED.xMaxM) / 2, 1.35, at.P8.zM],
    labelText: (s) => cupCodeText(p8Of(s)),
    update(snapshot, realDtS) {
      carrier.advance(snapshot, realDtS);
      place(carrier.running);
      animateKick(snapshot, realDtS);
    },
    debugState: () => ({ cups: cupsShown, filled: filledShown, lids: lidsShown, loaded: carrier.loaded, kicks, kicking: kickS >= 0 }),
    dispose() {
      root.removeFromParent();
      bodyGeometry.dispose();
      capGeometry.dispose();
      bodyMaterial.dispose();
      topMaterial.dispose();
      bodies.dispose();
      tops.dispose();
      release();
    },
  };
}
