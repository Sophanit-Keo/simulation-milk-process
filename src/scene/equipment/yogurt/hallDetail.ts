// The yogurt process hall's fittings in colour (phase 26): what the grey boxes cannot show in their machines' own
// materials, drawn as instances in the shared box mesh with the moving parts (wingMotion.ts), so they cost no draw
// call. Some stand still: nameplates, an emergency stop, red handles, the fermentation tanks' jacket pipes and CIP
// header, which the tanks' model would otherwise hide. Others follow the live sim:
// - the deaerator's sight glass shows the mix while it flows;
// - the homogenizer's screen is lit while it runs, amber while the wing cleans, and its lamps say which;
// - the hot-water set's display shows the heating's temperature, in the pipes' colours;
// - the culture skid's display is lit while it doses;
// - each fermentation tank's jacket valve opens to warm water while it ferments, to chilled water once it is ready;
// - the cooler's ice-water valve opens while it cools.
import type { YogurtSnapshot } from '../../../contracts';
import * as at from './layout';
import { fixed, heating, HEX, plate, still, valveStem, wingTempColor, type OpenFor, type Part } from './motionParts';

/** A box from (x1, y, z1) to (x2, y, z2) on the floor plan, `thickM` square: a pipe run in the plan. */
function run(machine: string, name: string, [x1, z1]: readonly [number, number], [x2, z2]: readonly [number, number], yM: number, thickM: number): Part {
  const lengthM = Math.hypot(x2 - x1, z2 - z1);
  const turnY = Math.atan2(x2 - x1, z2 - z1);
  return { machine, name, ratePerS: 0, pose: plate((x1 + x2) / 2, yM, (z1 + z2) / 2, thickM, thickM, lengthM, turnY), speed: still };
}

/** A vertical pipe at (x, z) from `fromM` to `toM`. */
const riser = (machine: string, name: string, xM: number, zM: number, fromM: number, toM: number, thickM = 0.05): Part => ({
  machine,
  name,
  ratePerS: 0,
  pose: plate(xM, (fromM + toM) / 2, zM, thickM, toM - fromM, thickM),
  speed: still,
});

/** A plate facing the aisle (+z) at (x, y, z) in a colour of its own. */
const face = (machine: string, name: string, xM: number, yM: number, zM: number, sx: number, sy: number, color: Part['color']): Part => ({
  machine,
  name,
  ratePerS: 0,
  pose: plate(xM, yM, zM, sx, sy, 0.006),
  speed: still,
  color,
});

/** The wing's heat treatment runs, cleans or stands: what its screens and lamps say. */
const heatState = (y: YogurtSnapshot): 'run' | 'clean' | 'idle' => (heating(y) > 0 ? 'run' : y.heat.mode === 'cleaning' ? 'clean' : 'idle');

/** What a fermentation tank's jacket carries: warm water while it ferments, chilled once it is ready, until empty. */
export function jacketWater(state: string | undefined): OpenFor | null {
  if (state === 'fermenting') return 'warm';
  if (state === 'ready' || state === 'emptying') return 'chilled';
  return null;
}

/** Stage 12's fittings. */
function stage12(): Part[] {
  const parts: Part[] = [];
  // The deaerator's sight glass beside its manway, turned to the shell: the mix shows in it while it flows.
  const deaerator = at.DEAERATOR;
  const dx = 0.3;
  const dz = Math.sqrt(0.5 * 0.5 - dx * dx) + 0.02;
  parts.push({
    machine: 'yogurt-deaerator',
    name: 'sightGlass',
    ratePerS: 0,
    pose: plate(deaerator.xM + dx, 1.65, deaerator.zM + dz, 0.08, 0.32, 0.02, Math.atan2(dx, dz)),
    speed: still,
    color: (y, _p, out) => out.setHex(heating(y) > 0 ? HEX.mix : HEX.glassEmpty),
  });
  // The homogenizer's cabinet: its screen, a green lamp while it runs and an amber one while the wing cleans, the
  // emergency stop on its yellow plate; the lube unit's oil sight glass.
  const panel = at.HOMOGENIZER_PANEL;
  const faceZM = panel.zM + panel.depthM / 2 + 0.004;
  parts.push(face('yogurt-homogenizer', 'screen', panel.xM, 1.12, faceZM, 0.22, 0.15, (y, _p, out) => {
    const state = heatState(y);
    return out.setHex(state === 'run' ? HEX.screen : state === 'clean' ? HEX.flash : HEX.screenDark);
  }));
  parts.push(face('yogurt-homogenizer', 'runLamp', panel.xM - 0.1, 0.9, faceZM + 0.008, 0.045, 0.045, (y, _p, out) => out.setHex(heatState(y) === 'run' ? HEX.open : HEX.off)));
  parts.push(face('yogurt-homogenizer', 'cleanLamp', panel.xM - 0.02, 0.9, faceZM + 0.008, 0.045, 0.045, (y, _p, out) => out.setHex(heatState(y) === 'clean' ? HEX.flash : HEX.off)));
  parts.push(face('yogurt-homogenizer', 'stopPlate', panel.xM + 0.09, 0.9, faceZM, 0.08, 0.08, fixed(HEX.flash)));
  parts.push({ machine: 'yogurt-homogenizer', name: 'stopButton', ratePerS: 0, pose: plate(panel.xM + 0.09, 0.9, faceZM + 0.015, 0.045, 0.045, 0.03), speed: still, color: fixed(HEX.bad) });
  const lube = at.HOMOGENIZER_LUBE;
  parts.push({ machine: 'yogurt-homogenizer', name: 'oilGlass', ratePerS: 0, pose: plate(lube.xM, 0.35, lube.zM + 0.154, 0.05, 0.09, 0.006), speed: still, color: fixed(HEX.oil) });
  // The heat exchanger's nameplate on its movable head; the hot-water controller's display, in the heating's colour.
  const phe = at.PHE;
  parts.push({ machine: 'yogurt-phe', name: 'nameplate', ratePerS: 0, pose: plate(phe.xM + phe.lengthM / 2 + 0.103, 1.25, phe.zM, 0.006, 0.12, 0.22), speed: still, color: fixed(HEX.nameplate) });
  const hot = at.HOT_WATER_SET;
  parts.push(face('yogurt-phe', 'hotWaterDisplay', hot.xM, hot.displayYM + 0.02, hot.tankZM + 0.314, 0.14, 0.06, (y, _p, out) => (heating(y) > 0 ? wingTempColor(y.heat.outletC, out) : out.setHex(HEX.screenDark))));
  return parts;
}

/** Stage 13's fittings, and the services the fermentation tanks' model leaves out. */
function stage13(): Part[] {
  const parts: Part[] = [];
  const culture = at.CULTURE_PANEL;
  parts.push(face('culture-pump', 'display', culture.xM, culture.yM + 0.03, culture.zM + 0.054, 0.18, 0.08, (y, _p, out) => out.setHex(y.heat.mode === 'production' && y.heat.flowLph > 0 ? HEX.open : HEX.screenDark)));
  const freezer = at.CULTURE_FREEZER;
  parts.push(face('culture-pump', 'freezerDisplay', freezer.xM + 0.25, 0.6, freezer.zM + freezer.depthM / 2 + 0.004, 0.12, 0.05, fixed(HEX.frost)));
  const tank = at.FERMENT_TANK;
  const jacket = at.FERMENT_JACKET;
  // Out from the tank's middle toward the jacket's risers, and along the shell: the two risers stand side by side.
  const out = [-Math.sin(jacket.angleRad), Math.cos(jacket.angleRad)] as const;
  const along = [Math.cos(jacket.angleRad), Math.sin(jacket.angleRad)] as const;
  tank.xsM.forEach((xM, i) => {
    const machine = `ferment-tank-${i + 1}`;
    const stateOf = (y: YogurtSnapshot) => y.ferment.tanks[i]?.state;
    const at2 = (radiusM: number, side: number): [number, number] => [xM + out[0] * radiusM + along[0] * side, tank.zM + out[1] * radiusM + along[1] * side];
    const [sx, sz] = at2(jacket.radiusM, jacket.spreadM);
    const [rx, rz] = at2(jacket.radiusM, -jacket.spreadM);
    // The supply riser up to its valve, and the stub from the valve into the jacket low on the shell; the return
    // riser up to the stub high on the shell. The valve's stem opens to the water the jacket takes.
    parts.push(riser(machine, 'jacketSupply', sx, sz, 0, jacket.supplyYM - 0.06));
    parts.push(run(machine, 'jacketSupplyStub', [sx, sz], at2(tank.radiusM - 0.02, jacket.spreadM), jacket.supplyYM, 0.05));
    parts.push(riser(machine, 'jacketReturn', rx, rz, 0, jacket.returnYM));
    parts.push(run(machine, 'jacketReturnStub', [rx, rz], at2(tank.radiusM - 0.02, -jacket.spreadM), jacket.returnYM, 0.05));
    parts.push({ machine, name: 'jacketValveBody', ratePerS: 0, pose: plate(sx, jacket.supplyYM, sz, 0.12, 0.12, 0.12), speed: still });
    parts.push({ machine, name: 'jacketActuator', ratePerS: 0, pose: plate(sx, jacket.supplyYM + 0.13, sz, 0.08, 0.14, 0.08), speed: still, color: fixed(HEX.blade) });
    parts.push(valveStem(machine, 'jacketValve', [sx, jacket.supplyYM + 0.235, sz], (y) => jacketWater(stateOf(y))));
    // The CIP header's drop into the dome, behind the drive.
    const header = at.FERMENT_CIP_HEADER;
    const domeTopM = tank.legsM + tank.coneM + tank.bodyM + tank.domeM * Math.sqrt(1 - ((tank.zM - header.zM) / tank.radiusM) ** 2);
    parts.push(riser(machine, 'cipDrop', xM, header.zM, domeTopM, header.yM, 0.06));
    // The sampling valve low on the shell to the aisle, right of the gauge, and its red handle.
    const sampleAngle = 0.35;
    const [vx, vz] = [xM + Math.sin(sampleAngle) * (tank.radiusM + 0.03), tank.zM + Math.cos(sampleAngle) * (tank.radiusM + 0.03)];
    parts.push({ machine, name: 'sampleValve', ratePerS: 0, pose: plate(vx, tank.legsM + tank.coneM + 0.15, vz, 0.06, 0.06, 0.06), speed: still });
    parts.push({ machine, name: 'sampleHandle', ratePerS: 0, pose: plate(vx + 0.05, tank.legsM + tank.coneM + 0.15, vz + 0.03, 0.1, 0.015, 0.015), speed: still, color: fixed(HEX.needle) });
  });
  // The CIP header over the tanks, on a post at each end.
  const header = at.FERMENT_CIP_HEADER;
  parts.push(run('ferment-tank-2', 'cipHeader', [header.xMinM, header.zM], [header.xMaxM, header.zM], header.yM, 0.07));
  parts.push(riser('ferment-tank-1', 'cipPost', header.xMinM, header.zM, 0, header.yM, 0.08));
  parts.push(riser('ferment-tank-3', 'cipPost', header.xMaxM, header.zM, 0, header.yM, 0.08));
  return parts;
}

/** Stage 14's fittings. */
function stage14(): Part[] {
  const parts: Part[] = [];
  const gauge = at.SMOOTHING_GAUGE;
  parts.push(face('smoothing-valve', 'gaugeFace', gauge.xM, gauge.yM, at.LINE_Z_M + 0.018, 0.08, 0.08, fixed(HEX.dial)));
  const cooler = at.COOLER;
  parts.push({ machine: 'yogurt-cooler', name: 'nameplate', ratePerS: 0, pose: plate(cooler.xM + cooler.lengthM / 2 + 0.053, 1.0, cooler.zM, 0.006, 0.1, 0.18), speed: still, color: fixed(HEX.nameplate) });
  // The ice-water control valve on the pump's line: its body, actuator, and the stem that opens while it cools.
  const valve = at.ICE_WATER_VALVE;
  // As the ice-water pump (wingMotion.ts): while an emptying tank sends yogurt through the cooler.
  const cooling = (y: YogurtSnapshot): boolean => y.ferment.tanks.some((tank) => tank.state === 'emptying') && y.buffer.inflowLph > 0;
  parts.push({ machine: 'yogurt-cooler', name: 'iceValveBody', ratePerS: 0, pose: plate(valve.xM, valve.yM, valve.zM, 0.1, 0.1, 0.1), speed: still });
  parts.push({ machine: 'yogurt-cooler', name: 'iceValveActuator', ratePerS: 0, pose: plate(valve.xM, valve.yM + 0.12, valve.zM, 0.07, 0.12, 0.07), speed: still, color: fixed(HEX.blade) });
  parts.push(valveStem('yogurt-cooler', 'iceValve', [valve.xM, valve.yM + 0.215, valve.zM], (y) => (cooling(y) ? 'chilled' : null), 0.05));
  // The buffer's sampling valve's red handle.
  const buffer = at.BUFFER;
  const zM = buffer.zM + Math.sqrt(buffer.radiusM ** 2 - 0.4 ** 2) + 0.065;
  parts.push({ machine: 'p8-buffer', name: 'sampleHandle', ratePerS: 0, pose: plate(buffer.xM - 0.35, 0.65, zM, 0.1, 0.015, 0.015), speed: still, color: fixed(HEX.needle) });
  return parts;
}

/** Every phase 26 fitting, stage by stage. */
export function hallDetailParts(): Part[] {
  return [...stage12(), ...stage13(), ...stage14()];
}

