import { describe, expect, it } from 'vitest';
import { degToRad, UHT_MODES, type Snapshot, type UhtMode } from '../../src/contracts';
import {
  flowFrac,
  GAUGE_FULL_SCALE_BAR,
  heatGlowFrac,
  needleAngleRad,
  steamFrac,
  tankFillFrac,
  uhtModeOf,
  valveLamp,
  VAPOUR_FULL_LPH,
  vapourFrac,
} from '../../src/scene/equipment/liquid/visuals';
import { advancePhase, MAX_MOTION_RATE, motionDtS, motionRate } from '../../src/scene/motion';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';

// What the liquid line shows, from the snapshot (phase 3): each mapping on its own, without three.js meshes.

const staticSnapshot = (): Snapshot => structuredClone(createSim(plantConfig).snapshot());
const CAPACITY_LPH = plantConfig.uht.capacityLph;

/** A snapshot in `mode`, with the line's flows as the sim would send them in that mode. */
function inMode(mode: UhtMode, uhtLph = CAPACITY_LPH): Snapshot {
  const snapshot = staticSnapshot();
  snapshot.liquid.uhtMode = mode;
  for (const point of ['silo', 'separator', 'feedTank', 'preheater', 'deaerator', 'homogenizer', 'holdingTube'] as const) {
    snapshot.line[point].flowLph = uhtLph;
  }
  const diverting = mode === 'divert';
  snapshot.line.divert.flowLph = diverting ? uhtLph : 0;
  snapshot.line.flashVessel.flowLph = diverting ? 0 : uhtLph;
  snapshot.line.cooler.flowLph = diverting ? 0 : uhtLph;
  return snapshot;
}

describe('tankFillFrac', () => {
  it('is the level over the capacity, for each tank of contracts v2', () => {
    const snapshot = staticSnapshot();
    const { tanks } = snapshot.liquid;
    tanks.silo = { levelL: 25_000, capacityL: 100_000 };
    tanks.mixTank = { levelL: 7_500, capacityL: 10_000 };
    tanks.asepticTank = { levelL: 18_000, capacityL: 20_000 };
    tanks.rejectTank = { levelL: 0, capacityL: 6_000 };
    expect(tankFillFrac(snapshot, 'silo')).toBeCloseTo(0.25, 12);
    expect(tankFillFrac(snapshot, 'mixTank')).toBeCloseTo(0.75, 12);
    expect(tankFillFrac(snapshot, 'asepticTank')).toBeCloseTo(0.9, 12);
    expect(tankFillFrac(snapshot, 'rejectTank')).toBe(0);
  });

  it('starts at plant.json’s opening levels on the static plant', () => {
    const snapshot = staticSnapshot();
    expect(tankFillFrac(snapshot, 'silo')).toBeCloseTo(plantConfig.standardization.siloStartFrac, 12);
    expect(tankFillFrac(snapshot, 'mixTank')).toBeCloseTo(plantConfig.standardization.mixTankStartFrac, 12);
    expect(tankFillFrac(snapshot, 'asepticTank')).toBeCloseTo(plantConfig.asepticTank.startFrac, 12);
  });

  it('stays within 0–1, and is undefined for a tank the snapshot lacks or can’t size', () => {
    const snapshot = staticSnapshot();
    snapshot.liquid.tanks.rejectTank = { levelL: 7_000, capacityL: 6_000 };
    expect(tankFillFrac(snapshot, 'rejectTank')).toBe(1);
    snapshot.liquid.tanks.rejectTank = { levelL: -5, capacityL: 6_000 };
    expect(tankFillFrac(snapshot, 'rejectTank')).toBe(0);
    snapshot.liquid.tanks.rejectTank = { levelL: 100, capacityL: 0 };
    expect(tankFillFrac(snapshot, 'rejectTank')).toBeUndefined();
    snapshot.liquid.tanks.rejectTank = { levelL: Number.NaN, capacityL: 6_000 };
    expect(tankFillFrac(snapshot, 'rejectTank')).toBeUndefined();
    const older = staticSnapshot() as Partial<Snapshot>;
    delete older.liquid;
    expect(tankFillFrac(older as Snapshot, 'silo')).toBeUndefined();
  });
});

describe('needleAngleRad', () => {
  const deg = (rad: number): number => (rad * 180) / Math.PI;

  it('sweeps 270° clockwise seen from above: zero at the front left, half scale at twelve, full at the front right', () => {
    expect(deg(needleAngleRad(0, 300))).toBeCloseTo(225, 9);
    expect(deg(needleAngleRad(150, 300))).toBeCloseTo(90, 9);
    expect(deg(needleAngleRad(300, 300))).toBeCloseTo(-45, 9);
    // A rotation of +x by 90° about y points it along -z, the far side of the dial: twelve o'clock from the front.
    const angle = needleAngleRad(150, 300);
    expect(Math.cos(angle)).toBeCloseTo(0, 9);
    expect(-Math.sin(angle)).toBeCloseTo(-1, 9);
  });

  it('puts the set points high on their dials: 200 of 300 bar and 30 of 60 bar', () => {
    const { stage1Bar, stage2Bar } = plantConfig.homogenizer;
    expect(needleAngleRad(stage1Bar, GAUGE_FULL_SCALE_BAR.stage1)).toBeCloseTo(degToRad(225 - 180), 9);
    expect(needleAngleRad(stage2Bar, GAUGE_FULL_SCALE_BAR.stage2)).toBeCloseTo(degToRad(90), 9);
  });

  it('falls with the pressure, so a pressure loss shows as a needle drop', () => {
    expect(needleAngleRad(100, 300)).toBeGreaterThan(needleAngleRad(200, 300));
  });

  it('stops at both ends of the dial, and reads a missing number as zero', () => {
    expect(needleAngleRad(-20, 300)).toBe(needleAngleRad(0, 300));
    expect(needleAngleRad(900, 300)).toBe(needleAngleRad(300, 300));
    expect(needleAngleRad(Number.NaN, 300)).toBe(needleAngleRad(0, 300));
  });
});

describe('the divert valve’s lamp', () => {
  it('is red while diverting, amber while cleaning or sterilizing, green in production', () => {
    const lamps = Object.fromEntries(UHT_MODES.map((mode) => [mode, valveLamp(mode)]));
    expect(lamps).toEqual({ production: 'ok', divert: 'bad', cip: 'warn', sterilize: 'warn', aic: 'warn' });
  });

  it('reads the mode from liquid.uhtMode', () => {
    for (const mode of UHT_MODES) expect(uhtModeOf(inMode(mode))).toBe(mode);
  });

  it('without contracts v2’s liquid part, diverts while milk flows to the reject tank', () => {
    const older = staticSnapshot() as Partial<Snapshot>;
    delete older.liquid;
    expect(uhtModeOf(older as Snapshot)).toBe('production');
    (older as Snapshot).line.divert.flowLph = 16_000;
    expect(uhtModeOf(older as Snapshot)).toBe('divert');
  });
});

describe('heatGlowFrac', () => {
  it('is dark up to 30 °C, rises in a straight line and glows fully from the 80 °C preheat', () => {
    expect(heatGlowFrac(4)).toBe(0);
    expect(heatGlowFrac(30)).toBe(0);
    expect(heatGlowFrac(55)).toBeCloseTo(0.5, 12);
    expect(heatGlowFrac(plantConfig.preheating.preheatTempC)).toBe(1);
    expect(heatGlowFrac(140)).toBe(1);
    expect(heatGlowFrac(Number.NaN)).toBe(0);
  });
});

describe('steam and vapour', () => {
  it('flowFrac is the share of the UHT plant’s full flow', () => {
    expect(flowFrac(CAPACITY_LPH)).toBe(1);
    expect(flowFrac(CAPACITY_LPH / 2)).toBe(0.5);
    expect(flowFrac(0)).toBe(0);
    expect(flowFrac(2 * CAPACITY_LPH)).toBe(1);
  });

  it('puffs steam at the injector while heating milk (producing or diverting), less when throttled', () => {
    expect(steamFrac(inMode('production'))).toBe(1);
    expect(steamFrac(inMode('production', CAPACITY_LPH * plantConfig.asepticTank.throttledFlowFrac))).toBe(0.5);
    // Diverting still heats the milk; a clean or re-sterilizing does not.
    expect(steamFrac(inMode('divert'))).toBe(1);
    for (const mode of ['cip', 'sterilize', 'aic'] as const) expect(steamFrac(inMode(mode)), mode).toBe(0);
    expect(steamFrac(inMode('production', 0))).toBe(0);
  });

  it('sizes the flash vessel’s vapour from stage 5’s waterRemovedLph', () => {
    const snapshot = inMode('production');
    snapshot.stages[5].values.waterRemovedLph = VAPOUR_FULL_LPH / 4;
    expect(vapourFrac(snapshot)).toBeCloseTo(0.25, 12);
    snapshot.stages[5].values.waterRemovedLph = 0;
    expect(vapourFrac(snapshot)).toBe(0);
    snapshot.stages[5].values.waterRemovedLph = 3 * VAPOUR_FULL_LPH;
    expect(vapourFrac(snapshot)).toBe(1);
  });

  it('without waterRemovedLph, sizes the vapour from the flow reaching the flash vessel: none in a divert', () => {
    // The live sim fills the key; drop it to test the fallback for snapshots that lack it.
    const withoutKey = (snapshot: Snapshot): Snapshot => {
      delete snapshot.stages[5].values.waterRemovedLph;
      return snapshot;
    };
    expect(vapourFrac(withoutKey(inMode('production')))).toBe(1);
    expect(vapourFrac(withoutKey(inMode('production', CAPACITY_LPH / 2)))).toBe(0.5);
    expect(vapourFrac(withoutKey(inMode('divert')))).toBe(0);
  });
});

describe('motion', () => {
  it('runs a little faster at a higher sim speed, at most MAX_MOTION_RATE times', () => {
    expect(motionRate(1)).toBe(1);
    expect(motionRate(10)).toBeCloseTo(1.5, 12);
    expect(motionRate(100)).toBeCloseTo(2, 12);
    expect(motionRate(1_000)).toBeCloseTo(2.5, 12);
    expect(motionRate(10_000)).toBe(MAX_MOTION_RATE);
    expect(motionRate(1e9)).toBe(MAX_MOTION_RATE);
    expect(MAX_MOTION_RATE).toBe(3);
  });

  it('turns a frame’s real time into animation time, none while paused', () => {
    expect(motionDtS({ paused: false, speed: 1 }, 0.016)).toBeCloseTo(0.016, 12);
    expect(motionDtS({ paused: false, speed: 10_000 }, 0.016)).toBeCloseTo(0.048, 12);
    expect(motionDtS({ paused: true, speed: 10_000 }, 0.016)).toBe(0);
    expect(motionDtS({ paused: false, speed: 10 }, -1)).toBe(0);
  });

  it('advances a phase by the step, at most maxStep a frame, wrapped into one period', () => {
    expect(advancePhase(0.5, 0.25, 1, 2 * Math.PI)).toBeCloseTo(0.75, 12);
    expect(advancePhase(0.5, 3, 0.35, 2 * Math.PI)).toBeCloseTo(0.85, 12);
    expect(advancePhase(6, 0.35, 0.35, 2 * Math.PI)).toBeCloseTo(6.35 - 2 * Math.PI, 12);
    expect(advancePhase(0.5, -1, 0.35, 1)).toBe(0.5);
  });
});
