// The cup filling room and Line P8 in more detail (phase 30, D32): what stands round the machine, and more of what
// the machine itself does. Like the rest of the wing's motion (wingMotion.ts) every part is an instance in the cold
// chain's box mesh, so the room costs no draw call. Nothing here changes the sim: every part follows the snapshot.
//
// The machine (places are the model's, P8_LAYOUT in make-heroes.mjs, round its middle at x 6.5, z −47):
// - The feed valve on the line from the buffer: open for product while P8 runs, amber in its clean, orange in its SIP.
// - The ionizer's jet flashes under its shroud once a cycle, and the shroud's extraction fan turns while P8 runs.
// - The dosing crossheads on the piston manifold rise as the pistons draw a dose and come down as the nozzles dispense.
// - A strip of foil lids rides down under the foil pick each cycle; the sealing heads' platen glows with their heat.
// - The carrier's index drive on the cabinet's aisle side steps round once a cycle.
// - The wash lances under the hood's ceiling blink amber in the clean and stand orange in the SIP.
// - The cabin's pressure gauge on the hood's west post reads its overpressure.
// - The check gates: the checkweigher's display is green for a cup inside its limits; each gate's belt roller turns
//   and its lamp turns red for a moment when it throws a cup out; the rejected cups heap up on the bin.
//   Phase 31: the checkweigher's weigh platform dips under each row and a marker on its scale shows the last cup's
//   weight between its limits; the metal detector's field sweeps on its arch; the vision check's strobe flashes for
//   each row and its monitor shows the verdict; a chute runs from the reject flap to the bin.
//
// The room:
// - A pallet of cup cartons by the de-nester and a cart of foil boxes by the lidder: each refill of a magazine takes
//   a layer or a stack, and a full one stands there once the last is gone (the scene's own count, as the mix room's).
// - The operator stands at the screen, and walks to the de-nester or the lidder while its magazine calls for a refill.
// - The sterile air unit behind the machine, its fans turning while the cabin holds, ducted to the HEPA housing.
// - The CIP/SIP skid behind the out end: its CIP valve opens in the clean, its steam valve in the SIP.
// - The QA bench: the seal tester's lamp shows the last test, the cups it took stand beside it for ten minutes, and a
//   bar fills as the next test comes due.
// - The hygiene line on the floor, with the step-over bench, the sticky mat, the hand-wash basin and the locker at
//   its gap.
import type { P8Snapshot, Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import * as at from './layout';
import { blade, fixed, gauge, HEX, p8Running, plate, rotor, still, TURN, valveStem, wingTempColor, type OpenFor, type Part } from './motionParts';
import { stroke, type P8Carrier } from './p8Machine';
import { yogurtOf } from './readings';

const P8 = plantJson.yogurt.p8;
const Z = at.P8.zM;
const LANE_HALF_M = ((P8.lanes - 1) * at.P8_CARRIER.lanePitchM) / 2;
/** The zone's slab: what stands on the floor stands on its top (zones.ts). */
const FLOOR_M = 0.04;
/** The machine's faces: the cabinet's and the hood's, on the aisle side (+z) and behind (−z). */
const CABINET_FRONT_Z_M = Z + 0.6;
const HOOD_FRONT_Z_M = Z + 0.8;
const HOOD_BACK_Z_M = Z - 0.8;

const COLOR = {
  wood: 0xb08a5a,
  carton: 0xc9a26b,
  foilBox: 0xd9dde2,
  foil: 0xc8ccd2,
  cup: 0xf6f4ee,
  steel: 0xaab3ba,
  duct: 0xb8c0c6,
  line: 0xf0c53a,
  mat: 0x2b7bd0,
  bench: 0x3d6fa5,
  coat: 0xf4f6f8,
  trousers: 0xdfe5ea,
  skin: 0xd9a98a,
  hairnet: 0x4aa3ff,
} as const;

/* where the room's things stand (world metres) */

/** The pallet of cup cartons, on the aisle side by the de-nester: three layers of six. */
export const CUP_PALLET = { xM: at.P8_STATIONS.denesterXM, zM: Z + 2.5, layers: 3, perLayer: 6, cartonM: [0.38, 0.3, 0.38] } as const;
/** The cart of foil boxes, on the aisle side by the lidder: three stacks of three. */
export const FOIL_CART = { xM: at.P8_STATIONS.foilXM, zM: Z + 2.4, stacks: 3, perStack: 3, boxM: [0.2, 0.16, 0.2] } as const;
/** Where the operator stands: at the screen, at the de-nester and at the lidder, half a metre off the hood. */
export const OPERATOR = { screenXM: 10, cupsXM: at.P8_STATIONS.denesterXM, foilsXM: at.P8_STATIONS.foilXM, zM: HOOD_FRONT_Z_M + 0.5, walkMPerS: 1.2 } as const;
/** The sterile air unit behind the machine, and its duct to the HEPA housing. */
export const AIR_UNIT = { xM: 6.5, zM: Z - 3.2, sizeM: [1.2, 1.5, 0.8], ductXM: 7.0 } as const;
/** The CIP/SIP skid behind the out end. */
export const CIP_SKID = { xM: 9.8, zM: Z - 3.2, cipValveXM: 9.55, steamValveXM: 10.05 } as const;
/** The QA bench, inside the hygiene line by the check gates. */
export const QA_BENCH = { xM: 13, zM: Z + 2.4, topM: 0.9, sizeM: [1.4, 0.6] } as const;
/** The reject chute (phase 31): from behind the belt at the reject flap down to the bin's near rim. */
export const REJECT_CHUTE = { fromM: [at.REJECT_KICK_XM, 0.72, Z - 0.26], toM: [at.REJECT_BIN.xM + 0.05, 0.62, at.REJECT_BIN.zM + 0.3] } as const;
/** The hygiene line round the high-care zone, and the gap in its aisle side where people step in. */
export const HYGIENE_LINE = { xMinM: 0.6, xMaxM: 15.6, zMinM: Z - 5.4, zMaxM: Z + 3.6, gapXM: [4.4, 5.6] } as const;

/* the room's own counts: the magazines' refills, the gates' rejects and the seal tests */

/** How long a gate's lamp stays red after it throws a cup out: snapshots seen, about a second and a half. */
const REJECT_SHOWN_FRAMES = 90;
/** A magazine's level rising by more than this between two snapshots is a refill, in points of a percent. */
const REFILL_RISE_PCT = 10;
/** The cups a seal test took stand on the bench this long, sim seconds. */
export const SAMPLE_SHOWN_S = 600;

export type Gate = 'checkweigher' | 'metal' | 'vision';
const GATES: readonly Gate[] = ['checkweigher', 'metal', 'vision'];

export interface CupRoomWatch {
  /** Cup cartons left on the pallet, and foil boxes left on the cart. */
  readonly cupCartons: number;
  readonly foilBoxes: number;
  /** A gate threw a cup out a moment ago. */
  rejecting(gate: Gate): boolean;
  /** The last seal test seen: passed, failed, or none yet. */
  readonly lastSealTest: 'passed' | 'failed' | null;
  /** The cups of the last seal test still stand on the bench. */
  readonly samplesOut: boolean;
  /** How far the next seal test has come due, 0–1; 0 while none is planned. */
  readonly sealTestDueFrac: number;
  observe(snapshot: Snapshot): void;
}

const gateRejects = (p8: P8Snapshot, gate: Gate): number => {
  const r = p8.rejects;
  if (!r) return 0;
  return gate === 'checkweigher' ? r.underFill + r.overFill : gate === 'metal' ? r.metal : r.vision;
};

export function createCupRoomWatch(): CupRoomWatch {
  const fullCups = CUP_PALLET.layers * CUP_PALLET.perLayer;
  const fullFoils = FOIL_CART.stacks * FOIL_CART.perStack;
  let last: Snapshot | null = null;
  let lastTimeS: number | null = null;
  let cupCartons = fullCups;
  let foilBoxes = fullFoils;
  let cupsPct: number | null = null;
  let foilsPct: number | null = null;
  let rejects: Record<Gate, number | null> = { checkweigher: null, metal: null, vision: null };
  let redFrames: Record<Gate, number> = { checkweigher: 0, metal: 0, vision: 0 };
  let tests: { passed: number; failed: number } | null = null;
  let lastSealTest: 'passed' | 'failed' | null = null;
  let sampledAtS: number | null = null;
  let dueFrac = 0;
  let timeS = 0;
  function reset(): void {
    cupCartons = fullCups;
    foilBoxes = fullFoils;
    cupsPct = null;
    foilsPct = null;
    rejects = { checkweigher: null, metal: null, vision: null };
    redFrames = { checkweigher: 0, metal: 0, vision: 0 };
    tests = null;
    lastSealTest = null;
    sampledAtS = null;
  }
  return {
    get cupCartons() {
      return cupCartons;
    },
    get foilBoxes() {
      return foilBoxes;
    },
    rejecting: (gate) => redFrames[gate] > 0,
    get lastSealTest() {
      return lastSealTest;
    },
    get samplesOut() {
      return sampledAtS !== null && timeS - sampledAtS < SAMPLE_SHOWN_S;
    },
    get sealTestDueFrac() {
      return dueFrac;
    },
    observe(snapshot) {
      if (snapshot === last) return;
      last = snapshot;
      const p8 = yogurtOf(snapshot)?.p8;
      if (!p8) return;
      // The clock went back (a new run): the room starts over.
      if (lastTimeS !== null && snapshot.timeS < lastTimeS) reset();
      lastTimeS = snapshot.timeS;
      timeS = snapshot.timeS;
      // A refill takes a layer of cartons, or a stack of foil boxes; a full pallet or cart comes once the last is gone.
      const nowCups = p8.magazines?.cupsPct ?? null;
      if (cupsPct !== null && nowCups !== null && nowCups - cupsPct > REFILL_RISE_PCT) {
        cupCartons -= CUP_PALLET.perLayer;
        if (cupCartons <= 0) cupCartons = fullCups;
      }
      cupsPct = nowCups;
      const nowFoils = p8.magazines?.foilsPct ?? null;
      if (foilsPct !== null && nowFoils !== null && nowFoils - foilsPct > REFILL_RISE_PCT) {
        foilBoxes -= FOIL_CART.perStack;
        if (foilBoxes <= 0) foilBoxes = fullFoils;
      }
      foilsPct = nowFoils;
      for (const gate of GATES) {
        const now = gateRejects(p8, gate);
        const before = rejects[gate];
        if (before !== null && now > before) redFrames[gate] = REJECT_SHOWN_FRAMES;
        else if (redFrames[gate] > 0 && !snapshot.paused) redFrames[gate] -= 1;
        rejects[gate] = now;
      }
      const now = p8.sealTests;
      if (now) {
        if (tests && now.failed > tests.failed) {
          lastSealTest = 'failed';
          sampledAtS = snapshot.timeS;
        } else if (tests && now.passed > tests.passed) {
          lastSealTest = 'passed';
          sampledAtS = snapshot.timeS;
        }
        tests = { passed: now.passed, failed: now.failed };
      }
      const nextS = p8.nextSealTestS;
      dueFrac = typeof nextS === 'number' ? Math.min(1, Math.max(0, 1 - (nextS - snapshot.timeS) / P8.sealTest.everyS)) : 0;
    },
  };
}

/* what the snapshot says */

const state = (y: YogurtSnapshot): P8Snapshot['state'] => y.p8.state;
const refillMarkPct = P8.magazines.refillBelowFrac * 100;
/** A magazine calls for its refill: under its mark, or run out. */
export const cupsCalled = (y: YogurtSnapshot): boolean => y.p8.stopReason === 'cups' || (y.p8.magazines?.cupsPct ?? 100) <= refillMarkPct;
export const foilsCalled = (y: YogurtSnapshot): boolean => y.p8.stopReason === 'foils' || (y.p8.magazines?.foilsPct ?? 100) <= refillMarkPct;
/** Where the operator should stand now: at the de-nester or the lidder while its magazine calls, else at the screen. */
export function operatorStationXM(y: YogurtSnapshot): number {
  if (cupsCalled(y)) return OPERATOR.cupsXM;
  if (foilsCalled(y)) return OPERATOR.foilsXM;
  return OPERATOR.screenXM;
}
/** What flows through the machine's feed and wash lines now. */
function feedOpen(y: YogurtSnapshot): OpenFor | null {
  if (state(y) === 'cleaning') return 'clean';
  if (state(y) === 'sterilizing') return 'warm';
  return p8Running(y) && y.buffer.levelL > 0 ? 'product' : null;
}
/** The last cup's weight inside the checkweigher's limits; null before the first cup. */
export function fillInLimits(p8: P8Snapshot): boolean | null {
  const g = p8.lastFillG;
  if (g === null || g === undefined) return null;
  return g >= P8.fill.underBelowG && g <= P8.fill.overAboveG;
}
const p8Rate = (y: YogurtSnapshot): number => (p8Running(y) ? (y.p8.cyclesPerMin ?? 30) / 30 : 0);

/** A still box of one colour. */
const box = (machine: string, name: string, xM: number, yM: number, zM: number, sx: number, sy: number, sz: number, hex: number): Part => ({
  machine,
  name,
  ratePerS: 0,
  pose: plate(xM, yM, zM, sx, sy, sz),
  speed: still,
  color: fixed(hex),
});

/* the machine */

function machineParts(carrier: P8Carrier | undefined, watch: CupRoomWatch): Part[] {
  const parts: Part[] = [];
  const st = at.P8_STATIONS;
  const dwell = (): number => (carrier?.running ? carrier.dwellFrac() : 0);
  const id = 'p8-filler';
  // The feed valve on the line from the buffer, 0.6 m before the machine. It also carries the room's watch.
  const feedXM = at.P8.xMinM - 0.6;
  parts.push({ ...box(id, 'feedValveBody', feedXM, 0.7, Z, 0.14, 0.14, 0.14, HEX.metal), observe: (snapshot) => watch.observe(snapshot) });
  parts.push(box(id, 'feedActuator', feedXM, 0.85, Z, 0.1, 0.16, 0.1, HEX.metal));
  parts.push(valveStem(id, 'feedValve', [feedXM, 0.965, Z], feedOpen));
  // The cabin's pressure gauge on the hood's west post, facing the aisle.
  parts.push(...gauge(id, 'cabinGauge', [at.P8.xMinM - 0.07, 1.7, HOOD_FRONT_Z_M + 0.006], (y) => y.p8.hepaPa ?? P8.hepa.normalPa, 2 * P8.hepa.normalPa));
  // The ionizer: its jet under the shroud, lit while it blows into the cups early in the dwell, and its extraction fan.
  parts.push({
    machine: id,
    name: 'ionJet',
    ratePerS: 0,
    pose: plate(st.ionizerXM, 1.243, Z, 0.3, 0.006, 2 * LANE_HALF_M + 0.1),
    speed: still,
    reading: () => (dwell() > 0.1 && dwell() < 0.5 ? 1 : 0),
    color: (_y, _p, out) => out.setHex(dwell() > 0.1 && dwell() < 0.5 ? HEX.frost : HEX.off),
  });
  for (const [suffix, offset] of [['', 0], ['Cross', 0.25]] as const) {
    parts.push({ machine: id, name: `shroudFan${suffix}`, ratePerS: 3, easeS: 1, pose: blade(st.ionizerXM, 1.385, Z + 0.25, 0.26, 0.05, offset), speed: (y) => (p8Running(y) ? 1 : 0), color: fixed(HEX.blade) });
  }
  // The dosing crossheads on the manifold's top, either side of the hopper: up with a drawn dose, down as it is dispensed.
  const doseDown = (): number => stroke(dwell(), 0.1, 0.75);
  for (const [name, dz] of [['doseHeadFront', 0.4], ['doseHeadBack', -0.4]] as const) {
    parts.push({
      machine: id,
      name,
      ratePerS: 0,
      pose(_phase, _y, out) {
        out.position.set(st.fillerXM, 1.91 - 0.08 * doseDown(), Z + dz);
        out.rotation.set(0, 0, 0);
        out.size.set(0.26, 0.05, 0.4);
      },
      speed: still,
      reading: () => Math.round(doseDown() * 1000) / 1000,
      color: fixed(HEX.blade),
    });
  }
  // The foil lids under the pick's suction cups: carried down from the start of the cycle, left on the cups' rims.
  const lidderDown = (): number => stroke(dwell(), 0.25, 0.8);
  const carriesFoil = (): boolean => carrier?.running === true && dwell() < 0.45;
  parts.push({
    machine: id,
    name: 'foilStrip',
    ratePerS: 0,
    pose(_phase, _y, out) {
      out.position.set(st.foilXM, 1.378 - 0.09 * lidderDown(), Z);
      out.rotation.set(0, 0, 0);
      if (carriesFoil()) out.size.set(0.07, 0.004, 2 * LANE_HALF_M + 0.07);
      else out.size.set(0, 0, 0);
    },
    speed: still,
    reading: () => (carriesFoil() ? 1 : 0),
    color: fixed(COLOR.foil),
  });
  // The sealing heads' platen, riding their stroke: orange at its heat, red over its window, dull under it.
  parts.push({
    machine: id,
    name: 'sealPlaten',
    ratePerS: 0,
    pose(_phase, _y, out) {
      out.position.set(st.sealerXM, 1.455 - 0.09 * lidderDown(), Z);
      out.rotation.set(0, 0, 0);
      out.size.set(0.14, 0.012, 2 * LANE_HALF_M + 0.06);
    },
    speed: still,
    reading: (y) => y.p8.seal?.tempC ?? P8.seal.tempC,
    color(y, _p, out) {
      const tempC = y.p8.seal?.tempC ?? P8.seal.tempC;
      return out.setHex(tempC > P8.seal.maxTempC ? HEX.bad : tempC < P8.seal.minTempC ? HEX.metal : HEX.warm);
    },
  });
  // The carrier's index drive, on the cabinet's aisle side past the screen: a sixth of a turn each cycle.
  const driveXM = at.P8.xMaxM - 0.5;
  parts.push(box(id, 'indexDriveCover', driveXM, 0.5, CABINET_FRONT_Z_M + 0.004, 0.3, 0.3, 0.008, HEX.off));
  for (const [suffix, offset] of [['', 0], ['Cross', 0.25]] as const) {
    const turn = rotor(driveXM, 0.5, CABINET_FRONT_Z_M + 0.016, 0.24);
    parts.push({
      machine: id,
      name: `indexDrive${suffix}`,
      ratePerS: 0,
      pose: (_phase, y, out) => turn(((carrier?.cycles ?? 0) + (carrier?.moveFrac() ?? 0)) / 6 + offset, y, out),
      speed: still,
      reading: () => carrier?.cycles ?? 0,
      color: fixed(HEX.blade),
    });
  }
  // The wash lances under the hood's ceiling: they blink amber in the clean and stand orange in the SIP.
  [-2.5, 0, 2.5].forEach((dxM, i) => {
    parts.push({
      machine: id,
      name: `washLance${i + 1}`,
      ratePerS: 1,
      pose(_phase, y, out) {
        out.position.set((at.P8.xMinM + at.P8.xMaxM) / 2 + dxM, 2.285, Z);
        out.rotation.set(0, 0, 0);
        if (state(y) === 'cleaning' || state(y) === 'sterilizing') out.size.set(1.8, 0.014, 0.08);
        else out.size.set(0, 0, 0);
      },
      speed: (y) => (state(y) === 'cleaning' ? 1 : 0),
      color: (y, phase, out) => out.setHex(state(y) === 'sterilizing' ? HEX.warm : state(y) === 'cleaning' && (phase + i / 3) % 1 < 0.5 ? HEX.flash : HEX.off),
    });
  });
  return parts;
}

/* the check gates and the reject bin */

function gateParts(watch: CupRoomWatch): Part[] {
  const parts: Part[] = [];
  const gates = [
    ['p8-checkweigher', at.CHECK_GATES.checkweigher, 'checkweigher'],
    ['p8-metal-detector', at.CHECK_GATES.metalDetector, 'metal'],
    ['p8-vision', at.CHECK_GATES.vision, 'vision'],
  ] as const;
  /** The gates' bodies are 0.7 m deep and their belts 0.4 m. */
  const bodyFrontZM = Z + 0.35;
  for (const [machine, xM, gate] of gates) {
    parts.push({ machine, name: 'beltRoller', ratePerS: 2, pose: rotor(xM + 0.4, 0.73, Z + 0.21, 0.07), speed: p8Rate, color: fixed(HEX.blade) });
    parts.push({
      machine,
      name: 'rejectLamp',
      ratePerS: 0,
      pose: plate(xM - 0.27, 0.6, bodyFrontZM + 0.006, 0.08, 0.08, 0.012),
      speed: still,
      reading: () => (watch.rejecting(gate) ? 1 : 0),
      color: (y, _p, out) => out.setHex(watch.rejecting(gate) ? HEX.bad : p8Running(y) ? HEX.open : HEX.off),
    });
  }
  // Phase 31. The gates' belts carry three rows of four for each of P8's cycles: 1.5 rows a second at full rate.
  const ROWS_PER_S = 1.5;
  const weigherXM = at.CHECK_GATES.checkweigher;
  // The checkweigher's weigh platform, proud of the belt: it dips 4 mm under each row and comes back.
  const dip = (phase: number): number => Math.max(0, Math.sin(phase * TURN));
  parts.push({
    machine: 'p8-checkweigher',
    name: 'weighPlatform',
    ratePerS: ROWS_PER_S,
    pose(phase, _y, out) {
      out.position.set(weigherXM, 0.763 - 0.004 * dip(phase), Z);
      out.rotation.set(0, 0, 0);
      out.size.set(0.5, 0.006, 0.38);
    },
    speed: p8Rate,
    color: fixed(COLOR.steel),
  });
  // Its scale on the body's front: the under limit at its left end, the over limit at its right, a green tick at the
  // target and a red marker at the last cup's weight.
  const scaleM = 0.5;
  const scaleYM = 0.26;
  const onScale = (g: number): number => weigherXM + 0.08 - scaleM / 2 + scaleM * Math.min(1, Math.max(0, (g - P8.fill.underBelowG) / (P8.fill.overAboveG - P8.fill.underBelowG)));
  parts.push(box('p8-checkweigher', 'weighScale', weigherXM + 0.08, scaleYM, bodyFrontZM + 0.004, scaleM + 0.02, 0.05, 0.008, HEX.dial));
  parts.push(box('p8-checkweigher', 'weighTarget', onScale(P8.fill.targetG), scaleYM, bodyFrontZM + 0.009, 0.012, 0.05, 0.004, HEX.open));
  parts.push({
    machine: 'p8-checkweigher',
    name: 'weighMarker',
    ratePerS: 0,
    pose(_phase, y, out) {
      out.position.set(onScale(y.p8.lastFillG ?? P8.fill.targetG), scaleYM, bodyFrontZM + 0.012);
      out.rotation.set(0, 0, 0);
      if (y.p8.lastFillG === null || y.p8.lastFillG === undefined) out.size.set(0, 0, 0);
      else out.size.set(0.016, 0.07, 0.004);
    },
    speed: still,
    reading: (y) => (y.p8.lastFillG === null || y.p8.lastFillG === undefined ? 0 : Math.round(((onScale(y.p8.lastFillG) - (weigherXM + 0.08 - scaleM / 2)) / scaleM) * 1000) / 10),
    color: fixed(HEX.needle),
  });
  // The metal detector: its tunnel's mouths on the arch's two ends, and the search field's bar on its face, a marker
  // sweeping it while the coils search.
  const detectorXM = at.CHECK_GATES.metalDetector;
  const archFrontZM = Z + 0.375;
  for (const [name, dx] of [['tunnelMouthIn', -1], ['tunnelMouthOut', 1]] as const) {
    parts.push(box('p8-metal-detector', name, detectorXM + dx * 0.177, 0.83, Z, 0.006, 0.14, 0.46, HEX.off));
  }
  parts.push(box('p8-metal-detector', 'fieldBar', detectorXM, 1.1, archFrontZM + 0.004, 0.27, 0.06, 0.008, HEX.off));
  parts.push({
    machine: 'p8-metal-detector',
    name: 'fieldSweep',
    ratePerS: 1,
    pose(phase, _y, out) {
      out.position.set(detectorXM + 0.11 * Math.sin(phase * TURN), 1.1, archFrontZM + 0.01);
      out.rotation.set(0, 0, 0);
      out.size.set(0.03, 0.045, 0.004);
    },
    speed: p8Rate,
    color: (y, _p, out) => out.setHex(watch.rejecting('metal') ? HEX.bad : p8Running(y) ? HEX.frost : HEX.metal),
  });
  // The vision check: its strobe under the camera, lit for the first quarter of each row, and its monitor on a post
  // at the gate's out end: blue while it looks, red on a cup it throws out.
  const visionXM = at.CHECK_GATES.vision;
  parts.push({
    machine: 'p8-vision',
    name: 'strobe',
    ratePerS: ROWS_PER_S,
    pose: plate(visionXM, 1.02, Z, 0.42, 0.008, 0.46),
    speed: p8Rate,
    reading: (y) => (p8Running(y) ? 1 : 0),
    color: (y, phase, out) => out.setHex(p8Running(y) && phase % 1 < 0.25 ? 0xffffff : HEX.off),
  });
  parts.push(box('p8-vision', 'monitorPost', visionXM + 0.3, 1.0, bodyFrontZM + 0.05, 0.04, 0.6, 0.04, HEX.metal));
  parts.push({
    machine: 'p8-vision',
    name: 'monitor',
    ratePerS: 0,
    pose: plate(visionXM + 0.3, 1.36, bodyFrontZM + 0.06, 0.26, 0.18, 0.03),
    speed: still,
    color: (y, _p, out) => out.setHex(watch.rejecting('vision') ? HEX.bad : p8Running(y) ? HEX.screen : HEX.screenDark),
  });
  // The reject chute: a trough from under the flap, behind the belt, down to the bin.
  const chute = REJECT_CHUTE;
  const [dx, dy, dz] = [chute.toM[0] - chute.fromM[0], chute.toM[1] - chute.fromM[1], chute.toM[2] - chute.fromM[2]];
  const yawRad = Math.atan2(dx, dz);
  parts.push({
    machine: 'p8-reject-bin',
    name: 'chute',
    ratePerS: 0,
    pose(_phase, _y, out) {
      out.position.set((chute.fromM[0] + chute.toM[0]) / 2, (chute.fromM[1] + chute.toM[1]) / 2, (chute.fromM[2] + chute.toM[2]) / 2);
      // Along its run, then tipped down toward the bin.
      out.rotation.set(-Math.asin(dy / Math.hypot(dx, dy, dz) / Math.cos(yawRad)), yawRad, 0);
      out.size.set(0.24, 0.02, Math.hypot(dx, dy, dz));
    },
    speed: still,
    color: fixed(COLOR.steel),
  });
  // The checkweigher's display: the last cup's weight, green inside its limits and red outside them.
  parts.push({
    machine: 'p8-checkweigher',
    name: 'weighDisplay',
    ratePerS: 0,
    pose: plate(at.CHECK_GATES.checkweigher + 0.08, 0.45, bodyFrontZM + 0.005, 0.36, 0.16, 0.01),
    speed: still,
    reading: (y) => y.p8.lastFillG ?? 0,
    color(y, _p, out) {
      const ok = fillInLimits(y.p8);
      return out.setHex(ok === null ? HEX.screenDark : ok ? HEX.open : HEX.bad);
    },
  });
  // The rejected cups, heaped on the bin: 2 mm a cup, up to 0.3 m.
  const heapM = (y: YogurtSnapshot): number => (y.p8.cupsRejected > 0 ? Math.min(0.3, 0.02 + 0.002 * y.p8.cupsRejected) : 0);
  parts.push({
    machine: 'p8-reject-bin',
    name: 'heap',
    ratePerS: 0,
    pose(_phase, y, out) {
      const h = heapM(y);
      out.position.set(at.REJECT_BIN.xM, 0.6 + h / 2, at.REJECT_BIN.zM);
      out.rotation.set(0, 0, 0);
      if (h > 0) out.size.set(0.66, h, 0.46);
      else out.size.set(0, 0, 0);
    },
    speed: still,
    reading: (y) => y.p8.cupsRejected,
    color: fixed(COLOR.cup),
  });
  return parts;
}

/* the room */

function supplyParts(watch: CupRoomWatch): Part[] {
  const parts: Part[] = [];
  const id = 'p8-filler';
  // The cup cartons on their pallet: three along x by two along z in a layer, the top layer taken first.
  const pallet = CUP_PALLET;
  const [cx, cy, cz] = pallet.cartonM;
  parts.push(box(id, 'cupPallet', pallet.xM, FLOOR_M + 0.07, pallet.zM, 1.2, 0.14, 0.8, COLOR.wood));
  for (let i = 0; i < pallet.layers * pallet.perLayer; i++) {
    const layer = Math.floor(i / pallet.perLayer);
    const k = i % pallet.perLayer;
    const xM = pallet.xM + ((k % 3) - 1) * (cx + 0.01);
    const zM = pallet.zM + (Math.floor(k / 3) - 0.5) * (cz + 0.01);
    parts.push({
      machine: id,
      name: `cupCarton${i + 1}`,
      ratePerS: 0,
      pose(_phase, _y, out) {
        out.position.set(xM, FLOOR_M + 0.14 + (layer + 0.5) * cy, zM);
        out.rotation.set(0, 0, 0);
        if (i < watch.cupCartons) out.size.set(cx, cy - 0.01, cz);
        else out.size.set(0, 0, 0);
      },
      speed: still,
      ...(i === 0 ? { reading: () => watch.cupCartons } : {}),
      color: fixed(COLOR.carton),
    });
  }
  // The foil boxes on their cart: three stacks along x, the top of each taken first.
  const cart = FOIL_CART;
  const [fx, fy, fz] = cart.boxM;
  const deckM = FLOOR_M + 0.5;
  parts.push(box(id, 'foilCartDeck', cart.xM, deckM - 0.02, cart.zM, 0.8, 0.04, 0.45, COLOR.steel));
  parts.push(box(id, 'foilCartFrame', cart.xM, FLOOR_M + (deckM - 0.04 - FLOOR_M) / 2, cart.zM, 0.7, deckM - 0.04 - FLOOR_M, 0.06, HEX.metal));
  parts.push(box(id, 'foilCartHandle', cart.xM + 0.42, deckM + 0.2, cart.zM, 0.03, 0.44, 0.4, HEX.metal));
  for (let i = 0; i < cart.stacks * cart.perStack; i++) {
    const level = Math.floor(i / cart.stacks);
    const stack = i % cart.stacks;
    parts.push({
      machine: id,
      name: `foilBox${i + 1}`,
      ratePerS: 0,
      pose(_phase, _y, out) {
        out.position.set(cart.xM + (stack - 1) * (fx + 0.02), deckM + (level + 0.5) * fy, cart.zM);
        out.rotation.set(0, 0, 0);
        if (i < watch.foilBoxes) out.size.set(fx, fy - 0.01, fz);
        else out.size.set(0, 0, 0);
      },
      speed: still,
      ...(i === 0 ? { reading: () => watch.foilBoxes } : {}),
      color: fixed(COLOR.foilBox),
    });
  }
  return parts;
}

/** The operator: a white coat and a hairnet, at the screen or walking along the machine's aisle side to a magazine. */
function operatorParts(): Part[] {
  const id = 'p8-filler';
  const spanM = OPERATOR.screenXM - OPERATOR.cupsXM;
  // The body leads: its phase is how far the operator stands from the screen toward the de-nester, 0–1, and the legs
  // and the head after it stand where it left them this frame.
  let xM: number = OPERATOR.screenXM;
  let walking = 0;
  const feetM = FLOOR_M;
  const turn = (): number => (walking * Math.PI) / 2;
  const limb = (name: string, yM: number, sx: number, sy: number, sz: number, hex: number, swingM = 0): Part => ({
    machine: id,
    name,
    ratePerS: 0,
    pose(_phase, _y, out) {
      // Standing, the legs are side by side along the machine; walking, they swing along it, a stride every 1.4 m.
      const side = Math.sign(swingM);
      out.position.set(xM + side * 0.09 * (1 - walking) + swingM * walking * Math.sin((xM / 1.4) * TURN), yM, OPERATOR.zM + side * 0.09 * walking);
      out.rotation.set(0, turn(), 0);
      out.size.set(sx, sy, sz);
    },
    speed: still,
    color: fixed(hex),
  });
  const body: Part = {
    machine: id,
    name: 'operator',
    ratePerS: OPERATOR.walkMPerS / spanM,
    pose(phase, y, out) {
      xM = OPERATOR.screenXM - phase * spanM;
      // Turned along the aisle while more than a step from the station, square to the machine once there.
      walking = Math.min(1, Math.abs(operatorStationXM(y) - xM) / 0.4);
      out.position.set(xM, feetM + 1.12, OPERATOR.zM);
      out.rotation.set(0, turn(), 0);
      out.size.set(0.4, 0.62, 0.22);
    },
    speed: still,
    target: (y) => (OPERATOR.screenXM - operatorStationXM(y)) / spanM,
    reading: () => Math.round(xM * 100) / 100,
    color: fixed(COLOR.coat),
  };
  return [
    body,
    limb('operatorLegLeft', feetM + 0.405, 0.14, 0.81, 0.15, COLOR.trousers, 0.16),
    limb('operatorLegRight', feetM + 0.405, 0.14, 0.81, 0.15, COLOR.trousers, -0.16),
    limb('operatorHead', feetM + 1.55, 0.19, 0.22, 0.19, COLOR.skin),
    limb('operatorHairnet', feetM + 1.69, 0.21, 0.07, 0.21, COLOR.hairnet),
  ];
}

function utilityParts(): Part[] {
  const parts: Part[] = [];
  const id = 'p8-filler';
  // The sterile air unit: its cabinet, two fans on its top, the duct up and across to the HEPA housing's back.
  const unit = AIR_UNIT;
  const [ux, uy, uz] = unit.sizeM;
  const housingMidM = 2.43;
  parts.push(box(id, 'airUnit', unit.xM, FLOOR_M + uy / 2, unit.zM, ux, uy, uz, COLOR.steel));
  parts.push(box(id, 'airUnitIntake', unit.xM - 0.25, FLOOR_M + uy + 0.01, unit.zM, 0.5, 0.02, 0.5, HEX.off));
  for (const [suffix, offset] of [['', 0], ['Cross', 0.25]] as const) {
    parts.push({
      machine: id,
      name: `airUnitFan${suffix}`,
      ratePerS: 2.5,
      easeS: 1.5,
      pose: blade(unit.xM - 0.25, FLOOR_M + uy + 0.035, unit.zM, 0.44, 0.06, offset),
      speed: (y) => ((y.p8.hepaPa ?? P8.hepa.normalPa) >= P8.hepa.minPa ? 1 : 0),
      color: fixed(HEX.blade),
    });
  }
  const riserFootM = FLOOR_M + uy;
  const riserTopM = housingMidM + 0.13;
  parts.push(box(id, 'airDuctRiser', unit.ductXM, (riserFootM + riserTopM) / 2, unit.zM, 0.36, riserTopM - riserFootM, 0.36, COLOR.duct));
  const ductFromZM = unit.zM + 0.18;
  const ductToZM = Z - 0.6;
  parts.push(box(id, 'airDuct', unit.ductXM, housingMidM, (ductFromZM + ductToZM) / 2, 0.36, 0.26, ductToZM - ductFromZM, COLOR.duct));
  // The CIP/SIP skid: its frame, the two valves on its top, its line to the machine and its display on a post.
  const skid = CIP_SKID;
  parts.push(box(id, 'cipSkid', skid.xM, FLOOR_M + 0.25, skid.zM, 1.0, 0.5, 0.6, HEX.metal));
  for (const [name, xM, how] of [['cipValve', skid.cipValveXM, 'clean'], ['steamValve', skid.steamValveXM, 'warm']] as const) {
    parts.push(box(id, `${name}Body`, xM, FLOOR_M + 0.57, skid.zM, 0.14, 0.14, 0.14, COLOR.steel));
    parts.push(box(id, `${name}Actuator`, xM, FLOOR_M + 0.72, skid.zM, 0.1, 0.16, 0.1, COLOR.steel));
    parts.push(valveStem(id, name, [xM, FLOOR_M + 0.835, skid.zM], (y) => (state(y) === (how === 'clean' ? 'cleaning' : 'sterilizing') ? how : null)));
  }
  const lineFromZM = skid.zM + 0.3;
  parts.push(box(id, 'cipLine', skid.xM, 0.3, (lineFromZM + (Z - 0.6)) / 2, 0.08, 0.08, Z - 0.6 - lineFromZM, COLOR.steel));
  parts.push(box(id, 'sipDisplayPost', skid.xM, FLOOR_M + 0.8, skid.zM + 0.33, 0.05, 0.6, 0.05, HEX.metal));
  parts.push({
    machine: id,
    name: 'sipDisplay',
    ratePerS: 0,
    pose: plate(skid.xM, FLOOR_M + 1.2, skid.zM + 0.34, 0.32, 0.2, 0.03),
    speed: still,
    reading: (y) => (state(y) === 'sterilizing' ? P8.sip.runC : 0),
    color: (y, _p, out) => (state(y) === 'sterilizing' ? wingTempColor(P8.sip.runC, out) : out.setHex(state(y) === 'cleaning' ? HEX.flash : HEX.screenDark)),
  });
  return parts;
}

function qaBenchParts(watch: CupRoomWatch): Part[] {
  const parts: Part[] = [];
  const id = 'p8-filler';
  const bench = QA_BENCH;
  const [bx, bz] = bench.sizeM;
  const topM = FLOOR_M + bench.topM;
  const frontZM = bench.zM + bz / 2;
  parts.push(box(id, 'qaBenchTop', bench.xM, topM - 0.025, bench.zM, bx, 0.05, bz, COLOR.steel));
  for (const dx of [-1, 1]) parts.push(box(id, `qaBenchLeg${dx < 0 ? 'West' : 'East'}`, bench.xM + dx * (bx / 2 - 0.04), FLOOR_M + (bench.topM - 0.05) / 2, bench.zM, 0.06, bench.topM - 0.05, bz - 0.08, HEX.metal));
  // The seal tester: a vacuum chamber, its lamp for the last test and the bar that fills as the next comes due.
  const testerXM = bench.xM - 0.4;
  parts.push(box(id, 'sealTester', testerXM, topM + 0.14, bench.zM - 0.05, 0.44, 0.28, 0.36, COLOR.duct));
  parts.push({
    machine: id,
    name: 'sealTestLamp',
    ratePerS: 0,
    pose: plate(testerXM + 0.15, topM + 0.3, bench.zM - 0.05, 0.08, 0.04, 0.08),
    speed: still,
    reading: () => (watch.lastSealTest === 'passed' ? 1 : watch.lastSealTest === 'failed' ? -1 : 0),
    color: (_y, _p, out) => out.setHex(watch.lastSealTest === 'passed' ? HEX.open : watch.lastSealTest === 'failed' ? HEX.bad : HEX.off),
  });
  const barM = 0.36;
  parts.push(box(id, 'sealTestDueBacking', testerXM, topM + 0.07, bench.zM + 0.132, barM + 0.02, 0.06, 0.006, HEX.off));
  parts.push({
    machine: id,
    name: 'sealTestDue',
    ratePerS: 0,
    pose(_phase, _y, out) {
      const w = barM * watch.sealTestDueFrac;
      out.position.set(testerXM - barM / 2 + w / 2, topM + 0.07, bench.zM + 0.137);
      out.rotation.set(0, 0, 0);
      out.size.set(w, 0.04, 0.006);
    },
    speed: still,
    reading: () => Math.round(watch.sealTestDueFrac * 1000) / 10,
    color: fixed(HEX.screen),
  });
  // The cups the last test took, in a row beside the tester.
  for (let i = 0; i < P8.sealTest.cups; i++) {
    parts.push({
      machine: id,
      name: `sampleCup${i + 1}`,
      ratePerS: 0,
      pose(_phase, _y, out) {
        out.position.set(bench.xM + 0.02 + i * 0.1, topM + at.CUP_M.heightM / 2, bench.zM + 0.1);
        out.rotation.set(0, 0, 0);
        if (watch.samplesOut) out.size.set(0.065, at.CUP_M.heightM, 0.065);
        else out.size.set(0, 0, 0);
      },
      speed: still,
      ...(i === 0 ? { reading: () => (watch.samplesOut ? P8.sealTest.cups : 0) } : {}),
      color: fixed(COLOR.cup),
    });
  }
  // A bench scale for the weight checks, its display dark.
  parts.push(box(id, 'qaScale', bench.xM + 0.5, topM + 0.03, bench.zM - 0.08, 0.26, 0.06, 0.26, HEX.metal));
  parts.push(box(id, 'qaScaleDisplay', bench.xM + 0.5, topM + 0.05, frontZM - 0.06, 0.2, 0.08, 0.03, HEX.screenDark));
  return parts;
}

function hygieneParts(): Part[] {
  const parts: Part[] = [];
  const id = 'p8-filler';
  const { xMinM, xMaxM, zMinM, zMaxM, gapXM } = HYGIENE_LINE;
  const lineM = 0.06;
  const yM = FLOOR_M + 0.004;
  const strip = (name: string, fromXM: number, toXM: number, fromZM: number, toZM: number): Part =>
    box(id, name, (fromXM + toXM) / 2, yM, (fromZM + toZM) / 2, Math.max(lineM, toXM - fromXM), 0.008, Math.max(lineM, toZM - fromZM), COLOR.line);
  parts.push(strip('hygieneLineNorth', xMinM, xMaxM, zMinM, zMinM));
  parts.push(strip('hygieneLineWest', xMinM, xMinM, zMinM, zMaxM));
  parts.push(strip('hygieneLineEast', xMaxM, xMaxM, zMinM, zMaxM));
  parts.push(strip('hygieneLineSouthWest', xMinM, gapXM[0], zMaxM, zMaxM));
  parts.push(strip('hygieneLineSouthEast', gapXM[1], xMaxM, zMaxM, zMaxM));
  // At the gap: the sticky mat in it, the step-over bench west of it, the basin east of it and the locker outside.
  const gapMidM = (gapXM[0] + gapXM[1]) / 2;
  parts.push(box(id, 'stickyMat', gapMidM, FLOOR_M + 0.006, zMaxM, gapXM[1] - gapXM[0] - 0.1, 0.012, 0.8, COLOR.mat));
  parts.push(box(id, 'stepOverBench', gapXM[0] - 0.9, FLOOR_M + 0.2, zMaxM, 1.6, 0.4, 0.4, COLOR.bench));
  const basinXM = gapXM[1] + 0.8;
  parts.push(box(id, 'handWashBasin', basinXM, FLOOR_M + 0.42, zMaxM + 0.5, 0.6, 0.84, 0.45, COLOR.steel));
  parts.push(box(id, 'handWashBowl', basinXM, FLOOR_M + 0.845, zMaxM + 0.5, 0.44, 0.012, 0.3, HEX.off));
  parts.push(box(id, 'handWashTap', basinXM, FLOOR_M + 0.96, zMaxM + 0.32, 0.04, 0.22, 0.04, HEX.metal));
  parts.push(box(id, 'gownLocker', gapXM[0] - 2.6, FLOOR_M + 0.9, zMaxM + 0.9, 0.9, 1.8, 0.45, COLOR.duct));
  return parts;
}

/**
 * The cup filling room's parts, following Line P8's carrier for the strokes (none given: the stations stand at rest).
 * The watch counts the refills, rejects and seal tests; a test may hand in its own.
 */
export function cupRoomParts(carrier?: P8Carrier, watch: CupRoomWatch = createCupRoomWatch()): Part[] {
  return [...machineParts(carrier, watch), ...gateParts(watch), ...supplyParts(watch), ...operatorParts(), ...utilityParts(), ...qaBenchParts(watch), ...hygieneParts()];
}

/** Exported for the tests: where the parts stand against the machine. */
export const CUP_ROOM_FACES = { hoodFrontZM: HOOD_FRONT_Z_M, hoodBackZM: HOOD_BACK_Z_M, cabinetFrontZM: CABINET_FRONT_Z_M, floorM: FLOOR_M } as const;
