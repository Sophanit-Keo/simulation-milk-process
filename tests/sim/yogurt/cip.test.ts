// The yogurt wing's CIP station (phase 32, D34): every clean of the wing on one model (src/sim/yogurt/heat.ts), each
// giving its step in the snapshot (contracts v13), and what the cleans use, against H139–H140 (plan/hand-calculations.md).
// Nothing in the cleans' timing changes: a tank still cleans 45 min, the wing's CIP still runs 80 min.
import { beforeAll, describe, expect, it } from 'vitest';
import { hToS, type CleaningSnapshot, type Command, type Sim, type Snapshot } from '../../../src/contracts';
import { createSim } from '../../../src/sim';
import { createTankCip, createWingCip, rinseUse } from '../../../src/sim/yogurt/heat';
import { plantConfig } from '../../helpers/plantConfig';

const wingCip = createWingCip(plantConfig);
const tankCip = createTankCip(plantConfig);

/** A sim at ×1,000 (1 s steps), run to `toS` after the opening, with a look at each frame. */
function runner(commands: { atS: number; command: Command }[] = []) {
  const sim: Sim = createSim(plantConfig);
  sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  const openS = sim.snapshot().timeS;
  const pending = [...commands];
  return {
    openS,
    sim,
    runTo(toS: number, look?: (snap: Snapshot) => void): Snapshot {
      while (sim.snapshot().timeS - openS < toS - 1e-6) {
        while (pending.length > 0 && pending[0].atS <= sim.snapshot().timeS - openS + 1e-6) sim.dispatch((pending.shift() as { command: Command }).command);
        const leftS = toS - (sim.snapshot().timeS - openS);
        sim.step(Math.min(0.1, leftS / 1_000));
        look?.(sim.snapshot());
      }
      return sim.snapshot();
    },
  };
}

/** When the return first goes `to` within a step's first minutes: by its own snapshot, second by second. */
function changeOverS(programme: typeof tankCip, stepIndex: number, to: CleaningSnapshot['returnTo']): number {
  const startS = programme.steps.slice(0, stepIndex).reduce((sum, step) => sum + step.durationS, 0);
  for (let s = 0; s < 200; s += 0.1) if (programme.snapshotAt(startS + s).returnTo === to) return s;
  return Number.NaN;
}

describe('a fermentation tank\'s CIP (H139)', () => {
  it('runs pre-rinse, lye at 78 °C, rinse, acid at 68 °C and post-rinse in 45 min, the tank clean\'s time', () => {
    expect(tankCip.steps.map((step) => [step.step, step.fluid, step.durationS, step.tempC])).toEqual([
      ['preRinse', 'water', 300, 45],
      ['lye', 'lye', 1_200, 78],
      ['rinse', 'water', 300, 45],
      ['acid', 'acid', 600, 68],
      ['postRinse', 'water', 300, 20],
    ]);
    expect(tankCip.totalS).toBe(plantConfig.yogurt.ferment.tankCleanS);
    const lye = tankCip.snapshotAt(400);
    expect(lye).toMatchObject({ program: 'cip', step: 'lye', fluid: 'lye', stepIndex: 1, stepCount: 5, stepRemainingS: 1_100, tempC: 78, flowLph: 12_000, concentrationPct: 1.8 });
    expect(tankCip.snapshotAt(2_200)).toMatchObject({ step: 'acid', concentrationPct: 0.8, tempC: 68 });
    expect(tankCip.snapshotAt(2_699)).toMatchObject({ step: 'postRinse', concentrationPct: null, stepRemainingS: 1 });
  });

  it('pushes the yogurt out to 0.4605 mS/cm, then changes the return over at half each solution\'s conductivity', () => {
    // After the 5 min pre-rinse: 0.3 + 4.5 e^(−300 ÷ 90).
    expect(tankCip.snapshotAt(299.999).returnConductivityMsPerCm).toBeCloseTo(0.4605, 4);
    // The lye to drain until 42.1 mS/cm, 90 ln(83.7395 ÷ 42.1) = 61.9 s; the rinse back to the lye tank for 62.7 s.
    expect(changeOverS(tankCip, 1, 'lyeTank')).toBeCloseTo(61.9, 0);
    expect(changeOverS(tankCip, 2, 'drain')).toBeCloseTo(62.7, 0);
    // The acid to drain until 22.5 mS/cm, 55.5 s; the post-rinse back to the acid tank for 62.9 s, then recovered.
    expect(changeOverS(tankCip, 3, 'acidTank')).toBeCloseTo(55.5, 0);
    expect(changeOverS(tankCip, 4, 'waterTank')).toBeCloseTo(62.9, 0);
  });

  it('uses 206.59 L of 1.8% lye, 3.7186 kg of NaOH; 195.98 L of 0.8% acid, 1.5679 kg of HNO₃; and 2,000 L of rinse water', () => {
    expect(tankCip.use.lyeKg).toBeCloseTo(3.7186, 4);
    expect(tankCip.use.lyeKg / 0.018).toBeCloseTo(206.59, 2);
    expect(tankCip.use.acidKg).toBeCloseTo(1.5679, 4);
    expect(tankCip.use.acidKg / 0.008).toBeCloseTo(195.98, 2);
    expect(tankCip.use.drainWaterL).toBeCloseTo(2_000, 9);
  });
});

describe('what the wing\'s other cleans use (H140)', () => {
  it('the wing\'s CIP: 3.7235 kg of NaOH, 1.5679 kg of HNO₃ and 3,000 L; a rinse before a stirred product: 3,000 L', () => {
    expect(wingCip.totalS).toBe(4_800);
    expect(wingCip.use.lyeKg).toBeCloseTo(3.7235, 4);
    expect(wingCip.use.acidKg).toBeCloseTo(1.5679, 4);
    expect(wingCip.use.drainWaterL).toBeCloseTo(3_000, 9);
    expect(rinseUse(plantConfig, plantConfig.yogurt.changeover.rinseS)).toEqual({ lyeKg: 0, acidKg: 0, drainWaterL: 3_000 });
  });

  it('counts each step once as it ends, however the programme\'s time is cut', () => {
    for (const programme of [wingCip, tankCip]) {
      for (const stepS of [0.1, 7, 299.99, 300, 1_234.5]) {
        let lye = 0;
        let acid = 0;
        let water = 0;
        for (let fromS = 0; fromS < programme.totalS; fromS += stepS) {
          const use = programme.useBetween(fromS, Math.min(programme.totalS, fromS + stepS));
          lye += use.lyeKg;
          acid += use.acidKg;
          water += use.drainWaterL;
        }
        expect(lye, `${programme.totalS} s in ${stepS} s steps`).toBeCloseTo(programme.use.lyeKg, 9);
        expect(acid).toBeCloseTo(programme.use.acidKg, 9);
        expect(water).toBeCloseTo(programme.use.drainWaterL, 6);
      }
      // A step that has not ended yet uses nothing so far.
      expect(programme.useBetween(0, 299)).toEqual({ lyeKg: 0, acidKg: 0, drainWaterL: 0 });
    }
  });
});

describe('a day of the wing\'s cleans from the opening (H125e, H140)', () => {
  const run = runner();
  const tankSteps: { atS: number; step: string }[] = [];
  const changeoverSteps: { atS: number; kind: string; step: string | null }[] = [];
  let end: Snapshot;
  let afterTank1: Snapshot | undefined;
  beforeAll(() => {
    end = run.runTo(hToS(24), (snap) => {
      const atS = snap.timeS - run.openS;
      const tank = snap.yogurt.ferment.tanks[0];
      const step = tank?.cleaning?.step;
      if (step && tankSteps.at(-1)?.step !== step) tankSteps.push({ atS, step });
      if (tank?.state !== 'cleaning' && tankSteps.length > 0 && !afterTank1) afterTank1 = snap;
      const changeover = snap.yogurt.buffer.changeover;
      if (changeover) {
        const key = changeover.cleaning?.step ?? null;
        const last = changeoverSteps.at(-1);
        if (!last || last.kind !== changeover.kind || last.step !== key) changeoverSteps.push({ atS, kind: changeover.kind, step: key });
      }
    });
  });

  it('cleans tank 1 from 2.333 h to 3.083 h through its five steps, its step null before and after', () => {
    // Tank 1 empties at 2.333 h (H125e), and its 45 min clean walks the programme in order.
    expect(tankSteps.map((each) => each.step)).toEqual(expect.arrayContaining(['preRinse', 'lye', 'rinse', 'acid', 'postRinse']));
    const first = tankSteps.slice(0, 5);
    expect(first.map((each) => each.step)).toEqual(['preRinse', 'lye', 'rinse', 'acid', 'postRinse']);
    const startS = first[0]?.atS ?? Number.NaN;
    expect(startS / 3_600).toBeCloseTo(2.333, 2);
    expect((first[1]?.atS ?? 0) - startS).toBeCloseTo(300, -1);
    expect((first[3]?.atS ?? 0) - startS).toBeCloseTo(1_800, -1);
    expect(afterTank1?.yogurt.ferment.tanks[0]?.cleaning).toBeNull();
    expect(((afterTank1?.timeS ?? 0) - run.openS) / 3_600).toBeCloseTo(3.083, 2);
  });

  it('gives the CIP of the buffer and P8 its step at 22:00, and the rinse at 14:00 none', () => {
    const rinse = changeoverSteps.find((each) => each.kind === 'rinse');
    expect(rinse?.step).toBeNull();
    expect((rinse?.atS ?? 0) / 3_600).toBeCloseTo(8, 1);
    const cip = changeoverSteps.filter((each) => each.kind === 'cip').map((each) => each.step);
    expect(cip).toEqual(['preRinse', 'lye', 'rinse', 'acid', 'postRinse', 'cooling']);
    const sip = changeoverSteps.find((each) => each.kind === 'sip');
    expect(sip?.step).toBeNull();
  });

  it('uses four tank CIPs, the wing\'s CIP and a rinse: 18.598 kg of NaOH, 7.839 kg of HNO₃ and 14,000 L of rinse water', () => {
    const use = end.yogurt.cleaningUse;
    expect(use?.lyeKg).toBeCloseTo(4 * tankCip.use.lyeKg + wingCip.use.lyeKg, 6);
    expect(use?.lyeKg).toBeCloseTo(18.598, 3);
    expect(use?.acidKg).toBeCloseTo(7.839, 3);
    expect(use?.drainWaterL).toBeCloseTo(14_000, 6);
  });
});

describe('the heat treatment\'s CIP after a divert (H125f, H140)', () => {
  it('gives its step and adds the wing\'s CIP to what the wing has used, once it is done', () => {
    // Set point 84 °C at 3.5 h, back to 92 °C during the divert: one divert, one clean (H125f).
    const run = runner([
      { atS: hToS(3.5), command: { type: 'setSetpoint', key: 'yogurtHeatC', value: 84 } },
      { atS: hToS(3.5) + 400, command: { type: 'setSetpoint', key: 'yogurtHeatC', value: 92 } },
    ]);
    const before = run.runTo(hToS(3.5)).yogurt.cleaningUse;
    let cleaning: CleaningSnapshot | null | undefined;
    const snap = run.runTo(hToS(3.5) + 5_400, (each) => {
      if (each.yogurt.heat.mode === 'cleaning' && !cleaning) cleaning = each.yogurt.heat.cleaning;
    });
    expect(cleaning).toMatchObject({ step: 'preRinse', stepCount: 6, flowLph: 12_000 });
    expect(snap.yogurt.heat.mode).not.toBe('cleaning');
    const after = snap.yogurt.cleaningUse;
    // Tank 1's CIP (2.333–3.083 h) ended before; nothing else cleans in the window but the heat treatment.
    expect((after?.lyeKg ?? 0) - (before?.lyeKg ?? 0)).toBeCloseTo(wingCip.use.lyeKg, 6);
    expect((after?.acidKg ?? 0) - (before?.acidKg ?? 0)).toBeCloseTo(wingCip.use.acidKg, 6);
    expect((after?.drainWaterL ?? 0) - (before?.drainWaterL ?? 0)).toBeCloseTo(wingCip.use.drainWaterL, 6);
  });
});
