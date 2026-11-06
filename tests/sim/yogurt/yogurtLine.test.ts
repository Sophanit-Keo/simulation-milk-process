// The yogurt line's liquid side, live (phase 17, D27), against the hand calculations: H122–H125 in the running line,
// and H125a–H125f (plan/hand-calculations.md, "Phase 17: the yogurt line live"); since phase 18 with Line P8 filling
// its cycles (D28), so the litres to P8 carry the fill weights' random part (H129). Each expected value is worked by
// hand there; only `process` changes one, with a source.
import { beforeAll, describe, expect, it } from 'vitest';
import { hToS, type Command, type Sim, type Snapshot } from '../../../src/contracts';
import { createSim, type SimOptions } from '../../../src/sim';
import type { YogurtLine, YogurtTotals } from '../../../src/sim/yogurt/yogurtLine';
import { expectWithin } from '../../helpers/expectWithin';
import { copyConfig, plantConfig } from '../../helpers/plantConfig';
import { expectWellFormedYogurt } from '../../helpers/yogurtShape';

/** A sim at ×1,000 (1 s steps) with its yogurt line, run to `toS` after the opening, with a look at each frame. */
function runner(commands: { atS: number; command: Command }[] = [], config = plantConfig, options: SimOptions = {}) {
  let line: YogurtLine | undefined;
  const sim: Sim = createSim(config, { ...options, onYogurtLine: (made) => (line = made) });
  sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  const openS = sim.snapshot().timeS;
  const pending = [...commands];
  return {
    openS,
    line: () => line as YogurtLine,
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

/** The yogurt log's entries, oldest first, with their time after the opening. */
const yogurtLog = (snap: Snapshot, openS: number): { atS: number; message: string; kind: string }[] =>
  snap.log
    .filter((entry) => entry.line === 'yogurt')
    .map((entry) => ({ atS: entry.timeS - openS, message: entry.message, kind: entry.kind }))
    .reverse();

describe('a day of the yogurt line from the opening (H125e, H122–H125 live)', () => {
  const run = runner();
  let end: Snapshot;
  let totals: YogurtTotals;
  const log: { atS: number; message: string; kind: string }[] = [];
  const seen = new Set<string>();
  let starvedS = 0;
  let lastS = 0;
  let filling: Snapshot | undefined;
  let setRunning: Snapshot | undefined;
  let maxSetWaitS = 0;
  beforeAll(() => {
    end = run.runTo(hToS(24), (snap) => {
      const atS = snap.timeS - run.openS;
      if (snap.yogurt.p8.state === 'starved') starvedS += atS - lastS;
      lastS = atS;
      for (const entry of yogurtLog(snap, run.openS)) {
        const key = `${entry.atS}|${entry.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          log.push(entry);
        }
      }
      // A look while the heat treatment fills tank 1 at full flow, and one while it feeds set mix at its level.
      if (!filling && atS > hToS(3.5) && snap.yogurt.heat.mode === 'production') filling = snap;
      if (!setRunning && atS > hToS(20) && snap.yogurt.buffer.product === 'plainSet') setRunning = snap;
      if (snap.yogurt.buffer.product === 'plainSet') maxSetWaitS = Math.max(maxSetWaitS, snap.yogurt.buffer.waitS ?? 0);
    });
    totals = run.line().totals();
    log.sort((a, b) => a.atS - b.atS);
  }, 120_000);

  const at = (message: RegExp): number => {
    const entry = log.find((candidate) => message.test(candidate.message));
    if (!entry) throw new Error(`no log entry ${message}`);
    return entry.atS;
  };

  it('H122 live: 26.95 kg of powder, 0.99450 L of raw milk and 0.02445 L of cream a litre of mix', () => {
    expectWithin(totals.powderKg / totals.mixL, 0.0269537, 1e-7);
    expectWithin(totals.rawDrawnL / totals.mixL, 0.994496, 1e-6);
    expectWithin(totals.creamL / totals.mixL, 0.0244496, 1e-7);
    expectWithin(totals.stabilizerKg / totals.mixL, 0.003, 1e-12);
  });

  it('H123 and H124 live: filling a tank at 6,000 L/h, the mix is held 300 s at 92 °C and 99.17% of its β-lactoglobulin denatured', () => {
    const heat = filling?.yogurt.heat;
    expect(heat?.flowLph).toBeCloseTo(6_000, 6);
    expectWithin(heat?.holdS ?? 0, 300, 1.5);
    expectWithin(heat?.outletC ?? 0, 92, 1e-6);
    expectWithin(heat?.denatPct ?? 0, 99.17, 0.01);
  });

  it('H125d: the heat treatment\'s steam, 255.27 kg/h at 6,000 L/h, and its gas', () => {
    expectWithin(filling?.yogurt.energy?.steamKgPerH ?? 0, 255.27, 0.01);
    expectWithin(filling?.yogurt.energy?.gasKw ?? 0, 197.85, 0.01);
  });

  it('H125 live: tank 3 ready 2 h in, tank 1 full at 4.75 h and ready 4 h after, at 8.75 h', () => {
    expectWithin(at(/tank 3 at pH 4\.55/), hToS(2), 1);
    expectWithin(at(/tank 1 empty/), hToS(2.3333), 2);
    expectWithin(at(/tank 1 full/), hToS(4.75), 3);
    const ready = log.filter((entry) => /tank 1 at pH 4\.55/.test(entry.message))[0];
    expectWithin(ready.atS - at(/tank 1 full/), hToS(4), 1);
  });

  it('H125a: the first tanker for the yogurt silo at 4.092 h, 20,000 L', () => {
    expectWithin(at(/Tanker unloading into the yogurt silo/), hToS(4.0917), 2);
    expectWithin(totals.tankerInL, 60_000, 1e-6);
  });

  it('H125e and H129: P8 fills 477,000 cups and takes 60,579 kg, never waiting outside the rinse at 14:00 and the CIP and SIP at 22:00', () => {
    // The fills are drawn: σ 1 g over 477,000 cups is 0.69 kg (H129).
    expectWithin(totals.toP8L, 60_579.0, 3);
    const p8 = run.line().p8.totals();
    expectWithin(p8.cupsFilled, 477_000, 24);
    expectWithin(p8.drawnKg, totals.toP8L, 1e-6);
    // Every cup filled is made, taken for a seal test or rejected (H129): 11 tests, 55 cups; the checks' rejects in band.
    const { rejects } = p8;
    expect(p8.cupsMade + p8.sealTestCups + rejects.underFill + rejects.overFill + rejects.metal + rejects.vision + rejects.sealHold).toBe(p8.cupsFilled);
    expect(p8.sealTestCups).toBe(55);
    expect(p8.sealTestsPassed).toBe(11);
    expect(rejects).toMatchObject({ underFill: 0, overFill: 0, sealHold: 0 });
    expect(rejects.metal).toBeLessThanOrEqual(9);
    expect(rejects.vision).toBeGreaterThanOrEqual(10);
    expect(rejects.vision).toBeLessThanOrEqual(41);
    expect(end.yogurt.p8.cupsMade).toBe(p8.cupsMade);
    // H126's magazines: called at 25%, refilled before they run out.
    expectWithin(p8.refills.cups, 70, 1);
    expectWithin(p8.refills.foils, 45, 1);
    expect(p8.stoppedS).toEqual({ hepa: 0, cups: 0, foils: 0 });
    expect(p8.starvedS).toBe(0);
    expect(starvedS).toBe(0);
    expect(totals.rinses).toBe(1);
    expect(totals.cips).toBe(1);
    expectWithin(at(/a rinse of the buffer/), hToS(8), 1);
    expectWithin(at(/ready for strawberry/), hToS(8.25), 1);
    expectWithin(at(/CIP and P8's SIP/), hToS(16), 1);
    expectWithin(at(/ready for plain set/), hToS(17.6667), 1);
  });

  it('H125e: five tanks fermented, no divert, 40,000 L into the tanks and 40,016.4 L out, 3,189.0 L of fruit, 17,816 L of set mix', () => {
    expect(totals.tanksFermented).toBe(5);
    expect(end.yogurt.heat.divertCount).toBe(0);
    expectWithin(totals.toTanksL, 40_000, 1e-6);
    // What the tanks give follows P8's drawn fills, ±0.6 kg over the stirred shifts' cups (H129).
    expectWithin(totals.fromTanksL, 40_016.4, 3);
    expectWithin(totals.fruitL, 3_188.97, 0.6); // 15 ÷ 85 of what the tanks give
    expectWithin(totals.setToBufferL, 17_817.0, 2);
    expect(totals.reworkL).toBe(0);
  });

  it('H125e: 57,816 L heated, 2,459.8 kg of steam and 1,906.4 kWh of gas', () => {
    expectWithin(totals.heatedL, 57_817.0, 2);
    expectWithin(totals.steamKg, 2_459.8, 0.2);
    expectWithin(end.yogurt.energy?.gasKwh ?? 0, 1_906.4, 0.2);
  });

  it('H125c: set mix held at about 1,600 L, so none waits near the 45 min limit', () => {
    expectWithin(setRunning?.yogurt.buffer.levelL ?? 0, 1_600, 1);
    expect(maxSetWaitS).toBeLessThan(hToS(0.75));
    expect(maxSetWaitS).toBeGreaterThan(hToS(0.5));
    // The heat treatment matches P8's draw: a hold of 656 s.
    expectWithin(setRunning?.yogurt.heat.holdS ?? 0, 656.2, 2);
  });

  it('conserves every litre: in from the tanker, the powder, the stabilizer and the fruit; out as cream, to P8 or to rework', () => {
    const now = run.line().inventory();
    const opening = { siloL: 18_000, mixTankL: 3_000, tanksL: 30_000, bufferL: 0, reprocessL: 0 };
    const held = now.siloL - opening.siloL + (now.mixTankL - opening.mixTankL) + (now.tanksL - opening.tanksL) + (now.bufferL - opening.bufferL) + now.reprocessL;
    const inL = totals.tankerInL + totals.powderKg + totals.stabilizerKg + totals.fruitL;
    const outL = totals.creamL + totals.toP8L + totals.reworkL + totals.reprocessedL + totals.flushedL;
    // Summed over 86,400 steps: only the floating point's rounding is left.
    expectWithin(inL - outL, held, 1e-3);
  });

  it('keeps a well-formed snapshot to the end', () => {
    expectWellFormedYogurt(end, plantConfig, 'after a day');
  });
});

describe('the CCP: a heat set point under 85 °C (H125f)', () => {
  const run = runner([
    { atS: hToS(3.5), command: { type: 'setSetpoint', key: 'yogurtHeatC', value: 84 } },
  ]);
  let log: { atS: number; message: string; kind: string }[] = [];
  let afterDivert: Snapshot | undefined;
  let cleaning: Snapshot | undefined;
  let atCleanStart: YogurtTotals | undefined;
  let atCleanEnd: YogurtTotals | undefined;
  beforeAll(() => {
    let lastMode = '';
    const end = run.runTo(hToS(3.5) + 6_000, (snap) => {
      const atS = snap.timeS - run.openS;
      const { mode } = snap.yogurt.heat;
      if (!afterDivert && mode === 'divert') afterDivert = snap;
      if (!cleaning && mode === 'cleaning' && atS > hToS(3.5) + 2_000) cleaning = snap;
      if (!atCleanStart && mode === 'cleaning') atCleanStart = run.line().totals();
      if (atCleanStart && !atCleanEnd && lastMode === 'cleaning' && mode !== 'cleaning') atCleanEnd = run.line().totals();
      lastMode = mode;
    });
    log = yogurtLog(end, run.openS);
  }, 120_000);

  it('diverts one hold after the heater outlet falls below 85 °C: 362 s after the change', () => {
    const divert = log.find((entry) => /diverted to the reprocess tank/.test(entry.message));
    expect(divert?.kind).toBe('bad');
    expectWithin((divert?.atS ?? 0) - hToS(3.5), 362.4, 1.5);
    expect(afterDivert?.stages[12].status).toBe('bad');
  });

  it('sends 300 L to the reprocess tank in its 3 min, then cleans for 80 min on the wing\'s CIP', () => {
    const cleanStart = log.find((entry) => /cleaning after the divert/.test(entry.message));
    expectWithin((cleanStart?.atS ?? 0) - hToS(3.5), 362.4 + 180, 1.5);
    expect(cleaning?.yogurt.heat.cleaning?.program).toBe('cip');
    expect(cleaning?.yogurt.heat.cleaning?.flowLph).toBe(12_000);
    expect(cleaning?.stages[12].status).toBe('warn');
    const ready = log.find((entry) => /clean, ready to run again/.test(entry.message));
    expectWithin((ready?.atS ?? 0) - (cleanStart?.atS ?? 0), 4_800, 1.5);
    expectWithin(atCleanStart?.divertedL ?? 0, 300, 2);
  });

  it('pumps the reprocess tank out by the clean\'s end, and diverts again on restart while the set point stays under the limit', () => {
    expectWithin(atCleanEnd?.reprocessedL ?? 0, 300, 2);
    const diverts = log.filter((entry) => /diverted to the reprocess tank/.test(entry.message));
    expect(diverts.length).toBe(2);
  });
});

describe('the restart after the clean, with the set point back over the limit', () => {
  // The divert above, then 92 °C again while it diverts: the clean ends with the line full of water at the set
  // point, so the cold mix of before the divert is gone and the line runs on.
  const run = runner([
    { atS: hToS(3.5), command: { type: 'setSetpoint', key: 'yogurtHeatC', value: 84 } },
    { atS: hToS(3.5) + 400, command: { type: 'setSetpoint', key: 'yogurtHeatC', value: 92 } },
  ]);
  let log: { atS: number; message: string; kind: string }[] = [];
  const modes: string[] = [];
  beforeAll(() => {
    const end = run.runTo(hToS(3.5) + 8_000, (snap) => {
      if (modes.at(-1) !== snap.yogurt.heat.mode) modes.push(snap.yogurt.heat.mode);
    });
    log = yogurtLog(end, run.openS);
  }, 120_000);

  it('diverts once, cleans, and goes forward again for good', () => {
    expect(log.filter((entry) => /diverted to the reprocess tank/.test(entry.message))).toHaveLength(1);
    expect(modes.slice(modes.indexOf('divert'))).toEqual(['divert', 'cleaning', 'production']);
    const ready = log.find((entry) => /clean, ready to run again/.test(entry.message));
    expect(ready?.kind).toBe('ok');
  });
});

describe('the changeover to set yogurt with a short SIP and then a dirty swab (D28)', () => {
  // The first SIP holds only 119 °C, so it runs again; the swab after it reads 14 RLU, so the wing cleans P8 again.
  let sips = 0;
  let swabs = 0;
  const run = runner([], plantConfig, {
    p8Conditions: {
      sipTempC: () => (++sips === 1 ? 119 : 123),
      atpRlu: () => (++swabs === 1 ? 14 : 4),
    },
  });
  let log: { atS: number; message: string; kind: string }[] = [];
  const seen = new Map<string, { atS: number; message: string; kind: string }>();
  const states = new Set<string>();
  beforeAll(() => {
    run.runTo(hToS(20.5), (snap) => {
      for (const entry of yogurtLog(snap, run.openS)) seen.set(`${entry.atS}|${entry.message}`, entry);
      if (snap.timeS - run.openS > hToS(16)) states.add(snap.yogurt.p8.state);
    });
    log = [...seen.values()].sort((a, b) => a.atS - b.atS);
  }, 120_000);

  it('sterilizes again after the short SIP, cleans again after the dirty swab, and starts set yogurt only once both pass', () => {
    const at = (pattern: RegExp) => log.find((entry) => pattern.test(entry.message));
    // From 22:00: the CIP to 17.333 h, the short SIP to 17.667, the SIP again to 18.0, the CIP again to 19.333, the SIP to 19.667.
    expectWithin(at(/SIP held 119\.0 °C, under 121 °C: sterilizing again/)?.atS ?? 0, hToS(16 + 80 / 60 + 1 / 3), 2);
    expectWithin(at(/ATP swab read 14\.0 RLU, not under 10: the wing cleans P8 again/)?.atS ?? 0, hToS(18), 2);
    expectWithin(at(/cleared to start: SIP 123 °C for 20 min, ATP swab \d\.\d RLU/)?.atS ?? 0, hToS(19 + 2 / 3), 2);
    expectWithin(at(/ready for plain set yogurt/)?.atS ?? 0, hToS(19 + 2 / 3), 2);
    expect(run.line().totals()).toMatchObject({ cips: 1, recleans: 1 });
    expect(run.line().p8.totals()).toMatchObject({ sips: 3, swabs: 2 });
    // Cleaning and sterilizing until then, and running set yogurt after.
    expect([...states].sort()).toEqual(['cleaning', 'idle', 'running', 'sterilizing']);
    expect(run.sim.snapshot().yogurt.p8.state).toBe('running');
  });
});

describe('fermenting at 40 °C (H125 live)', () => {
  const config = copyConfig();
  const run = runner([{ atS: 0, command: { type: 'setSetpoint', key: 'fermentTempC', value: 40 } }], config);
  let log: { atS: number; message: string }[] = [];
  beforeAll(() => {
    log = yogurtLog(run.runTo(hToS(10)), run.openS);
  }, 120_000);

  it('takes 15,354 s from full to pH 4.55, 4 h 16 min, where 43 °C takes 4 h', () => {
    const full = log.find((entry) => /tank 1 full/.test(entry.message));
    const ready = log.filter((entry) => /tank 1 at pH 4\.55/.test(entry.message))[0];
    expectWithin((ready?.atS ?? 0) - (full?.atS ?? 0), 15_353.9, 1.5);
  });
});
