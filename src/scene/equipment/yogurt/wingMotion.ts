// The yogurt machines in motion (phase 23): what happens inside the wing's machines, shown by small parts that move
// with the sim's live state. Every part is an instance of a box, coloured per instance and casting no shadow, drawn in
// the cold chain's box mesh ahead of its pallets (coldChainScene.ts, SharedBoxes): the overview stands at its budget of
// draw calls (phase 20), and the wing's motion costs none.
//
// - Stage 11: the powder station's rotary valve turns as powder is dosed; the high-shear mixer's rotor spins in its
//   funnel; the stabilizer pump's plunger strokes.
// - Stage 12: the deaerator's vacuum pump turns; the homogenizer's three pistons stroke, a third of a turn apart; the
//   plate heat exchanger's three packs show their temperatures on a strip each (regeneration, heating, cooling).
// - Stage 13: the culture pump's plunger strokes as it doses; each fermentation tank's sight glass shows what is inside
//   at its level: milk-white mix at pH 6.6 turning to cream yogurt by pH 4.55, dark above the level.
// - Stage 14: the flow meter after the smoothing valve spins; the cooler's strip shows its outlet; the fruit pump strokes.
// - Stage 15: the coder flashes as each cycle's lids pass, and the three check gates flash as they check a row.
// - Stage 16: the blast chiller's fans turn while it holds pallets; the cold room's evaporator fans turn while its
//   cooling works, and stand still in a cooling failure (D30).
//
// Each part moves on animation time (motion.ts): paused, it stands; at high speeds it only hints at the rate.
import * as THREE from 'three';
import type { Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import { motionDtS } from '../../motion';
import * as at from './layout';
import { yogurtOf } from './readings';

const Y = plantJson.yogurt;
const TURN = Math.PI * 2;
/** At most this much of a turn or stroke a frame, so a slow frame never skips a whole one. */
const MAX_PHASE_PER_FRAME = 0.45;

/** Colours: the moving metal, a lamp off and a flash, the temperature ramp of the pipes (tokens.css --t4 … --t140). */
const HEX = { metal: 0x5d6a74, blade: 0x8a96a0, off: 0x30363c, flash: 0xffd84a, glassEmpty: 0x2a3036, mix: 0xf3f1ea, yogurt: 0xe9dcb2 } as const;
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
interface PartState {
  /** Turns or strokes so far, or the flash's 0/1; what the part does now. */
  value: number;
  moving: boolean;
  color: number;
}

interface Part {
  machine: string;
  name: string;
  /** Turns (or strokes) a second at its full rate, on animation time. */
  ratePerS: number;
  /** Where it is, its size and turn, from its phase (0–1 of a turn or stroke) and the live snapshot. */
  pose(phase: number, yogurt: YogurtSnapshot, out: Pose): void;
  /** Its share of its full rate now: 0 stands it still. */
  speed(yogurt: YogurtSnapshot): number;
  /** Its colour now; the part's metal if left out. */
  color?(yogurt: YogurtSnapshot, phase: number, out: THREE.Color): THREE.Color;
}

interface Pose {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  size: THREE.Vector3;
}

export interface WingMotion {
  /** How many instances it draws (SharedBoxes). */
  readonly count: number;
  /** The mesh it draws in, and its first instance (SharedBoxes): the cold chain's boxes, which take no clicks. */
  bind(mesh: THREE.InstancedMesh, offset: number): void;
  /** The mesh it draws in, once bound. */
  readonly mesh: THREE.InstancedMesh | null;
  /** Moves every part on, once a snapshot: any machine of the wing may call it, a second call does nothing. */
  advance(snapshot: Snapshot, realDtS: number): void;
  /** A machine's parts, by name: what they do now (debugState). */
  state(machine: string): Readonly<Record<string, number | string | boolean>>;
  /** The machine ids that have parts. */
  readonly machines: readonly string[];
}

const PIPE_Y = at.PIPE_Y_M;
/** A plunger strokes along x by this much either side of its rest. */
const STROKE_M = 0.06;
/** A fermentation tank's sight glass on its +z face, left of the level gauge: its middle and height. */
const SIGHT_GLASS = { yM: 2.9, heightM: 0.7 } as const;
const p8Running = (y: YogurtSnapshot): boolean => y.p8.state === 'running';
const mixing = (y: YogurtSnapshot): number => y.mix.flowLph / Y.mix.capacityLph;
const heating = (y: YogurtSnapshot): number => (y.heat.mode === 'production' || y.heat.mode === 'divert' ? y.heat.flowLph / Y.mix.capacityLph : 0);
const p8Rate = (y: YogurtSnapshot): number => (p8Running(y) ? (y.p8.cyclesPerMin ?? 30) / 30 : 0);

/** A box turning about y at (x, y, z), `lengthM` across. */
const blade = (x: number, yM: number, z: number, lengthM: number, widthM = 0.06, offsetTurn = 0) =>
  (phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(x, yM, z);
    out.rotation.set(0, (phase + offsetTurn) * TURN, 0);
    out.size.set(lengthM, 0.03, widthM);
  };

/** A plunger along x at (x, y, z): out and back once a stroke. */
const plunger = (x: number, yM: number, z: number, lengthM: number, offsetTurn = 0) =>
  (phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(x + STROKE_M * Math.sin((phase + offsetTurn) * TURN), yM, z);
    out.rotation.set(0, 0, 0);
    out.size.set(lengthM, 0.05, 0.05);
  };

/** A flat strip or plate, still, at (x, y, z). */
const plate = (x: number, yM: number, z: number, sx: number, sy: number, sz: number, turnY = 0) =>
  (_phase: number, _y: YogurtSnapshot, out: Pose): void => {
    out.position.set(x, yM, z);
    out.rotation.set(0, turnY, 0);
    out.size.set(sx, sy, sz);
  };

/** A flash once a cycle: lit for the first `litFrac` of each turn of the phase. */
const flashColor = (litFrac: number) => (y: YogurtSnapshot, phase: number, out: THREE.Color): THREE.Color =>
  out.setHex(p8Running(y) && phase % 1 < litFrac ? HEX.flash : HEX.off);

/** A fermentation tank's sight glass: on the +z face, left of the gauge, turned to face out. */
function sightGlass(tank: number): Part {
  const xM = at.FERMENT_TANK.xsM[tank] ?? 0;
  const zM = at.FERMENT_TANK.zM;
  const r = at.FERMENT_TANK.radiusM;
  const dx = -0.55;
  const dz = Math.sqrt(r * r - dx * dx) + 0.03;
  const yM = SIGHT_GLASS.yM;
  return {
    machine: `ferment-tank-${tank + 1}`,
    name: 'sightGlass',
    ratePerS: 0,
    pose: plate(xM + dx, yM, zM + dz, 0.3, SIGHT_GLASS.heightM, 0.03, Math.atan2(dx, dz)),
    speed: () => 0,
    color(y, _phase, out) {
      const level = y.ferment.tanks[tank];
      if (!level || level.capacityL <= 0) return out.setHex(HEX.glassEmpty);
      // The contents' top against the glass's middle: below it, the glass shows the empty tank's dark.
      const bottomM = at.FERMENT_TANK.legsM + at.FERMENT_TANK.coneM;
      const topM = bottomM + at.FERMENT_TANK.bodyM * (level.levelL / level.capacityL);
      return topM < yM ? out.setHex(HEX.glassEmpty) : contentColor(level.ph, out);
    },
  };
}

/** Where the cold room's evaporators hang: in the middle of the north wall's runs between its dock doors. */
export function evaporatorXs(): number[] {
  const room = at.COLD_ROOM;
  const doorHalfM = 1.4;
  const edges = [room.xMinM, ...at.DOCK_DOORS_X_M.flatMap((xM) => [xM - doorHalfM, xM + doorHalfM]), room.xMaxM];
  const runs: number[] = [];
  for (let i = 0; i + 1 < edges.length; i += 2) runs.push(((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2);
  // The three runs nearest the middle, so none sits in the corner by the chiller's doorway.
  return runs.slice(1);
}

/** The wing's parts, machine by machine, in world metres (layout.ts and the fixtures in yogurtLine.ts). */
function wingParts(): Part[] {
  const parts: Part[] = [];
  // Stage 11.
  const powder = at.POWDER_STATION;
  parts.push({ machine: 'powder-station', name: 'rotaryValve', ratePerS: 0.8, pose: (phase, _y, out) => {
    out.position.set(powder.xM, 1.32, powder.zM);
    out.rotation.set(0, 0, phase * TURN);
    out.size.set(0.34, 0.05, 0.3);
  }, speed: mixing });
  const mixer = at.MIXER;
  for (const [i, offset] of [[0, 0], [1, 0.25]] as const) {
    parts.push({ machine: 'high-shear-mixer', name: `rotor${i + 1}`, ratePerS: 3, pose: blade(mixer.xM, 1.83, mixer.zM, 0.7, 0.06, offset), speed: mixing, color: (_y, _p, out) => out.setHex(HEX.blade) });
  }
  const skid = at.STABILIZER_SKID;
  parts.push({ machine: 'stabilizer-skid', name: 'plunger', ratePerS: 1.2, pose: plunger(skid.xM + 0.28, 0.3, skid.zM + 0.4, 0.22), speed: mixing });
  // Stage 12.
  const deaerator = at.DEAERATOR;
  parts.push({ machine: 'yogurt-deaerator', name: 'vacuumPump', ratePerS: 2, pose: (phase, _y, out) => {
    out.position.set(deaerator.xM + 1.02, 0.3, deaerator.zM);
    out.rotation.set(phase * TURN, 0, 0);
    out.size.set(0.03, 0.42, 0.06);
  }, speed: heating, color: (_y, _p, out) => out.setHex(HEX.blade) });
  const homogenizer = at.HOMOGENIZER;
  [-0.35, 0, 0.35].forEach((dx, i) => {
    parts.push({ machine: 'yogurt-homogenizer', name: `piston${i + 1}`, ratePerS: 2.5, pose: (phase, _y, out) => {
      out.position.set(homogenizer.xM + dx, 1.15, homogenizer.zM + 0.42 + 0.07 * Math.sin((phase + i / 3) * TURN));
      out.rotation.set(0, 0, 0);
      out.size.set(0.1, 0.1, 0.24);
    }, speed: heating, color: (_y, _p, out) => out.setHex(HEX.blade) });
  });
  const phe = at.PHE;
  const packM = (phe.lengthM - 0.3) / 3;
  const sections = [
    // The regeneration section brings the cold mix up to the homogenizer's temperature with the hot mix's heat.
    { name: 'regenerationStrip', tempC: () => Y.homogenizer.tempC },
    { name: 'heatingStrip', tempC: (y: YogurtSnapshot) => y.heat.outletC },
    { name: 'coolingStrip', tempC: (y: YogurtSnapshot) => y.ferment.tempC },
  ];
  sections.forEach((section, i) => {
    const cxM = phe.xM - phe.lengthM / 2 + 0.05 + packM / 2 + i * (packM + 0.1);
    parts.push({
      machine: 'yogurt-phe',
      name: section.name,
      ratePerS: 0,
      pose: plate(cxM, phe.heightM - 0.3, phe.zM + phe.depthM / 2 + 0.02, packM - 0.08, 0.08, 0.02),
      speed: () => 0,
      color: (y, _p, out) => (heating(y) > 0 ? wingTempColor(section.tempC(y), out) : out.setHex(HEX.off)),
    });
  });
  // Stage 13.
  const culture = at.CULTURE_PUMP;
  const inoculating = (y: YogurtSnapshot): number => (y.heat.mode === 'production' ? y.heat.flowLph / Y.mix.capacityLph : 0);
  parts.push({ machine: 'culture-pump', name: 'plunger', ratePerS: 1, pose: plunger(culture.xM + 0.67, 0.35, culture.zM, 0.24), speed: inoculating });
  for (let tank = 0; tank < at.FERMENT_TANK.xsM.length; tank++) parts.push(sightGlass(tank));
  // Stage 14.
  const smoothing = at.SMOOTHING_VALVE;
  const fromTank = (y: YogurtSnapshot): number => (y.ferment.tanks.some((t) => t.state === 'emptying') ? y.buffer.inflowLph / Y.cooling.flowLph : 0);
  // A flow meter on the pipe after the valve: its body, and the impeller's vane spinning on top with the flow.
  parts.push({ machine: 'smoothing-valve', name: 'flowMeterBody', ratePerS: 0, pose: plate(smoothing.xM + 0.6, PIPE_Y + 0.12, smoothing.zM, 0.16, 0.14, 0.16), speed: () => 0 });
  parts.push({ machine: 'smoothing-valve', name: 'flowMeter', ratePerS: 2, pose: blade(smoothing.xM + 0.6, PIPE_Y + 0.21, smoothing.zM, 0.22, 0.05), speed: fromTank, color: (_y, _p, out) => out.setHex(HEX.blade) });
  const cooler = at.COOLER;
  parts.push({
    machine: 'yogurt-cooler',
    name: 'outletStrip',
    ratePerS: 0,
    pose: plate(cooler.xM, cooler.heightM - 0.25, cooler.zM + cooler.depthM / 2 + 0.02, cooler.lengthM - 0.25, 0.08, 0.02),
    speed: () => 0,
    color: (y, _p, out) => (y.buffer.coolerOutletC !== null && fromTank(y) > 0 ? wingTempColor(y.buffer.coolerOutletC, out) : out.setHex(HEX.off)),
  });
  const fruit = at.FRUIT_TANK;
  // The fruit's dosing pump at the tank's foot: its body, and the plunger that strokes while a fruit recipe runs.
  parts.push({ machine: 'fruit-tank', name: 'dosingPumpBody', ratePerS: 0, pose: plate(fruit.xM + fruit.radiusM + 0.2, 0.2, fruit.zM, 0.3, 0.3, 0.26), speed: () => 0 });
  parts.push({ machine: 'fruit-tank', name: 'dosingPump', ratePerS: 1.4, pose: plunger(fruit.xM + fruit.radiusM + 0.47, 0.25, fruit.zM, 0.22), speed: (y) => (y.buffer.fruitDosePct > 0 ? 1 : 0) });
  // Stage 15: the coder and the gates flash once a cycle, each in its turn as the row passes.
  const laneHalfM = (11 * at.P8_CARRIER.lanePitchM) / 2;
  parts.push({ machine: 'p8-filler', name: 'coderFlash', ratePerS: 0.5, pose: plate(at.P8_STATIONS.coderXM, at.P8_CARRIER.topM + 0.16, at.P8.zM - laneHalfM - 0.08, 0.12, 0.04, 0.12), speed: p8Rate, color: flashColor(0.3) });
  const gates = [
    ['p8-checkweigher', at.CHECK_GATES.checkweigher, 0.95],
    ['p8-metal-detector', at.CHECK_GATES.metalDetector, 1.45],
    ['p8-vision', at.CHECK_GATES.vision, 1.85],
  ] as const;
  gates.forEach(([machine, xM, yM], i) => {
    // Each gate a quarter of a cycle after the one before it, as the row reaches it.
    parts.push({ machine, name: 'checkFlash', ratePerS: 0.5, pose: plate(xM, yM, at.P8.zM + 0.32, 0.1, 0.06, 0.06), speed: p8Rate, color: (y, phase, out) => flashColor(0.3)(y, phase + 1 - (i + 1) * 0.25, out) });
  });
  // Stage 16.
  const chiller = at.BLAST_CHILLER;
  const chillerX = (chiller.xMinM + chiller.xMaxM) / 2;
  const chillerZ = (chiller.zMinM + chiller.zMaxM) / 2;
  [-0.5, 0, 0.5].forEach((dx, i) => {
    parts.push({ machine: 'blast-chiller', name: `fan${i + 1}`, ratePerS: 2.5, pose: blade(chillerX + dx, chiller.heightM + 0.53, chillerZ, 0.46, 0.09, i * 0.17), speed: (y) => (y.coldChain.chiller.pallets > 0 ? 1 : 0), color: (_y, _p, out) => out.setHex(HEX.blade) });
  });
  const room = at.COLD_ROOM;
  const coolingWorks = (y: YogurtSnapshot): number => (y.coldChain.coldRoom.excursion?.coolingDown ? 0 : 1);
  // The evaporators hang high on the inside of the north wall, between the dock doors, facing the stage's camera over
  // the south wall: each a casing and its fan's blade turning in front of it.
  evaporatorXs().forEach((xM, i) => {
    parts.push({ machine: 'cold-room', name: `evaporator${i + 1}`, ratePerS: 0, pose: plate(xM, room.wallM - 0.55, room.zMinM + 0.35, 1.0, 0.5, 0.4), speed: () => 0 });
    parts.push({ machine: 'cold-room', name: `fan${i + 1}`, ratePerS: 2, pose: (phase, _y, out) => {
      out.position.set(xM, room.wallM - 0.55, room.zMinM + 0.58);
      out.rotation.set(0, 0, (phase + i * 0.2) * TURN);
      out.size.set(0.44, 0.07, 0.02);
    }, speed: coolingWorks, color: (_y, _p, out) => out.setHex(HEX.blade) });
  });
  return parts;
}

export function createWingMotion(): WingMotion {
  const parts = wingParts();
  let mesh: THREE.InstancedMesh | null = null;
  let offset = 0;
  const phases = parts.map(() => 0);
  const states: PartState[] = parts.map(() => ({ value: 0, moving: false, color: HEX.metal }));
  const pose: Pose = { position: new THREE.Vector3(), rotation: new THREE.Euler(), size: new THREE.Vector3() };
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  let last: Snapshot | null = null;

  function place(yogurt: YogurtSnapshot | undefined): void {
    parts.forEach((part, i) => {
      if (yogurt) part.pose(phases[i] ?? 0, yogurt, pose);
      else pose.size.set(0, 0, 0);
      if (yogurt && part.color) part.color(yogurt, phases[i] ?? 0, color);
      else color.setHex(HEX.metal);
      const state = states[i];
      if (state) state.color = color.getHex();
      if (!mesh) return;
      matrix.compose(pose.position, quaternion.setFromEuler(pose.rotation), pose.size);
      mesh.setMatrixAt(offset + i, matrix);
      mesh.setColorAt(offset + i, color);
    });
    if (!mesh) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    count: parts.length,
    get mesh() {
      return mesh;
    },
    bind(target, first) {
      mesh = target;
      offset = first;
      place(undefined);
    },
    machines: [...new Set(parts.map((part) => part.machine))],
    advance(snapshot, realDtS) {
      if (snapshot === last) return;
      last = snapshot;
      const yogurt = yogurtOf(snapshot);
      if (yogurt) {
        const dtS = motionDtS(snapshot, realDtS);
        parts.forEach((part, i) => {
          const speed = Math.max(0, part.speed(yogurt));
          const step = Math.min(MAX_PHASE_PER_FRAME, part.ratePerS * speed * dtS);
          // The phase counts turns (it is not wrapped), so a test can see how far a part has turned.
          phases[i] = (phases[i] ?? 0) + step;
          const state = states[i];
          if (state) {
            state.value = phases[i] ?? 0;
            state.moving = part.ratePerS > 0 && speed > 0;
          }
        });
      }
      place(yogurt);
    },
    state(machine) {
      const out: Record<string, number | string | boolean> = {};
      parts.forEach((part, i) => {
        if (part.machine !== machine) return;
        const state = states[i];
        if (!state) return;
        out[`${part.name}Turns`] = Math.round(state.value * 1000) / 1000;
        out[`${part.name}Moving`] = state.moving;
        out[`${part.name}Color`] = `#${state.color.toString(16).padStart(6, '0')}`;
      });
      return out;
    },
  };
}
