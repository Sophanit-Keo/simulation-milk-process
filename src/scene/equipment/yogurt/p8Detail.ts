// Line P8 in more detail (phase 28): what its model (assets' p8Filler) does not move or light, drawn as instances in
// the shared box mesh with the wing's other moving parts (wingMotion.ts), so they cost no draw call.
// - The de-nester's suction bar strokes down once a cycle in the carrier's dwell, as the pistons do, and sets a cup
//   from each magazine into the pockets under it.
// - The HEPA hood's three fans turn on its filter housing while the cabin holds its overpressure; they run down and
//   stand once it falls under its limit (the HEPA loss, D30).
// - A level bar on the de-nester's upright shows the cup magazines' fill, and one on the foil magazine its foils:
//   green, amber once under the refill mark.
// - The sealing heads' display is green while the seal is inside its window, red outside it (the seal drift).
// - The stack light over the out end: green while P8 runs, amber while it waits, cleans or sterilizes, red when stopped.
// - The operator's screen on the cabinet's aisle side lights with its state.
// Places are the model's (P8_LAYOUT in make-heroes.mjs), round the machine's middle at x 6.5, z −47.
import type { P8Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import * as at from './layout';
import { fixed, HEX, plate, still, type Part } from './motionParts';
import { stroke, type P8Carrier } from './p8Machine';

const P8 = plantJson.yogurt.p8;
/** The model's origin: the middle of P8's cabinet, on the floor. */
const ORIGIN = { xM: (at.P8.xMinM + at.P8.xMaxM) / 2, zM: at.P8.zM } as const;
const LANE_HALF_M = ((P8.lanes - 1) * at.P8_CARRIER.lanePitchM) / 2;
/** The de-nester's suction bar: at rest just under its rail, and how far it strokes down to the cups' tops. */
const DENESTER = { restYM: 1.21, strokeM: 0.09 } as const;
/** Its stroke in the carrier's dwell, ahead of the pistons' (0.1–0.75, p8Machine.ts). */
const DENESTER_DWELL = [0.05, 0.55] as const;
/** The stack light's lamps, lit and dark: red on top, amber, green at the foot. */
const STACK = {
  red: [HEX.bad, 0x4a2622],
  amber: [HEX.flash, 0x4a4226],
  green: [HEX.open, 0x21402a],
} as const;

const p8Of = (y: YogurtSnapshot): P8Snapshot => y.p8;
/** The cabin holds its overpressure: the hood's fans run. A snapshot without the reading counts as holding. */
export const hepaHolds = (y: YogurtSnapshot): boolean => (p8Of(y).hepaPa ?? P8.hepa.normalPa) >= P8.hepa.minPa;
/** The seal inside its window on all three of temperature, time and pressure. */
export function sealInWindow(seal: P8Snapshot['seal']): boolean {
  if (!seal) return true;
  const s = P8.seal;
  return seal.tempC >= s.minTempC && seal.tempC <= s.maxTempC && seal.timeS >= s.minTimeS && seal.timeS <= s.maxTimeS && seal.bar >= s.minBar && seal.bar <= s.maxBar;
}
/** Which of the stack light's lamps is lit for P8's state, or none while it stands ready. */
export function stackLamp(state: P8Snapshot['state']): keyof typeof STACK | null {
  if (state === 'running') return 'green';
  if (state === 'stopped') return 'red';
  if (state === 'idle') return null;
  return 'amber';
}

/** A level bar on a face to the aisle (+z): its dark backing, and the bar from its foot up to `frac` of its height. */
function levelBar(name: string, xM: number, footM: number, heightM: number, zM: number, widthM: number, frac: (y: YogurtSnapshot) => number): Part[] {
  const refillFrac = P8.magazines.refillBelowFrac;
  return [
    { machine: 'p8-filler', name: `${name}Backing`, ratePerS: 0, pose: plate(xM, footM + heightM / 2, zM, widthM + 0.012, heightM + 0.012, 0.004), speed: still, color: fixed(HEX.off) },
    {
      machine: 'p8-filler',
      name,
      ratePerS: 0,
      pose(_phase, y, out) {
        const h = heightM * Math.min(1, Math.max(0, frac(y)));
        out.position.set(xM, footM + h / 2, zM + 0.004);
        out.rotation.set(0, 0, 0);
        out.size.set(widthM, h, 0.004);
      },
      speed: still,
      reading: (y) => Math.round(frac(y) * 1000) / 10,
      color: (y, _p, out) => out.setHex(frac(y) > refillFrac ? HEX.open : HEX.flash),
    },
  ];
}

/** Line P8's parts, following its carrier for the de-nester's stroke (none given: the bar stays at rest). */
export function p8DetailParts(carrier?: P8Carrier): Part[] {
  const parts: Part[] = [];
  const wx = (modelXM: number): number => ORIGIN.xM + modelXM;
  const front = (modelZM: number): number => ORIGIN.zM + modelZM;
  // The de-nester's suction bar, across the 12 lanes under the magazines.
  const denesterStroke = (): number => (carrier?.running ? stroke(carrier.dwellFrac(), ...DENESTER_DWELL) : 0);
  parts.push({
    machine: 'p8-filler',
    name: 'denesterBar',
    ratePerS: 0,
    pose(_phase, _y, out) {
      out.position.set(at.P8_STATIONS.denesterXM, DENESTER.restYM - DENESTER.strokeM * denesterStroke(), ORIGIN.zM);
      out.rotation.set(0, 0, 0);
      out.size.set(0.08, 0.025, 2 * LANE_HALF_M + 0.12);
    },
    speed: still,
    reading: () => Math.round(denesterStroke() * 1000) / 1000,
    color: fixed(HEX.blade),
  });
  // The HEPA hood's fans on its filter housing's three fan boxes (the model's x −3, 0 and 3, their tops at 2.6 m).
  [-3, 0, 3].forEach((modelXM, i) => {
    for (const [suffix, offset] of [['', 0], ['Cross', 0.25]] as const) {
      parts.push({
        machine: 'p8-filler',
        name: `hepaFan${i + 1}${suffix}`,
        ratePerS: 2.5,
        easeS: 1.5,
        pose(phase, _y, out) {
          out.position.set(wx(modelXM), 2.612, ORIGIN.zM);
          out.rotation.set(0, (phase + offset + i * 0.13) * Math.PI * 2, 0);
          out.size.set(0.62, 0.012, 0.07);
        },
        speed: (y) => (hepaHolds(y) ? 1 : 0),
        color: fixed(HEX.blade),
      });
    }
  });
  // The magazines' levels: the cups' on the de-nester's upright on the aisle side, the foils' on the foil magazine.
  const cupsFrac = (y: YogurtSnapshot): number => (p8Of(y).magazines?.cupsPct ?? 100) / 100;
  const foilsFrac = (y: YogurtSnapshot): number => (p8Of(y).magazines?.foilsPct ?? 100) / 100;
  parts.push(...levelBar('cupMagazineLevel', at.P8_STATIONS.denesterXM, 1.08, 0.9, front(LANE_HALF_M + 0.154), 0.05, cupsFrac));
  parts.push(...levelBar('foilMagazineLevel', at.P8_STATIONS.foilXM + 0.1, 1.6, 0.22, front(LANE_HALF_M + 0.1 + 0.004), 0.04, foilsFrac));
  // The sealing heads' display on their housing's aisle side.
  parts.push({
    machine: 'p8-filler',
    name: 'sealDisplay',
    ratePerS: 0,
    pose: plate(at.P8_STATIONS.sealerXM - 0.05, 1.69, front(LANE_HALF_M + 0.1 + 0.004), 0.16, 0.08, 0.006),
    speed: still,
    reading: (y) => p8Of(y).seal?.tempC ?? P8.seal.tempC,
    color: (y, _p, out) => out.setHex(p8Of(y).seal === undefined ? HEX.screenDark : sealInWindow(p8Of(y).seal) ? HEX.open : HEX.bad),
  });
  // The stack light over the out end, on the filter housing: its pole, then green, amber and red up it.
  const stack = { xM: wx(4.3), zM: front(0.45), footM: 2.56 };
  parts.push({ machine: 'p8-filler', name: 'stackPole', ratePerS: 0, pose: plate(stack.xM, stack.footM + 0.05, stack.zM, 0.03, 0.1, 0.03), speed: still, color: fixed(HEX.metal) });
  (['green', 'amber', 'red'] as const).forEach((lamp, i) => {
    parts.push({
      machine: 'p8-filler',
      name: `stack${lamp[0]?.toUpperCase()}${lamp.slice(1)}`,
      ratePerS: 0,
      pose: plate(stack.xM, stack.footM + 0.14 + i * 0.085, stack.zM, 0.08, 0.08, 0.08),
      speed: still,
      color: (y, _p, out) => out.setHex(STACK[lamp][stackLamp(p8Of(y).state) === lamp ? 0 : 1]),
    });
  });
  // The operator's screen on the cabinet's aisle side (the model's HMI, x 3.25–3.75, y 0.6–0.82).
  parts.push({
    machine: 'p8-filler',
    name: 'screen',
    ratePerS: 0,
    pose: plate(wx(3.5), 0.71, front(0.629), 0.46, 0.2, 0.006),
    speed: still,
    color: (y, _p, out) => {
      const lamp = stackLamp(p8Of(y).state);
      return out.setHex(lamp === 'green' ? HEX.screen : lamp === 'red' ? HEX.bad : lamp === 'amber' ? HEX.flash : HEX.screenDark);
    },
  });
  return parts;
}
