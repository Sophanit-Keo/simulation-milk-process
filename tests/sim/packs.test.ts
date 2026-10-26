// Stages 7–10, the discrete packs model (src/sim/packsLine.ts and src/sim/packs/), through createSim as the
// app runs it: the fillers' state machines, trays and pallets, batches and samples, incubation and the QA
// override, the warehouse and its trucks, and the opening history of D11. Hand values from
// plan/hand-calculations.md (H26–H52) where a row gives one.
import { describe, expect, it } from 'vitest';
import { dayToS, hToS, minToS, sToH, type PlantConfig, type Snapshot } from '../../src/contracts';
import { oeeFrac } from '../../src/sim/formulas';
import { expectWithin } from '../helpers/expectWithin';
import { emptyPlantConfig, scriptedRng, startPacks } from '../helpers/packsRun';
import { expectPacksMatchKpis, expectWellFormedPacks } from '../helpers/packsShape';
import { copyConfig, NO_BREAKDOWNS_MTBF_S, plantConfig } from '../helpers/plantConfig';

const SHIFT_S = plantConfig.quality.batchS;
const PACKS_PER_PALLET = 1_008;

/** No breakdowns: the fillers run as the phase 3 stub did, so counts follow from the rates alone. */
const steadyConfig = (change: (config: PlantConfig) => void = () => {}): PlantConfig => {
  const config = emptyPlantConfig();
  config.fillers.mtbfMeanS = NO_BREAKDOWNS_MTBF_S;
  change(config);
  return config;
};

const logged = (snap: Snapshot, pattern: RegExp) => snap.log.filter((entry) => pattern.test(entry.message));

describe('the plant as it opens (D11: day 8, 06:00, after a week of batches)', () => {
  const snap = startPacks(copyConfig()).sim.snapshot();

  it('is well formed, and its KPIs and stage values repeat what Snapshot.packs holds', () => {
    expectWellFormedPacks(snap, plantConfig, 'opening');
    expectPacksMatchKpis(snap, 'opening');
  });

  it('holds 42 batches on hold, 6 a day for 7 days, and the 2 it fills now (H30, H49)', () => {
    const { batches } = snap.packs;
    expect(batches.filter((batch) => batch.status === 'hold')).toHaveLength(42);
    expect(batches.filter((batch) => batch.status === 'filling').map((batch) => batch.filler)).toEqual(['A', 'B']);
    expect(snap.kpis.batchesOnHold).toBe(42);
  });

  it('holds about 2,450 pallets on hold: 42 batches of about 58.3 after breakdowns (D11)', () => {
    const pallets = snap.packs.batches.reduce((sum, batch) => sum + batch.pallets, 0);
    expectWithin(pallets, 42 * 58.3, 40);
    for (const batch of snap.packs.batches.filter((each) => each.status === 'hold')) {
      expect(batch.pallets, `batch ${batch.id}`).toBeGreaterThanOrEqual(50);
      expect(batch.pallets, `batch ${batch.id}`).toBeLessThanOrEqual(60);
      // 16 samples a shift, and 2 after each restart (D1).
      expect((batch.samples - 16) % 2, `batch ${batch.id} samples`).toBe(0);
      expect(batch.samples, `batch ${batch.id} samples`).toBeGreaterThanOrEqual(16);
    }
  });

  it('releases the oldest batch first, on day 8 at 14:00 (H50), and the newest a week after its shift ends', () => {
    const onHold = snap.packs.batches.filter((batch) => batch.status === 'hold');
    expect(onHold[0]).toMatchObject({ startS: hToS(6), endS: hToS(14), releaseAtS: 655_200 });
    expect(onHold.at(-1)?.releaseAtS).toBe(626_400 + dayToS(7));
  });

  it('has 634 pallets of released stock, two days of cover (H44), first-expired-first-out', () => {
    const { warehouse } = snap.packs;
    expect(warehouse.palletsInStock).toBe(634);
    expectWithin(snap.kpis.daysOfCover, 2.0, 0.01);
    const bestBefore = warehouse.stock.map((entry) => entry.bestBeforeS);
    expect([...bestBefore].sort((a, b) => a - b)).toEqual(bestBefore);
    // Every batch in stock is older than every batch on hold.
    const oldestOnHold = Math.min(...snap.packs.batches.map((batch) => batch.id));
    for (const entry of warehouse.stock) expect(entry.batchId).toBeLessThan(oldestOnHold);
  });

  it('dates every batch to its shift: best before 182 days after its start (D9)', () => {
    for (const batch of snap.packs.batches) expect(batch.bestBeforeS - batch.startS).toBe(dayToS(182));
  });

  it('opens with both fillers running at 7,500 packs/h and 93.75% OEE: 100% available, 7,500 ÷ 8,000, no rejects yet', () => {
    for (const filler of snap.packs.fillers) {
      expect(filler).toMatchObject({ state: 'running', packsPerH: 7_500, packsMade: 0, breakdowns: 0, availabilityPct: 100, qualityPct: 100 });
      expectWithin(filler.oeePct, 93.75, 1e-9);
    }
    expect(snap.kpis.oeePct).toBe(93.75);
    expect(snap.kpis.packsPerH).toBe(15_000);
  });

  it('expects its first truck 100 min after opening, and has shipped none (D3)', () => {
    expect(snap.packs.warehouse.nextTruckS).toBe(626_400 + 6_000);
    expect(snap.packs.warehouse.trucks).toEqual([]);
    expect(snap.kpis).toMatchObject({ trucksShipped: 0, orderFillPct: 100 });
  });
});

describe('stage 7: the fillers', () => {
  it('make 7,500 packs/h each, the seal check rejects 0.2% of them, and litres drawn = packs made × 1 L', () => {
    const run = startPacks(steadyConfig(), { speed: 1_000 });
    run.runTo(hToS(1));
    const { totals } = run.packs;
    expectWithin(totals.packsMade, 15_000, 1);
    expect(totals.packsRejected).toBe(30);
    expectWithin(totals.packsMade * plantConfig.product.packVolumeL, run.liquid.totals.toFillersL, 2);
  });

  it('break down after their running time, repair for the random part, re-sterilize for 2 min, then run again', () => {
    const config = steadyConfig();
    // Filler A breaks down after 1 h of running; its repair takes 10 min, then 2 min of cleaning (D2, D14).
    const run = startPacks(config, { speed: 10, packsRng: scriptedRng(config, { toFailureS: [hToS(1), NO_BREAKDOWNS_MTBF_S], repairS: [minToS(10)] }) });
    const states: { tS: number; state: string; leftS: number }[] = [];
    run.runTo(hToS(1) + minToS(15), (snap) => {
      const a = snap.packs.fillers[0];
      if (a && states.at(-1)?.state !== a.state) states.push({ tS: run.t(), state: a.state, leftS: a.stateRemainingS });
    });
    expect(states.map((entry) => entry.state)).toEqual(['running', 'repair', 'cleaning', 'running']);
    expect(states[1]).toMatchObject({ tS: hToS(1), leftS: minToS(10) });
    expect(states[2]).toMatchObject({ tS: hToS(1) + minToS(10), leftS: minToS(2) });
    expect(states[3]?.tS).toBe(hToS(1) + minToS(12));
    const snap = run.sim.snapshot();
    expect(snap.packs.fillers[0]?.breakdowns).toBe(1);
    expect(snap.packs.fillers[1]?.breakdowns).toBe(0);
    expect(logged(snap, /^Filler A broke down: repair about 12 min/)).toHaveLength(1);
    expect(logged(snap, /^Filler A sterile: running again/)).toHaveLength(1);
  });

  it('turn stage 7 red in repair and amber while cleaning, and hold the packs line still', () => {
    const config = steadyConfig();
    const run = startPacks(config, { packsRng: scriptedRng(config, { toFailureS: [minToS(1)], repairS: [minToS(5)] }) });
    const repairing = run.runTo(minToS(3));
    expect(repairing.stages[7].status).toBe('bad');
    expect(repairing.stages[7].values.runningCount).toBe(1);
    expect(repairing.liquid.fillersRunning).toBe(1);
    expect(repairing.line.filler.flowLph).toBe(7_500);
    const cleaning = run.runTo(minToS(7));
    expect(cleaning.packs.fillers[0]?.state).toBe('cleaning');
    expect(cleaning.stages[7].status).toBe('warn');
    expect(run.runTo(minToS(9)).stages[7].status).toBe('ok');
  });

  it('count time to failure only while running: a filler stopped at rate 0 does not break down, and breaks down later by as much', () => {
    const config = steadyConfig();
    const run = startPacks(config, { packsRng: scriptedRng(config, { toFailureS: [minToS(30), minToS(30)] }) });
    run.runTo(minToS(20));
    run.sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 0 });
    const stopped = run.runTo(minToS(50));
    expect(stopped.packs.fillers.map((filler) => filler.state)).toEqual(['stopped', 'stopped']);
    expect(stopped.stages[7].status).toBe('warn');
    expect(stopped.liquid.fillersRunning).toBe(0);
    expect(stopped.line.filler.flowLph).toBe(0);
    run.sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 7_500 });
    // 20 min ran before the stop, so 10 min of running are left: the breakdowns come at 60 min, not 30.
    const before = run.runTo(minToS(59) + 50);
    expect(before.packs.fillers.map((filler) => filler.state)).toEqual(['running', 'running']);
    const after = run.runTo(minToS(60) + 2);
    expect(after.packs.fillers.map((filler) => filler.state)).toEqual(['repair', 'repair']);
  });

  it('starve when the aseptic tank runs low, and count it against availability, not as a breakdown', () => {
    // A divert at once: the UHT plant is out for 113 min while the fillers drain the tank from 10,000 L (H37).
    const config = steadyConfig((each) => (each.uht.displayNoiseC = 0));
    const run = startPacks(config, { speed: 100 });
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 138 });
    run.sim.step(0.01);
    run.sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 140 });
    const starved = run.runTo(minToS(60));
    expect(starved.liquid.fillersStarved).toBe(true);
    expect(starved.packs.fillers.map((filler) => filler.state)).toEqual(['starved', 'starved']);
    expect(starved.stages[7].status).toBe('idle');
    expect(starved.packs.fillers[0]?.breakdowns).toBe(0);
    expect(starved.packs.fillers[0]?.availabilityPct).toBeLessThan(100);
    expect(starved.packs.packaging.lanes.map((lane) => lane.packerState)).toEqual(['idle', 'idle']);
  });

  it('give OEE = availability × performance × quality: one shift with one 14-min stop (H51), with the 0.2% rejects', () => {
    const config = steadyConfig();
    // Filler A stops once, 12 min of repair + 2 min of cleaning = 14 min, as in H51.
    const run = startPacks(config, { speed: 1_000, packsRng: scriptedRng(config, { toFailureS: [hToS(3)], repairS: [minToS(12)] }) });
    const snap = run.runTo(SHIFT_S - 1);
    const a = snap.packs.fillers[0];
    if (!a) throw new Error('no filler A');
    const availabilityFrac = (480 - 14) / 480;
    expectWithin(a.availabilityPct / 100, availabilityFrac, 1e-4);
    expectWithin(a.performancePct / 100, 7_500 / 8_000, 1e-4);
    expectWithin(a.qualityPct / 100, 0.998, 1e-4);
    // H51 with Q = 1 is 0.91016; with the reject rate, 0.91016 × 0.998.
    expectWithin(oeeFrac(availabilityFrac, 0.9375, 1), 0.91016, 0.00001);
    expectWithin(a.oeePct / 100, 0.91016 * 0.998, 2e-4);
    // H51: 466 min × 7,500 packs/h = 58,250 packs.
    expectWithin(a.packsMade, (466 / 60) * 7_500 * ((SHIFT_S - 1) / SHIFT_S), 15);
  });
});

describe('stage 8: trays, pallets and the batch change', () => {
  it('packs 12 to a tray and 84 trays to a pallet: 1,008 packs (H26), each pallet of one batch', () => {
    const run = startPacks(steadyConfig(), { speed: 1_000 });
    const snap = run.runTo(hToS(2));
    const { totals } = run.packs;
    // 2 h × 7,500 packs/h a line, less 0.2% rejects and 4 samples: 14,966 packs, 14 full pallets a line.
    expect(totals.packsOnClosedPallets).toBe(totals.palletsMade * PACKS_PER_PALLET);
    expect(snap.packs.packaging.palletsMade).toBe(28);
    expect(snap.packs.packaging.lanes.map((lane) => 12 * lane.palletTrays + lane.trayPacks + lane.queuePacks)).toEqual([14_966 - 14 * 1_008, 14_966 - 14 * 1_008]);
    for (const lane of snap.packs.packaging.lanes) {
      const batch = snap.packs.batches.find((each) => each.id === lane.batchId);
      expect(batch?.status).toBe('filling');
      expect(batch?.filler).toBe(lane.name);
    }
    expect(snap.packs.packaging.lastPallet).toMatchObject({ palletNo: expect.any(Number) });
  });

  it('at the shift change closes each batch with a part-full last pallet (D1), stops the packer 2 min, then catches up', () => {
    const config = steadyConfig();
    const run = startPacks(config, { speed: 10 });
    run.runTo(SHIFT_S - 10);
    const lanesSeen: string[] = [];
    let mostQueued = 0;
    run.runTo(SHIFT_S + minToS(12), (snap) => {
      const lane = snap.packs.packaging.lanes[0];
      if (!lane) return;
      if (lanesSeen.at(-1) !== lane.packerState) lanesSeen.push(lane.packerState);
      mostQueued = Math.max(mostQueued, lane.queuePacks);
    });
    expect(lanesSeen).toEqual(['running', 'changeover', 'catchUp', 'running']);
    // 2 min of 7,500 packs/h queue up (250 packs), and the packer clears them at up to 30% over 8,000/h (D9).
    expectWithin(mostQueued, 250, 3);
    const snap = run.sim.snapshot();
    const closed = snap.packs.batches.filter((batch) => batch.status === 'hold');
    expect(closed.map((batch) => batch.filler)).toEqual(['A', 'B']);
    for (const batch of closed) {
      // 60,000 packs at full rate (H27), less 120 rejects and the 16 samples: 59 full pallets and a part-full one (H28).
      expect(batch.pallets).toBe(60);
      expect(batch.packs).toBe(60_000 - 120 - 16);
      expect(batch.lastPalletPacks).toBe(60_000 - 120 - 16 - 59 * PACKS_PER_PALLET);
      expect(batch.samples).toBe(16);
      expect(batch.releaseAtS).toBe(run.openS + SHIFT_S + dayToS(7));
    }
    expect(logged(snap, /^Batch \d+ \(filler A\) closed: 60 pallets on hold until day 15, 14:00$/)).toHaveLength(1);
    expect(snap.stages[8].status).toBe('ok');
  });

  it('shows stage 8 amber during the batch change', () => {
    const run = startPacks(steadyConfig(), { speed: 10 });
    expect(run.runTo(SHIFT_S + 60).stages[8].status).toBe('warn');
  });
});

describe('stage 9: samples, incubation and the QA override', () => {
  it('takes 16 samples a batch, 1 a filler every 30 min (H29), and 2 more after each restart (D1)', () => {
    const run = startPacks(steadyConfig(), { speed: 1_000 });
    run.runTo(hToS(2));
    // A stop of 10 min at rate 0, then running again: one restart for each filler.
    run.sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 0 });
    run.runTo(hToS(2) + minToS(10));
    run.sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 7_500 });
    const snap = run.runTo(SHIFT_S + 5);
    const closed = snap.packs.batches.filter((batch) => batch.status === 'hold');
    expect(closed.map((batch) => batch.samples)).toEqual([18, 18]);
    // Every sample owed has been taken off the line from good packs.
    expect(run.packs.totals.samplesOwed).toBe(0);
    expect(run.packs.totals.packsSampled).toBe(2 * 18 + 2);
  });

  it('releases a batch 7 days after it closes; at ×10,000 that takes 60.48 s of real time (H54)', () => {
    const run = startPacks(steadyConfig(), { speed: 10_000 });
    let closedFrame = -1;
    let releasedFrame = -1;
    let frame = 0;
    run.runTo(SHIFT_S + dayToS(7) + 60, (snap) => {
      frame += 1;
      const closed = logged(snap, /^Batch \d+ \(filler A\) closed/);
      if (closedFrame < 0 && closed.length > 0) closedFrame = frame;
      if (releasedFrame < 0 && logged(snap, /passed incubation/).length > 0) releasedFrame = frame;
    });
    expect(closedFrame).toBeGreaterThan(0);
    expectWithin((releasedFrame - closedFrame) * plantConfig.clock.maxFrameS, 60.48, 0.11);
    const snap = run.sim.snapshot();
    expect(snap.kpis.batchesReleased).toBe(2);
    // The released pallets are in stock: 2 batches of 60.
    expect(snap.packs.warehouse.palletsInStock + run.packs.totals.palletsLoading + run.packs.totals.palletsShipped).toBe(120);
  });

  it('blocks a batch whose sample spoils, keeps its pallets in quarantine a day with stage 9 red, then destroys them', () => {
    const config = steadyConfig();
    const run = startPacks(config, { speed: 10_000, packsRng: scriptedRng(config, { spoil: [true, false] }) });
    const blocked = run.runTo(SHIFT_S + dayToS(7) + 60);
    const batch = blocked.packs.batches.find((each) => each.status === 'blocked');
    expect(batch?.filler).toBe('A');
    expect(blocked.stages[9].status).toBe('bad');
    expect(blocked.kpis).toMatchObject({ batchesBlocked: 1, batchesReleased: 1 });
    expect(logged(blocked, /failed incubation \(a sample of 16 spoiled\): 60 pallets blocked/)).toHaveLength(1);
    const gone = run.runTo(SHIFT_S + dayToS(8) + 60);
    expect(gone.packs.batches.find((each) => each.id === batch?.id)).toBeUndefined();
    expect(gone.packs.warehouse.palletsDestroyed).toBe(60);
    expect(logged(gone, /60 pallets left quarantine for destruction/)).toHaveLength(1);
  });

  it('applies a QA fail at once, even to a batch still filling, and a pass at the end of incubation without the draw', () => {
    const config = steadyConfig();
    // Both samples spoil: only the override can release batch B.
    const run = startPacks(config, { speed: 10_000, packsRng: scriptedRng(config, { spoil: [true, true] }) });
    const [a, b] = run.sim.snapshot().packs.batches;
    if (!a || !b) throw new Error('no batches');
    run.sim.dispatch({ type: 'setQaResult', batchId: a.id, result: 'fail' });
    run.sim.dispatch({ type: 'setQaResult', batchId: b.id, result: 'pass' });
    const now = run.runTo(60);
    expect(now.packs.batches.find((batch) => batch.id === a.id)).toMatchObject({ status: 'blocked', qaResult: 'fail' });
    expect(now.packs.batches.find((batch) => batch.id === b.id)).toMatchObject({ status: 'filling', qaResult: 'pass' });
    expect(now.stages[9].status).toBe('bad');
    const later = run.runTo(SHIFT_S + dayToS(7) + 60);
    expect(later.packs.batches.find((batch) => batch.id === b.id)).toBeUndefined();
    expect(later.packs.warehouse.stock.map((entry) => entry.batchId)).toContain(b.id);
    // A batch that has left quarantine takes no more results.
    run.sim.dispatch({ type: 'setQaResult', batchId: b.id, result: 'fail' });
    expect(run.sim.snapshot().log[0]).toMatchObject({ kind: 'warn', message: `QA result for batch ${b.id} not applied: it is not in quarantine` });
  });
});

describe('stage 10: stock and trucks', () => {
  it('loads a truck every 100 min with 22 pallets, earliest best-before first, and sends it off after 20 min (D3)', () => {
    const run = startPacks(copyConfig(), { speed: 100 });
    const firstStock = run.sim.snapshot().packs.warehouse.stock.map((entry) => ({ ...entry }));
    const loading = run.runTo(6_000 + 60);
    expect(loading.packs.warehouse.trucks).toMatchObject([{ id: 1, door: 0, state: 'loading', pallets: 22 }]);
    expect(loading.stages[10].values.trucksAtDock).toBe(1);
    // The oldest batch in stock (41 pallets) gives the whole load.
    expect(loading.packs.warehouse.stock[0]).toEqual({ ...firstStock[0], pallets: (firstStock[0]?.pallets ?? 0) - 22 });
    expect(loading.packs.warehouse.palletsInStock).toBe(634 - 22);
    const gone = run.runTo(6_000 + 1_200 + 60);
    expect(gone.packs.warehouse.trucks).toEqual([]);
    expect(gone.kpis).toMatchObject({ trucksShipped: 1, orderFillPct: 100 });
    expect(logged(gone, /^Truck 1 left with 22 pallets$/)).toHaveLength(1);
    const two = run.runTo(12_000 + 60);
    expect(two.packs.warehouse.trucks[0]).toMatchObject({ id: 2, state: 'loading' });
  });

  it('keeps a truck waiting at the dock when stock is short, the yard after three doors, and loads them in order once stock is released', () => {
    const config = steadyConfig();
    const run = startPacks(config, { speed: 10_000 });
    // No stock until the first release, 8 h + 7 days after opening: every truck waits.
    const queued = run.runTo(4 * 6_000 + 60);
    const { trucks } = queued.packs.warehouse;
    expect(trucks.map((truck) => [truck.id, truck.door, truck.state])).toEqual([
      [1, 0, 'waiting'],
      [2, 1, 'waiting'],
      [3, 2, 'waiting'],
      [4, -1, 'waiting'],
    ]);
    expect(queued.stages[10].status).toBe('warn');
    expect(queued.kpis.orderFillPct).toBe(0);
    expect(logged(queued, /^Truck 4 waiting in the yard: all 3 doors taken$/)).toHaveLength(1);
    // The first two batches release 120 pallets: enough for five trucks, loaded in arrival order.
    const released = run.runTo(SHIFT_S + dayToS(7) + 60);
    expect(released.packs.warehouse.trucks.filter((truck) => truck.state === 'loading').map((truck) => truck.id)).toEqual([1, 2, 3]);
    expect(released.packs.warehouse.palletsInStock).toBe(120 - 3 * 22);
  });
});

describe('coupling at the aseptic tank', () => {
  it('rises 1,000 L/h with both fillers running, 8,500 L/h with one down, and throttles the UHT plant at 90%', () => {
    const config = steadyConfig((each) => (each.uht.displayNoiseC = 0));
    const run = startPacks(config, { speed: 100, packsRng: scriptedRng(config, { toFailureS: [hToS(1)], repairS: [hToS(5)] }) });
    const both = run.runTo(hToS(1) - 10);
    expectWithin(both.liquid.tanks.asepticTank.levelL, 10_000 + 1_000 * sToH(hToS(1) - 10), 0.5);
    // With A down from 1 h: +8,500 L/h, so 90% (18,000 L) at 1 h + 7,000 ÷ 8,500 h.
    const throttleS = hToS(1) + hToS(7_000 / 8_500);
    const before = run.runTo(throttleS - 30);
    expect(before.liquid.throttled).toBe(false);
    expect(before.stages[6].values.inflowLph - before.stages[6].values.outflowLph).toBe(8_500);
    const after = run.runTo(throttleS + 30);
    expect(after.liquid.throttled).toBe(true);
    expect(after.kpis.uhtFlowLph).toBe(8_000);
    const throttle = logged(after, /UHT plant throttled/)[0];
    expectWithin((throttle?.timeS ?? 0) - run.openS, throttleS, 1);
  });

  it('falls 15,000 L/h while the UHT plant cleans and the fillers keep drawing (H32)', () => {
    const config = steadyConfig((each) => (each.cleaning.aicEveryProductionS = 600));
    const run = startPacks(config, { speed: 100 });
    const start = run.runTo(600 + 10);
    expect(start.liquid.uhtMode).toBe('aic');
    const end = run.runTo(600 + 10 + 600);
    expectWithin(start.liquid.tanks.asepticTank.levelL - end.liquid.tanks.asepticTank.levelL, 2_500, 1);
    expect(end.packs.fillers.map((filler) => filler.state)).toEqual(['running', 'running']);
  });
});
