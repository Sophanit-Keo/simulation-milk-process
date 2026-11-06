// The yogurt line's five fault scenarios (phase 20, D30), against H134–H138 in plan/hand-calculations.md: each starts,
// shows its consequence, logs why, and resets; and none moves the UHT line's numbers.
import { describe, expect, it } from 'vitest';
import { hToS, YOGURT_SCENARIO_IDS, type PlantConfig, type ScenarioId, type ScenarioRunSnapshot, type Sim, type Snapshot } from '../../../src/contracts';
import { createSim } from '../../../src/sim';
import { leakChance } from '../../../src/sim/yogurt/p8';
import { createWingCip } from '../../../src/sim/yogurt/heat';
import { fermentPh, timeToPhS } from '../../../src/sim/yogurt/formulas';
import type { YogurtLine } from '../../../src/sim/yogurt/yogurtLine';
import { uhtFingerprint } from '../../fixtures/uhtPart';
import { copyConfig, plantConfig } from '../../helpers/plantConfig';

const { yogurt: wing } = plantConfig;
const faults = wing.faults;
const OPEN_S = plantConfig.clock.startTimeS;

interface Harness {
  sim: Sim;
  line: YogurtLine;
  /** Runs `seconds` of sim time at ×10 in 2.5 s steps (the base step), or until `until` holds. */
  run(seconds: number, until?: (snap: Snapshot) => boolean): Snapshot;
  trigger(id: ScenarioId): ScenarioRunSnapshot;
  readonly timeS: number;
}

function harness(config: PlantConfig = plantConfig): Harness {
  let line: YogurtLine | undefined;
  const sim = createSim(config, { onYogurtLine: (built) => (line = built) });
  sim.dispatch({ type: 'setSpeed', speed: 10 });
  const h: Harness = {
    sim,
    line: line as unknown as YogurtLine,
    run(seconds, until) {
      const endS = sim.snapshot().timeS + seconds;
      let snap = sim.snapshot();
      while (snap.timeS < endS - 1e-6) {
        sim.step(0.25);
        snap = sim.snapshot();
        if (until?.(snap)) break;
      }
      return snap;
    },
    trigger(id) {
      sim.dispatch({ type: 'triggerScenario', id });
      const run = sim.snapshot().scenarios.runs[0];
      expect(run?.id).toBe(id);
      return run as ScenarioRunSnapshot;
    },
    get timeS() {
      return sim.snapshot().timeS;
    },
  };
  return h;
}

const runOf = (snap: Snapshot, id: ScenarioId): ScenarioRunSnapshot => snap.scenarios.runs.find((run) => run.id === id) as ScenarioRunSnapshot;
const after = (run: ScenarioRunSnapshot, message: RegExp): number => {
  const entry = run.log.find((each) => message.test(each.message));
  expect(entry, `${run.id}: ${String(message)}`).toBeDefined();
  return (entry?.timeS ?? NaN) - run.startedS;
};
const over = (snap: Snapshot): boolean => snap.scenarios.runs[0]?.following === false;

describe('H134: slow fermentation (a bacteriophage)', () => {
  it('stalls the half-way tank at pH 5.2, flags it 2 h after it was due, discards it at 8 h, and brings the next tank forward', () => {
    const h = harness();
    h.run(10);
    const run = h.trigger('yogurtSlowFermentation');
    // Tank 3 opened half way through its 4 h at 43 °C: it started 2 h before the opening.
    expect(run.log[0]?.message).toBe("Bacteriophage in fermentation tank 3's culture: its pH will stall near 5.2");
    expect(run.endedS).toBe(run.startedS); // a phage cannot be put right
    const stalled = h.run(hToS(3));
    const tank = stalled.yogurt.ferment.tanks[2];
    expect(tank?.ph).toBeCloseTo(faults.phage.stallPh, 6);
    expect(tank?.held).toBeUndefined();
    // The curve, unhurt, would be past its end pH by now.
    expect(fermentPh(wing.ferment, hToS(2) + hToS(3), wing.ferment.optC)).toBeLessThan(wing.ferment.endPh);
    expect(timeToPhS(wing.ferment, faults.phage.stallPh, wing.ferment.optC)).toBeLessThan(hToS(4));
    const end = h.run(hToS(6), over);
    const done = runOf(end, 'yogurtSlowFermentation');
    // Started at 04:00: due 08:00, flagged 10:00, discarded 12:00.
    const flagS = OPEN_S - hToS(2) + wing.ferment.endAtOptS + faults.phage.flagAfterS;
    expect(after(done, /^Fermentation tank 3 flagged: pH 5\.20 6\.0 h after it started, on hold$/) + done.startedS).toBeCloseTo(flagS, -1);
    expect(done.log.map((entry) => entry.message)).toContain(done.log.find((entry) => /brought forward to feed Line P8/.test(entry.message))?.message);
    const discardS = OPEN_S - hToS(2) + faults.phage.discardAfterS;
    expect(after(done, /^Fermentation tank 3 discarded: 10,000 L of stalled yogurt/) + done.startedS).toBeCloseTo(discardS, -1);
    expect(h.line.totals().discardedL).toBe(wing.ferment.tankL);
    expect(done).toMatchObject({ following: false, summary: 'Over: the tank discarded and cleaned' });
    for (const entry of done.log.slice(1)) expect(entry.why, entry.message).toBeTruthy();
    // Held, the tank was never fed to P8; while held its lamp was red.
    expect(end.yogurt.ferment.tanks[2]?.state).toBe('cleaning');
  });

  it('turns stage 13 red while the tank is held', () => {
    const h = harness();
    h.run(10);
    h.trigger('yogurtSlowFermentation');
    const held = h.run(hToS(5), (snap) => snap.yogurt.ferment.tanks.some((tank) => tank.held));
    expect(held.yogurt.ferment.tanks[2]?.held).toBe(true);
    expect(held.stages[13].status).toBe('bad');
    expect(held.scenarios.runs[0]?.summary).toMatch(/^Tank 3 held at pH 5\.20 · discarded in 2 h/);
    expect(held.scenarios.unavailable.yogurtSlowFermentation).toBe("A tank's culture is stalled already");
  });
});

describe('H135: the heat treatment under temperature', () => {
  it('waits for the heat treatment to run, then diverts once the cool mix reaches the outlet, cleans, and runs again', () => {
    const h = harness();
    expect(h.sim.snapshot().scenarios.unavailable.yogurtHeatUnderTemp).toBe('The yogurt heat treatment is idle; the dip needs it in production');
    h.run(hToS(8), (snap) => snap.yogurt.heat.mode === 'production' && snap.yogurt.heat.flowLph >= wing.mix.capacityLph - 1);
    const run = h.trigger('yogurtHeatUnderTemp');
    expect(run.log[0]?.message).toBe('Steam to the yogurt heat treatment dips for 10 min: the outlet falls toward 82 °C');
    const end = h.run(hToS(4), over);
    const done = runOf(end, 'yogurtHeatUnderTemp');
    // The outlet passes 85 °C 30 × ln(10/3) = 36.1 s in; that mix leaves the holding cell 300 s later.
    expect(after(done, /^Yogurt mix diverted to the reprocess tank: 8\d\.\d °C at the holding cell's outlet, below 85 °C$/)).toBeCloseTo(336.1, -1);
    expect(after(done, /^Yogurt heat treatment cleaning after the divert/)).toBeCloseTo(336.1 + wing.heat.divertS, -1);
    expect(after(done, /^Steam to the yogurt heat treatment restored/)).toBeCloseTo(faults.heat.durationS, -1);
    expect(after(done, /^Yogurt heat treatment clean, ready to run again$/)).toBeCloseTo(336.1 + wing.heat.divertS + createWingCip(plantConfig).totalS, -1);
    expect(done).toMatchObject({ following: false, summary: 'Over: the heat treatment runs again' });
    expect(h.line.totals().divertedL).toBeGreaterThan(0);
  });
});

describe('H136: seal temperature drift', () => {
  it('leaks every test cup once the heads reach 160 °C: the next test fails, holds the cups since the last pass, and the heads are set back', () => {
    // The drift: 200 °C to 160 °C over 15 min. Under 180 °C the leaks rise; at 160 °C, 20 °C (half the window) out, every cup leaks.
    const seal = (tempC: number) => leakChance(wing.p8.seal, { tempC, timeS: wing.p8.seal.timeS, bar: wing.p8.seal.bar });
    expect(seal(190)).toBe(wing.p8.seal.leakInWindowFrac);
    expect(seal(170)).toBeCloseTo(0.5, 3);
    expect(seal(faults.seal.driftToC)).toBe(1);
    const h = harness();
    h.run(10);
    h.trigger('yogurtSealDrift');
    const drifting = h.run(faults.seal.driftS);
    expect(drifting.yogurt.p8.seal?.tempC).toBeCloseTo(faults.seal.driftToC, 6);
    expect(drifting.stages[15].status).toBe('warn');
    const end = h.run(hToS(3), over);
    const done = runOf(end, 'yogurtSealDrift');
    // P8's first seal test after the opening is due at 08:00.
    expect(after(done, /^Line P8 seal test failed: 5 of 5 cups leaked; [\d,]+ cups held since the last test that passed \(batch P8-008-1\)$/) + done.startedS).toBeCloseTo(OPEN_S + hToS(2), -1);
    const held = h.line.p8.totals().rejects.sealHold;
    // Two hours at 21,600 cups/h, less the 5 test cups and a few rejects.
    expect(held).toBeGreaterThan(43_150);
    expect(held).toBeLessThanOrEqual(43_195);
    expect(done.log.map((entry) => entry.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^Cold chain: [\d,]+ cups pulled for the failed seal test/), "Line P8's seal heads set back to 200 °C"]));
    expect(done).toMatchObject({ following: false, summary: 'Over: seal heads back at 200 °C' });
    expect(end.yogurt.p8.seal?.tempC).toBe(wing.p8.seal.tempC);
  });
});

describe('H137: HEPA overpressure loss', () => {
  it('stops P8 at once; after the 30 min repair, a 20 min SIP and a swab, it fills again: 18,000 cups not made', () => {
    const h = harness();
    h.run(10);
    h.trigger('yogurtHepaLoss');
    const stopped = h.run(10);
    expect(stopped.yogurt.p8).toMatchObject({ state: 'stopped', stopReason: 'hepa', hepaPa: faults.hepa.cabinPa });
    const before = h.line.p8.totals().cupsFilled;
    const end = h.run(hToS(2), over);
    const done = runOf(end, 'yogurtHepaLoss');
    expect(after(done, /^HEPA cabin's fan repaired/)).toBeCloseTo(faults.hepa.repairS, -1);
    expect(after(done, /^Line P8: SIP and ATP swab after the HEPA cabin/)).toBeCloseTo(faults.hepa.repairS, -1);
    expect(after(done, /^Line P8 cleared to start: SIP 123 °C for 20 min/)).toBeCloseTo(faults.hepa.repairS + wing.p8.sip.holdS, -1);
    expect(done).toMatchObject({ following: false, summary: 'Over: P8 fills again' });
    expect(h.line.p8.totals().sips).toBe(1);
    // It filled nothing from the fan's failure to the swab.
    const stalledS = faults.hepa.repairS + wing.p8.sip.holdS;
    expect((stalledS / 3600) * wing.p8.rateCupsPerH).toBe(18_000);
    expect(h.line.p8.totals().cupsFilled - before).toBeLessThan(wing.p8.lanes * 2);
  });
});

describe('H138: the cold-room excursion', () => {
  /** The air and the cores, stepped by hand every second: the closed forms' check. */
  function stepped(untilS: number): { airC: number; coreC: number; peakC: number } {
    const room = faults.coldRoom;
    let airC = wing.coldChain.roomC;
    let coreC = airC;
    let peakC = coreC;
    for (let t = 0; t < untilS; t++) {
      const targetC = t < room.repairS ? room.airC : wing.coldChain.roomC;
      airC += (targetC - airC) * (1 - Math.exp(-1 / room.airTauS));
      coreC += (airC - coreC) * (1 - Math.exp(-1 / wing.coldChain.chillTauS));
      peakC = Math.max(peakC, coreC);
    }
    return { airC, coreC, peakC };
  }

  it('holds the cold room\'s pallets after 2 h over 6 °C, and QA destroys them: their cores passed 8 °C', () => {
    const room = faults.coldRoom;
    // Over 6 °C at 1,800 × ln(7/4) = 1,007 s; held 2 h later, at 8,207 s; repaired at 3 h; under 6 °C again at 12,321 s.
    const overS = room.airTauS * Math.log((room.airC - wing.coldChain.roomC) / (room.airC - room.limitC));
    expect(overS).toBeCloseTo(1_007.3, 1);
    const h = harness();
    h.run(10);
    h.trigger('yogurtColdRoomExcursion');
    const end = h.run(hToS(7), over);
    const done = runOf(end, 'yogurtColdRoomExcursion');
    expect(after(done, /^Cold room's air over 6 °C/)).toBeCloseTo(overS, -1);
    expect(after(done, /^Cold room over 6 °C for 2 h: \d+ pallets on QA hold$/)).toBeCloseTo(overS + room.overS, -1);
    expect(after(done, /^Cold room's cooling repaired: the air at 10\.0 °C/)).toBeCloseTo(room.repairS, -1);
    const backS = after(done, /^Cold room back under 6 °C: QA decides/);
    expect(backS).toBeCloseTo(12_321, -1);
    const verdict = done.log.find((entry) => /^QA destroys the \d+ held pallets/.test(entry.message));
    expect(verdict?.timeS).toBeCloseTo(done.startedS + backS + room.qaDecisionS, -1);
    const peakC = Number(/reached ([\d.]+) °C/.exec(verdict?.message ?? '')?.[1]);
    expect(peakC).toBeCloseTo(stepped(backS + room.qaDecisionS).peakC, 1);
    expect(peakC).toBeGreaterThan(room.maxCoreC);
    expect(h.line.coldChain.totals().cupsDestroyed).toBeGreaterThan(0);
    expect(done).toMatchObject({ following: false, summary: 'Over: QA destroyed the held pallets' });
    expect(end.yogurt.coldChain.coldRoom.tempC).toBeLessThan(wing.coldChain.roomMaxC);
    // Once the air is back at its set point the excursion is over, and the run still says what QA decided.
    const later = h.run(hToS(1));
    expect(later.yogurt.coldChain.coldRoom.excursion).toBeNull();
    expect(runOf(later, 'yogurtColdRoomExcursion').summary).toBe('Over: QA destroyed the held pallets');
  });

  it('releases the pallets when the air only reaches 8 °C: held, but their cores stay under 8 °C', () => {
    const config = copyConfig();
    config.yogurt.faults.coldRoom.airC = 8;
    const room = config.yogurt.faults.coldRoom;
    const h = harness(config);
    h.run(10);
    h.trigger('yogurtColdRoomExcursion');
    const held = h.run(hToS(3), (snap) => snap.scenarios.runs[0]?.log.some((entry) => /on QA hold/.test(entry.message)) === true);
    expect(held.stages[16].status).toBe('bad');
    expect(held.yogurt.coldChain.pallets?.some((pallet) => pallet.qaHold && !pallet.released)).toBe(true);
    expect(held.yogurt.coldChain.coldRoom.excursion).toMatchObject({ coolingDown: true, limitC: room.limitC, verdict: null });
    const end = h.run(hToS(8), over);
    const done = runOf(end, 'yogurtColdRoomExcursion');
    const verdict = done.log.find((entry) => /^QA releases the \d+ held pallets: their cores peaked at ([\d.]+) °C, within 8 °C$/.test(entry.message));
    expect(verdict, done.log.map((entry) => entry.message).join('\n')).toBeDefined();
    expect(done.summary).toBe('Over: QA released the held pallets');
    expect(end.yogurt.coldChain.pallets?.some((pallet) => pallet.qaHold)).toBe(false);
    expect(h.line.coldChain.totals().cupsDestroyed).toBe(0);
  });

  it('holds nothing when the cooling is put right before 2 h over the limit', () => {
    const h = harness();
    h.run(10);
    h.trigger('yogurtColdRoomExcursion');
    h.run(hToS(1));
    h.sim.dispatch({ type: 'resetScenarios' });
    const end = h.run(hToS(4), over);
    const done = runOf(end, 'yogurtColdRoomExcursion');
    // Repaired at 1 h with the air at 10 − 7e⁻² = 9.05 °C, it is back under 6 °C 1,800 × ln(6.05/3) = 1,263 s later.
    expect(done.log.map((entry) => entry.message)).toContain('Cold room back under 6 °C after 1 h 21 min: no pallet held');
    expect(done.following).toBe(false);
    expect(h.line.coldChain.totals().cupsDestroyed).toBe(0);
  });
});

describe('the five together', () => {
  it('each says why it cannot start twice, resets, and leaves the UHT line\'s numbers as they were', () => {
    const plain = (snap: Snapshot): unknown => JSON.parse(JSON.stringify(snap));
    const quiet = harness();
    const faulty = harness();
    quiet.run(10);
    faulty.run(10);
    for (const id of YOGURT_SCENARIO_IDS) if (id !== 'yogurtHeatUnderTemp') faulty.trigger(id);
    const snap = faulty.sim.snapshot();
    expect(snap.scenarios.unavailable).toMatchObject({
      yogurtSlowFermentation: "A tank's culture is stalled already",
      yogurtSealDrift: 'The seal heads are drifting already',
      yogurtHepaLoss: 'The HEPA cabin is down already',
      yogurtColdRoomExcursion: 'The cold room is out of its range already',
    });
    faulty.sim.dispatch({ type: 'resetScenarios' });
    const live = faulty.sim.snapshot().scenarios.runs.filter((run) => run.endedS === null);
    expect(live).toEqual([]);
    const a = quiet.run(hToS(1));
    const b = faulty.run(hToS(1));
    expect(uhtFingerprint(plain(b))).toBe(uhtFingerprint(plain(a)));
  });
});
