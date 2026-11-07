// The yogurt machines in motion (phase 23): what happens inside the wing's machines, shown by small parts that move
// with the sim's live state. Every part is an instance of a box, coloured per instance and casting no shadow, drawn in
// the cold chain's box mesh ahead of its pallets (coldChainScene.ts, SharedBoxes): the overview stands at its budget of
// draw calls (phase 20), and the wing's motion costs none.
//
// - Stage 11: the powder station's rotary valve turns as powder is dosed; the high-shear mixer's rotor spins in its
//   funnel; the stabilizer pump's plunger strokes.
// - Stage 12: the deaerator's vacuum pump turns; the homogenizer's three pistons stroke, a third of a turn apart; the
//   plate heat exchanger's three packs show their temperatures on a strip each (regeneration, heating, cooling).
//   Phase 25: the deaerator's gauge reads its vacuum; the homogenizer's flywheel turns with its pistons and its two
//   gauges read the first and second stages (phase 27: on its top cover, its pistons in the open gap with their collars,
//   the crank spinning up and down); the hot-water pump turns and the steam valve's stem lifts with the steam;
//   the CCP recorder's chart runs and its pen follows the holding cell's outlet, red under the divert limit; the
//   reprocess pump turns while it empties the tank in the clean.
// - Stage 13: the culture pump's plunger strokes as it doses; each fermentation tank's sight glass shows what is inside
//   at its level: milk-white mix at pH 6.6 turning to cream yogurt by pH 4.55, dark above the level. Phase 25: the
//   valve matrix, an inlet valve on each tank's branch and an outlet valve under its cone, each opening (green, amber
//   in a clean) while its tank fills or empties.
// - Stage 14: the flow meter after the smoothing valve spins; the cooler's strip shows its outlet; the fruit pump strokes.
//   Phase 25: the ice-water pump turns while the cooler cools; the buffer's outlet valve opens while P8 runs on it.
// - Phase 26: the process hall's fittings in colour, some following the sim (hallDetail.ts).
// - Stage 15: the coder flashes as each cycle's lids pass, and the three check gates flash as they check a row.
// - Stage 16: the blast chiller's fans turn while it holds pallets; the cold room's evaporator fans turn while its
//   cooling works, and stand still in a cooling failure (D30).
//
// Each part moves on animation time (motion.ts): paused, it stands; at high speeds it only hints at the rate.
import * as THREE from 'three';
import type { Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import { motionDtS } from '../../motion';
import { hallDetailParts } from './hallDetail';
import * as at from './layout';
import { blade, clamp01, contentColor, fixed, flashColor, gauge, heating, HEX, p8Running, plate, plunger, rotor, still, topGauge, TURN, valveStem, wingTempColor, type Part, type PartState, type Pose } from './motionParts';
import { yogurtOf } from './readings';

export { contentColor, wingTempColor } from './motionParts';

const Y = plantJson.yogurt;
/** At most this much of a turn or stroke a frame, so a slow frame never skips a whole one. */
const MAX_PHASE_PER_FRAME = 0.45;

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
/** A fermentation tank's sight glass on its +z face, left of the level gauge: its middle and height. */
const SIGHT_GLASS = { yM: 2.9, heightM: 0.7 } as const;
/** Phase 25: the deaerator's vacuum while it runs, bar below atmospheric (Tetra Pak's deaeration at about 0.8 bar). */
const DEAERATOR_VACUUM_BAR = 0.8;
/** The homogenizer's gauges' full scale, and its second stage as a share of its first, as the UHT's (plant.json). */
const HOMOGENIZER_FULL_SCALE_BAR = 250;
const SECOND_STAGE_FRAC = plantJson.homogenizer.stage2Bar / plantJson.homogenizer.stage1Bar;
/** Phase 27: the homogenizer's crank turns as the UHT homogenizer's (liquidLine.ts, 7 rad/s), and takes 0.8 s to spin up. */
const CRANK_TURNS_PER_S = 7 / TURN;
const CRANK_EASE_S = 0.8;
/** The steam the heat treatment takes at full flow, to the setpoint from the homogenizer's temperature (steamLph). */
const STEAM_FULL_KG_PER_H = (Y.mix.capacityLph * plantJson.product.cpKjPerKgK * (Y.heat.setpointC - Y.homogenizer.tempC)) / plantJson.uht.steamLatentKjPerKg;
/** The CCP recorder's chart spans these temperatures. */
const RECORDER_FROM_C = 80;
const RECORDER_TO_C = 95;
/** The fermentation tanks' outlet line under their cones (yogurtPipes.ts). */
const OUTLET_Y_M = 0.6;
const mixing = (y: YogurtSnapshot): number => y.mix.flowLph / Y.mix.capacityLph;
const p8Rate = (y: YogurtSnapshot): number => (p8Running(y) ? (y.p8.cyclesPerMin ?? 30) / 30 : 0);

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
  // Phase 27: the pistons run in the open gap between the crankcase and the liquid end (HOMOGENIZER_FRAME), each with
  // a collar that shows its stroke, a third of a turn apart, at the UHT homogenizer's crank speed (7 rad/s). The crank
  // spins up and runs down with the flow.
  const homogenizer = at.HOMOGENIZER;
  const frame = at.HOMOGENIZER_FRAME;
  frame.pistonXsM.forEach((dx, i) => {
    const zAt = (phase: number): number => homogenizer.zM + frame.pistonZM + frame.strokeM * Math.sin((phase + i / 3) * TURN);
    parts.push({ machine: 'yogurt-homogenizer', name: `piston${i + 1}`, ratePerS: CRANK_TURNS_PER_S, easeS: CRANK_EASE_S, pose: (phase, _y, out) => {
      out.position.set(homogenizer.xM + dx, frame.pistonYM, zAt(phase));
      out.rotation.set(0, 0, 0);
      out.size.set(frame.pistonSideM, frame.pistonSideM, frame.pistonLengthM);
    }, speed: heating, color: fixed(HEX.blade) });
    parts.push({ machine: 'yogurt-homogenizer', name: `collar${i + 1}`, ratePerS: CRANK_TURNS_PER_S, easeS: CRANK_EASE_S, pose: (phase, _y, out) => {
      out.position.set(homogenizer.xM + dx, frame.pistonYM, zAt(phase) - 0.08);
      out.rotation.set(0, 0, 0);
      out.size.set(frame.pistonSideM + 0.04, frame.pistonSideM + 0.04, 0.04);
    }, speed: heating, color: fixed(HEX.metal) });
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
  // Phase 25, stage 12: the deaerator's vacuum gauge (0 to -1 bar, read as its depth), the homogenizer's flywheel on its
  // belt guard, turning with the pistons' crank, and its two gauges (0–250 bar).
  parts.push(...gauge('yogurt-deaerator', 'vacuumGauge', [at.DEAERATOR_GAUGE.xM, at.DEAERATOR_GAUGE.yM, at.DEAERATOR_GAUGE.zM], (y) => (heating(y) > 0 ? DEAERATOR_VACUUM_BAR : 0), 1));
  // Phase 27: the flywheel's two spokes on the belt guard's east face, turning with the crank.
  const guard = frame.guard;
  const wheel: [number, number, number] = [homogenizer.xM + guard.xM + guard.widthM / 2 + 0.012, (guard.yMinM + guard.yMaxM) / 2, homogenizer.zM + (guard.zMinM + guard.zMaxM) / 2];
  const spokeM = Math.min(guard.yMaxM - guard.yMinM, guard.zMaxM - guard.zMinM) - 0.12;
  parts.push({ machine: 'yogurt-homogenizer', name: 'flywheel', ratePerS: CRANK_TURNS_PER_S, easeS: CRANK_EASE_S, pose: rotor(...wheel, spokeM, true), speed: heating, color: fixed(HEX.blade) });
  parts.push({ machine: 'yogurt-homogenizer', name: 'flywheelSpoke', ratePerS: CRANK_TURNS_PER_S, easeS: CRANK_EASE_S, pose: (phase, y, out) => rotor(...wheel, spokeM, true)(phase + 0.25, y, out), speed: heating, color: fixed(HEX.blade) });
  // Its two gauges on the top cover, facing up, where the stage's camera reads them.
  const stage1Bar = (y: YogurtSnapshot): number => (y.heat.flowLph > 0 ? Y.homogenizer.bar : 0);
  const stages = [stage1Bar, (y: YogurtSnapshot) => stage1Bar(y) * SECOND_STAGE_FRAC];
  at.HOMOGENIZER_GAUGES.forEach((spec, i) => {
    parts.push(...topGauge('yogurt-homogenizer', spec.name, [homogenizer.xM + spec.dxM, frame.gaugeYM, homogenizer.zM + spec.dzM], stages[i] ?? stage1Bar, HOMOGENIZER_FULL_SCALE_BAR));
  });
  // The hot-water set: its pump turns while it heats; its steam valve's stem lifts with the steam it lets in.
  const hot = at.HOT_WATER_SET;
  const steam = (y: YogurtSnapshot): number => y.energy?.steamKgPerH ?? 0;
  parts.push({ machine: 'yogurt-phe', name: 'hotWaterPump', ratePerS: 3, pose: rotor(hot.xM, 0.18, hot.pumpZM + 0.16, 0.26), speed: (y) => (heating(y) > 0 || steam(y) > 0 ? 1 : 0), color: fixed(HEX.blade) });
  parts.push({
    machine: 'yogurt-phe',
    name: 'steamValve',
    ratePerS: 0.8,
    pose(phase, _y, out) {
      out.position.set(hot.xM, hot.valveYM + 0.33 + phase * 0.12, hot.tankZM);
      out.rotation.set(0, 0, 0);
      out.size.set(0.03, 0.1, 0.03);
    },
    speed: still,
    target: (y) => steam(y) / STEAM_FULL_KG_PER_H,
    reading: steam,
    color: (y, _p, out) => out.setHex(steam(y) > 0 ? HEX.flash : HEX.metal),
  });
  // The CCP's recorder: its chart runs while the heat treatment does, a grid line passing every half a minute of
  // animation; the pen follows the outlet's temperature across 80–95 °C, red under the divert limit.
  const recorder = at.CCP_RECORDER;
  const chartZM = recorder.zM + 0.005;
  const chartAt = (tempC: number): number => clamp01((tempC - RECORDER_FROM_C) / (RECORDER_TO_C - RECORDER_FROM_C));
  const across = (frac: number): number => recorder.xM - recorder.widthM / 2 + 0.02 + frac * (recorder.widthM - 0.04);
  const recording = (y: YogurtSnapshot): number => (y.heat.mode === 'idle' ? 0 : 1);
  parts.push({ machine: 'holding-cell', name: 'chart', ratePerS: 0, pose: plate(recorder.xM, recorder.yM, chartZM, recorder.widthM, recorder.heightM, 0.006), speed: still, color: fixed(HEX.paper) });
  parts.push({ machine: 'holding-cell', name: 'limitLine', ratePerS: 0, pose: plate(across(chartAt(Y.heat.divertBelowC)), recorder.yM, chartZM + 0.004, 0.004, recorder.heightM - 0.02, 0.004), speed: still, color: fixed(HEX.bad) });
  for (let k = 0; k < 2; k++) {
    parts.push({ machine: 'holding-cell', name: `chartLine${k + 1}`, ratePerS: 1 / 60, pose: (phase, _y, out) => {
      out.position.set(recorder.xM, recorder.yM - recorder.heightM / 2 + 0.01 + ((phase + k / 2) % 1) * (recorder.heightM - 0.02), chartZM + 0.003);
      out.rotation.set(0, 0, 0);
      out.size.set(recorder.widthM - 0.02, 0.004, 0.004);
    }, speed: recording, color: fixed(HEX.grid) });
  }
  parts.push({
    machine: 'holding-cell',
    name: 'recorderPen',
    ratePerS: 0.6,
    pose(phase, _y, out) {
      out.position.set(across(phase), recorder.yM, chartZM + 0.012);
      out.rotation.set(0, 0, 0);
      out.size.set(0.016, 0.03, 0.012);
    },
    speed: still,
    target: (y) => chartAt(y.heat.outletC),
    reading: (y) => y.heat.outletC,
    color: (y, _p, out) => out.setHex(y.heat.outletC < Y.heat.divertBelowC ? HEX.bad : HEX.ink),
  });
  // The reprocess pump at the tank's foot turns while the clean empties the tank to rework.
  const reprocess = at.REPROCESS_TANK;
  parts.push({ machine: 'reprocess-tank', name: 'reprocessPump', ratePerS: 2.5, pose: rotor(at.REPROCESS_PUMP.xM + 0.21, 0.2, reprocess.zM, 0.24, true), speed: (y) => (y.heat.mode === 'cleaning' && y.heat.reprocessTank.levelL > 0 ? 1 : 0), color: fixed(HEX.blade) });
  // Stage 13.
  const culture = at.CULTURE_PUMP;
  const inoculating = (y: YogurtSnapshot): number => (y.heat.mode === 'production' ? y.heat.flowLph / Y.mix.capacityLph : 0);
  parts.push({ machine: 'culture-pump', name: 'plunger', ratePerS: 1, pose: plunger(culture.xM + 0.67, 0.35, culture.zM, 0.24), speed: inoculating });
  for (let tank = 0; tank < at.FERMENT_TANK.xsM.length; tank++) parts.push(sightGlass(tank));
  // Phase 25: the valve matrix. Each tank's inlet valve on its branch from the header, its outlet valve under its cone
  // on the line to the manifold: a body on the pipe, its actuator, and the stem that lifts as it opens.
  at.FERMENT_TANK.xsM.forEach((xM, tank) => {
    const machine = `ferment-tank-${tank + 1}`;
    const stateOf = (y: YogurtSnapshot) => y.ferment.tanks[tank]?.state;
    const inlet = at.FERMENT_INLET_VALVE_Z_M;
    parts.push({ machine, name: 'inletValveBody', ratePerS: 0, pose: plate(xM, at.FERMENT_INLET_Y_M, inlet, 0.14, 0.14, 0.14), speed: still });
    parts.push({ machine, name: 'inletActuator', ratePerS: 0, pose: plate(xM, at.FERMENT_INLET_Y_M + 0.15, inlet, 0.1, 0.16, 0.1), speed: still });
    parts.push(valveStem(machine, 'inletValve', [xM, at.FERMENT_INLET_Y_M + 0.265, inlet], (y) => (stateOf(y) === 'filling' ? 'product' : stateOf(y) === 'cleaning' ? 'clean' : null)));
    const outlet = at.FERMENT_OUTLET_VALVE_Z_M;
    parts.push({ machine, name: 'outletValveBody', ratePerS: 0, pose: plate(xM, OUTLET_Y_M, outlet, 0.14, 0.14, 0.14), speed: still });
    parts.push({ machine, name: 'outletActuator', ratePerS: 0, pose: plate(xM + 0.15, OUTLET_Y_M, outlet, 0.16, 0.1, 0.1), speed: still });
    parts.push({
      ...valveStem(machine, 'outletValve', [0, 0, 0], (y) => (stateOf(y) === 'emptying' ? 'product' : stateOf(y) === 'cleaning' ? 'clean' : null)),
      // Under the cone there is no room above, so its actuator lies along x and the stem slides out east.
      pose(phase, _y, out) {
        out.position.set(xM + 0.265 + phase * 0.06, OUTLET_Y_M, outlet);
        out.rotation.set(0, 0, 0);
        out.size.set(0.07, 0.05, 0.05);
      },
    });
  });
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
  // Phase 25: the ice-water pump turns while the cooler cools; the buffer's outlet valve opens while P8 runs on it.
  const ice = at.ICE_WATER_PUMP;
  parts.push({ machine: 'yogurt-cooler', name: 'iceWaterPump', ratePerS: 3, pose: rotor(ice.xM, 0.18, ice.zM + 0.15, 0.24), speed: (y) => (fromTank(y) > 0 ? 1 : 0), color: fixed(HEX.blade) });
  const valve = at.BUFFER_OUTLET_VALVE;
  parts.push({ machine: 'p8-buffer', name: 'outletValveBody', ratePerS: 0, pose: plate(valve.xM, valve.yM, valve.zM, 0.14, 0.14, 0.14), speed: still });
  parts.push({ machine: 'p8-buffer', name: 'outletActuator', ratePerS: 0, pose: plate(valve.xM, valve.yM + 0.15, valve.zM, 0.1, 0.16, 0.1), speed: still });
  // P8 draws a cycle's cups at a time, so the valve stands open while it runs on a buffer that has yogurt.
  parts.push(valveStem('p8-buffer', 'outletValve', [valve.xM, valve.yM + 0.265, valve.zM], (y) => (p8Running(y) && y.buffer.levelL > 0 ? 'product' : null)));
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
  // Phase 26: the process hall's fittings in colour, after every part before them, so those keep their instances.
  parts.push(...hallDetailParts());
  return parts;
}

export function createWingMotion(): WingMotion {
  const parts = wingParts();
  let mesh: THREE.InstancedMesh | null = null;
  let offset = 0;
  const phases = parts.map(() => 0);
  /** The share of its rate each easing part turns at now (phase 27). */
  const speeds = parts.map(() => 0);
  const states: PartState[] = parts.map(() => ({ value: 0, moving: false, color: HEX.metal, reading: null }));
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
          const state = states[i];
          const now = phases[i] ?? 0;
          let moving: boolean;
          if (part.target) {
            // A part that travels: it eases to where it should be, at most its rate a second, and moves while it does.
            const goal = clamp01(part.target(yogurt));
            const maxStep = Math.min(MAX_PHASE_PER_FRAME, part.ratePerS * dtS);
            phases[i] = now + Math.max(-maxStep, Math.min(maxStep, goal - now));
            moving = Math.abs((phases[i] ?? 0) - now) > 1e-9;
          } else {
            const wanted = Math.max(0, part.speed(yogurt));
            let speed = wanted;
            if (part.easeS) {
              // Spinning up or running down: the share of its rate eases to the wanted one over easeS of animation time.
              const was = speeds[i] ?? 0;
              const maxStep = dtS / part.easeS;
              speed = was + Math.max(-maxStep, Math.min(maxStep, wanted - was));
              speeds[i] = speed;
            }
            // The phase counts turns (it is not wrapped), so a test can see how far a part has turned.
            phases[i] = now + Math.min(MAX_PHASE_PER_FRAME, part.ratePerS * speed * dtS);
            moving = part.ratePerS > 0 && speed > 0;
          }
          if (state) {
            state.value = phases[i] ?? 0;
            state.moving = moving;
            state.reading = part.reading ? part.reading(yogurt) : null;
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
        // A part that travels says how far it has gone (0–1); one that turns, how many turns.
        out[`${part.name}${part.target ? 'Lift' : 'Turns'}`] = Math.round(state.value * 1000) / 1000;
        out[`${part.name}Moving`] = state.moving;
        out[`${part.name}Color`] = `#${state.color.toString(16).padStart(6, '0')}`;
        if (state.reading !== null) out[`${part.name}Reading`] = Math.round(state.reading * 10) / 10;
      });
      return out;
    },
  };
}
