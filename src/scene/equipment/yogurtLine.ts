// Stages 11–16, the yogurt wing (phase 16, plan 12, D25), as grey boxes: every machine of the phase 16 table at
// the positions of yogurt/layout.ts, built with the milk line's builder and kit (reuse, not copy). The pipes
// between them belong to pipes.ts, the holding cell's serpentine among them. Driven by the snapshot's yogurt
// part (contracts v8): tank levels on their gauges and a key value on each label. Phase 17 adds the agitators of
// the mix tank, the fermentation tanks and the fruit tank, the divert valve's flag and lamp, and the pH ring on each
// fermentation tank's label. Phase 18 makes P8 move and fill its cups (yogurt/p8Machine.ts); pallets come in phase 19.
import * as THREE from 'three';
import type { Snapshot, StageId } from '../../contracts';
import { DARK_LAMP_BODY_HEX, createLampPalette, glowInDark } from '../lamps';
import { advancePhase, motionDtS } from '../motion';
import { LAMP_COLOR_VAR, LAMP_GLOW_HEX, type LampStatus } from '../theme';
import { labelValue, stageValue } from './liquid/readings';
import { MachineBuilder } from './liquid/builder';
import { createKit, type Kit, type LiquidMaterial } from './liquid/kit';
import {
  AGITATOR_RAD_PER_S,
  ease,
  easeSpin,
  FULL_TURN_RAD,
  levelGauge,
  machine,
  MAX_TURN_PER_FRAME_RAD,
  VALVE_EASE_PER_S,
  type FillReading,
  type MachineSpec,
} from './liquidLine';
import { HERO_MODELS, swapInHero } from './heroes';
import type { Equipment, EquipmentContext, EquipmentFactory } from './types';
import * as at from './yogurt/layout';
import { coldChainTokens } from './yogurt/coldChainScene';
import { createTransfers } from './yogurt/dispatchBoxes';
import { createReeferYard } from './yogurt/reeferTruck';
import { MIXER_FITTINGS, onSilo, POWDER_FITTINGS, SILO_FITTINGS, SKID_FITTINGS } from './yogurt/mixDetail';
import { createP8Carrier, p8Cups, p8Filler } from './yogurt/p8Machine';
import { createWingMotion, type WingMotion } from './yogurt/wingMotion';
import { createPalletLine, FILM_TOP_M, filmHeightM, GANTRY, PALLET, STACK_CAPACITY, type PalletLine } from './yogurt/palletLine';
import { CARRIAGE_AT_M, createFilmMaterial, createFilmWeb, FILM_BOTTOM_M, MAST_AT_M, MAST_HEIGHT_M, TURNTABLE_AT_M, WRAP_TURNS } from './packs/stretchWrap';
import { finite, HEAT_MODE_TEXT, heatValveLamp, phRingFrac, tankStirs, yogurtFill, yogurtOf } from './yogurt/readings';

/** A held tank's lamp (phase 20, D30): red, over its pH probe, at about the probe's height plus a little. */
const HELD_LAMP_HEX = 0xff3b30;
const HELD_LAMP_Y_M = 2.15;

/**
 * A machine with moving parts in the wing's motion (phase 23): its update moves the motion on (once a frame, whichever
 * machine comes first), and its debugState reports its parts. `host`, the cold chain's tokens, draws them.
 */
function withMotion(item: Equipment, motion: WingMotion, host: boolean): Equipment {
  const own = motion.machines.includes(item.id);
  if (!own && !host) return item;
  const { update, debugState } = item;
  return {
    ...item,
    update(snapshot, realDtS) {
      update(snapshot, realDtS);
      motion.advance(snapshot, realDtS);
    },
    ...(own ? { debugState: () => ({ ...(debugState?.() ?? {}), ...motion.state(item.id) }) } : {}),
  };
}

/** The yogurt line, stages 11–16: one Equipment per machine. */
export const yogurtLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  // P8's machine and its cups follow one carrier clock (phase 18).
  const carrier = createP8Carrier();
  // The wing's moving parts (phase 23), in world metres, drawn in the cold chain's box mesh, whose root stands at the
  // world's origin and spans the wing, and which takes no clicks: no draw call of their own.
  const motion = createWingMotion(carrier);
  // The palletizer, the wrapper and the pallets between them (phase 24), likewise drawn in the cold chain's box mesh.
  const palletLine = createPalletLine();
  // The reefers on the north yard and the dock's doors and lamps (phase 29), drawn in the same mesh.
  const yard = createReeferYard();
  const transfers = createTransfers(palletLine);
  const items = [
    yogurtSilo(kit),
    powderStation(kit),
    highShearMixer(kit),
    stabilizerSkid(kit),
    vessel(kit, {
      id: 'yogurt-mix-tank',
      stage: 11,
      label: 'Mix tank',
      ...at.MIX_TANK,
      domeM: 0.3,
      drive: true,
      // It stirs while it holds mix, so the powder stays in suspension.
      stir: (s) => (yogurtOf(s)?.mix.tanks.mixTank.levelL ?? 0) > 0,
      fill: yogurtFill((y) => y.mix.tanks.mixTank),
      labelText: (s) => labelValue(stageValue(s, 11, 'mixTankLevelPct'), 0, '%'),
    }),
    deaerator(kit),
    homogenizer(kit),
    plateHeatExchanger(kit),
    holdingCell(kit),
    divertValve(kit),
    vessel(kit, {
      id: 'reprocess-tank',
      stage: 12,
      label: 'Reprocess tank',
      ...at.REPROCESS_TANK,
      domeM: 0.2,
      fill: yogurtFill((y) => y.heat.reprocessTank),
      labelText: (s) => labelValue(stageValue(s, 12, 'reprocessLevelL'), 0, 'L'),
      detail: reprocessPump,
    }),
    culturePump(kit),
    ...at.FERMENT_TANK.xsM.map((xM, i) =>
      vessel(kit, {
        id: `ferment-tank-${i + 1}`,
        stage: 13,
        label: `Fermentation tank ${i + 1}`,
        xM,
        zM: at.FERMENT_TANK.zM,
        radiusM: at.FERMENT_TANK.radiusM,
        legsM: at.FERMENT_TANK.legsM,
        coneM: at.FERMENT_TANK.coneM,
        bodyM: at.FERMENT_TANK.bodyM,
        domeM: at.FERMENT_TANK.domeM,
        drive: true,
        stir: (s) => tankStirs(yogurtOf(s)?.ferment.tanks[i]),
        hero: { ctx, path: HERO_MODELS.fermentTank },
        held: (s) => yogurtOf(s)?.ferment.tanks[i]?.held === true,
        fill: yogurtFill((y) => y.ferment.tanks[i]),
        labelText: (s) => {
          const ph = finite(yogurtOf(s)?.ferment.tanks[i]?.ph);
          return ph === undefined ? '' : `pH ${labelValue(ph, 2, '')}`;
        },
        labelRing: (s) => phRingFrac(yogurtOf(s)?.ferment.tanks[i]),
      }),
    ),
    smoothingValve(kit),
    plateCooler(kit),
    vessel(kit, {
      id: 'fruit-tank',
      stage: 14,
      label: 'Fruit preparation',
      ...at.FRUIT_TANK,
      domeM: 0.25,
      drive: true,
      stir: (s) => (yogurtOf(s)?.buffer.fruitDosePct ?? 0) > 0,
      detail: fruitIbc,
      labelText: (s) => {
        const pct = labelValue(stageValue(s, 14, 'fruitDosePct'), 0, '%');
        return pct && `${pct} dosed`;
      },
    }),
    vessel(kit, {
      id: 'p8-buffer',
      stage: 14,
      label: 'P8 buffer',
      ...at.BUFFER,
      domeM: 0.3,
      fill: yogurtFill((y) => y.buffer),
      labelText: (s) => labelValue(stageValue(s, 14, 'levelPct'), 0, '%'),
      detail: bufferFittings,
    }),
    p8Filler(kit, carrier, ctx),
    // The gates stand 1.1 m apart, so their labels stand at three heights, one above the other at the stage's stop.
    checkGate(kit, 'p8-checkweigher', 'Checkweigher', at.CHECK_GATES.checkweigher, 'weigh', 0.9, (s) => labelValue(stageValue(s, 15, 'fillTargetG'), 0, 'g')),
    checkGate(kit, 'p8-metal-detector', 'Metal detector', at.CHECK_GATES.metalDetector, 'arch', 1.7),
    checkGate(kit, 'p8-vision', 'Vision check', at.CHECK_GATES.vision, 'camera', 2.5),
    rejectBin(kit),
    p8Cups(kit, carrier),
    trayPacker(kit),
    palletizer(kit, ctx, palletLine),
    wrapper(kit, ctx, palletLine),
    warmRoom(kit),
    blastChiller(kit),
    coldRoom(kit),
    coldChainTokens(kit, [motion, palletLine, yard, transfers], { yard, transfers }),
  ];
  return items.map((item) => withMotion(item, motion, item.id === 'yogurt-pallets'));
};

/* shared shapes */

interface VesselSpec {
  id: string;
  stage: StageId;
  label: string;
  xM: number;
  zM: number;
  radiusM: number;
  legsM: number;
  bodyM: number;
  domeM?: number;
  coneM?: number;
  /** An agitator drive on top. */
  drive?: boolean;
  /** Whether the agitator turns now (phase 17), shown by a paddle on the drive; it eases to a stop when not. */
  stir?: (snapshot: Snapshot) => boolean;
  /** The tank's level, on a gauge down its front. */
  fill?: FillReading;
  /** A hero model in place of the grey box (phase 20), with the scene's context that loads it. */
  hero?: { ctx: EquipmentContext; path: string };
  /** A red lamp over the pH probe while this says the tank is held (phase 20, D30: a stalled fermentation). */
  held?: (snapshot: Snapshot) => boolean;
  labelText?: MachineSpec['labelText'];
  labelRing?: MachineSpec['labelRing'];
  /**
   * The vessel's own fittings (phase 25): a pump, a filter, a container beside it. Drawn in the vessel's materials, its
   * dark steel unshadowed or its steel shadowed, so they join its meshes and cost no draw call.
   */
  detail?: (b: MachineBuilder) => void;
}

/**
 * A vertical steel vessel on legs: an optional cone bottom, the body, a dome, an agitator drive and a level gauge.
 * A vessel that stirs has a paddle on its drive, which turns while `stir` says so, as the milk line's mixing tank's.
 */
function vessel(kit: Kit, spec: VesselSpec): Equipment {
  const { xM, zM, radiusM, legsM, bodyM } = spec;
  const coneM = spec.coneM ?? 0;
  const domeM = spec.domeM ?? 0;
  const b = new MachineBuilder(kit, spec.id, [xM, 0, zM]);
  const bodyBottomM = legsM + coneM;
  if (legsM > 0) {
    b.legs([xM, zM], radiusM * 0.72, bodyBottomM, 4, 0.07);
    // Phase 26: each leg stands on a pad bolted to the floor, at the legs' angles (MachineBuilder.legs).
    for (let i = 0; i < 4; i++) {
      const angleRad = (i / 4) * Math.PI * 2 + 0.4;
      b.part('cylLo', 'steelDark', [xM + radiusM * 0.72 * Math.cos(angleRad), 0.015, zM + radiusM * 0.72 * Math.sin(angleRad)], [0.13, 0.03, 0.13]);
    }
  }
  // Every steel part casts a shadow, so the vessel's steel is one mesh; its drive is dark steel, merged with the legs.
  if (coneM > 0) b.part('coneDown', 'steel', [xM, legsM + coneM / 2, zM], [radiusM, coneM, radiusM], { castShadow: true });
  b.part('cyl', 'steel', [xM, bodyBottomM + bodyM / 2, zM], [radiusM, bodyM, radiusM], { castShadow: true });
  if (domeM > 0) b.part('dome', 'steel', [xM, bodyBottomM + bodyM, zM], [radiusM, domeM, radiusM], { castShadow: true });
  let topM = bodyBottomM + bodyM + domeM;
  if (spec.drive) {
    b.part('box', 'steelDark', [xM, topM + 0.22, zM], [0.4, 0.44, 0.4]);
    topM += 0.44;
  }
  let agitator: THREE.Object3D | undefined = spec.drive && spec.stir ? b.mesh('agitator', 'box', 'steelDark', [xM, topM + 0.03, zM], [Math.min(1.1, radiusM), 0.06, 0.12]) : undefined;
  if (agitator) topM += 0.06;
  spec.detail?.(b);
  const level = spec.fill && levelGauge(b, [xM, 0, zM + radiusM + 0.02], bodyBottomM + 0.1, bodyM - 0.2, 0.1, spec.fill);
  // The hold lamp (phase 20): over the pH probe on the +x, +z side, shown only while the tank is held.
  const heldSpec = spec.held;
  const heldMaterial = heldSpec ? new THREE.MeshBasicMaterial({ color: HELD_LAMP_HEX }) : undefined;
  const heldLamp = heldMaterial ? new THREE.Mesh(kit.shape('sphere'), heldMaterial) : undefined;
  if (heldLamp) {
    heldLamp.name = 'heldLamp';
    heldLamp.position.copy(b.local([xM + radiusM * Math.SQRT1_2, HELD_LAMP_Y_M, zM + radiusM * Math.SQRT1_2]));
    heldLamp.scale.setScalar(0.14);
    heldLamp.visible = false;
    b.root.add(heldLamp);
  }
  let heldNow = false;
  const stir = spec.stir;
  let spinRadPerS = 0;
  let stirring = false;
  const update =
    level || (agitator && stir) || heldLamp
      ? (s: Snapshot, realDtS: number) => {
          level?.update(s);
          if (heldLamp && heldSpec) {
            heldNow = heldSpec(s);
            heldLamp.visible = heldNow;
          }
          if (agitator && stir) {
            const dtS = motionDtS(s, realDtS);
            stirring = stir(s);
            spinRadPerS = easeSpin(spinRadPerS, stirring, AGITATOR_RAD_PER_S, dtS);
            agitator.rotation.y = advancePhase(agitator.rotation.y, spinRadPerS * dtS, MAX_TURN_PER_FRAME_RAD, FULL_TURN_RAD);
          }
        }
      : undefined;
  const debugState =
    level || agitator
      ? () => ({
          ...(level ? { fillFrac: level.fillFrac() } : {}),
          ...(agitator ? { stirring, spinRadPerS, angleRad: agitator.rotation.y } : {}),
          ...(heldLamp ? { held: heldNow } : {}),
        })
      : undefined;
  const hero = spec.hero;
  const milk = b.root.getObjectByName('milk');
  return machine(b, {
    id: spec.id,
    stage: spec.stage,
    label: spec.label,
    labelAnchorM: [xM, topM + 0.5, zM],
    labelText: spec.labelText,
    labelRing: spec.labelRing,
    update,
    debugState,
    dispose: heldMaterial ? () => heldMaterial.dispose() : undefined,
    onBuilt: hero
      ? (object, isAlive) => {
          // The scene keeps the gauge's level and the hold lamp; the model brings the rest, the agitator its own.
          const keep = [milk, heldLamp].filter((each): each is THREE.Object3D => each !== undefined);
          swapInHero(hero.ctx, object, { path: hero.path, nodes: ['agitator'], keep }, (nodes) => {
            if (agitator) nodes.agitator.rotation.y = agitator.rotation.y;
            agitator = nodes.agitator;
            // A thin paddle on top: its shadow would cost a draw call a tank and show nothing.
            agitator.traverse((each) => (each.castShadow = false));
            // The matte body (legs, bands, drive) neither, as the grey vessel's dark steel casts none.
            object.getObjectByName(`${object.name}-hero`)?.traverse((each) => {
              if (each instanceof THREE.Mesh && /_matte$/.test((each.material as THREE.Material).name)) each.castShadow = false;
            });
          }, isAlive);
        }
      : undefined,
  });
}

/**
 * A box machine on the floor: a body of `material`, `sizeM` across, standing at (xM, zM). The wing's small machines
 * cast no shadows: each caster is a draw call more in the shadow pass, and only the vessels and rooms are tall.
 */
function body(b: MachineBuilder, xM: number, zM: number, sizeM: readonly [number, number, number], material: LiquidMaterial = 'paint', baseM = 0): void {
  b.part('box', material, [xM, baseM + sizeM[1] / 2, zM], sizeM);
}

/** A machine with nothing to update: its parts drawn by `draw`, its label above `topM`. */
function fixture(
  kit: Kit,
  id: string,
  stage: StageId,
  label: string,
  [xM, zM]: readonly [number, number],
  topM: number,
  draw: (b: MachineBuilder) => void,
  labelText?: (snapshot: Snapshot) => string,
): Equipment {
  const b = new MachineBuilder(kit, id, [xM, 0, zM]);
  draw(b);
  return machine(b, { id, stage, label, labelAnchorM: [xM, topM + 0.45, zM], labelText });
}

/* stage 11: the yogurt silo, the powder station, the high-shear mixer and the stabilizer skid */

function yogurtSilo(kit: Kit): Equipment {
  const { xM, zM, radiusM, plinthM, bodyM, domeM } = at.SILO;
  const b = new MachineBuilder(kit, 'yogurt-silo', [xM, 0, zM]);
  b.part('cyl', 'steelDark', [xM, plinthM / 2, zM], [radiusM + 0.2, plinthM, radiusM + 0.2]);
  b.part('cyl', 'steel', [xM, plinthM + bodyM / 2, zM], [radiusM, bodyM, radiusM], { castShadow: true });
  b.part('dome', 'steel', [xM, plinthM + bodyM, zM], [radiusM, domeM, radiusM], { castShadow: true });
  b.part('box', 'steelDark', [xM - radiusM - 0.04, plinthM + bodyM / 2, zM], [0.08, bodyM - 0.3, 0.45]); // ladder, on the far side from the outlet
  siloFittings(b);
  const level = levelGauge(b, [xM, 0, zM + radiusM + 0.02], plinthM + 0.2, bodyM - 0.4, 0.12, yogurtFill((y) => y.mix.tanks.silo));
  return machine(b, {
    id: 'yogurt-silo',
    stage: 11,
    label: 'Yogurt silo',
    labelAnchorM: [xM, plinthM + bodyM + domeM + 0.6, zM],
    labelText: (s) => labelValue(stageValue(s, 11, 'siloLevelPct'), 0, '%'),
    update: (s) => level.update(s),
    debugState: () => ({ fillFrac: level.fillFrac() }),
  });
}

/**
 * Phase 29: the silo's fittings (mixDetail.ts SILO_FITTINGS), in its own materials so they join its meshes: the milk
 * pump on the outlet pipe, its volute to the aisle and its motor behind; the side agitator's drive, out from the
 * shell; the manway; and the CIP riser up the back to the dome.
 */
function siloFittings(b: MachineBuilder): void {
  const S = SILO_FITTINGS;
  const { zM, plinthM, bodyM } = at.SILO;
  const alongZ: [number, number, number] = [Math.PI / 2, 0, 0];
  b.part('box', 'steelDark', [S.pumpXM, 0.12, zM - 0.1], [0.4, 0.24, 0.9]); // the pump's base
  b.part('cylLo', 'steelDark', [S.pumpXM, 0.45, zM + 0.14], [0.2, 0.12, 0.2], { rotationRad: alongZ }); // its volute
  b.part('cylLo', 'steelDark', [S.pumpXM, 0.45, zM - 0.3], [0.16, 0.5, 0.16], { rotationRad: alongZ }); // its motor
  // A cylinder laid out from the shell at `rad` round it: its height axis turned from y to the shell's normal.
  const outward = (rad: number): [number, number, number] => [Math.PI / 2, 0, -rad];
  const [driveXM, driveZM] = onSilo(S.agitatorRad, 0.26);
  b.part('cylLo', 'steelDark', [driveXM, S.agitatorYM, driveZM], [0.16, 0.5, 0.16], { rotationRad: outward(S.agitatorRad) });
  const [manwayXM, manwayZM] = onSilo(S.manwayRad, 0.03);
  b.part('cylLo', 'steelDark', [manwayXM, S.manwayYM, manwayZM], [0.3, 0.07, 0.3], { rotationRad: outward(S.manwayRad) });
  const [riserXM, riserZM] = onSilo(S.riserRad, 0.08);
  b.part('cylLo', 'steelDark', [riserXM, plinthM + bodyM / 2, riserZM], [0.05, bodyM, 0.05]);
}

function powderStation(kit: Kit): Equipment {
  const { xM, zM } = at.POWDER_STATION;
  // A big-bag discharger: a frame of four posts with the bag on top, a hopper under it, a chute to the mixer.
  return fixture(kit, 'powder-station', 11, 'Powder station', [xM, zM], 3.5, (b) => {
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) {
      b.part('box', 'steelDark', [xM + dx, 1.6, zM + dz], [0.1, 3.2, 0.1]);
    }
    b.part('box', 'steelDark', [xM, 3.2, zM], [1.8, 0.1, 1.8]);
    b.part('box', 'carton', [xM, 2.65, zM], [1.1, 1.0, 1.1], { castShadow: true }); // the big bag of skim-milk powder
    b.part('coneDown', 'steel', [xM, 1.75, zM], [0.6, 0.7, 0.6]);
    // The chute to the mixer's funnel: a cylinder laid along z (its height axis turned from y to z).
    const chuteFromZM = zM + 0.8;
    const chuteToZM = at.MIXER.zM - 0.5;
    b.part('cylLo', 'steel', [xM, 1.6, (chuteFromZM + chuteToZM) / 2], [0.1, chuteToZM - chuteFromZM, 0.1], { rotationRad: [Math.PI / 2, 0, 0] });
    // Phase 29 (mixDetail.ts POWDER_FITTINGS), in the frame's dark steel: the dust filter on the frame's top, the
    // hoist's rail reaching out over the aisle with its chain block, and the operator panel on the front left post.
    const P = POWDER_FITTINGS;
    b.part('box', 'steelDark', [xM + P.filter.dxM, P.filter.yM, zM + P.filter.dzM], P.filter.sizeM);
    b.part('box', 'steelDark', [xM, 3.33, zM + 0.25], [0.14, 0.14, 2.3]);
    b.part('box', 'steelDark', [xM, 3.16, zM + 1.25], [0.22, 0.2, 0.22]);
    b.part('box', 'steelDark', [xM + P.panel.dxM, P.panel.yM, zM + P.panel.dzM], P.panel.sizeM);
  }, (s) => labelValue(stageValue(s, 11, 'powderKgPerT'), 1, 'kg/t'));
}

function highShearMixer(kit: Kit): Equipment {
  const { xM, zM } = at.MIXER;
  // A powder funnel on a pump: the powder is drawn into the milk as it passes.
  return fixture(kit, 'high-shear-mixer', 11, 'High-shear mixer', [xM, zM], 1.9, (b) => {
    body(b, xM, zM, [0.9, 0.6, 0.7]);
    b.part('cylLo', 'steel', [xM, 0.9, zM], [0.22, 0.6, 0.22]);
    b.part('coneDown', 'steel', [xM, 1.5, zM], [0.45, 0.6, 0.45]); // the funnel, wide at the top
    // Phase 29: the drive motor, lying along z in front of the body, in the body's paint (one mesh with it).
    const M = MIXER_FITTINGS;
    b.part('cylLo', 'paint', [xM, M.motorYM, M.motorZM], [M.motorRadiusM, M.motorLengthM, M.motorRadiusM], { rotationRad: [Math.PI / 2, 0, 0] });
  });
}

function stabilizerSkid(kit: Kit): Equipment {
  const { xM, zM } = at.STABILIZER_SKID;
  return fixture(kit, 'stabilizer-skid', 11, 'Stabilizer dosing', [xM, zM], 1.3, (b) => {
    b.part('box', 'steelDark', [xM, 0.08, zM], [1.6, 0.16, 1.0]);
    for (const dx of [-0.4, 0.4]) b.part('cylLo', 'paint', [xM + dx, 0.6, zM], [0.3, 0.9, 0.3]); // two drums
    b.part('box', 'paint', [xM, 0.3, zM + 0.4], [0.4, 0.3, 0.25]); // dosing pump
    // Phase 29: an agitator drive on each drum's lid, in the drums' paint (one mesh with them).
    const K = SKID_FITTINGS;
    for (const dx of [-K.drumDxM, K.drumDxM]) b.part('cylLo', 'paint', [xM + dx, K.drumTopM + 0.08, zM], [0.09, 0.16, 0.09]);
  });
}

/* stage 12: deaerator, homogenizer, heat exchanger, holding cell, divert valve */

function deaerator(kit: Kit): Equipment {
  const { xM, zM } = at.DEAERATOR;
  return fixture(kit, 'yogurt-deaerator', 12, 'Deaerator', [xM, zM], 2.6, (b) => {
    b.legs([xM, zM], 0.35, 0.8, 3, 0.05);
    b.part('cyl', 'steel', [xM, 1.55, zM], [0.5, 1.5, 0.5], { castShadow: true });
    b.part('dome', 'steel', [xM, 2.3, zM], [0.5, 0.25, 0.5], { castShadow: true });
    b.part('box', 'steelDark', [xM + 0.75, 0.3, zM], [0.5, 0.6, 0.4]); // vacuum pump
    // Phase 25: the vapour condenser on the dome, the vacuum line behind the product pipe down to the pump, the pump's
    // motor, the tangential inlet on the camera's side, a level transmitter, and the vacuum gauge's dial on the pump.
    b.part('cylLo', 'steel', [xM, 2.68, zM], [0.14, 0.36, 0.14], { castShadow: true });
    b.part('cylLo', 'steelDark', [xM + 0.38, 2.6, zM - 0.15], [0.03, 0.76, 0.03], { rotationRad: [0, 0, Math.PI / 2] });
    b.part('cylLo', 'steelDark', [xM + 0.75, 1.6, zM - 0.15], [0.03, 2.0, 0.03]);
    b.part('cylLo', 'steelDark', [xM + 0.75, 0.28, zM - 0.33], [0.13, 0.26, 0.13], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('cylLo', 'steelDark', [xM, 1.95, zM + 0.58], [0.06, 0.18, 0.06], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('box', 'steelDark', [xM - 0.53, 1.3, zM + 0.1], [0.06, 0.55, 0.06]);
    b.part('cylLo', 'steelDark', [at.DEAERATOR_GAUGE.xM, at.DEAERATOR_GAUGE.yM, at.DEAERATOR_GAUGE.zM - 0.02], [0.08, 0.04, 0.08], { rotationRad: [Math.PI / 2, 0, 0] });
    // Phase 26: the manway on the shell to the aisle and its handle, the CIP spray line and the vacuum relief valve on
    // the dome, the vacuum pump and its motor on a base frame. The sight glass beside the manway is the motion's.
    b.part('cylLo', 'steelDark', [xM, 1.2, zM + 0.5], [0.18, 0.05, 0.18], { rotationRad: [Math.PI / 2, 0, 0] });
    b.part('box', 'steelDark', [xM, 1.2, zM + 0.55], [0.18, 0.03, 0.03]);
    b.part('cylLo', 'steelDark', [xM - 0.25, 2.75, zM - 0.1], [0.03, 0.5, 0.03]);
    b.part('box', 'steelDark', [xM + 0.2, 2.6, zM + 0.2], [0.08, 0.12, 0.08]);
    b.part('box', 'steelDark', [xM + 0.75, 0.03, zM - 0.1], [0.6, 0.06, 0.75]);
  });
}

/**
 * The homogenizer, laid out as the UHT line's model (phase 27, HOMOGENIZER_FRAME): its pistons, collars, flywheel,
 * gauge needles, screen and lamps are the motion's (wingMotion.ts, hallDetail.ts). Its grey parts are two meshes, its
 * paint and its dark steel, as before.
 */
function homogenizer(kit: Kit): Equipment {
  const { xM, zM } = at.HOMOGENIZER;
  const f = at.HOMOGENIZER_FRAME;
  return fixture(
    kit,
    'yogurt-homogenizer',
    12,
    'Homogenizer',
    [xM, zM],
    1.35,
    (b) => {
      const p = (dx: number, yM: number, dz: number): [number, number, number] => [xM + dx, yM, zM + dz];
      const along = (from: number, to: number): [number, number] => [(from + to) / 2, to - from];
      // The base frame under the crankcase and the liquid end, and the crankcase on it with its top cover.
      const [baseZ, baseD] = along(f.crankBackM - 0.1, f.endFrontM);
      b.part('box', 'steelDark', p(0, 0.06, baseZ), [f.crankHalfXM * 2 + 0.2, 0.12, baseD]);
      const [crankZ, crankD] = along(f.crankBackM, f.crankFrontM);
      b.part('box', 'paint', p(0, (0.12 + f.crankTopM) / 2, crankZ), [f.crankHalfXM * 2, f.crankTopM - 0.12, crankD]);
      b.part('box', 'steelDark', p(0, f.crankTopM + 0.015, crankZ), [f.crankHalfXM * 2 - 0.2, 0.03, crankD - 0.14]);
      // The inspection cover over the gap, and a seal cover where each piston leaves the crankcase.
      b.part('box', 'steelDark', p(0, 0.88, f.crankFrontM + 0.01), [1.0, 0.2, 0.02]);
      for (const px of f.pistonXsM) b.part('cylLo', 'steelDark', p(px, f.pistonYM, f.crankFrontM + 0.01), [0.11, 0.02, 0.11], { rotationRad: [Math.PI / 2, 0, 0] });
      // The gap: four tie rods from the crankcase to the liquid end, and the drip tray under the pistons.
      const [gapZ, gapD] = along(f.crankFrontM, f.endBackM);
      for (const tx of [-0.6, 0.6]) for (const ty of [0.48, 0.68]) b.part('cylLo', 'steelDark', p(tx, ty, gapZ), [0.025, gapD, 0.025], { rotationRad: [Math.PI / 2, 0, 0] });
      b.part('box', 'steelDark', p(0, 0.4, gapZ), [1.1, 0.04, gapD]);
      // The liquid end on its pedestal, a valve cover over each piston, and the two-stage homogenizing valve at its
      // east end with its two hydraulic actuators.
      const [endZ, endD] = along(f.endBackM, f.endFrontM);
      b.part('box', 'steelDark', p(0, 0.26, endZ), [0.9, 0.28, endD - 0.04]);
      b.part('box', 'paint', p(0, (0.4 + f.endTopM) / 2, endZ), [1.2, f.endTopM - 0.4, endD]);
      for (const px of f.pistonXsM) b.part('cylLo', 'steelDark', p(px, f.endTopM + 0.02, endZ), [0.07, 0.04, 0.07]);
      b.part('box', 'steelDark', p(0.69, 0.6, endZ), [0.18, 0.3, endD - 0.04]);
      for (const dz of [-0.055, 0.055]) b.part('cylLo', 'steelDark', p(0.69, 0.86, endZ + dz), [0.045, 0.22, 0.045]);
      // The milk's nozzles on both sides, at the pipes' height.
      for (const side of [-1, 1]) b.part('cylLo', 'steelDark', p(side * (f.crankHalfXM + 0.04), at.PIPE_Y_M, 0), [0.07, 0.08, 0.07], { rotationRad: [0, 0, Math.PI / 2] });
      // The gauges' bezels on the top cover; their faces and needles are the motion's.
      for (const gauge of at.HOMOGENIZER_GAUGES) b.part('cylLo', 'steelDark', p(gauge.dxM, f.gaugeYM - 0.015, gauge.dzM), [0.1, 0.03, 0.1]);
      // The main motor behind, along x, with its fan cowl, end shield, feet and terminal box, and the belt guard from
      // its shaft to the crankshaft on the east side, where the flywheel turns.
      const motor = f.motor;
      b.part('cyl', 'paint', p(0, motor.yM, motor.zM), [motor.radiusM, motor.lengthM, motor.radiusM], { rotationRad: [0, 0, Math.PI / 2] });
      b.part('cylLo', 'steelDark', p(-motor.lengthM / 2 - 0.04, motor.yM, motor.zM), [motor.radiusM - 0.02, 0.08, motor.radiusM - 0.02], { rotationRad: [0, 0, Math.PI / 2] });
      b.part('cylLo', 'steelDark', p(motor.lengthM / 2 + 0.025, motor.yM, motor.zM), [motor.radiusM - 0.03, 0.05, motor.radiusM - 0.03], { rotationRad: [0, 0, Math.PI / 2] });
      b.part('box', 'steelDark', p(0, 0.06, motor.zM), [motor.lengthM - 0.1, 0.12, 0.5]);
      b.part('box', 'steelDark', p(0.1, motor.yM + motor.radiusM + 0.05, motor.zM), [0.18, 0.1, 0.18]);
      const guard = f.guard;
      const [guardZ, guardD] = along(guard.zMinM, guard.zMaxM);
      b.part('box', 'paint', p(guard.xM, (guard.yMinM + guard.yMaxM) / 2, guardZ), [guard.widthM, guard.yMaxM - guard.yMinM, guardD]);
      // Phase 26: the control cabinet east of it (its screen, lamps and stop are the motion's), and the lube-oil unit
      // behind its west end with its cooler (its oil sight glass is the motion's).
      const panel = at.HOMOGENIZER_PANEL;
      b.part('box', 'paint', [panel.xM, panel.heightM / 2, panel.zM], [panel.widthM, panel.heightM, panel.depthM]);
      b.part('box', 'steelDark', [panel.xM, panel.heightM + 0.02, panel.zM], [panel.widthM + 0.04, 0.04, panel.depthM + 0.04]);
      const lube = at.HOMOGENIZER_LUBE;
      b.part('box', 'paint', [lube.xM, 0.3, lube.zM], [0.25, 0.6, 0.3]);
      b.part('cylLo', 'steelDark', [lube.xM, 0.68, lube.zM], [0.05, 0.26, 0.05], { rotationRad: [Math.PI / 2, 0, 0] });
    },
    (s) => labelValue(stageValue(s, 12, 'homogenizerBar'), 0, 'bar'),
  );
}

function plateHeatExchanger(kit: Kit): Equipment {
  const { xM, zM, lengthM, depthM, heightM } = at.PHE;
  return fixture(
    kit,
    'yogurt-phe',
    12,
    'Plate heat exchanger',
    [xM, zM],
    heightM + 0.2,
    (b) => {
      // A frame with three plate packs: regeneration, heating and cooling, divided by connector plates.
      b.part('box', 'steelDark', [xM, heightM + 0.05, zM], [lengthM + 0.2, 0.1, depthM + 0.1]);
      for (const dx of [-lengthM / 2 - 0.05, lengthM / 2 + 0.05]) b.part('box', 'paint', [xM + dx, heightM / 2, zM], [0.1, heightM, depthM + 0.1]);
      const packM = (lengthM - 0.3) / 3;
      for (let i = 0; i < 3; i++) {
        const cxM = xM - lengthM / 2 + 0.05 + packM / 2 + i * (packM + 0.1);
        b.part('box', 'steel', [cxM, heightM / 2 + 0.05, zM], [packM, heightM - 0.3, depthM]);
        // Phase 25: the plates' edges down the pack's front, every 6 cm.
        for (let px = cxM - packM / 2 + 0.04; px < cxM + packM / 2 - 0.02; px += 0.06) b.part('box', 'steelDark', [px, 0.78, zM + depthM / 2 + 0.005], [0.012, 0.95, 0.01]);
        // The connector plate after the pack, between it and the next section.
        if (i < 2) b.part('box', 'steelDark', [cxM + packM / 2 + 0.05, heightM / 2, zM], [0.06, heightM - 0.1, depthM + 0.04]);
      }
      // The bottom guide bar, the four tie bolts along the frame, the ports on the fixed head (west).
      b.part('box', 'steelDark', [xM, 0.12, zM], [lengthM + 0.2, 0.08, 0.1]);
      for (const yM of [0.35, 1.35]) for (const dz of [-0.38, 0.38]) b.part('cylLo', 'steelDark', [xM, yM, zM + dz], [0.025, lengthM + 0.3, 0.025], { rotationRad: [0, 0, Math.PI / 2] });
      for (const yM of [0.45, 1.25]) for (const dz of [-0.15, 0.15]) b.part('cylLo', 'steelDark', [xM - lengthM / 2 - 0.18, yM, zM + dz], [0.05, 0.16, 0.05], { rotationRad: [0, 0, Math.PI / 2] });
      // The hot-water set east of it: the circuit's tank, piped into the movable head, the steam valve on the tank with
      // its actuator and the steam line from behind, and the circulation pump in front.
      const hot = at.HOT_WATER_SET;
      const headXM = xM + lengthM / 2 + 0.05;
      b.part('cyl', 'steel', [hot.xM, 0.55, hot.tankZM], [0.25, 1.1, 0.25]);
      b.part('cylLo', 'steelDark', [(headXM + hot.xM - 0.25) / 2, 0.45, hot.tankZM], [0.035, hot.xM - 0.25 - headXM, 0.035], { rotationRad: [0, 0, Math.PI / 2] });
      b.part('cylLo', 'steelDark', [(headXM + hot.xM - 0.25) / 2, 1.0, hot.tankZM], [0.035, hot.xM - 0.25 - headXM, 0.035], { rotationRad: [0, 0, Math.PI / 2] });
      b.part('box', 'steelDark', [hot.xM, hot.valveYM, hot.tankZM], [0.18, 0.18, 0.18]);
      b.part('cylLo', 'steelDark', [hot.xM, hot.valveYM + 0.19, hot.tankZM], [0.08, 0.2, 0.08]);
      b.part('cylLo', 'steelDark', [hot.xM, hot.valveYM, hot.tankZM - 0.45], [0.035, 0.72, 0.035], { rotationRad: [Math.PI / 2, 0, 0] });
      b.part('cylLo', 'steelDark', [hot.xM, hot.valveYM + 0.6, hot.tankZM - 0.8], [0.035, 1.2, 0.035]);
      b.part('box', 'paint', [hot.xM, 0.18, hot.pumpZM], [0.34, 0.36, 0.3]);
      b.part('cylLo', 'steelDark', [hot.xM, 0.2, (hot.tankZM + 0.25 + hot.pumpZM - 0.15) / 2], [0.035, hot.pumpZM - 0.15 - hot.tankZM - 0.25, 0.035], { rotationRad: [Math.PI / 2, 0, 0] });
      // Phase 26: the tie bolts' nuts outside both heads, thermometers on the fixed head's upper ports; on the hot-water
      // set, the expansion vessel behind the tank, the safety valve on its top, and the controller on its front, whose
      // display is the motion's.
      for (const dx of [-lengthM / 2 - 0.1, lengthM / 2 + 0.1]) {
        for (const yM of [0.35, 1.35]) for (const dz of [-0.38, 0.38]) b.part('box', 'steelDark', [xM + dx, yM, zM + dz], [0.04, 0.07, 0.07]);
      }
      for (const dz of [-0.15, 0.15]) {
        b.part('cylLo', 'steelDark', [xM - lengthM / 2 - 0.2, 1.36, zM + dz], [0.012, 0.14, 0.012]);
        b.part('box', 'steelDark', [xM - lengthM / 2 - 0.2, 1.45, zM + dz], [0.04, 0.04, 0.04]);
      }
      b.part('cylLo', 'steelDark', [hot.xM, 0.3, hot.tankZM - 0.4], [0.1, 0.4, 0.1]);
      b.part('cylLo', 'steelDark', [hot.xM, 0.3, hot.tankZM - 0.275], [0.02, 0.06, 0.02], { rotationRad: [Math.PI / 2, 0, 0] });
      b.part('cylLo', 'steelDark', [hot.xM + 0.18, 1.17, hot.tankZM - 0.13], [0.03, 0.14, 0.03]);
      b.part('box', 'steelDark', [hot.xM, hot.displayYM, hot.tankZM + 0.28], [0.2, 0.16, 0.06]);
    },
    (s) => labelValue(stageValue(s, 12, 'tempC'), 1, '°C'),
  );
}

function holdingCell(kit: Kit): Equipment {
  const { xMinM, xMaxM, zMinM, zMaxM, heightM } = at.HOLDING_CELL;
  const xM = (xMinM + xMaxM) / 2;
  const zM = (zMinM + zMaxM) / 2;
  // An open frame of posts and rails round the serpentine, which pipes.ts draws and colours by temperature.
  return fixture(
    kit,
    'holding-cell',
    12,
    'Holding cell',
    [xM, zM],
    heightM,
    (b) => {
      for (const px of [xMinM, xMaxM]) {
        for (const pz of [zMinM, zMaxM]) b.part('box', 'steelDark', [px, heightM / 2, pz], [0.08, heightM, 0.08]);
        b.part('box', 'steelDark', [px, heightM, zM], [0.08, 0.08, zMaxM - zMinM]);
      }
      for (const pz of [zMinM, zMaxM]) b.part('box', 'steelDark', [xM, heightM, pz], [xMaxM - xMinM, 0.08, 0.08]);
      // Phase 26: two beams under the serpentine's passes on their posts, a clamp over each pass at each beam, a brace
      // down each long side of the frame, and the temperature probes at the inlet and the outlet.
      for (const bx of [xMinM + 0.8, xMaxM - 0.8]) {
        b.part('box', 'steelDark', [bx, 0.79, zM], [0.06, 0.06, zMaxM - zMinM]);
        for (const pz of [zMinM + 0.05, zMaxM - 0.05]) b.part('box', 'steelDark', [bx, 0.38, pz], [0.05, 0.76, 0.05]);
        for (const passZM of at.HOLDING_CELL_PASSES_Z_M) b.part('box', 'steelDark', [bx, at.PIPE_Y_M + 0.065, passZM], [0.03, 0.02, 0.12]);
      }
      const braceM = Math.hypot(zMaxM - zMinM - 0.2, heightM - 0.25);
      for (const px of [xMinM, xMaxM]) b.part('box', 'steelDark', [px, (0.15 + heightM - 0.1) / 2, zM], [0.04, 0.04, braceM], { rotationRad: [-Math.atan2(heightM - 0.25, zMaxM - zMinM - 0.2), 0, 0] });
      for (const [px, pz] of [[xMinM + 0.4, zMaxM - 0.15], [xMaxM - 0.2, at.HOLDING_CELL_PASSES_Z_M[4]]] as const) {
        b.part('cylLo', 'steelDark', [px, at.PIPE_Y_M + 0.12, pz], [0.012, 0.14, 0.012]);
        b.part('box', 'steelDark', [px, at.PIPE_Y_M + 0.22, pz], [0.06, 0.06, 0.06]);
      }
      // Phase 25: the CCP's temperature recorder at the outlet, on its post, its chart facing the aisle.
      b.part('box', 'steelDark', [at.CCP_RECORDER.xM, at.CCP_RECORDER.yM / 2, at.CCP_RECORDER.zM - 0.08], [0.06, at.CCP_RECORDER.yM, 0.06]);
      b.part('box', 'steelDark', [at.CCP_RECORDER.xM, at.CCP_RECORDER.yM, at.CCP_RECORDER.zM - 0.04], [at.CCP_RECORDER.widthM + 0.06, at.CCP_RECORDER.heightM + 0.06, 0.08]);
    },
    (s) => labelValue(stageValue(s, 12, 'holdS'), 0, 's'),
  );
}

/** The divert valve's lamp colours: the milk line's, and off (a dark body) while the line stands. */
const VALVE_LAMP_OFF_HEX = 0x2a3036;

/**
 * The heat treatment's divert valve, the CCP's (phase 17): its flag points down the open outlet, +x forward to the
 * regeneration or −z to the reprocess tank, and the lamp on top is green forward, red diverting, amber while the wing
 * cleans, and off while the line stands. The flip follows the state even while paused, as the milk line's valve does.
 */
function divertValve(kit: Kit): Equipment {
  const { xM, zM } = at.DIVERT_VALVE;
  const b = new MachineBuilder(kit, 'yogurt-divert-valve', [xM, 0, zM]);
  b.part('box', 'steelDark', [xM, at.PIPE_Y_M, zM], [0.4, 0.4, 0.4]);
  b.part('cylLo', 'steelDark', [xM, 1.2, zM], [0.07, 0.2, 0.07]);
  b.part('box', 'paint', [xM, 1.35, zM], [0.3, 0.12, 0.3]); // actuator
  b.part('cylLo', 'steelDark', [xM, at.PIPE_Y_M / 2, zM], [0.05, at.PIPE_Y_M, 0.05]); // stand
  // Phase 26: the flanges of its three ports, and the actuator's solenoid valve with its air line down to the floor.
  for (const dx of [-0.215, 0.215]) b.part('cylLo', 'steelDark', [xM + dx, at.PIPE_Y_M, zM], [0.08, 0.03, 0.08], { rotationRad: [0, 0, Math.PI / 2] });
  b.part('cylLo', 'steelDark', [xM, at.PIPE_Y_M, zM - 0.215], [0.08, 0.03, 0.08], { rotationRad: [Math.PI / 2, 0, 0] });
  b.part('box', 'steelDark', [xM + 0.22, 1.35, zM - 0.1], [0.08, 0.1, 0.1]);
  b.part('cylLo', 'steelDark', [xM + 0.24, 0.65, zM - 0.13], [0.01, 1.3, 0.01]);
  const flag = b.pivot('flag', [xM, 1.45, zM]);
  b.part('box', 'paint', [0.16, 0, 0], [0.32, 0.05, 0.09], { parent: flag });
  const lampMaterial = kit.material('lamp');
  b.mesh('lamp', 'sphere', 'lamp', [xM, 1.56, zM], [0.065, 0.065, 0.065]);
  const palette = createLampPalette(LAMP_GLOW_HEX, LAMP_COLOR_VAR);
  let lamp: LampStatus | 'off' | null = null;
  let diverting = false;
  const paintLamp = (status: LampStatus | 'off'): void => {
    if (!(lampMaterial instanceof THREE.MeshStandardMaterial)) return;
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
  return machine(b, {
    id: 'yogurt-divert-valve',
    stage: 12,
    label: 'Divert valve',
    labelAnchorM: [xM, 1.95, zM],
    labelText: (s) => {
      const mode = yogurtOf(s)?.heat.mode;
      return mode ? HEAT_MODE_TEXT[mode] : '';
    },
    update(s, realDtS) {
      const mode = yogurtOf(s)?.heat.mode;
      diverting = mode === 'divert';
      showLamp(heatValveLamp(mode));
      // Rotating +x by +90° about y points it along −z, toward the reprocess tank.
      flag.rotation.y = ease(flag.rotation.y, diverting ? Math.PI / 2 : 0, VALVE_EASE_PER_S, realDtS);
    },
    debugState: () => ({ diverting, lamp: lamp ?? 'off', flagRad: flag.rotation.y }),
    applyTheme() {
      palette.applyTheme();
      paintLamp(lamp ?? 'off');
    },
  });
}

/* stage 13: the culture dosing pump (the tanks are vessels) */

/**
 * Phase 25: the reprocess tank's pump at its foot, east of it, which sends the diverted mix to rework in the clean.
 * Phase 26 adds the tank's other fittings.
 */
function reprocessPump(b: MachineBuilder): void {
  const { xM, zM, radiusM } = at.REPROCESS_TANK;
  b.part('cylLo', 'steelDark', [xM + radiusM + 0.1, 0.22, zM], [0.04, 0.5, 0.04], { rotationRad: [0, 0, Math.PI / 2] });
  b.part('box', 'steelDark', [at.REPROCESS_PUMP.xM, 0.2, zM], [0.4, 0.34, 0.3]);
  // Phase 26: the outlet valve before the pump, the manway, the vent's gooseneck and the CIP inlet on the dome, and the
  // high-level switch on the shell.
  b.part('box', 'steelDark', [xM + radiusM + 0.1, 0.22, zM], [0.1, 0.1, 0.1]);
  b.part('cylLo', 'steel', [xM - 0.25, 1.92, zM - 0.1], [0.18, 0.08, 0.18], { castShadow: true });
  b.part('cylLo', 'steelDark', [xM + 0.3, 2.0, zM - 0.25], [0.03, 0.3, 0.03]);
  b.part('cylLo', 'steelDark', [xM + 0.38, 2.15, zM - 0.25], [0.03, 0.16, 0.03], { rotationRad: [0, 0, Math.PI / 2] });
  b.part('cylLo', 'steelDark', [xM, 2.05, zM], [0.04, 0.3, 0.04]);
  b.part('box', 'steelDark', [xM - radiusM * Math.SQRT1_2, 1.55, zM + radiusM * Math.SQRT1_2], [0.08, 0.06, 0.08]);
}

/** Phase 25: the fruit preparation's IBC on its pallet, west of the tank, which the tank is filled from; phase 26's fittings. */
function fruitIbc(b: MachineBuilder): void {
  const { xM, zM } = at.FRUIT_IBC;
  b.part('box', 'steelDark', [xM, 0.07, zM], [1.0, 0.14, 1.0]);
  b.part('box', 'steel', [xM, 0.6, zM], [0.92, 0.92, 0.92], { castShadow: true });
  for (const yM of [0.36, 0.7, 1.06]) b.part('box', 'steelDark', [xM, yM, zM + 0.47], [0.98, 0.03, 0.02]);
  b.part('cylLo', 'steelDark', [xM, 1.1, zM], [0.12, 0.08, 0.12]);
  b.part('cylLo', 'steelDark', [xM + 0.3, 0.24, zM + 0.5], [0.05, 0.1, 0.05], { rotationRad: [Math.PI / 2, 0, 0] });
  // Phase 26: the transfer pump between the IBC and the tank and its line up over the dome; the tank's manway and its
  // level probe.
  const tank = at.FRUIT_TANK;
  const lineXM = xM + 0.7;
  const lineZM = tank.zM + 0.25;
  const topM = tank.legsM + tank.bodyM + 0.35;
  b.part('box', 'steelDark', [lineXM, 0.12, lineZM], [0.2, 0.24, 0.16]);
  b.part('cylLo', 'steelDark', [lineXM, (0.24 + topM) / 2, lineZM], [0.03, topM - 0.24, 0.03]);
  b.part('cylLo', 'steelDark', [lineXM + 0.2, topM, lineZM], [0.03, 0.4, 0.03], { rotationRad: [0, 0, Math.PI / 2] });
  b.part('cylLo', 'steelDark', [lineXM + 0.4, topM - 0.08, lineZM], [0.03, 0.16, 0.03]);
  b.part('cylLo', 'steel', [tank.xM - 0.3, tank.legsM + tank.bodyM + 0.26, tank.zM - 0.15], [0.16, 0.06, 0.16], { castShadow: true });
  b.part('cylLo', 'steelDark', [tank.xM + 0.35, tank.legsM + tank.bodyM + 0.3, tank.zM - 0.2], [0.02, 0.3, 0.02]);
}

/** Phase 25: the buffer's sterile-air filter and its pressure transmitter on the dome (P8 draws under pressure). */
function bufferFittings(b: MachineBuilder): void {
  const { xM, zM, legsM, bodyM } = at.BUFFER;
  const topM = legsM + bodyM;
  b.part('cylLo', 'steelDark', [xM - 0.35, topM + 0.45, zM - 0.3], [0.08, 0.4, 0.08]);
  b.part('cylLo', 'steelDark', [xM - 0.35, topM + 0.68, zM - 0.3], [0.05, 0.06, 0.05]);
  b.part('box', 'steelDark', [xM + 0.3, topM + 0.33, zM + 0.25], [0.08, 0.16, 0.08]);
  // Phase 26: the manway and the CIP line on the dome; a temperature transmitter and the sampling valve on the shell
  // to the aisle (its red handle is the motion's).
  const { radiusM } = at.BUFFER;
  b.part('cylLo', 'steel', [xM + 0.15, topM + 0.27, zM - 0.4], [0.22, 0.07, 0.22], { castShadow: true });
  b.part('cylLo', 'steelDark', [xM - 0.25, topM + 0.55, zM + 0.25], [0.03, 0.6, 0.03]);
  b.part('cylLo', 'steelDark', [xM - 0.5, topM + 0.85, zM + 0.25], [0.03, 0.5, 0.03], { rotationRad: [0, 0, Math.PI / 2] });
  const shellZM = (dx: number): number => zM + Math.sqrt(radiusM * radiusM - dx * dx);
  b.part('cylLo', 'steelDark', [xM + 0.5, 1.1, shellZM(0.5) + 0.07], [0.025, 0.14, 0.025], { rotationRad: [Math.PI / 2, 0, 0] });
  b.part('box', 'steelDark', [xM + 0.5, 1.1, shellZM(0.5) + 0.16], [0.07, 0.07, 0.05]);
  b.part('box', 'steelDark', [xM - 0.4, 0.65, shellZM(0.4) + 0.03], [0.06, 0.06, 0.06]);
}

function culturePump(kit: Kit): Equipment {
  const { xM, zM } = at.CULTURE_PUMP;
  return fixture(kit, 'culture-pump', 13, 'Culture dosing', [xM, zM], 1.4, (b) => {
    b.part('box', 'steelDark', [xM, 0.08, zM], [1.2, 0.16, 0.8]);
    b.part('cylLo', 'steel', [xM - 0.25, 0.65, zM], [0.28, 0.9, 0.28]); // the culture vessel
    b.part('box', 'steelDark', [xM + 0.35, 0.35, zM], [0.4, 0.38, 0.35]); // the dosing pump
    // Phase 25: the freezer chest of frozen culture beside it, its lid and handle.
    b.part('box', 'steel', [xM - 1.15, 0.4, zM], [0.8, 0.8, 0.55]);
    b.part('box', 'steelDark', [xM - 1.15, 0.82, zM], [0.82, 0.04, 0.57]);
    b.part('box', 'steelDark', [xM - 1.15, 0.7, zM + 0.29], [0.4, 0.04, 0.03]);
    // Phase 26: the vessel's lid and its stirrer's motor, the scale it stands on, the controller on its post (its
    // display is the motion's), and the freezer's compressor grille.
    b.part('cylLo', 'steelDark', [xM - 0.25, 1.12, zM], [0.3, 0.04, 0.3]);
    b.part('box', 'steelDark', [xM - 0.25, 1.24, zM], [0.12, 0.2, 0.12]);
    b.part('box', 'steelDark', [xM - 0.25, 0.18, zM], [0.62, 0.04, 0.62]);
    const panel = at.CULTURE_PANEL;
    b.part('box', 'steelDark', [panel.xM, (0.16 + panel.yM - 0.11) / 2, panel.zM - 0.07], [0.04, panel.yM - 0.11 - 0.16, 0.04]);
    b.part('box', 'steelDark', [panel.xM, panel.yM, panel.zM], [0.28, 0.22, 0.1]);
    for (const yM of [0.12, 0.2, 0.28]) b.part('box', 'steelDark', [xM - 1.15, yM, zM + 0.28], [0.6, 0.03, 0.01]);
  });
}

/* stage 14: the smoothing valve and the plate cooler (the fruit tank and the buffer are vessels) */

function smoothingValve(kit: Kit): Equipment {
  const { xM, zM } = at.SMOOTHING_VALVE;
  return fixture(kit, 'smoothing-valve', 14, 'Smoothing valve', [xM, zM], 1.3, (b) => {
    b.part('cylLo', 'steel', [xM, at.PIPE_Y_M, zM], [0.22, 0.9, 0.22], { rotationRad: [0, 0, Math.PI / 2] });
    b.part('box', 'steelDark', [xM, 1.15, zM], [0.25, 0.25, 0.25]);
    b.part('cylLo', 'steelDark', [xM, at.PIPE_Y_M / 2, zM], [0.05, at.PIPE_Y_M, 0.05]);
    // Phase 25: the strainer before it, a basket housing under the line with its drain.
    b.part('cylLo', 'steel', [xM - 0.67, at.PIPE_Y_M - 0.22, zM], [0.1, 0.34, 0.1]);
    b.part('cylLo', 'steelDark', [xM - 0.67, at.PIPE_Y_M - 0.45, zM], [0.03, 0.12, 0.03]);
    // Phase 26: the actuator's positioner, and the pressure gauge on the line after the flow meter (its face is the
    // motion's).
    b.part('box', 'steelDark', [xM, 1.32, zM], [0.1, 0.08, 0.1]);
    b.part('cylLo', 'steelDark', [at.SMOOTHING_GAUGE.xM, at.PIPE_Y_M + 0.1, zM], [0.015, 0.14, 0.015]);
    b.part('cylLo', 'steelDark', [at.SMOOTHING_GAUGE.xM, at.SMOOTHING_GAUGE.yM, zM], [0.06, 0.03, 0.06], { rotationRad: [Math.PI / 2, 0, 0] });
  });
}

function plateCooler(kit: Kit): Equipment {
  const { xM, zM, lengthM, depthM, heightM } = at.COOLER;
  return fixture(
    kit,
    'yogurt-cooler',
    14,
    'Plate cooler',
    [xM, zM],
    heightM + 0.1,
    (b) => {
      for (const dx of [-lengthM / 2, lengthM / 2]) b.part('box', 'paint', [xM + dx, heightM / 2, zM], [0.1, heightM, depthM + 0.1]);
      b.part('box', 'steel', [xM, heightM / 2 + 0.05, zM], [lengthM - 0.1, heightM - 0.2, depthM]);
      b.part('box', 'steelDark', [xM, heightM + 0.05, zM], [lengthM + 0.1, 0.1, depthM + 0.1]);
      // Phase 25: the plates' edges, the tie bolts, the ice-water ports on the back, and the ice-water pump behind it.
      for (let px = xM - lengthM / 2 + 0.1; px < xM + lengthM / 2 - 0.06; px += 0.06) b.part('box', 'steelDark', [px, heightM / 2 - 0.05, zM + depthM / 2 + 0.005], [0.012, heightM - 0.45, 0.01]);
      for (const yM of [0.3, heightM - 0.2]) for (const dz of [-0.33, 0.33]) b.part('cylLo', 'steelDark', [xM, yM, zM + dz], [0.022, lengthM + 0.2, 0.022], { rotationRad: [0, 0, Math.PI / 2] });
      for (const yM of [0.35, heightM - 0.35]) b.part('cylLo', 'steelDark', [xM + lengthM / 2 - 0.25, yM, zM - depthM / 2 - 0.08], [0.05, 0.16, 0.05], { rotationRad: [Math.PI / 2, 0, 0] });
      const pump = at.ICE_WATER_PUMP;
      b.part('box', 'paint', [pump.xM, 0.18, pump.zM], [0.3, 0.36, 0.28]);
      // Phase 26: temperature transmitters on the product line in and out, and the ice-water lines from the back
      // ports down to the floor. The control valve on the pump's line is the motion's.
      for (const px of [xM - lengthM / 2 - 0.25, xM + lengthM / 2 + 0.25]) {
        b.part('cylLo', 'steelDark', [px, at.PIPE_Y_M + 0.1, zM], [0.012, 0.14, 0.012]);
        b.part('box', 'steelDark', [px, at.PIPE_Y_M + 0.2, zM], [0.05, 0.05, 0.05]);
      }
      for (const yM of [0.35, heightM - 0.35]) {
        b.part('cylLo', 'steelDark', [xM + lengthM / 2 - 0.25, yM, zM - depthM / 2 - 0.35], [0.04, 0.38, 0.04], { rotationRad: [Math.PI / 2, 0, 0] });
        b.part('cylLo', 'steelDark', [xM + lengthM / 2 - 0.25, yM / 2, zM - depthM / 2 - 0.55], [0.04, yM, 0.04]);
      }
      b.part('cylLo', 'steelDark', [(xM + lengthM / 2 + 0.05 + pump.xM - 0.15) / 2, 0.22, pump.zM], [0.03, pump.xM - 0.15 - xM - lengthM / 2 - 0.05, 0.03], { rotationRad: [0, 0, Math.PI / 2] });
    },
    (s) => {
      const tempC = finite(yogurtOf(s)?.buffer.coolerOutletC);
      return tempC === undefined ? '' : labelValue(tempC, 1, '°C');
    },
  );
}

/* stage 15: Line P8, its check gates and the reject bin */

function checkGate(kit: Kit, id: string, label: string, xM: number, kind: 'weigh' | 'arch' | 'camera', labelTopM: number, labelText?: (snapshot: Snapshot) => string): Equipment {
  const zM = at.P8.zM;
  return fixture(
    kit,
    id,
    15,
    label,
    [xM, zM],
    labelTopM,
    (b) => {
      b.part('box', 'paint', [xM, 0.35, zM], [0.8, 0.7, 0.7]);
      b.part('box', 'rubber', [xM, 0.73, zM], [0.9, 0.06, 0.4]); // the belt the cups pass on
      if (kind === 'arch') b.part('box', 'paint', [xM, 1.0, zM], [0.35, 0.55, 0.75]);
      if (kind === 'camera') {
        b.part('box', 'paint', [xM, 1.15, zM], [0.5, 0.25, 0.55]);
        b.part('cylLo', 'paint', [xM, 0.95, zM - 0.3], [0.04, 0.45, 0.04]);
      }
    },
    labelText,
  );
}

function rejectBin(kit: Kit): Equipment {
  const { xM, zM } = at.REJECT_BIN;
  return fixture(
    kit,
    'p8-reject-bin',
    15,
    'Reject bin',
    [xM, zM],
    0.7,
    (b) => b.part('box', 'paint', [xM, 0.3, zM], [0.8, 0.6, 0.6]),
    (s) => labelValue(stageValue(s, 15, 'cupsRejected'), 0, 'cups'),
  );
}

/* stage 16: tray packer, palletizer, wrapper, warm room, blast chiller, cold room */

/** P8 runs: the tray packer and the palletizer work while it fills. */
const p8Running = (s: Snapshot): boolean => yogurtOf(s)?.p8.state === 'running';

function trayPacker(kit: Kit): Equipment {
  const { xM, zM } = at.TRAY_PACKER;
  const { xMinM, xMaxM } = at.OUTFEED;
  const b = new MachineBuilder(kit, 'p8-tray-packer', [xM, 0, zM]);
  b.part('box', 'rubber', [(xMinM + xMaxM) / 2, 0.72, zM], [xMaxM - xMinM, 0.06, 0.45]); // the outfeed from P8
  // The belt's legs in its own material: one mesh with it (phase 24, draw calls).
  for (const px of [xMinM + 0.2, xMaxM - 0.2]) b.part('box', 'rubber', [px, 0.35, zM], [0.08, 0.7, 0.4]);
  body(b, xM + 0.1, zM, [1.8, 1.0, 1.4]);
  b.part('box', 'glass', [xM + 0.1, 1.35, zM], [1.8, 0.7, 1.4]); // the pick-and-place cell
  // The pick-and-place head: it shuttles a row of cups from the outfeed into the tray while P8 fills (phase 19).
  const head = b.pivot('pickHead', [xM + 0.1, 1.55, zM]);
  b.part('box', 'steelDark', [0, 0, 0], [0.3, 0.12, 0.9], { parent: head });
  let phaseRad = 0;
  return machine(b, {
    id: 'p8-tray-packer',
    stage: 16,
    label: 'Tray packer',
    labelAnchorM: [xM, 2.35, zM],
    update(s, realDtS) {
      if (p8Running(s)) phaseRad = (phaseRad + 2.5 * motionDtS(s, realDtS)) % FULL_TURN_RAD;
      head.position.x = b.local([xM + 0.1, 0, zM]).x + 0.55 * Math.sin(phaseRad);
    },
    debugState: () => ({ headM: head.position.x, running: phaseRad !== 0 }),
  });
}

/**
 * The gantry palletizer (phase 24, palletLine.ts): four posts and two beams over the pallet place, the tray infeed from
 * the packer, the place's rollers and the empty-pallet dispenser behind it. The bridge runs along the line, the trolley
 * across it, and the lift lowers the vacuum head onto each tray. With the hero model these are its nodes; in grey
 * boxes, pivots of the same names at the same rest transforms.
 */
function palletizer(kit: Kit, ctx: EquipmentContext, line: PalletLine): Equipment {
  const { xM, zM } = at.PALLETIZER;
  const L = at.PALLET_LINE;
  const b = new MachineBuilder(kit, 'yogurt-palletizer', [xM, 0, zM]);
  for (const dx of [-2.15, 0.75]) {
    for (const dz of [-0.9, 0.9]) b.part('box', 'paint', [xM + dx, 1.025, zM + dz], [0.1, 2.05, 0.1]);
    b.part('box', 'paint', [xM + dx, 2.0, zM], [0.1, 0.1, 1.9]);
  }
  for (const dz of [-0.9, 0.9]) b.part('box', 'paint', [xM - 0.7, 2.0, zM + dz], [3.0, 0.1, 0.12]);
  const inMidM = (L.infeed.xMinM + L.infeed.xMaxM) / 2;
  const inLenM = L.infeed.xMaxM - L.infeed.xMinM;
  b.part('box', 'rubber', [inMidM, L.infeed.topM - 0.02, zM], [inLenM, 0.04, L.infeed.widthM]);
  b.part('box', 'steelDark', [inMidM, (L.infeed.topM - 0.04) / 2, zM], [inLenM - 0.1, L.infeed.topM - 0.04, L.infeed.widthM - 0.1]);
  b.part('box', 'steelDark', [xM, L.rollerTopM / 2, zM], [1.5, L.rollerTopM, L.widthM]);
  for (const dx of [-0.66, 0.66]) for (const dz of [-0.56, 0.56]) b.part('box', 'steelDark', [xM + dx, 0.65, L.dispenserZM + dz], [0.08, 1.3, 0.08]);
  // The moving parts, nested as the model's nodes: bridge > trolley > lift (the lift's origin is the head's underside).
  let bridge: THREE.Object3D = b.pivot('bridge', [xM + GANTRY.bridgeRestXM, GANTRY.bridgeYM, zM]);
  b.part('box', 'paint', [0, 0, 0], [0.18, 0.1, 2.0], { parent: bridge as THREE.Group });
  const greyTrolley = b.pivot('trolley', [xM, GANTRY.bridgeYM, zM]);
  bridge.add(greyTrolley);
  greyTrolley.position.set(0, 0, 0);
  b.part('box', 'steelDark', [0, 0, 0], [0.36, 0.26, 0.34], { parent: greyTrolley });
  const greyLift = b.pivot('lift', [xM, GANTRY.restM, zM]);
  greyTrolley.add(greyLift);
  greyLift.position.set(0, GANTRY.restM - GANTRY.bridgeYM, 0);
  b.part('box', 'steelDark', [0, 0.055, 0], [0.32, 0.07, 0.47], { parent: greyLift });
  b.part('box', 'steel', [0, 0.97, 0], [0.08, 1.76, 0.08], { parent: greyLift });
  let trolley: THREE.Object3D = greyTrolley;
  let lift: THREE.Object3D = greyLift;
  let hero = false;
  const apply = (): void => {
    const pose = line.gantry;
    bridge.position.x = pose.bridgeXM;
    trolley.position.z = pose.trolleyZM;
    lift.position.y = pose.liftM - GANTRY.bridgeYM;
  };
  return machine(b, {
    id: 'yogurt-palletizer',
    stage: 16,
    label: 'Palletizer',
    labelAnchorM: [xM - 0.7, 3.85, zM],
    labelText: () => `${line.stacked} of ${STACK_CAPACITY} trays`,
    update(s, realDtS) {
      line.advance(s, realDtS);
      apply();
    },
    debugState: () => ({
      step: line.gantry.step,
      bridgeXM: bridge.position.x,
      trolleyZM: trolley.position.z,
      liftM: lift.position.y + GANTRY.bridgeYM,
      carrying: line.gantry.carrying,
      stacked: line.stacked,
      laid: line.laid,
      closed: line.closed,
      sliding: line.place.slideFrac < 1,
      hero,
    }),
    onBuilt(object, isAlive) {
      swapInHero(ctx, object, { path: HERO_MODELS.yogurtPalletizer, nodes: ['bridge', 'trolley', 'lift'] }, (nodes) => {
        ({ bridge, trolley, lift } = nodes);
        hero = true;
        // A frame of thin parts: its shadows would cost draw calls and show little (the wing's small machines cast none).
        object.getObjectByName(`${object.name}-hero`)?.traverse((each) => (each.castShadow = false));
        apply();
      }, isAlive);
    },
  });
}

/**
 * The stretch wrapper (phase 24): the UHT line's model (phase 12) and its wrap cycle (packs/stretchWrap.ts), here with
 * the wing's rollers to and from its turntable, the film web from the roll to the load, and the film shell that grows
 * up the load and stays on it to the staging row. The pallet on the turntable turns with it (palletLine.ts).
 */
function wrapper(kit: Kit, ctx: EquipmentContext, line: PalletLine): Equipment {
  const { xM, zM } = at.WRAPPER;
  const L = at.PALLET_LINE;
  const b = new MachineBuilder(kit, 'yogurt-wrapper', [xM, 0, zM]);
  const [mastX, , mastZ] = MAST_AT_M;
  b.part('box', 'paint', [xM + mastX, MAST_HEIGHT_M / 2, zM + mastZ], [0.22, MAST_HEIGHT_M, 0.22]);
  let turntable: THREE.Object3D = b.pivot('turntable', [xM + TURNTABLE_AT_M[0], TURNTABLE_AT_M[1], zM + TURNTABLE_AT_M[2]]);
  b.part('cyl', 'steelDark', [0, 0, 0], [1.0, 0.25, 1.0], { parent: turntable as THREE.Group });
  let carriage: THREE.Object3D = b.pivot('carriage', [xM + CARRIAGE_AT_M[0], CARRIAGE_AT_M[1], zM + CARRIAGE_AT_M[2]]);
  b.part('box', 'paint', [0.1, 0.3, 0.05], [0.3, 0.6, 0.3], { parent: carriage as THREE.Group });
  // The rollers to the turntable and from it to the staging row's end: the wing's, kept with the model.
  const rollers = b.pivot('rollers', [xM, 0, zM]);
  for (const run of [L.toWrapper, L.outfeed]) {
    const lengthM = run.xMaxM - run.xMinM;
    // One material for the whole run, frames and legs too: a mesh, a draw call.
    for (const side of [-1, 1]) b.part('box', 'steel', [(run.xMinM + run.xMaxM) / 2 - xM, L.rollerTopM - 0.06, side * (L.widthM / 2 + 0.03)], [lengthM, 0.08, 0.05], { parent: rollers });
    for (let rx = run.xMinM + 0.06; rx <= run.xMaxM - 0.05; rx += 0.125) b.part('cylLo', 'steel', [rx - xM, L.rollerTopM - 0.04, 0], [0.04, L.widthM, 0.04], { parent: rollers, rotationRad: [Math.PI / 2, 0, 0] });
    for (let lx = run.xMinM + 0.1; lx < run.xMaxM; lx += 1.5) for (const side of [-1, 1]) b.part('box', 'steel', [lx - xM, (L.rollerTopM - 0.1) / 2, side * (L.widthM / 2 + 0.03)], [0.05, L.rollerTopM - 0.1, 0.05], { parent: rollers });
  }
  // The film: the web from the roll to the load, and the shell round the load, both clear film.
  const web = createFilmWeb(FILM_TOP_M);
  const shellMaterial = createFilmMaterial('shell');
  const shell = new THREE.Mesh(new THREE.BoxGeometry(PALLET.widthM + 0.02, 1, PALLET.depthM + 0.02).translate(0, 0.5, 0), shellMaterial);
  shell.name = 'film-shell';
  shell.visible = false;
  shell.castShadow = false;
  const extras = new THREE.Group();
  extras.name = 'film';
  extras.add(web.mesh, shell);
  let hero = false;
  const apply = (): void => {
    const pose = line.wrap;
    turntable.rotation.y = pose.turnRad;
    carriage.position.y = CARRIAGE_AT_M[1] + pose.carriageM;
    web.update(pose);
    const rider = line.rider;
    const heightM = rider && rider.phase !== 'toWrapper' ? filmHeightM(pose.filmFrac) : 0;
    shell.visible = heightM > 0.005;
    if (rider && shell.visible) {
      shell.position.set(rider.xM - xM, L.rollerTopM + FILM_BOTTOM_M, 0);
      shell.rotation.y = rider.phase === 'wrapping' ? pose.turnRad : 0;
      shell.scale.y = heightM;
    }
  };
  return machine(b, {
    id: 'yogurt-wrapper',
    stage: 16,
    label: 'Stretch wrapper',
    labelAnchorM: [xM - 0.6, 3.1, zM - 0.5],
    labelText: () => {
      const rider = line.rider;
      if (rider?.phase === 'wrapping') return `wrapping · ${Math.min(WRAP_TURNS, Math.floor(line.wrap.turnRad / FULL_TURN_RAD) + 1)} of ${WRAP_TURNS} turns`;
      return rider ? 'pallet on the rollers' : 'waiting';
    },
    update(s, realDtS) {
      line.advance(s, realDtS);
      apply();
    },
    debugState: () => ({
      wrapping: line.rider?.phase === 'wrapping',
      riderPhase: line.rider?.phase ?? 'none',
      riderXM: line.rider?.xM ?? 0,
      phase: line.wrap.phase,
      turnRad: turntable.rotation.y,
      carriageM: carriage.position.y - CARRIAGE_AT_M[1],
      filmFrac: line.wrap.filmFrac,
      web: web.mesh.visible,
      shell: shell.visible,
      hero,
    }),
    dispose() {
      web.dispose();
      shell.geometry.dispose();
      shellMaterial.dispose();
    },
    onBuilt(object, isAlive) {
      object.add(extras);
      swapInHero(ctx, object, { path: HERO_MODELS.stretchWrapper, nodes: ['turntable', 'carriage'], keep: [rollers, extras] }, (nodes) => {
        ({ turntable, carriage } = nodes);
        hero = true;
        // No shadows, as the wing's other small machines: each would cost a draw call (the overview stands at its budget).
        object.getObjectByName(`${object.name}-hero`)?.traverse((each) => (each.castShadow = false));
        apply();
      }, isAlive);
    },
  });
}

/** Four walls of insulated panel, with a doorway in the wall at `doorAt`. No roof: the overview looks in. */
function walls(b: MachineBuilder, rect: { xMinM: number; xMaxM: number; zMinM: number; zMaxM: number }, heightM: number, gaps: readonly { side: 'north' | 'south' | 'east' | 'west'; atM: number; widthM: number }[]): void {
  const thickM = 0.15;
  const y = heightM / 2;
  const run = (side: 'north' | 'south' | 'east' | 'west', fromM: number, toM: number): void => {
    const cut = gaps.filter((gap) => gap.side === side).sort((a, b2) => a.atM - b2.atM);
    let startM = fromM;
    for (const gap of [...cut, { atM: toM + 1e9, widthM: 0 }]) {
      const endM = Math.min(toM, gap.atM - gap.widthM / 2);
      if (endM - startM > 0.05) {
        const midM = (startM + endM) / 2;
        const lenM = endM - startM;
        if (side === 'north' || side === 'south') {
          const zM = side === 'north' ? rect.zMinM : rect.zMaxM;
          b.part('box', 'steel', [midM, y, zM], [lenM, heightM, thickM], { castShadow: true });
        } else {
          const xM = side === 'west' ? rect.xMinM : rect.xMaxM;
          b.part('box', 'steel', [xM, y, midM], [thickM, heightM, lenM], { castShadow: true });
        }
      }
      startM = gap.atM + gap.widthM / 2;
    }
  };
  run('north', rect.xMinM, rect.xMaxM);
  run('south', rect.xMinM, rect.xMaxM);
  run('west', rect.zMinM, rect.zMaxM);
  run('east', rect.zMinM, rect.zMaxM);
}

function warmRoom(kit: Kit): Equipment {
  const r = at.WARM_ROOM;
  const xM = (r.xMinM + r.xMaxM) / 2;
  const zM = (r.zMinM + r.zMaxM) / 2;
  return fixture(
    kit,
    'warm-room',
    16,
    'Warm room',
    [xM, zM],
    r.wallM,
    (b) => walls(b, r, r.wallM, [{ side: 'east', atM: at.WARM_DOOR.zM, widthM: at.WARM_DOOR.widthM }]),
    (s) => labelValue(finite(yogurtOf(s)?.coldChain.warmRoom.tempC), 0, '°C'),
  );
}

function blastChiller(kit: Kit): Equipment {
  const r = at.BLAST_CHILLER;
  const xM = (r.xMinM + r.xMaxM) / 2;
  const zM = (r.zMinM + r.zMaxM) / 2;
  const lengthM = r.xMaxM - r.xMinM;
  const depthM = r.zMaxM - r.zMinM;
  // A tunnel, open at both ends: the pallets ride through it on a roller track.
  return fixture(
    kit,
    'blast-chiller',
    16,
    'Blast chiller',
    [xM, zM],
    r.heightM,
    (b) => {
      b.part('box', 'steel', [xM, r.heightM - 0.1, zM], [lengthM, 0.2, depthM], { castShadow: true });
      for (const dz of [-depthM / 2, depthM / 2]) b.part('box', 'steel', [xM, r.heightM / 2, zM + dz], [lengthM, r.heightM, 0.15], { castShadow: true });
      b.part('box', 'steelDark', [xM, 0.2, zM], [lengthM, 0.4, 1.3]); // the roller track
      b.part('box', 'steel', [xM, r.heightM + 0.3, zM], [1.6, 0.4, 1.2], { castShadow: true }); // the refrigeration unit on top, in the tunnel's steel (one mesh)
    },
    (s) => {
      const pallets = finite(yogurtOf(s)?.coldChain.chiller.pallets);
      return pallets === undefined ? '' : labelValue(pallets, 0, pallets === 1 ? 'pallet' : 'pallets');
    },
  );
}

function coldRoom(kit: Kit): Equipment {
  const r = at.COLD_ROOM;
  const xM = (r.xMinM + r.xMaxM) / 2;
  const zM = (r.zMinM + r.zMaxM) / 2;
  return fixture(
    kit,
    'cold-room',
    16,
    'Cold room',
    [xM, zM],
    r.wallM,
    (b) => {
      // The dock doors in the north wall, facing the reefer yard, and a doorway from the chiller in the south one.
      walls(b, r, r.wallM, [...at.DOCK_DOORS_X_M.map((atM) => ({ side: 'north' as const, atM, widthM: 2.8 })), { side: 'south', atM: at.COLD_DOORWAY.xM, widthM: at.COLD_DOORWAY.widthM }]);
      for (const doorXM of at.DOCK_DOORS_X_M) {
        b.part('box', 'steel', [doorXM, r.wallM - 0.15, r.zMinM], [3.0, 0.3, 0.25], { castShadow: true }); // door head, in the walls' steel (one mesh)
        b.part('box', 'concrete', [doorXM, 0.6, r.zMinM - 0.6], [3.0, 1.2, 1.2]); // dock leveller
      }
      // Two rows of racks along the room, three levels, for the pallets of phase 19.
      for (const rowZM of [r.zMinM + 1.4, r.zMaxM - 1.4]) {
        for (let i = 0; i < 6; i++) {
          const rxM = r.xMinM + 1.2 + i * 2.6;
          for (const dz of [-0.5, 0.5]) b.part('box', 'rack', [rxM, 1.6, rowZM + dz], [0.08, 3.2, 0.08]);
          for (const yM of [0.1, 1.2, 2.3]) b.part('box', 'rack', [rxM + 1.25, yM, rowZM], [2.5, 0.08, 1.1]);
        }
      }
    },
    (s) => labelValue(finite(yogurtOf(s)?.coldChain.coldRoom.tempC), 1, '°C'),
  );
}
