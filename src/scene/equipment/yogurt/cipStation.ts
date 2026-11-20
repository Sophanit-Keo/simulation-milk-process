// The yogurt wing's CIP station (phase 32, D34): a tank each for the rinse water, the lye and the acid, and a lane for each
// of its three circuits (the heat treatment, the fermentation tanks, the buffer and P8), cipCircuits.ts reading what each
// circulates from the snapshot. Its steel shell joins the reprocess tank's meshes, which stand beside it in stage 12
// (cipStationShell, yogurtLine.ts), and its coloured and moving parts are instances in the wing's shared box mesh
// (wingMotion.ts): the station costs no draw call. Its lines are pipes.ts's, merged into a yogurt run.
//
// - Each tank wears a plate in its fluid's colour, and a lamp on its dome lights while a circuit draws its fluid or sends
//   its return back to it.
// - Each lane's supply pump turns while its circuit runs, spinning up and down over a second; its heater's strip shows
//   the step's temperature in the pipes' colours, and a bar beside it the return's conductivity in the step's fluid.
// - Each lane's change-over valve has a stem on its way back to the tanks and one on its way to the drain: the one the
//   return takes lifts, in the colour of what it carries, and the drain splashes while a return runs to it.
// - The cabinet's screen is lit while any circuit runs, and a lamp for each circuit glows amber while it does.
// - The tanks' CIP header and each tank's drop carry the fluid of the tank they clean; a cleaning tank's sight glass shows
//   the fluid streaming down its inside (wingMotion.ts lists those with the tanks' other parts).
import * as THREE from 'three';
import type { CleaningFluid, CleaningReturn, Snapshot, YogurtSnapshot } from '../../../contracts';
import { cipLabelFluid } from '../utilities';
import type { MachineBuilder } from '../liquid/builder';
import type { Equipment } from '../types';
import { CIP_CIRCUIT_IDS, cipCircuits, type CipCircuitId, type CipCircuitState, tankCipFluid } from './cipCircuits';
import * as at from './layout';
import { fixed, HEX, plate, rotor, still, TURN, wingTempColor, type Part } from './motionParts';
import { yogurtOf } from './readings';

export const CIP_STATION_ID = 'yogurt-cip';

/** Each cleaning fluid's colour: the pipes' tokens (tokens.css --clean-water, --clean-lye, --clean-acid). */
export const FLUID_HEX: Readonly<Record<CleaningFluid, number>> = { water: 0x8fb4c8, lye: 0x7d5cc6, acid: 0xc2479a };
/** The tanks along the back, west to east, by the fluid each holds. */
export const CIP_TANK_FLUIDS: readonly CleaningFluid[] = ['water', 'lye', 'acid'];
const TANK_OF_RETURN: Readonly<Record<Exclude<CleaningReturn, 'drain'>, CleaningFluid>> = { waterTank: 'water', lyeTank: 'lye', acidTank: 'acid' };

/** The return's conductivity the station's bars read at full height, mS/cm: a little over the lye's 84.2. */
export const CONDUCTIVITY_FULL_MS_PER_CM = 90;
/** Turns a second of a supply pump's rotor at full speed, and how long it takes to spin up or run down. */
const PUMP_TURNS_PER_S = 3;
const PUMP_EASE_S = 1;

const S = at.CIP_STATION;
const laneX = (i: number): number => S.laneXsM[i] ?? 0;
const tankX = (i: number): number => S.tankXsM[i] ?? 0;
const tankTopM = S.tankLegsM + S.tankBodyM;
/** The return valve's back and front, where its way to the tanks and its way to the drain leave it. */
const VALVE_HALF_M = 0.07;
const TANK_RETURN_HEADER_Z_M = S.tankZM + S.tankRadiusM + 0.2;

/* the steel shell, joined to the reprocess tank's meshes */

/**
 * The station's steel and dark steel (D34), drawn into the reprocess tank's builder: its steel casts shadows as the
 * tank's does, its dark steel none, so the station adds no mesh. Positions are world metres.
 */
export function cipStationShell(b: MachineBuilder): void {
  const r = S.tankRadiusM;
  for (const [i] of CIP_TANK_FLUIDS.entries()) {
    const x = tankX(i);
    b.legs([x, S.tankZM], r * 0.7, S.tankLegsM, 4, 0.04);
    b.part('cyl', 'steel', [x, S.tankLegsM + S.tankBodyM / 2, S.tankZM], [r, S.tankBodyM, r], { castShadow: true });
    b.part('dome', 'steel', [x, tankTopM, S.tankZM], [r, S.tankDomeM, r], { castShadow: true });
    // The manway on the dome, the outlet down to the supply header, and the return's stub in from the header in front.
    b.part('cylLo', 'steel', [x - 0.12, tankTopM + S.tankDomeM * 0.75, S.tankZM - 0.08], [0.12, 0.05, 0.12], { castShadow: true });
    b.part('cylLo', 'steelDark', [x, S.tankLegsM / 2 + 0.09, S.tankZM + 0.3], [0.035, S.tankLegsM - 0.18, 0.035]);
    b.part('cylLo', 'steelDark', [x, S.valveYM, (S.tankZM + r * 0.75 + TANK_RETURN_HEADER_Z_M) / 2], [0.035, TANK_RETURN_HEADER_Z_M - (S.tankZM + r * 0.75), 0.035], {
      rotationRad: [Math.PI / 2, 0, 0],
    });
  }
  // The supply header under the tanks' outlets, feeding each lane's pump; the return header over it, from the valves
  // back into the tanks.
  const westM = Math.min(...S.laneXsM, ...S.tankXsM) - 0.4;
  const eastM = Math.max(...S.laneXsM, ...S.tankXsM) + 0.4;
  const headerZM = S.tankZM + 0.3;
  b.part('cylLo', 'steelDark', [(westM + eastM) / 2, 0.18, headerZM], [0.045, eastM - westM, 0.045], { rotationRad: [0, 0, Math.PI / 2] });
  b.part('cylLo', 'steelDark', [(westM + eastM) / 2, S.valveYM, TANK_RETURN_HEADER_Z_M], [0.04, eastM - westM, 0.04], { rotationRad: [0, 0, Math.PI / 2] });
  for (const [i] of CIP_CIRCUIT_IDS.entries()) {
    const x = laneX(i);
    // The pump, in front of the heater so its rotor shows to the aisle: its base, its motor behind it, its casing; the
    // suction from the header past the heater's side.
    b.part('box', 'steelDark', [x, 0.03, S.pumpZM - 0.12], [0.3, 0.06, 0.5]);
    b.part('cylLo', 'steelDark', [x, 0.25, S.pumpZM - 0.24], [0.1, 0.24, 0.1], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('cylLo', 'steel', [x, 0.25, S.pumpZM], [0.15, 0.12, 0.15], { rotationRad: [Math.PI / 2, 0, 0], castShadow: true });
    b.part('cylLo', 'steelDark', [x - 0.27, 0.18, (headerZM + S.pumpZM) / 2], [0.035, S.pumpZM - headerZM, 0.035], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('cylLo', 'steelDark', [x - 0.135, 0.18, S.pumpZM], [0.035, 0.27, 0.035], { rotationRad: [0, 0, Math.PI / 2] });
    // The pump's discharge back into the heater's foot, beside its strips; the heater, a plate pack between its frame's
    // end plates.
    const heaterFrontZM = S.heaterZM + 0.11;
    b.part('cylLo', 'steelDark', [x + 0.2, 0.25, (S.pumpZM + heaterFrontZM) / 2], [0.035, S.pumpZM - heaterFrontZM, 0.035], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('box', 'steel', [x, (S.heaterTopM - 0.05) / 2 + 0.05, S.heaterZM], [0.34, S.heaterTopM - 0.1, 0.22], { castShadow: true });
    for (const dx of [-1, 1]) b.part('box', 'steelDark', [x + dx * 0.19, (S.heaterTopM + 0.04) / 2, S.heaterZM], [0.04, S.heaterTopM + 0.04, 0.26]);
    // The supply's stub out of the heater's top, where its line starts.
    b.part('cylLo', 'steelDark', [x + S.supplyDxM, S.heaterTopM - 0.04, S.heaterZM], [0.045, 0.1, 0.045]);
    // The change-over valve on the return: its body, its way back to the tanks and its way to the drain.
    const vx = x + S.returnDxM;
    b.part('box', 'steelDark', [vx, S.valveYM, S.valveZM], [2 * VALVE_HALF_M, 2 * VALVE_HALF_M, 2 * VALVE_HALF_M]);
    const backLengthM = S.valveZM - VALVE_HALF_M - TANK_RETURN_HEADER_Z_M;
    b.part('cylLo', 'steelDark', [vx, S.valveYM, TANK_RETURN_HEADER_Z_M + backLengthM / 2], [0.035, backLengthM, 0.035], { rotationRad: [Math.PI / 2, 0, 0] });
    const frontToM = S.drain.zM;
    b.part('cylLo', 'steelDark', [vx, S.valveYM, (S.valveZM + VALVE_HALF_M + frontToM) / 2], [0.035, frontToM - S.valveZM - VALVE_HALF_M, 0.035], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('cylLo', 'steelDark', [vx, (S.valveYM + 0.04) / 2, frontToM], [0.035, S.valveYM - 0.04, 0.035]);
    // Each way's actuator, where its stem stands (cipStationParts).
    for (const dz of [-1, 1]) b.part('box', 'steelDark', [vx, S.valveYM + 0.09, S.valveZM + dz * 0.2], [0.07, 0.1, 0.07]);
  }
  // The drain's grating, and the control cabinet at the east end.
  const { drain, cabinet } = S;
  b.part('box', 'steelDark', [(drain.xMinM + drain.xMaxM) / 2, 0.012, drain.zM], [drain.xMaxM - drain.xMinM, 0.024, drain.widthM]);
  b.part('box', 'steel', [cabinet.xM, cabinet.heightM / 2, cabinet.zM], [cabinet.widthM, cabinet.heightM, cabinet.depthM], { castShadow: true });
}

/* the coloured and moving parts, in the wing's shared box mesh */

/** Is `fluid`'s tank in use now: a circuit draws it, or sends its return back to it? */
export function tankInUse(circuits: Readonly<Record<CipCircuitId, CipCircuitState>>, fluid: CleaningFluid): boolean {
  return CIP_CIRCUIT_IDS.some((id) => {
    const each = circuits[id];
    if (!each.running) return false;
    if (each.fluid === fluid) return true;
    return each.returnTo !== null && each.returnTo !== 'drain' && TANK_OF_RETURN[each.returnTo] === fluid;
  });
}

/** Where a circuit's return goes now: back to a tank (that tank's fluid), to the drain, or nowhere while it stands. */
function returnWay(each: CipCircuitState): { to: 'tank' | 'drain' | null; fluid: CleaningFluid | null } {
  if (!each.running || each.returnTo === null) return { to: null, fluid: null };
  if (each.returnTo === 'drain') return { to: 'drain', fluid: each.fluid };
  return { to: 'tank', fluid: TANK_OF_RETURN[each.returnTo] };
}

/**
 * The station's parts. The snapshot's circuits are read once a frame, by the first part (`observe`), since each part asks
 * with the yogurt snapshot alone.
 */
export function cipStationParts(): Part[] {
  const id = CIP_STATION_ID;
  let circuits: Record<CipCircuitId, CipCircuitState> | null = null;
  let seen: YogurtSnapshot | null = null;
  const now = (y: YogurtSnapshot): Record<CipCircuitId, CipCircuitState> => {
    if (y !== seen || !circuits) {
      seen = y;
      circuits = cipCircuits(y);
    }
    return circuits;
  };
  const parts: Part[] = [];
  const frontZ = S.tankZM + S.tankRadiusM;
  // The tanks: a plate in each one's colour on its front, and its lamp on the dome.
  CIP_TANK_FLUIDS.forEach((fluid, i) => {
    const x = tankX(i);
    parts.push({ machine: id, name: `${fluid}TankPlate`, ratePerS: 0, pose: plate(x, 1.55, frontZ + 0.006, 0.42, 0.16, 0.01), speed: still, color: fixed(FLUID_HEX[fluid]) });
    parts.push({
      machine: id,
      name: `${fluid}Lamp`,
      ratePerS: 0,
      pose: plate(x + 0.16, tankTopM + S.tankDomeM * 0.55, S.tankZM + 0.12, 0.08, 0.08, 0.08),
      speed: still,
      reading: (y) => (tankInUse(now(y), fluid) ? 1 : 0),
      color: (y, _p, out) => out.setHex(tankInUse(now(y), fluid) ? FLUID_HEX[fluid] : HEX.off),
    });
  });
  CIP_CIRCUIT_IDS.forEach((circuit, i) => {
    const x = laneX(i);
    const of = (y: YogurtSnapshot): CipCircuitState => now(y)[circuit];
    // The supply pump's rotor on its casing's face, as the wing's other pumps (motionParts.ts rotor).
    for (const [suffix, offset] of [['', 0], ['Cross', 0.25]] as const) {
      const turn = rotor(x, 0.25, S.pumpZM + 0.075, 0.22);
      parts.push({
        machine: id,
        name: `${circuit}Pump${suffix}`,
        ratePerS: PUMP_TURNS_PER_S,
        easeS: PUMP_EASE_S,
        pose: (phase, y, out) => turn(phase + offset, y, out),
        speed: (y) => (of(y).running ? 1 : 0),
        color: fixed(HEX.blade),
      });
    }
    // The heater's strip: the step's temperature in the pipes' colours; dark while the circuit stands.
    const heaterFrontZ = S.heaterZM + 0.115;
    parts.push({
      machine: id,
      name: `${circuit}Heater`,
      ratePerS: 0,
      pose: plate(x - 0.07, 0.6, heaterFrontZ, 0.12, 0.62, 0.008),
      speed: still,
      reading: (y) => of(y).tempC ?? 0,
      color: (y, _p, out) => {
        const tempC = of(y).tempC;
        return of(y).running && tempC !== null ? wingTempColor(tempC, out) : out.setHex(HEX.off);
      },
    });
    // The return's conductivity: a bar beside it, rising from its foot to the reading over 90 mS/cm, in the step's fluid.
    const barM = 0.62;
    const barFootM = 0.6 - barM / 2;
    parts.push({ machine: id, name: `${circuit}ConductivityBacking`, ratePerS: 0, pose: plate(x + 0.08, 0.6, heaterFrontZ, 0.1, barM, 0.006), speed: still, color: fixed(HEX.off) });
    parts.push({
      machine: id,
      name: `${circuit}Conductivity`,
      ratePerS: 0,
      pose(_phase, y, out) {
        const ms = of(y).returnMsPerCm ?? 0;
        const h = barM * Math.min(1, Math.max(0, ms / CONDUCTIVITY_FULL_MS_PER_CM));
        out.position.set(x + 0.08, barFootM + h / 2, heaterFrontZ + 0.004);
        out.rotation.set(0, 0, 0);
        out.size.set(0.08, h, 0.006);
      },
      speed: still,
      reading: (y) => of(y).returnMsPerCm ?? 0,
      color: (y, _p, out) => out.setHex(FLUID_HEX[of(y).fluid ?? 'water']),
    });
    // The change-over valve's two stems: back to the tanks (behind) and to the drain (in front); the open one lifts.
    const vx = x + S.returnDxM;
    for (const [name, dz, way] of [['ToTank', -1, 'tank'], ['ToDrain', 1, 'drain']] as const) {
      parts.push({
        machine: id,
        name: `${circuit}${name}`,
        ratePerS: 1.5,
        pose(phase, _y, out) {
          out.position.set(vx, S.valveYM + 0.175 + phase * 0.05, S.valveZM + dz * 0.2);
          out.rotation.set(0, 0, 0);
          out.size.set(0.04, 0.07, 0.04);
        },
        speed: still,
        target: (y) => (returnWay(of(y)).to === way ? 1 : 0),
        color(y, _p, out) {
          const ret = returnWay(of(y));
          return out.setHex(ret.to === way && ret.fluid ? FLUID_HEX[ret.fluid] : HEX.off);
        },
      });
    }
    // The drain splashes under its way while the return runs to it.
    parts.push({
      machine: id,
      name: `${circuit}Splash`,
      ratePerS: 4,
      pose(phase, y, out) {
        const draining = returnWay(of(y)).to === 'drain';
        const h = draining ? 0.04 + 0.05 * Math.abs(Math.sin(phase * TURN)) : 0;
        out.position.set(vx, 0.024 + h / 2, S.drain.zM);
        out.rotation.set(0, (phase * 0.37) % 1, 0);
        if (draining) out.size.set(0.16, h, 0.12);
        else out.size.set(0, 0, 0);
      },
      speed: (y) => (returnWay(of(y)).to === 'drain' ? 1 : 0),
      color: (y, _p, out) => out.setHex(FLUID_HEX[of(y).fluid ?? 'water']),
    });
    // The cabinet's lamp for this circuit, amber while it runs.
    const cab = S.cabinet;
    parts.push({
      machine: id,
      name: `${circuit}Lamp`,
      ratePerS: 0,
      pose: plate(cab.xM - 0.08 + i * 0.08, 1.1, cab.zM + cab.depthM / 2 + 0.005, 0.05, 0.05, 0.01),
      speed: still,
      color: (y, _p, out) => out.setHex(of(y).running ? HEX.flash : HEX.off),
    });
  });
  // The cabinet's screen, lit while any circuit runs.
  const cab = S.cabinet;
  parts.push({
    machine: id,
    name: 'screen',
    ratePerS: 0,
    pose: plate(cab.xM, 1.32, cab.zM + cab.depthM / 2 + 0.005, 0.22, 0.16, 0.01),
    speed: still,
    reading: (y) => CIP_CIRCUIT_IDS.filter((each) => now(y)[each].running).length,
    color: (y, _p, out) => out.setHex(CIP_CIRCUIT_IDS.some((each) => now(y)[each].running) ? HEX.screen : HEX.screenDark),
  });
  return parts;
}

/* at the tanks: the header, the drops and the sight glasses (wingMotion.ts lists them) */

/** The colour a tank's drop or the header shows: its fluid's while it carries one, the metal's otherwise. */
const lineColor = (fluid: CleaningFluid | null, out: THREE.Color): THREE.Color => out.setHex(fluid ? FLUID_HEX[fluid] : HEX.metal);

/** The tanks' CIP header carries the fluid of the tanks' circuit's supply. */
export const headerColor = (y: YogurtSnapshot, out: THREE.Color): THREE.Color => lineColor(cipCircuits(y).tanks.fluid, out);

/** A tank's CIP drop carries its own clean's fluid. */
export const dropColor = (tank: number) => (y: YogurtSnapshot, out: THREE.Color): THREE.Color => lineColor(tankCipFluid(y, tank), out);

/* the station's label */

/** Short names for the label: "heat treatment", "tank 2", "P8". */
function shortName(circuit: CipCircuitId, each: CipCircuitState): string {
  if (circuit === 'tanks') return each.what;
  return circuit === 'heat' ? 'heat treatment' : 'P8';
}

/**
 * The station's label: "tank 2 · NaOH 1.8% · 78 °C" for one circuit, "tank 2 + P8" for more, "standing by" while none
 * runs; '' without the yogurt line.
 */
export function cipStationLabelText(y: YogurtSnapshot | undefined): string {
  if (!y) return '';
  const circuits = cipCircuits(y);
  const running = CIP_CIRCUIT_IDS.filter((each) => circuits[each].running);
  if (running.length === 0) return 'standing by';
  if (running.length > 1) return running.map((each) => shortName(each, circuits[each])).join(' + ');
  const circuit = running[0] as CipCircuitId;
  const each = circuits[circuit];
  const fluid = cipLabelFluid(each.fluid ?? 'water', each.step?.concentrationPct);
  return each.tempC === null ? `${shortName(circuit, each)} · ${fluid}` : `${shortName(circuit, each)} · ${fluid} · ${each.tempC} °C`;
}

/**
 * The station's label over its tanks (D34): an empty group with a label, as phase 31's tags, so it costs no draw call.
 * Its moving parts report under its id (wingMotion.ts); a click on its steel selects stage 12, the reprocess tank's.
 */
export function cipStationTag(): Equipment {
  const root = new THREE.Group();
  root.name = CIP_STATION_ID;
  root.userData = { equipmentId: CIP_STATION_ID, stage: 12, tokens: true };
  return {
    id: CIP_STATION_ID,
    stage: 12,
    label: 'CIP station',
    object: root,
    labelAnchorM: [laneX(1), tankTopM + S.tankDomeM + 1.1, S.tankZM],
    labelText: (snapshot: Snapshot) => cipStationLabelText(yogurtOf(snapshot)),
    update() {},
    dispose() {
      root.removeFromParent();
    },
  };
}
