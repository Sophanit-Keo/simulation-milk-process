// Line P8 (src/sim/yogurt/p8.ts, phase 18, D28) on its own, fed from a buffer kept full, against H126–H129: the
// cycles, the fill weights and the checkweigher, the seal's leak chance and the seal tests' holds, the rare rejects,
// the interlocks (HEPA, SIP, ATP, the magazines, the buffer), the batches and their codes, and the conservation of cups.
import { describe, expect, it } from 'vitest';
import { dayToS, hToS, type LogKind, type PlantConfig, type YogurtProductId } from '../../../src/contracts';
import { createRng } from '../../../src/sim/rng';
import { batchCode, createP8, cyclePeriodS, leakChance, outsideFrac, type P8, type P8Conditions } from '../../../src/sim/yogurt/p8';
import { createBuffer, type Buffer } from '../../../src/sim/yogurt/routing';
import { expectWithin } from '../../helpers/expectWithin';
import { copyConfig, plantConfig } from '../../helpers/plantConfig';

interface Entry {
  timeS: number;
  kind: LogKind;
  message: string;
}

/** A P8 on 1 s steps from the plant's opening, its buffer topped up to 2,000 L each step unless told otherwise. */
function harness(config: PlantConfig = plantConfig, conditions: Partial<P8Conditions> = {}, seed = 1) {
  const openS = config.clock.startTimeS;
  const p8: P8 = createP8(config, openS, createRng(seed), conditions);
  const buffer: Buffer = createBuffer();
  const log: Entry[] = [];
  let timeS = openS;
  let drawnL = 0;
  return {
    p8,
    buffer,
    log,
    openS,
    get timeS() {
      return timeS;
    },
    run(seconds: number, options: { product?: YogurtProductId; shiftProduct?: YogurtProductId; mayRun?: boolean; feed?: boolean; rate?: number } = {}) {
      for (let i = 0; i < seconds; i++) {
        timeS += 1;
        if (options.feed !== false && buffer.levelL < 2_000) buffer.add(2_000 - buffer.levelL, timeS);
        drawnL += p8.step({
          dtS: 1,
          timeS,
          rateCupsPerH: options.rate ?? config.yogurt.p8.rateCupsPerH,
          buffer,
          product: options.product ?? 'plainStirred',
          shiftProduct: options.shiftProduct ?? options.product ?? 'plainStirred',
          mayRun: options.mayRun ?? true,
          log: (atS, kind, message) => log.push({ timeS: atS, kind, message }),
        });
      }
      return p8.view(timeS, options.rate ?? config.yogurt.p8.rateCupsPerH);
    },
    drawnL: () => drawnL,
  };
}

/** Every cup filled is made, taken for a seal test or rejected; every gram came from the buffer. */
function expectConserved(p8: P8, drawnL: number): void {
  const totals = p8.totals();
  const { underFill, overFill, metal, vision, sealHold } = totals.rejects;
  expect(totals.cupsMade + totals.sealTestCups + underFill + overFill + metal + vision + sealHold).toBe(totals.cupsFilled);
  expect(totals.cupsFilled).toBe(totals.cycles * plantConfig.yogurt.p8.lanes);
  expectWithin(totals.drawnKg, drawnL, 1e-6);
}

describe('H126: a cycle every 2 s, 12 cups, 1.524 kg', () => {
  it('fills 12 cups every 2 s at 21,600 cups/h, 30 cycles a minute, and 15 or 35 at the slider\'s ends', () => {
    expect(cyclePeriodS(12, 21_600)).toBeCloseTo(2, 12);
    expect(60 / cyclePeriodS(12, 10_800)).toBeCloseTo(15, 12);
    expect(60 / cyclePeriodS(12, 25_200)).toBeCloseTo(35, 12);
    const h = harness();
    const view = h.run(hToS(1));
    expect(view).toMatchObject({ state: 'running', stopReason: null, cyclesPerMin: 30 });
    const totals = h.p8.totals();
    expect(totals.cycles).toBe(1_800);
    expect(totals.cupsFilled).toBe(21_600);
    // 1.524 kg a cycle on average: σ 1 g over 21,600 cups is 0.15 kg.
    expectWithin(totals.drawnKg, 2_743.2, 0.6);
    expectConserved(h.p8, h.drawnL());
  });

  it('starts a cycle only with 12 × (127 + 4 σ) g in the buffer, and waits, logged once, while it has less', () => {
    const h = harness();
    expectWithin(h.p8.cycleNeedL, 12 * 0.131, 1e-12);
    h.run(10);
    h.buffer.draw(h.buffer.levelL);
    h.buffer.add(1.5, h.timeS);
    const view = h.run(20, { feed: false });
    expect(view.state).toBe('starved');
    expect(h.log.filter((entry) => entry.message === 'Line P8 waiting: the buffer is empty')).toHaveLength(1);
    // The first of the 20 s owes no cycle yet: 19 s of waiting.
    expect(h.p8.totals().starvedS).toBe(19);
    expect(h.run(4).state).toBe('running');
    expectConserved(h.p8, h.drawnL());
  });

  it('does not log a wait at a run-down, when the buffer holds the last shift\'s product', () => {
    const h = harness();
    h.buffer.add(1, h.timeS);
    const view = h.run(10, { feed: false, product: 'plainStirred', shiftProduct: 'strawberryStirred' });
    expect(view.state).toBe('starved');
    expect(h.log.filter((entry) => /waiting/.test(entry.message))).toEqual([]);
    expect(h.p8.totals().starvedS).toBe(0);
  });

  it('repeats exactly from its seed, and a different seed draws differently', () => {
    const a = harness(plantConfig, {}, 7);
    const b = harness(plantConfig, {}, 7);
    const c = harness(plantConfig, {}, 8);
    for (const h of [a, b, c]) h.run(hToS(2));
    expect(a.p8.totals()).toEqual(b.p8.totals());
    expect(a.p8.totals().drawnKg).not.toBe(c.p8.totals().drawnKg);
  });
});

describe('H127: the checkweigher at σ 1.0 g', () => {
  it('rejects none of a shift\'s cups at the 127 g target', () => {
    const h = harness();
    // To just before 14:00, inside the opening shift's batch, whose fills the histogram counts.
    h.run(hToS(8) - 10);
    expect(h.p8.totals().rejects).toMatchObject({ underFill: 0, overFill: 0 });
    // The fill histogram: the shift's cups, centred on 127 g.
    const { fromG, binG, counts } = h.p8.view(h.timeS, 21_600).fillHistogram;
    const cups = counts.reduce((sum, count) => sum + count, 0);
    expect(cups).toBe(h.p8.totals().cupsFilled);
    const meanG = counts.reduce((sum, count, i) => sum + count * (fromG + (i + 0.5) * binG), 0) / cups;
    expectWithin(meanG, 127, 0.01);
  });

  it('rejects Φ((120.5 − 121) ÷ 1) = 30.9% as under-fills when the target falls to 121 g', () => {
    const config = copyConfig();
    config.yogurt.p8.fill.targetG = 121;
    const h = harness(config);
    h.run(hToS(1));
    const { rejects, cupsFilled } = h.p8.totals();
    // 21,600 cups: the binomial's σ is 0.31%.
    expectWithin(rejects.underFill / cupsFilled, 0.30854, 0.01);
    expect(rejects.overFill).toBe(0);
    expectConserved(h.p8, h.drawnL());
  });
});

describe('H128: the seal\'s leak chance and the seal tests', () => {
  const { seal } = plantConfig.yogurt.p8;
  it('leaks 1 cup in 10,000 inside the window, and more the farther out: 170 °C or 3.5 bar half the cups, 1.4 s every one', () => {
    expect(leakChance(seal, { tempC: 200, timeS: 1, bar: 5 })).toBe(1e-4);
    expect(leakChance(seal, { tempC: 180, timeS: 0.8, bar: 6 })).toBe(1e-4);
    expectWithin(leakChance(seal, { tempC: 170, timeS: 1, bar: 5 }), 0.50005, 1e-9);
    expectWithin(leakChance(seal, { tempC: 200, timeS: 1, bar: 3.5 }), 0.50005, 1e-9);
    expect(leakChance(seal, { tempC: 200, timeS: 1.4, bar: 5 })).toBe(1);
    expect(outsideFrac(230, 180, 220)).toBeCloseTo(0.25, 12);
  });

  it('takes 5 cups every 2 operating hours; at the defaults every test passes', () => {
    const h = harness();
    const before = h.run(10);
    expect(before.nextSealTestS).toBe(h.openS + 10 + 7_190);
    h.run(hToS(8) - 10);
    const totals = h.p8.totals();
    expect(totals.sealTestsPassed).toBe(4);
    expect(totals.sealTestCups).toBe(20);
    expect(totals.rejects.sealHold).toBe(0);
    expectConserved(h.p8, h.drawnL());
  });

  it('holds every cup since the last test that passed when one fails, and the log names the batch', () => {
    // The heads fall to 170 °C 3 h in: the test at 2 h passes, the one at 4 h fails (96.9%, H128).
    const h = harness(plantConfig, { seal: (timeS) => ({ tempC: timeS - plantConfig.clock.startTimeS > hToS(3) ? 170 : 200, timeS: 1, bar: 5 }) }, 3);
    h.run(hToS(2) + 5);
    const madeAtPass = h.p8.totals().cupsMade;
    h.run(hToS(2));
    const totals = h.p8.totals();
    expect(totals).toMatchObject({ sealTestsPassed: 1, sealTestsFailed: 1 });
    // The cups of the two hours since the test that passed, less the test's own 5.
    expect(totals.rejects.sealHold).toBe(totals.cupsFilled - madeAtPass - 2 * 5 - totals.rejects.metal - totals.rejects.vision);
    expectWithin(totals.rejects.sealHold, 43_200 - 5, 30);
    const failed = h.log.find((entry) => /seal test failed/.test(entry.message));
    expect(failed?.kind).toBe('bad');
    expect(failed?.message).toMatch(/^Line P8 seal test failed: [1-5] of 5 cups leaked; 43,1\d\d cups held since the last test that passed \(batch P8-008-1\)$/);
    expect(h.p8.view(h.timeS, 21_600).currentBatch?.cups).toBe(totals.cupsMade);
    expectConserved(h.p8, h.drawnL());
  });
});

describe('H129: the metal detector and the vision check', () => {
  it('reject about 0.86 and 8.64 cups in a full 8 h shift, in their Poisson bands over three shifts', () => {
    const h = harness(plantConfig, {}, 11);
    h.run(hToS(24));
    const { rejects, cupsFilled } = h.p8.totals();
    expect(cupsFilled).toBe(518_400);
    // 518,400 cups: 2.59 metal (99.9% of runs 0–10), 25.9 vision (11–44).
    expect(rejects.metal).toBeLessThanOrEqual(10);
    expect(rejects.vision).toBeGreaterThanOrEqual(11);
    expect(rejects.vision).toBeLessThanOrEqual(44);
    expectConserved(h.p8, h.drawnL());
  });
});

describe('the interlocks', () => {
  it('stops while the HEPA cabin reads under +15 Pa, logs why, and runs again once it is back', () => {
    const low = (timeS: number): boolean => timeS - plantConfig.clock.startTimeS > 100 && timeS - plantConfig.clock.startTimeS <= 400;
    const h = harness(plantConfig, { hepaPa: (timeS) => (low(timeS) ? 12 : 25) });
    h.run(100);
    const cycles = h.p8.totals().cycles;
    const stopped = h.run(300);
    expect(stopped).toMatchObject({ state: 'stopped', stopReason: 'hepa', hepaPa: 12, cyclesPerMin: 0, nextSealTestS: null });
    expect(h.p8.totals().cycles).toBe(cycles);
    expect(h.p8.totals().stoppedS.hepa).toBe(300);
    expect(h.log.filter((entry) => /stopped/.test(entry.message)).map((entry) => entry.message)).toEqual([
      'Line P8 stopped: the HEPA cabin reads +12.0 Pa, under +15 Pa',
    ]);
    expect(h.run(10).state).toBe('running');
    expect(h.log.at(-1)?.message).toBe('Line P8 runs again: the HEPA cabin is back at +25.0 Pa');
  });

  it('starts after a CIP only once an SIP has held 121 °C and a swab reads under 10 RLU: a short SIP runs again, a dirty swab sends it back to the CIP', () => {
    let sipC = 119;
    let swab = 14;
    const h = harness(plantConfig, { sipTempC: () => sipC, atpRlu: () => swab });
    h.run(10);
    h.p8.cipDone(h.timeS);
    // Not cleared: it stands, whatever the buffer holds.
    expect(h.run(10).state).toBe('idle');
    expect(h.p8.afterSip(h.timeS, (atS, kind, message) => h.log.push({ timeS: atS, kind, message }))).toBe('sip');
    expect(h.log.at(-1)).toMatchObject({ kind: 'bad', message: "Line P8's SIP held 119.0 °C, under 121 °C: sterilizing again" });
    expect(h.p8.view(h.timeS, 21_600).sip).toEqual({ lastS: h.timeS, ok: false });
    sipC = 123;
    expect(h.p8.afterSip(h.timeS, (atS, kind, message) => h.log.push({ timeS: atS, kind, message }))).toBe('cip');
    expect(h.log.at(-1)?.message).toBe("Line P8's ATP swab read 14.0 RLU, not under 10: the wing cleans P8 again");
    expect(h.run(10).state).toBe('idle');
    h.p8.cipDone(h.timeS);
    swab = 3;
    expect(h.p8.afterSip(h.timeS, (atS, kind, message) => h.log.push({ timeS: atS, kind, message }))).toBe('ok');
    expect(h.log.at(-1)).toMatchObject({ kind: 'ok', message: 'Line P8 cleared to start: SIP 123 °C for 20 min, ATP swab 3.0 RLU' });
    expect(h.p8.view(h.timeS, 21_600)).toMatchObject({ sip: { ok: true }, atpRlu: 3 });
    expect(h.run(10).state).toBe('running');
    expect(h.p8.totals()).toMatchObject({ sips: 3, swabs: 2 });
  });

  it('stops when a magazine runs out before its refill comes, and runs again once it is refilled', () => {
    // A refill 10 min after the call at 25%: the cup magazine (5 min left) runs dry first, the foils (8.3 min) later.
    const config = copyConfig();
    config.yogurt.p8.magazines.refillS = 600;
    const h = harness(config);
    h.run(hToS(1));
    const totals = h.p8.totals();
    expect(totals.stoppedS.cups).toBeGreaterThan(0);
    expect(totals.stoppedS.foils).toBeGreaterThan(0);
    const stop = h.log.find((entry) => /magazine is empty/.test(entry.message));
    expect(stop).toMatchObject({ kind: 'bad', message: 'Line P8 stopped: the cup magazine is empty, waiting for its refill' });
    // 7,200 cups at 6 a second last 1,200 s; the refill, called at 25% (900 s), comes at 1,500 s.
    expectWithin((stop?.timeS ?? 0) - h.openS, 1_200, 2);
    const again = h.log.find((entry) => /runs again: the cup magazine/.test(entry.message));
    expectWithin((again?.timeS ?? 0) - h.openS, 1_500, 2);
    expectConserved(h.p8, h.drawnL());
  });

  it('never runs a magazine dry at the defaults: 70 cup and 45 foil refills in a day of running (H126)', () => {
    const h = harness();
    const view = h.run(79_500);
    const { refills, stoppedS } = h.p8.totals();
    expectWithin(refills.cups, 70, 1);
    expectWithin(refills.foils, 45, 1);
    expect(stoppedS).toEqual({ hepa: 0, cups: 0, foils: 0 });
    expect(view.magazines.cupsPct).toBeGreaterThan(0);
  });

  it('stands while it may not run (a changeover), and keeps no backlog of cycles', () => {
    const h = harness();
    h.run(60);
    const cycles = h.p8.totals().cycles;
    expect(h.run(600, { mayRun: false }).state).toBe('idle');
    expect(h.p8.totals().cycles).toBe(cycles);
    h.run(2);
    expect(h.p8.totals().cycles).toBe(cycles + 1);
  });
});

describe('batches and coding', () => {
  it('codes the opening shift P8-008-1, best before 28 days on, and starts a batch with each shift and each product', () => {
    const { firstShiftStartS, batchS } = plantConfig.quality;
    expect(batchCode(plantConfig.clock.startTimeS, firstShiftStartS, batchS)).toBe('P8-008-1');
    expect(batchCode(plantConfig.clock.startTimeS + hToS(16), firstShiftStartS, batchS)).toBe('P8-008-3');
    expect(batchCode(plantConfig.clock.startTimeS + hToS(24), firstShiftStartS, batchS)).toBe('P8-009-1');
    const h = harness();
    let batch = h.run(10).currentBatch;
    expect(batch).toMatchObject({ code: 'P8-008-1', product: 'plainStirred', madeS: h.openS + 2, expiresS: h.openS + 2 + dayToS(28) });
    // Past 14:00 with the same product: a new batch for the new shift.
    h.run(hToS(8));
    batch = h.p8.view(h.timeS, 21_600).currentBatch;
    expect(batch?.code).toBe('P8-008-2');
    // A new product in the same shift: a new batch, with the shift's code.
    batch = h.run(10, { product: 'strawberryStirred' }).currentBatch;
    expect(batch).toMatchObject({ code: 'P8-008-2', product: 'strawberryStirred' });
    expect(h.log.filter((entry) => /batch P8-008-\d started/.test(entry.message))).toHaveLength(3);
  });

  it('finishes the last shift\'s product as its own batch past the shift change, while the buffer still holds it', () => {
    const h = harness();
    h.run(hToS(8) - 5);
    // 14:00 has come, the shift makes strawberry, the buffer still holds plain stirred: the batch runs on.
    const view = h.run(20, { product: 'plainStirred', shiftProduct: 'strawberryStirred' });
    expect(view.currentBatch?.code).toBe('P8-008-1');
  });
});
