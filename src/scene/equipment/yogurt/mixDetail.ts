// The yogurt mix room's fittings and motion (phase 29, D31): what stage 11's machines do, shown by parts that move
// with the mix flow. Like the rest of the wing's motion (wingMotion.ts) every part is an instance in the cold chain's
// box mesh, so the room costs no draw call. The grey fittings these stand on (the pump's casing, the motors, the dust
// filter, the panel) are in yogurtLine.ts, joined to meshes the machines already have.
//
// - Yogurt silo: the milk pump's rotor turns and the outlet valve stands open while mix is made; the side agitator's
//   fan turns while the silo holds milk; a display beside the gauge is lit in the pipes' 4 °C blue.
// - Powder station: the dust filter's fan turns while powder is dosed; a gauge on the frame shows the powder left in
//   the big bag, falling as it is dosed and full again with each new bag; the panel's screen and lamp light.
// - High-shear mixer: the drive motor's fan turns; specks of powder circle down the funnel into the rotor; the valve
//   after it stands open.
// - Stabilizer skid: each drum's agitator turns while it doses; a strip on each shows the solution left, the duty
//   drum's falling and the other full.
// - Mix tank: its inlet valve stands open while mix is made, its outlet valve while the heat treatment draws.
//
// The bag and the drums are the scene's own count: the snapshot gives the mix flow, and the scene adds it up over sim
// time (mixUse). A 1,000 kg bag at H122's 27 kg a tonne lasts about 6 h at 6,000 L/h; a 200 L drum of 10% solution at
// the recipe's 0.3% stabilizer about an hour.
import type { Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import * as at from './layout';
import { blade, fixed, heating, HEX, plate, rotor, still, TURN, valveStem, type OpenFor, type Part } from './motionParts';
import { yogurtOf } from './readings';

const Y = plantJson.yogurt;
/** The pipe from the silo through the mixer to the mix tank (yogurtPipes.ts MIX_PATH), and the tank's outlet's. */
const MIX_PIPE_Y_M = 0.45;
/** A big bag of skim-milk powder, and a drum of stabilizer solution with its strength (visual assumptions, D31). */
export const POWDER_BAG_KG = 1_000;
export const STABILIZER_DRUM_L = 200;
export const STABILIZER_SOLUTION_FRAC = 0.1;
const POWDER_HEX = 0xf1e9d2;
const SOLUTION_HEX = 0xd8c98a;

const mixing = (y: YogurtSnapshot): number => y.mix.flowLph / Y.mix.capacityLph;
const mixes = (y: YogurtSnapshot): boolean => y.mix.flowLph > 0;

/* where the silo's fittings stand (yogurtLine.ts draws their grey bodies at the same places) */

/** The silo's fittings: the pump and the valve on its outlet pipe, and the agitator, manway and display round its shell. */
export const SILO_FITTINGS = {
  /** On the outlet pipe (it leaves the shell at x + radius, heading east). */
  valveXM: at.SILO.xM + at.SILO.radiusM + 0.35,
  pumpXM: at.SILO.xM + at.SILO.radiusM + 0.95,
  /** The side agitator: its angle round the shell from the aisle (+z) toward the outlet (+x), and its height. */
  agitatorRad: Math.PI / 4,
  agitatorYM: 1.3,
  /** The manway, the same way round the shell toward the ladder (−x). */
  manwayRad: -0.44,
  manwayYM: 1.25,
  /** The CIP riser up the back of the shell. */
  riserRad: (3 * Math.PI) / 4,
  /** The temperature display, beside the level gauge. */
  displayDxM: 0.34,
  displayYM: 1.75,
} as const;

/** A point on the silo's shell `outM` out from it, `rad` round from the aisle (+z) toward +x: [x, z]. */
export function onSilo(rad: number, outM = 0): [number, number] {
  const r = at.SILO.radiusM + outM;
  return [at.SILO.xM + r * Math.sin(rad), at.SILO.zM + r * Math.cos(rad)];
}

/** The powder station's fittings on its frame (posts 0.8 m out from its centre). */
export const POWDER_FITTINGS = {
  filter: { dxM: -0.5, dzM: -0.5, yM: 3.47, sizeM: [0.6, 0.44, 0.6] },
  /** The bag gauge on the front right post: its foot and its height. */
  gauge: { dxM: 0.8, dzM: 0.86, fromM: 1.55, heightM: 1.3 },
  panel: { dxM: -0.8, dzM: 0.9, yM: 1.3, sizeM: [0.36, 0.5, 0.12] },
} as const;

/** The mixer's drive motor, lying along z in front of its body, and the valve after the mixer on the pipe. */
export const MIXER_FITTINGS = { motorYM: 0.32, motorZM: at.MIXER.zM + 0.62, motorRadiusM: 0.19, motorLengthM: 0.55, valveXM: at.MIXER.xM + 0.8 } as const;

/** The stabilizer skid's drums (yogurtLine.ts): 0.4 m either side of its centre, their tops at 1.05 m. */
export const SKID_FITTINGS = { drumDxM: 0.4, drumTopM: 1.05, drumRadiusM: 0.3 } as const;

/** The mix tank's valves: on the inlet run before its riser, and on its outlet toward the process hall. */
export const MIX_TANK_FITTINGS = {
  inletXM: at.MIX_TANK.xM - at.MIX_TANK.radiusM - 1.0,
  outletXM: at.MIX_TANK.xM + at.MIX_TANK.radiusM + 0.45,
  outletYM: at.PIPE_Y_M,
} as const;

/* the mix the room has made, for the bag and the drums */

/** What the room has used since the scene first saw it: mix made, in litres, added up over sim time. */
export interface MixUse {
  readonly mixL: number;
  observe(snapshot: Snapshot): void;
}

export function createMixUse(): MixUse {
  let mixL = 0;
  let lastS: number | null = null;
  return {
    get mixL() {
      return mixL;
    },
    observe(snapshot) {
      const yogurt = yogurtOf(snapshot);
      if (!yogurt) return;
      // A clock that went back is a new sim behind the same scene: the count starts over.
      if (lastS !== null && snapshot.timeS < lastS) mixL = 0;
      else if (lastS !== null) mixL += (yogurt.mix.flowLph * (snapshot.timeS - lastS)) / 3_600;
      lastS = snapshot.timeS;
    },
  };
}

/** How full the powder bag is after `mixL` litres of mix at `kgPerT` (litres count as kilograms, as H122): 1 full, 0 empty. */
export function bagFrac(mixL: number, kgPerT: number): number {
  const usedKg = (mixL / 1_000) * kgPerT;
  return 1 - (usedKg % POWDER_BAG_KG) / POWDER_BAG_KG;
}

/** How full stabilizer drum `drum` (0 or 1) is after `mixL` litres of mix: the duty drum falls, the other stands full. */
export function drumFrac(drum: number, mixL: number): number {
  const usedL = (mixL * (Y.mix.stabilizerPct / 100)) / STABILIZER_SOLUTION_FRAC;
  const duty = Math.floor(usedL / STABILIZER_DRUM_L) % 2;
  return drum === duty ? 1 - (usedL % STABILIZER_DRUM_L) / STABILIZER_DRUM_L : 1;
}

/* shapes */

/** A valve on a pipe along x at (x, y, z): its body and actuator, still, and its stem, which lifts as it opens. */
function valve(machine: string, name: string, xM: number, yM: number, zM: number, open: (y: YogurtSnapshot) => OpenFor | null): Part[] {
  return [
    { machine, name: `${name}Body`, ratePerS: 0, pose: plate(xM, yM, zM, 0.14, 0.14, 0.14), speed: still },
    { machine, name: `${name}Actuator`, ratePerS: 0, pose: plate(xM, yM + 0.15, zM, 0.1, 0.16, 0.1), speed: still },
    valveStem(machine, name, [xM, yM + 0.265, zM], open),
  ];
}

/**
 * A level strip on a face to the aisle: its dark back, still, and its fill, which eases to `level` (0–1) from the
 * strip's foot upward.
 */
function levelStrip(machine: string, name: string, xM: number, fromM: number, zM: number, widthM: number, heightM: number, level: (y: YogurtSnapshot) => number, hex: number): Part[] {
  return [
    { machine, name: `${name}Back`, ratePerS: 0, pose: plate(xM, fromM + heightM / 2, zM, widthM, heightM, 0.012), speed: still, color: fixed(HEX.glassEmpty) },
    {
      machine,
      name,
      ratePerS: 0.6,
      pose(phase, _y, out) {
        const fillM = Math.max(0.001, heightM * phase);
        out.position.set(xM, fromM + fillM / 2, zM + 0.008);
        out.rotation.set(0, 0, 0);
        out.size.set(widthM - 0.02, fillM, 0.008);
      },
      speed: still,
      target: level,
      reading: (y) => level(y) * 100,
      color: fixed(hex),
    },
  ];
}

/** A speck of powder circling down the mixer's funnel into the rotor: `offset` of a turn behind the first. */
function speck(i: number, offset: number): Part {
  const { xM, zM } = at.MIXER;
  return {
    machine: 'high-shear-mixer',
    name: `speck${i + 1}`,
    ratePerS: 0.9,
    pose(phase, y, out) {
      // Each turn of the phase takes the speck from the funnel's rim (1.78 m, 0.36 m out) down to the rotor.
      const fall = (phase + offset) % 1;
      const angle = (phase * 2.5 + offset) * TURN;
      const outM = 0.36 * (1 - fall) + 0.04;
      out.position.set(xM + Math.cos(angle) * outM, 1.78 - 0.5 * fall, zM + Math.sin(angle) * outM);
      out.rotation.set(0, -angle, 0);
      const sizeM = mixes(y) ? 0.05 : 0;
      out.size.set(sizeM, sizeM, sizeM);
    },
    speed: mixing,
    color: fixed(POWDER_HEX),
  };
}

/** Stage 11's parts, machine by machine. `use` is the room's count of the mix it has made. */
export function mixDetailParts(use: MixUse = createMixUse()): Part[] {
  const parts: Part[] = [];

  /* the silo */
  const S = SILO_FITTINGS;
  const siloZ = at.SILO.zM;
  parts.push(...valve('yogurt-silo', 'outletValve', S.valveXM, MIX_PIPE_Y_M, siloZ, (y) => (mixes(y) ? 'product' : null)));
  parts.push({ machine: 'yogurt-silo', name: 'pumpRotor', ratePerS: 3, pose: rotor(S.pumpXM, MIX_PIPE_Y_M, siloZ + 0.215, 0.3), speed: mixing, color: fixed(HEX.blade) });
  // The agitator's fan on the end of its drive, turning about the drive's axis, which points out from the shell.
  const [fanXM, fanZM] = onSilo(S.agitatorRad, 0.54);
  parts.push({
    machine: 'yogurt-silo',
    name: 'agitatorFan',
    ratePerS: 1.2,
    pose(phase, _y, out) {
      out.position.set(fanXM, S.agitatorYM, fanZM);
      out.rotation.set(0, S.agitatorRad, phase * TURN);
      out.size.set(0.3, 0.05, 0.02);
    },
    speed: (y) => (y.mix.tanks.silo.levelL > 0 ? 1 : 0),
    color: fixed(HEX.blade),
  });
  const displayZM = siloZ + Math.sqrt(at.SILO.radiusM ** 2 - S.displayDxM ** 2) + 0.02;
  parts.push({
    machine: 'yogurt-silo',
    name: 'tempDisplay',
    ratePerS: 0,
    pose: plate(at.SILO.xM + S.displayDxM, S.displayYM, displayZM, 0.22, 0.14, 0.02, Math.atan2(S.displayDxM, displayZM - siloZ)),
    speed: still,
    // Lit in the pipes' 4 °C blue while the silo holds milk.
    color: (y, _phase, out) => out.setHex(y.mix.tanks.silo.levelL > 0 ? HEX.chilled : HEX.screenDark),
  });

  /* the powder station */
  const powder = at.POWDER_STATION;
  const P = POWDER_FITTINGS;
  parts.push({
    machine: 'powder-station',
    name: 'filterFan',
    ratePerS: 2.5,
    pose: blade(powder.xM + P.filter.dxM, P.filter.yM + P.filter.sizeM[1] / 2 + 0.02, powder.zM + P.filter.dzM, 0.44, 0.07),
    speed: mixing,
    color: fixed(HEX.blade),
  });
  const bag = levelStrip('powder-station', 'bagLevel', powder.xM + P.gauge.dxM, P.gauge.fromM, powder.zM + P.gauge.dzM, 0.09, P.gauge.heightM, (y) => bagFrac(use.mixL, y.mix.powderKgPerT), POWDER_HEX);
  // The gauge's fill carries the room's count: it adds up the mix once a frame, before any part reads it.
  (bag[1] as Part).observe = (snapshot) => use.observe(snapshot);
  parts.push(...bag);
  const panelXM = powder.xM + P.panel.dxM;
  const panelFaceZM = powder.zM + P.panel.dzM + P.panel.sizeM[2] / 2 + 0.005;
  parts.push({ machine: 'powder-station', name: 'screen', ratePerS: 0, pose: plate(panelXM, P.panel.yM + 0.08, panelFaceZM, 0.24, 0.18, 0.006), speed: still, color: (y, _p, out) => out.setHex(mixes(y) ? HEX.screen : HEX.screenDark) });
  parts.push({ machine: 'powder-station', name: 'runLamp', ratePerS: 0, pose: plate(panelXM + 0.1, P.panel.yM - 0.16, panelFaceZM, 0.05, 0.05, 0.02), speed: still, color: (y, _p, out) => out.setHex(mixes(y) ? HEX.open : HEX.off) });

  /* the high-shear mixer */
  const M = MIXER_FITTINGS;
  parts.push({ machine: 'high-shear-mixer', name: 'motorFan', ratePerS: 3, pose: rotor(at.MIXER.xM, M.motorYM, M.motorZM + M.motorLengthM / 2 + 0.012, 0.3), speed: mixing, color: fixed(HEX.blade) });
  [0, 1 / 3, 2 / 3].forEach((offset, i) => parts.push(speck(i, offset)));
  parts.push(...valve('high-shear-mixer', 'outletValve', M.valveXM, MIX_PIPE_Y_M, at.MIXER.zM, (y) => (mixes(y) ? 'product' : null)));

  /* the stabilizer skid */
  const skid = at.STABILIZER_SKID;
  const K = SKID_FITTINGS;
  [-1, 1].forEach((side, drum) => {
    const xM = skid.xM + side * K.drumDxM;
    parts.push({ machine: 'stabilizer-skid', name: `agitator${drum + 1}`, ratePerS: 1.5, pose: blade(xM, K.drumTopM + 0.2, skid.zM, 0.36, 0.05, drum * 0.25), speed: mixing, color: fixed(HEX.blade) });
    parts.push(...levelStrip('stabilizer-skid', `drum${drum + 1}Level`, xM, 0.27, skid.zM + K.drumRadiusM + 0.012, 0.07, 0.7, () => drumFrac(drum, use.mixL), SOLUTION_HEX));
  });

  /* the mix tank */
  const T = MIX_TANK_FITTINGS;
  parts.push(...valve('yogurt-mix-tank', 'inletValve', T.inletXM, MIX_PIPE_Y_M, at.MIX_TANK.zM, (y) => (mixes(y) ? 'product' : null)));
  parts.push(...valve('yogurt-mix-tank', 'outletValve', T.outletXM, T.outletYM, at.MIX_TANK.zM, (y) => (heating(y) > 0 ? 'product' : null)));
  return parts;
}
