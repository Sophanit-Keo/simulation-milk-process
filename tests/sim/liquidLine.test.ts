// The live liquid line, stages 1–6 (phase 3): the stage models against the hand calculations
// (plan/hand-calculations.md, with the tolerances stated there), the UHT plant's modes, the aseptic
// tank's throttle and filler thresholds, mass balance, step size and determinism.
import { describe, expect, it } from 'vitest';
import { dayToS, hToS, minToS, type PlantConfig, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createFillerStub } from '../../src/sim/fillerStub';
import { createMockSim } from '../../src/sim/mock';
import { bStar, hydraulicPowerKw, lagToward, surplusCreamFrac } from '../../src/sim/formulas';
import {
  condenserKw,
  creamingRiskPct,
  globuleUm,
  headspaceBar,
  heatRecoveredKw,
  homogenizerPowerKw,
  separatorFlows,
  steamLph,
} from '../../src/sim/liquid/stageModels';
import { LIQUID_STAGE_IDS, type LiquidLine } from '../../src/sim/liquidLine';
import { expectWithin } from '../helpers/expectWithin';
import { defaultSetpoints, quietConfig, startLiquid, type LiquidRun } from '../helpers/liquidRun';
import { copyConfig, plantConfig } from '../helpers/plantConfig';

const START_S = plantConfig.clock.startTimeS;
/** H36: 3 min divert + 80 min CIP + 30 min sterilizing. */
const OUT_AFTER_DIVERT_S = minToS(113);

/** Every level of the line within its tank. */
function expectLevelsInRange(line: LiquidLine, config: PlantConfig, where: string): void {
  const { siloL, mixTankL, asepticL, rejectL } = line.state;
  const checks: [string, number, number][] = [
    ['silo', siloL, config.standardization.siloCapacityL],
    ['mixing tank', mixTankL, config.standardization.mixTankCapacityL],
    ['aseptic tank', asepticL, config.asepticTank.capacityL],
    ['reject tank', rejectL, config.uht.rejectTankL],
  ];
  for (const [name, levelL, capacityL] of checks) {
    if (!(levelL >= 0 && levelL <= capacityL)) expect.fail(`${where}: ${name} at ${levelL} L of ${capacityL} L`);
  }
}

/** Sets the UHT temperature for one step, so the plant diverts, then puts it back. Returns the divert's start. */
function divertOnce(run: LiquidRun, tempC: number, dtS = 1): number {
  const startS = run.timeS;
  const before = run.setpoints.uhtSetpointC;
  run.setpoints.uhtSetpointC = tempC;
  run.run(dtS, dtS);
  run.setpoints.uhtSetpointC = before;
  return startS;
}

const messagesMatching = (run: LiquidRun, pattern: RegExp) => run.log.filter((entry) => pattern.test(entry.message));

describe('stage models against the hand calculations', () => {
  it('stage 1: 1.370% of raw milk at 4.0% fat leaves as surplus cream (H2)', () => {
    const { standardization: std, product } = plantConfig;
    expectWithin(surplusCreamFrac(std.rawMilkFatPct, product.fatPct, std.creamFatPct), 0.0137, 0.00001);
  });

  it('stage 1: 16,000 L/h of 3.5% milk needs 16,222.22 L/h of raw milk (H3) and leaves 222.22 L/h of cream (H4)', () => {
    const { rawMilkLph, surplusCreamLph } = separatorFlows(plantConfig, 16_000);
    expectWithin(rawMilkLph, 16_222.22, 0.01);
    expectWithin(surplusCreamLph, 222.22, 0.01);
  });

  it('stage 1: the fat balance closes, the cream carries 40% fat (H5)', () => {
    const { rawMilkLph, surplusCreamLph } = separatorFlows(plantConfig, 16_000);
    expectWithin((rawMilkLph * 4.0 - 16_000 * 3.5) / surplusCreamLph, 40, 0.001);
  });

  it('stage 2: heating 16,000 L/h from 4 to 80 °C at cp 3.9 recovers 16,000 ÷ 3,600 × 3.9 × 76 = 1,317.33 kW', () => {
    expectWithin(heatRecoveredKw(plantConfig, 16_000, 80), 1_317.33, 0.01);
    expect(heatRecoveredKw(plantConfig, 0, 80)).toBe(0);
  });

  it('stage 3: the handbook example, 10,000 L/h at 200 bar, is 55.556 kW hydraulic (H8) and about 68 kW drawn', () => {
    expectWithin(hydraulicPowerKw(10_000, 200), 55.556, 0.001);
    expectWithin(homogenizerPowerKw(plantConfig, 10_000, 200), 68, 0.5);
  });

  it('stage 3: globules are under 1 µm at 200 bar and grow as the pressure falls, up to the raw 3.5 µm', () => {
    expect(globuleUm(plantConfig, 200)).toBeLessThan(1);
    let lastUm = 0;
    for (let bar = 250; bar >= 0; bar -= 10) {
      const sizeUm = globuleUm(plantConfig, bar);
      expect(sizeUm, `${bar} bar`).toBeGreaterThanOrEqual(lastUm);
      expect(sizeUm, `${bar} bar`).toBeLessThanOrEqual(plantConfig.homogenizer.rawGlobuleUm);
      lastUm = sizeUm;
    }
    expect(globuleUm(plantConfig, 0)).toBe(plantConfig.homogenizer.rawGlobuleUm);
  });

  it('stage 3: the creaming-risk score is 0 at 200 bar, rises as the pressure falls, and stays within 0–100', () => {
    const riskAt = (bar: number) => creamingRiskPct(plantConfig, globuleUm(plantConfig, bar));
    expect(riskAt(200)).toBe(0);
    expect(riskAt(100)).toBeGreaterThan(riskAt(150));
    expect(riskAt(50)).toBeGreaterThan(riskAt(100));
    expect(riskAt(0)).toBe(100);
    for (let bar = 0; bar <= 250; bar += 5) {
      expect(riskAt(bar)).toBeGreaterThanOrEqual(0);
      expect(riskAt(bar)).toBeLessThanOrEqual(100);
    }
  });

  it('stages 4–5: the steam injected heats the milk (energy balance), about 10% of the flow, and the condenser takes it back', () => {
    const { cpKjPerKgK } = plantConfig.product;
    const { steamLatentKjPerKg } = plantConfig.uht;
    const steam = steamLph(plantConfig, 16_000, 81.75, 140);
    expectWithin(steam * steamLatentKjPerKg, 16_000 * cpKjPerKgK * (140 - 81.75), 1e-6);
    expect(steam / 16_000).toBeGreaterThan(0.08);
    expect(steam / 16_000).toBeLessThan(0.12);
    expectWithin(condenserKw(plantConfig, steam), (steam / 3_600) * steamLatentKjPerKg, 1e-9);
    expect(steamLph(plantConfig, 16_000, 140, 130)).toBe(0);
  });

  it('stage 6: headspace pressure rises with the level and never passes maxHeadspaceBar (3.0 bar, D9)', () => {
    const { headspaceMinBar, maxHeadspaceBar } = plantConfig.asepticTank;
    expect(headspaceBar(plantConfig, 0)).toBe(headspaceMinBar);
    expect(headspaceBar(plantConfig, 1)).toBe(maxHeadspaceBar);
    expect(headspaceBar(plantConfig, 1.5)).toBe(maxHeadspaceBar);
    expect(headspaceBar(plantConfig, 0.5)).toBeGreaterThan(headspaceMinBar);
  });

  it('a first-order lag lands in the same place in one step as in many (exact integration)', () => {
    const one = lagToward(4, 80, 60, 30);
    let many = 4;
    for (let i = 0; i < 60; i++) many = lagToward(many, 80, 1, 30);
    expectWithin(many, one, 1e-9);
    expectWithin(lagToward(0, 1, 30, 30), 1 - Math.exp(-1), 1e-12);
  });

  it('the filler stub draws fillers.count × the live rate × the pack volume (H74: 2 × 7,500 × 1 L)', () => {
    const stub = createFillerStub(plantConfig);
    expect(stub.readyCount(0)).toBe(2);
    expect(stub.drawLph(stub.readyCount(0), 7_500)).toBe(15_000);
    expect(stub.drawLph(1, 7_000)).toBe(7_000);
    expect(stub.drawLph(0, 7_500)).toBe(0);
  });
});

/** The new per-stage keys of phase 3 (common lane notes), on top of the phase 2 keys. */
const PHASE_3_KEYS: Record<1 | 2 | 3 | 4 | 5 | 6, string[]> = {
  1: ['rawMilkLph', 'surplusCreamLph', 'siloLevelPct', 'mixTankLevelPct'],
  2: ['airPct', 'heatRecoveredKw'],
  3: ['globuleUm', 'creamingRiskPct', 'powerKw'],
  4: ['setpointC', 'tempC', 'flowLph', 'holdS', 'f0Min', 'bStar', 'divertLimitC', 'rejectLevelL'],
  5: ['waterRemovedLph', 'condenserKw'],
  6: ['levelL', 'levelPct', 'capacityL', 'tempC', 'inflowLph', 'outflowLph', 'headspaceBar', 'nextCleanS'],
};

describe.each([
  ['createSim', createSim],
  ['createMockSim', createMockSim],
] as const)('%s: the phase 3 stage values', (_name, create) => {
  it('has every agreed key in stages 1–6, each a finite number, at opening and through two days at ×10,000', () => {
    const sim = create(plantConfig);
    const check = (snap: Snapshot) => {
      for (const id of LIQUID_STAGE_IDS) {
        for (const key of PHASE_3_KEYS[id]) {
          const value = snap.stages[id].values[key];
          if (!Number.isFinite(value)) expect.fail(`at ${snap.timeS} s: stage ${id} ${key} is ${value}`);
        }
      }
    };
    check(sim.snapshot());
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    for (let frame = 0; frame < dayToS(2) / 1_000; frame++) {
      sim.step(0.1);
      check(sim.snapshot());
    }
  });
});

describe('createSim: the live line at full flow', () => {
  it('opens on the hand values: raw milk 16,222.22 L/h (H3, H64), surplus cream 222.22 L/h (H4)', () => {
    const { stages, line } = createSim(plantConfig).snapshot();
    expectWithin(stages[1].values.rawMilkLph, 16_222.22, 0.01);
    expectWithin(stages[1].values.surplusCreamLph, 222.22, 0.01);
    expectWithin(line.silo.flowLph, 16_222.22, 0.01);
    expect(line.separator.flowLph).toBe(16_000);
  });

  it('holds 4 s and shows F0 5.175 min (H11), B* 1.1856 (H12) and a 139.224 °C limit (H13) without noise, after an hour of steps', () => {
    const sim = createSim(quietConfig());
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    for (let frame = 0; frame < 36; frame++) sim.step(0.1);
    const { values } = sim.snapshot().stages[4];
    expect(values.flowLph).toBe(16_000);
    expectWithin(values.holdS, 4, 0.001);
    expectWithin(values.f0Min, 5.175, 0.001);
    expectWithin(values.bStar, 1.1856, 0.0001);
    expectWithin(values.divertLimitC, 139.224, 0.001);
  });

  it('with ±0.3 °C noise: readings stay within it, B* ≥ 1.1101 (H21) and F0 within 4.830–5.545 min (H22)', () => {
    const run = startLiquid(plantConfig);
    const seenC: number[] = [];
    run.run(hToS(7), 1, () => {
      const { values } = run.line.view(run.setpoints, run.timeS);
      seenC.push(values[4].tempC);
      expect(Math.abs(values[4].tempC - 140)).toBeLessThanOrEqual(0.3);
      expect(values[4].bStar).toBeGreaterThanOrEqual(1.1101 - 0.0001);
      expect(values[4].f0Min).toBeGreaterThanOrEqual(4.83 - 0.001);
      expect(values[4].f0Min).toBeLessThanOrEqual(5.545 + 0.001);
    });
    // The noise moves both ways and uses most of its band.
    expect(Math.min(...seenC)).toBeLessThan(139.75);
    expect(Math.max(...seenC)).toBeGreaterThan(140.25);
  });

  it('stage 3 at 200 + 30 bar: outlet 81.75 °C (H7), power = hydraulic power at 230 bar ÷ 0.82, no creaming risk', () => {
    const { values } = createSim(plantConfig).snapshot().stages[3];
    expectWithin(values.outletTempC, 81.75, 0.001);
    expectWithin(values.powerKw, hydraulicPowerKw(16_000, 230) / 0.82, 1e-9);
    expect(values.creamingRiskPct).toBe(0);
    expect(values.globuleUm).toBeLessThan(1);
  });

  it('stage 6 gains 1,000 L/h (H31): 16,000 L/h in, 15,000 L/h out to the fillers', () => {
    const { values } = createSim(plantConfig).snapshot().stages[6];
    expect(values.inflowLph).toBe(16_000);
    expect(values.outflowLph).toBe(15_000);
    const run = startLiquid(plantConfig);
    run.run(hToS(1));
    expectWithin(run.line.state.asepticL, 11_000, 1e-6);
  });

  it('noise alone never diverts: 7 days at 140 °C, 1 s steps (H63)', () => {
    const run = startLiquid(plantConfig);
    run.run(dayToS(7));
    expect(run.line.state.divertCount).toBe(0);
    expect(run.line.totals.divertedL).toBe(0);
  });

  it('stage 4 follows B*, not F0 (D4): ok at 139.8 °C (F0 under 5 min), amber at 139.5 °C (B* 1.06), red below the limit', () => {
    const statusAt = (tempC: number) => {
      const sim = createSim(quietConfig());
      sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: tempC });
      return sim.snapshot().stages[4];
    };
    const at1398 = statusAt(139.8);
    expect(at1398.values.f0Min).toBeLessThan(5);
    expect(at1398.status).toBe('ok');
    expect(statusAt(139.5).status).toBe('warn');
    expect(statusAt(139).status).toBe('bad');
  });

  it('stage 3 turns amber when the homogenizer pressure is too low to keep the globules small', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'homogenizerStage1Bar', value: 100 });
    const stage = sim.snapshot().stages[3];
    expect(stage.values.creamingRiskPct).toBeGreaterThan(0);
    expect(stage.status).toBe('warn');
    expectWithin(stage.values.outletTempC, 76 + 130 / 40, 0.001);
  });
});

describe('throttled to 50% flow (R6)', () => {
  const throttledConfig = () => {
    const config = quietConfig();
    config.asepticTank.startFrac = 0.95;
    return config;
  };

  it('holds 8 s (H10) with B* 2.3712 (H15), F0 10.350 min (H16) and a 136.063 °C limit (H17)', () => {
    const snap = createSim(throttledConfig()).snapshot();
    expect(snap.liquid.throttled).toBe(true);
    const { values } = snap.stages[4];
    expect(values.flowLph).toBe(8_000);
    expectWithin(values.holdS, 8, 0.001);
    expectWithin(values.bStar, 2.3712, 0.0001);
    expectWithin(values.f0Min, 10.35, 0.001);
    expectWithin(values.divertLimitC, 136.063, 0.001);
    expect(snap.stages[6].status).toBe('warn');
    // Every point from silo to cooler carries 8,000 L/h (silo 8,111.11 L/h), as hand-calculations.md has it.
    expectWithin(snap.line.silo.flowLph, 8_111.11, 0.01);
    for (const id of ['separator', 'feedTank', 'preheater', 'deaerator', 'homogenizer', 'holdingTube', 'flashVessel', 'cooler'] as const) {
      expect(snap.line[id].flowLph, id).toBe(8_000);
    }
  });

  it('a 135.5 °C fault diverts there too, and sends 400 L to the reject tank in 3 min (H24, H35, H62)', () => {
    const run = startLiquid(throttledConfig());
    divertOnce(run, 135.5);
    expect(run.line.state.mode).toBe('divert');
    run.run(178); // 179 s since the divert began, with divertOnce's step
    expect(run.line.state.mode).toBe('divert');
    run.run(1);
    expect(run.line.state.mode).toBe('cip');
    expectWithin(run.line.state.rejectL, 400, 1e-6);
  });
});

describe('divert, clean and re-sterilize (H35, H36, H62)', () => {
  it('setting 139 °C (noise off, H88) diverts within one step, fills the reject tank by 800 L in 3 min, and is back in production 113 min later', () => {
    const run = startLiquid(quietConfig());
    run.run(60);
    const asepticBeforeL = run.line.state.asepticL;
    const startS = divertOnce(run, 139);
    expect(run.line.state.mode).toBe('divert');
    expect(run.line.state.divertCount).toBe(1);
    expect(run.log.at(-1)).toMatchObject({ timeS: startS, kind: 'bad' });
    run.run(178); // 179 s since the divert began, with divertOnce's step
    expect(run.line.state.mode).toBe('divert');
    // Nothing reaches the aseptic tank while diverting; the fillers keep drawing.
    expectWithin(run.line.state.asepticL, asepticBeforeL - (15_000 * 179) / 3_600, 1e-6);
    run.run(1);
    expect(run.line.state.mode).toBe('cip');
    expectWithin(run.line.state.rejectL, 800, 1e-6);
    expectWithin(run.line.totals.divertedL, 800, 1e-6);
    run.run(minToS(80) - 1);
    expect(run.line.state.mode).toBe('cip');
    run.run(1);
    expect(run.line.state.mode).toBe('sterilize');
    // The reject tank is pumped out during the CIP.
    expectWithin(run.line.state.rejectL, 0, 1e-6);
    run.run(minToS(30) - 1);
    expect(run.line.state.mode).toBe('sterilize');
    run.run(1);
    expect(run.line.state.mode).toBe('production');
    expect(run.timeS - startS).toBe(OUT_AFTER_DIVERT_S);
    // The divert, the CIP, the sterilizing and the return (the fillers' starving is logged in between).
    const modeLog = run.log.filter((entry) => !/filler/.test(entry.message));
    expect(modeLog.map((entry) => entry.kind).slice(-4)).toEqual(['bad', 'warn', 'info', 'ok']);
    expect(modeLog.map((entry) => entry.timeS).slice(-4)).toEqual([startS, startS + 180, startS + 180 + 4_800, startS + 6_780]);
  });

  it('through createSim, default noise: one step after 138.9 °C the snapshot diverts, the divert line carries the whole flow', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138.9 });
    sim.step(0.1); // one 1 s step at ×10
    const snap = sim.snapshot();
    expect(snap.liquid.uhtMode).toBe('divert');
    expect(snap.liquid.modeRemainingS).toBe(179);
    expect(snap.stages[4].status).toBe('bad');
    expect(snap.stages[5].status).toBe('idle');
    expect(snap.line.divert.flowLph).toBe(16_000);
    expect(snap.line.flashVessel.flowLph).toBe(0);
    expect(snap.line.cooler.flowLph).toBe(0);
    expect(snap.stages[6].values.inflowLph).toBe(0);
    expect(snap.stages[5].values.waterRemovedLph).toBe(0);
    expectWithin(snap.stages[4].values.rejectLevelL, 16_000 / 3_600, 1e-9);
    expectWithin(snap.kpis.divertedL, 16_000 / 3_600, 1e-9);
  });

  it('cleaning shows: nothing flows through stages 2–5, stage 4 amber, the holding tube at lye then sterilizing temperature', () => {
    const run = startLiquid(plantConfig);
    divertOnce(run, 139);
    run.run(180 + minToS(40));
    let view = run.line.view(run.setpoints, run.timeS);
    expect(view.liquid.uhtMode).toBe('cip');
    expect(view.values[4].tempC).toBe(plantConfig.cleaning.cipTempC);
    expect(view.statuses).toMatchObject({ 2: 'idle', 3: 'idle', 4: 'warn', 5: 'idle' });
    expect(view.flows.uhtLph).toBe(0);
    expect(view.values[4].f0Min).toBe(0);
    expect(view.values[4].bStar).toBe(0);
    expectWithin(view.values[4].divertLimitC, 139.224, 0.001);
    // The preheater has lagged down to the lye temperature.
    expectWithin(view.values[2].preheatTempC, plantConfig.cleaning.cipTempC, 0.01);
    run.run(minToS(50));
    view = run.line.view(run.setpoints, run.timeS);
    expect(view.liquid.uhtMode).toBe('sterilize');
    expect(view.values[4].tempC).toBeGreaterThanOrEqual(plantConfig.uht.sterilizeTempC);
    // 1 s + 3 min + 40 min + 50 min after the divert began, 113 min in all.
    expect(view.liquid.modeRemainingS).toBe(OUT_AFTER_DIVERT_S - (1 + 180 + minToS(90)));
  });

  it('a set point just above the limit diverts only on the noise, and a reading above it never hides a set point below it', () => {
    // 139.3 °C: the reading spans 139.0–139.6 °C around a 139.224 °C limit, so some steps divert.
    const run = startLiquid(plantConfig);
    run.setpoints.uhtSetpointC = 139.3;
    run.run(600);
    expect(run.line.state.divertCount).toBe(1);
    // 139.2 °C, under the limit by less than the noise: every one of 200 fresh plants diverts in its first step.
    for (let seed = 1; seed <= 200; seed++) {
      const fresh = startLiquid(plantConfig, { seed });
      divertOnce(fresh, 139.2);
      expect(fresh.line.state.mode, `seed ${seed}`).toBe('divert');
    }
  });
});

describe('the aseptic tank: throttle, fillers and cleaning (H31–H34, H37)', () => {
  it('throttles 8 h after opening (H33) and is back at full flow 51.43 min later (H34), the same at 1 s and 60 s steps', () => {
    for (const dtS of [1, 60]) {
      const run = startLiquid(quietConfig());
      run.run(hToS(9.5), dtS);
      const switches = messagesMatching(run, /UHT plant (throttled|back to full flow)/);
      expect(switches.map((entry) => entry.kind), `${dtS} s steps`).toEqual(['warn', 'ok']);
      expectWithin(switches[0].timeS, START_S + hToS(8), 1e-3);
      expectWithin((switches[1].timeS - switches[0].timeS) / 60, 51.43, 0.01);
    }
  });

  it('switches once per crossing, at exactly 90% and 60%, alternating, over 3 days', () => {
    const run = startLiquid(plantConfig);
    run.run(dayToS(3), 10);
    const switches = messagesMatching(run, /UHT plant (throttled|back to full flow)/);
    expect(switches.length).toBeGreaterThanOrEqual(4);
    switches.forEach((entry, i) => {
      const throttling = i % 2 === 0;
      expect(entry.message, `switch ${i}`).toMatch(throttling ? /throttled/ : /back to full flow/);
      expectWithin(entry.asepticL, throttling ? 18_000 : 12_000, 1e-6);
    });
  });

  it('runs the intermediate clean after 10 h of production, for 30 min, while the fillers draw 7,500 L from the tank (H32)', () => {
    const run = startLiquid(quietConfig());
    run.run(hToS(10) - 1);
    expect(run.line.state.mode).toBe('production');
    expect(run.line.view(run.setpoints, run.timeS).values[6].nextCleanS).toBe(1);
    run.run(1);
    expect(run.line.state.mode).toBe('aic');
    const atStartL = run.line.state.asepticL;
    // 10,000 + 8 h × 1,000 L/h, throttled back to 12,000 L, then 1,000 L/h for the rest of the 10 h.
    expectWithin(atStartL, 12_000 + 1_000 * (10 - 8 - 6 / 7), 1e-6);
    run.run(minToS(30));
    expect(run.line.state.mode).toBe('production');
    expectWithin(atStartL - run.line.state.asepticL, 7_500, 0.001);
    expect(run.line.state.productionSinceCleanS).toBe(0);
    const aic = messagesMatching(run, /Intermediate clean/);
    expect(aic.map((entry) => entry.timeS)).toEqual([START_S + hToS(10), START_S + hToS(10.5)]);
  });

  it('a divert from 50% starves the fillers after 39.4 min (H37), and they restart once, above 500 L, after production resumes', () => {
    const run = startLiquid(quietConfig());
    const startS = divertOnce(run, 135.5);
    run.run(hToS(4), 1, () => expectLevelsInRange(run.line, plantConfig, `at ${run.timeS}`));
    const starved = messagesMatching(run, /fillers stopped/);
    const restarted = messagesMatching(run, /fillers running again/);
    expect(starved).toHaveLength(1);
    expect(restarted).toHaveLength(1);
    expectWithin((starved[0].timeS - startS) / 60, 39.4, 0.01);
    expectWithin(starved[0].asepticL, 150, 1e-6);
    // Back in production at 113 min, the tank refills from 150 L at 16,000 L/h; the fillers wait for 500 L.
    expectWithin(restarted[0].timeS, startS + OUT_AFTER_DIVERT_S + (350 / 16_000) * 3_600, 1e-3);
  });

  it('while starved the fillers draw nothing and stage 6 is amber', () => {
    const run = startLiquid(quietConfig());
    divertOnce(run, 135.5);
    run.run(minToS(60));
    const view = run.line.view(run.setpoints, run.timeS);
    expect(view.liquid.fillersStarved).toBe(true);
    expect(view.liquid.fillersRunning).toBe(0);
    expect(view.flows.fillerLph).toBe(0);
    expect(view.kpis.packsPerH).toBe(0);
    expect(view.statuses[6]).toBe('warn');
  });

  it('never fills the aseptic tank past capacity when the fillers are slowed: the UHT plant then makes only what they take', () => {
    const run = startLiquid(quietConfig());
    run.setpoints.fillerRatePacksPerH = 1_000; // 2,000 L/h, below even the throttled 8,000 L/h
    run.run(dayToS(1), 10, () => expectLevelsInRange(run.line, plantConfig, `at ${run.timeS}`));
    const view = run.line.view(run.setpoints, run.timeS);
    if (view.liquid.uhtMode === 'production') {
      expectWithin(run.line.state.asepticL, 20_000, 1e-6);
      expect(view.flows.uhtLph).toBe(2_000);
    }
  });
});

describe('mass balance, step size, determinism and a 30-day soak', () => {
  /** A day with a divert and an intermediate clean in it. */
  function busyDay(config: PlantConfig, dtS: number): LiquidRun {
    const run = startLiquid(config);
    run.run(hToS(3), dtS);
    divertOnce(run, 139, dtS);
    run.run(dayToS(1) - hToS(3) - dtS, dtS);
    return run;
  }

  it('over 24 h: silo draw = to fillers + reject + surplus cream + Δ mixing tank + Δ aseptic tank, within 0.1%', () => {
    const config = plantConfig;
    const run = busyDay(config, 1);
    const { totals, state } = run.line;
    expect(totals.divertedL).toBeGreaterThan(0);
    const mixDeltaL = state.mixTankL - config.standardization.mixTankCapacityL * config.standardization.mixTankStartFrac;
    const asepticDeltaL = state.asepticL - config.asepticTank.capacityL * config.asepticTank.startFrac;
    const accountedL = totals.toFillersL + totals.divertedL + totals.surplusCreamL + mixDeltaL + asepticDeltaL;
    expect(Math.abs(totals.rawDrawnL - accountedL) / totals.rawDrawnL).toBeLessThan(0.001);
    expectWithin(totals.rawDrawnL, accountedL, 1e-3);
  });

  it('every step, the aseptic tank moves by litres in minus litres out (H60)', () => {
    const run = startLiquid(plantConfig);
    let lastL = run.line.state.asepticL;
    let lastInL = 0;
    let lastOutL = 0;
    run.run(dayToS(1), 10, () => {
      const { asepticL } = run.line.state;
      const { toAsepticL, toFillersL } = run.line.totals;
      expectWithin(asepticL - lastL, toAsepticL - lastInL - (toFillersL - lastOutL), 0.001);
      lastL = asepticL;
      lastInL = toAsepticL;
      lastOutL = toFillersL;
    });
  });

  /** A day of plain production: a throttle at 8 h and an intermediate clean at 10 h. */
  function plainDay(config: PlantConfig, dtS: number): LiquidRun {
    const run = startLiquid(config);
    run.run(dayToS(1), dtS);
    return run;
  }

  it.each([
    ['a day with a divert', busyDay],
    ['a day of plain production', plainDay],
  ])('24 h at 1 s steps and at 60 s steps end within 1%: %s', (_label, day) => {
    const fine = day(plantConfig, 1).line;
    const coarse = day(plantConfig, 60).line;
    const pairs: [string, number, number][] = [
      ['aseptic tank', fine.state.asepticL, coarse.state.asepticL],
      ['silo', fine.state.siloL, coarse.state.siloL],
      ['mixing tank', fine.state.mixTankL, coarse.state.mixTankL],
      ['raw milk drawn', fine.totals.rawDrawnL, coarse.totals.rawDrawnL],
      ['to the fillers', fine.totals.toFillersL, coarse.totals.toFillersL],
      // + 1 L and + 1 s: a value that is 0 at both step sizes (no divert on a plain day) agrees.
      ['diverted', fine.totals.divertedL + 1, coarse.totals.divertedL + 1],
      ['surplus cream', fine.totals.surplusCreamL, coarse.totals.surplusCreamL],
      ['production time', fine.totals.productionS, coarse.totals.productionS],
      ['throttled time', fine.totals.throttledProductionS + 1, coarse.totals.throttledProductionS + 1],
    ];
    for (const [name, a, b] of pairs) {
      expect(a, name).toBeGreaterThan(0);
      expect(Math.abs(a - b) / a, `${name}: ${a} at 1 s, ${b} at 60 s`).toBeLessThan(0.01);
    }
  });

  it('is deterministic: the same seed and set points give the same state; another seed only moves the noise', () => {
    const a = busyDay(plantConfig, 10).line;
    const b = busyDay(plantConfig, 10).line;
    expect(JSON.stringify([a.state, a.totals])).toBe(JSON.stringify([b.state, b.totals]));
    const other = startLiquid(plantConfig, { seed: 1 });
    const same = startLiquid(plantConfig);
    other.run(100);
    same.run(100);
    expect(other.line.state.noiseC).not.toBe(same.line.state.noiseC);
    expect(other.line.state.asepticL).toBe(same.line.state.asepticL);
  });

  it('30 days at 10 s steps with a fault every 5 days: no NaN, every level within its tank, the silo never dry', () => {
    const run = startLiquid(plantConfig);
    for (let day = 0; day < 30; day += 5) {
      divertOnce(run, plantConfig.uht.faultTempC, 10);
      run.run(dayToS(5) - 10, 10, () => {
        expectLevelsInRange(run.line, plantConfig, `at ${run.timeS}`);
        if (!(run.line.state.siloL > 0)) expect.fail(`silo dry at ${run.timeS}`);
      });
      const view = run.line.view(run.setpoints, run.timeS);
      for (const id of LIQUID_STAGE_IDS) {
        for (const [key, value] of Object.entries(view.values[id])) {
          if (!Number.isFinite(value)) expect.fail(`day ${day + 5}: stage ${id} ${key} is ${value}`);
        }
      }
    }
    expect(run.line.state.divertCount).toBe(6);
    expect(run.line.totals.tankerL).toBeGreaterThan(0);
    // H59's 9% of production time throttled needs the phase 4 filler breakdowns; the stub's fillers never stop.
    expect(run.line.totals.throttledProductionS).toBeGreaterThan(0);
  });

  it('the silo is topped up by tankers before it falls below its threshold by more than a step of draw', () => {
    const run = startLiquid(plantConfig);
    const { siloCapacityL, tankerBelowFrac } = plantConfig.standardization;
    let lowestL = Infinity;
    run.run(dayToS(2), 10, () => (lowestL = Math.min(lowestL, run.line.state.siloL)));
    expect(lowestL).toBeGreaterThan(tankerBelowFrac * siloCapacityL - 16_222.23 * (10 / 3_600));
    expect(run.line.totals.tankerL).toBeGreaterThan(0);
  });

  it('the mixing tank holds its level while the UHT plant draws, and fills toward its idle level while it cleans', () => {
    const run = startLiquid(quietConfig());
    run.run(hToS(1));
    expectWithin(run.line.state.mixTankL, 5_000, 1e-6);
    divertOnce(run, 139);
    run.run(180 + minToS(60));
    expect(run.line.state.mixTankL).toBeGreaterThan(7_500);
    expect(run.line.state.mixTankL).toBeLessThanOrEqual(8_000);
  });
});

describe('createSim exposes the model for tests', () => {
  it('hands the liquid line to onLiquidLine, and the snapshot agrees with it', () => {
    let line: LiquidLine | undefined;
    const sim = createSim(copyConfig(), { onLiquidLine: (created) => (line = created) });
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    for (let frame = 0; frame < 10; frame++) sim.step(0.1);
    const snap = sim.snapshot();
    expect(line).toBeDefined();
    expect(snap.liquid.tanks.asepticTank.levelL).toBe(line?.state.asepticL);
    expect(snap.kpis.tankLevelPct).toBe(snap.stages[6].values.levelPct);
    expect(defaultSetpoints(plantConfig).uhtSetpointC).toBe(snap.stages[4].values.setpointC);
    expect(bStar(snap.stages[4].values.tempC, snap.stages[4].values.holdS)).toBe(snap.kpis.bStar);
  });
});

describe('createMockSim: the liquid-line modes', () => {
  /** Which mode may follow which, as the live model walks them (a random red window diverts and returns). */
  const NEXT_MODES: Record<string, string[]> = {
    production: ['divert', 'aic'],
    divert: ['cip', 'production'],
    cip: ['sterilize'],
    sterilize: ['production'],
    aic: ['production'],
  };

  it('walks divert → cip → sterilize → production and runs intermediate cleans within two weeks, in that order', () => {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const seen = new Set<string>();
    let last = sim.snapshot().liquid.uhtMode;
    for (let frame = 0; frame < dayToS(14) / 100; frame++) {
      sim.step(0.01); // 100 sim seconds, under the 3 min divert
      const snap = sim.snapshot();
      const mode = snap.liquid.uhtMode;
      seen.add(mode);
      if (mode !== last && !NEXT_MODES[last].includes(mode)) expect.fail(`at ${snap.timeS} s: ${last} → ${mode}`);
      if (mode === 'cip' || mode === 'sterilize' || mode === 'aic') {
        expect(snap.stages[4].status).toBe('warn');
        expect(snap.line.holdingTube.flowLph).toBe(0);
        expect(snap.liquid.modeRemainingS).toBeGreaterThan(0);
      }
      if (mode === 'divert') expect(snap.stages[4].status).toBe('bad');
      last = mode;
    }
    expect([...seen].sort()).toEqual(['aic', 'cip', 'divert', 'production', 'sterilize']);
    const { liquid } = sim.snapshot();
    expect(liquid.divertCount).toBeGreaterThan(0);
  });
});
