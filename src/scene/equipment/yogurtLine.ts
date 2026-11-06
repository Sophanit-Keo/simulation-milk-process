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
import { createP8Carrier, p8Cups, p8Filler } from './yogurt/p8Machine';
import { finite, HEAT_MODE_TEXT, heatValveLamp, phRingFrac, tankStirs, yogurtFill, yogurtOf } from './yogurt/readings';

/** A held tank's lamp (phase 20, D30): red, over its pH probe, at about the probe's height plus a little. */
const HELD_LAMP_HEX = 0xff3b30;
const HELD_LAMP_Y_M = 2.15;

/** The yogurt line, stages 11–16: one Equipment per machine. */
export const yogurtLine: EquipmentFactory = (ctx) => {
  const kit = createKit(ctx);
  // P8's machine and its cups follow one carrier clock (phase 18).
  const carrier = createP8Carrier();
  return [
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
    }),
    p8Filler(kit, carrier, ctx),
    // The gates stand 1.1 m apart, so their labels stand at three heights, one above the other at the stage's stop.
    checkGate(kit, 'p8-checkweigher', 'Checkweigher', at.CHECK_GATES.checkweigher, 'weigh', 0.9, (s) => labelValue(stageValue(s, 15, 'fillTargetG'), 0, 'g')),
    checkGate(kit, 'p8-metal-detector', 'Metal detector', at.CHECK_GATES.metalDetector, 'arch', 1.7),
    checkGate(kit, 'p8-vision', 'Vision check', at.CHECK_GATES.vision, 'camera', 2.5),
    rejectBin(kit),
    p8Cups(kit, carrier),
    trayPacker(kit),
    palletizer(kit),
    wrapper(kit),
    warmRoom(kit),
    blastChiller(kit),
    coldRoom(kit),
    coldChainTokens(kit),
  ];
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
  if (legsM > 0) b.legs([xM, zM], radiusM * 0.72, bodyBottomM, 4, 0.07);
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
  }, (s) => labelValue(stageValue(s, 11, 'powderKgPerT'), 1, 'kg/t'));
}

function highShearMixer(kit: Kit): Equipment {
  const { xM, zM } = at.MIXER;
  // A powder funnel on a pump: the powder is drawn into the milk as it passes.
  return fixture(kit, 'high-shear-mixer', 11, 'High-shear mixer', [xM, zM], 1.9, (b) => {
    body(b, xM, zM, [0.9, 0.6, 0.7]);
    b.part('cylLo', 'steel', [xM, 0.9, zM], [0.22, 0.6, 0.22]);
    b.part('coneDown', 'steel', [xM, 1.5, zM], [0.45, 0.6, 0.45]); // the funnel, wide at the top
  });
}

function stabilizerSkid(kit: Kit): Equipment {
  const { xM, zM } = at.STABILIZER_SKID;
  return fixture(kit, 'stabilizer-skid', 11, 'Stabilizer dosing', [xM, zM], 1.3, (b) => {
    b.part('box', 'steelDark', [xM, 0.08, zM], [1.6, 0.16, 1.0]);
    for (const dx of [-0.4, 0.4]) b.part('cylLo', 'paint', [xM + dx, 0.6, zM], [0.3, 0.9, 0.3]); // two drums
    b.part('box', 'paint', [xM, 0.3, zM + 0.4], [0.4, 0.3, 0.25]); // dosing pump
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
  });
}

function homogenizer(kit: Kit): Equipment {
  const { xM, zM } = at.HOMOGENIZER;
  return fixture(
    kit,
    'yogurt-homogenizer',
    12,
    'Homogenizer',
    [xM, zM],
    1.35,
    (b) => {
      body(b, xM, zM, [1.4, 1.0, 0.9]);
      b.part('box', 'steelDark', [xM, 1.15, zM], [1.2, 0.3, 0.6]); // the crank case and pistons
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
      }
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

function culturePump(kit: Kit): Equipment {
  const { xM, zM } = at.CULTURE_PUMP;
  return fixture(kit, 'culture-pump', 13, 'Culture dosing', [xM, zM], 1.4, (b) => {
    b.part('box', 'steelDark', [xM, 0.08, zM], [1.2, 0.16, 0.8]);
    b.part('cylLo', 'steel', [xM - 0.25, 0.65, zM], [0.28, 0.9, 0.28]); // the culture vessel
    b.part('box', 'steelDark', [xM + 0.35, 0.35, zM], [0.4, 0.38, 0.35]); // the dosing pump
  });
}

/* stage 14: the smoothing valve and the plate cooler (the fruit tank and the buffer are vessels) */

function smoothingValve(kit: Kit): Equipment {
  const { xM, zM } = at.SMOOTHING_VALVE;
  return fixture(kit, 'smoothing-valve', 14, 'Smoothing valve', [xM, zM], 1.3, (b) => {
    b.part('cylLo', 'steel', [xM, at.PIPE_Y_M, zM], [0.22, 0.9, 0.22], { rotationRad: [0, 0, Math.PI / 2] });
    b.part('box', 'steelDark', [xM, 1.15, zM], [0.25, 0.25, 0.25]);
    b.part('cylLo', 'steelDark', [xM, at.PIPE_Y_M / 2, zM], [0.05, at.PIPE_Y_M, 0.05]);
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
  for (const px of [xMinM + 0.2, xMaxM - 0.2]) b.part('box', 'steelDark', [px, 0.35, zM], [0.08, 0.7, 0.4]);
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

function palletizer(kit: Kit): Equipment {
  const { xM, zM } = at.PALLETIZER;
  const b = new MachineBuilder(kit, 'yogurt-palletizer', [xM, 0, zM]);
  b.part('box', 'steelDark', [xM, 0.15, zM + 0.9], [1.3, 0.3, 1.1]); // the pallet place
  b.part('cyl', 'paint', [xM, 0.3, zM - 0.6], [0.45, 0.6, 0.45]); // the robot's base
  b.part('box', 'paint', [xM, 1.5, zM - 0.6], [0.35, 1.8, 0.35]); // its column
  // Its arm swings from the infeed to the pallet while P8 fills (phase 19); the pallet it builds is a cold-chain token.
  const arm = b.pivot('arm', [xM, 2.45, zM - 0.6]);
  b.part('box', 'paint', [0, 0, 0.5], [0.3, 0.3, 1.3], { parent: arm });
  let phaseRad = 0;
  return machine(b, {
    id: 'yogurt-palletizer',
    stage: 16,
    label: 'Palletizer',
    labelAnchorM: [xM, 3.25, zM],
    update(s, realDtS) {
      if (p8Running(s)) phaseRad = (phaseRad + 1.6 * motionDtS(s, realDtS)) % FULL_TURN_RAD;
      arm.rotation.y = 0.9 * Math.sin(phaseRad);
    },
    debugState: () => ({ armRad: arm.rotation.y }),
  });
}

/** The wrapper turns a closed pallet this long, in animation seconds. */
const WRAP_S = 6;

function wrapper(kit: Kit): Equipment {
  const { xM, zM } = at.WRAPPER;
  const b = new MachineBuilder(kit, 'yogurt-wrapper', [xM, 0, zM]);
  b.part('box', 'paint', [xM + 1.2, 1.25, zM], [0.25, 2.5, 0.35], { castShadow: true }); // mast
  // The turntable turns each pallet the palletizer closes (phase 19), the newest pallet's id telling one has.
  const table = b.pivot('turntable', [xM, 0.1, zM]);
  b.part('cyl8', 'steelDark', [0, 0, 0], [0.95, 0.2, 0.95], { parent: table });
  let newest: number | null = null;
  let wrapLeftS = 0;
  return machine(b, {
    id: 'yogurt-wrapper',
    stage: 16,
    label: 'Stretch wrapper',
    labelAnchorM: [xM, 2.95, zM],
    update(s, realDtS) {
      const pallets = yogurtOf(s)?.coldChain.pallets;
      if (pallets && pallets.length > 0) {
        const id = pallets.reduce((most, pallet) => Math.max(most, pallet.id), 0);
        if (newest !== null && id > newest) wrapLeftS = WRAP_S;
        newest = id;
      }
      const dtS = motionDtS(s, realDtS);
      if (wrapLeftS > 0) {
        wrapLeftS = Math.max(0, wrapLeftS - dtS);
        table.rotation.y = (table.rotation.y + 2.2 * dtS) % FULL_TURN_RAD;
      }
    },
    debugState: () => ({ wrapping: wrapLeftS > 0, tableRad: table.rotation.y }),
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
    (b) => walls(b, r, r.wallM, [{ side: 'north', atM: xM, widthM: 2 }]),
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
      b.part('box', 'paint', [xM, r.heightM + 0.3, zM], [1.6, 0.4, 1.2]); // the refrigeration unit on top
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
      walls(b, r, r.wallM, [...at.DOCK_DOORS_X_M.map((atM) => ({ side: 'north' as const, atM, widthM: 2.8 })), { side: 'south', atM: 33.2, widthM: 2.4 }]);
      for (const doorXM of at.DOCK_DOORS_X_M) {
        b.part('box', 'steelDark', [doorXM, r.wallM - 0.15, r.zMinM], [3.0, 0.3, 0.25]); // door head
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
