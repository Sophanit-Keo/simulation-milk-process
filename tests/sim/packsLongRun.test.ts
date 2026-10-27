// The phase 4 long runs (qa lane): a headless 60-day run of the shipped plant at ×10,000, checked every sim
// hour for conservation (H61), the liquid-to-packs balance, bounded queues and a quarantine within the R9
// range, and at the end against the long-run rows (H52, H58, H59, H41–H43); then 1 s and 10 s steps agree,
// since the packs model draws from its own stream.
import { beforeAll, describe, expect, it } from 'vitest';
import { dayToS, hToS, type LogEntry, type Snapshot } from '../../src/contracts';
import type { PacksTotals } from '../../src/sim/packsLine';
import { expectWithin } from '../helpers/expectWithin';
import { startPacks, type PacksRun } from '../helpers/packsRun';
import { expectPacksMatchKpis, expectWellFormedPacks } from '../helpers/packsShape';
import { copyConfig, plantConfig } from '../helpers/plantConfig';

const DAYS = 60;

/** Packs made = rejected + sampled + on the conveyors + in open trays + on open and closed pallets (H61). */
function packsBalance(totals: PacksTotals): number {
  return (
    totals.packsMade -
    (totals.packsRejected + totals.packsSampled + totals.packsQueued + totals.packsInTrays + totals.packsOnOpenPallets + totals.packsOnClosedPallets)
  );
}

/** Pallets at opening + made = in quarantine + in stock + loading + shipped + destroyed. */
function palletBalance(totals: PacksTotals): number {
  return (
    totals.palletsAtOpen +
    totals.palletsMade -
    (totals.palletsInQuarantine + totals.palletsInStock + totals.palletsLoading + totals.palletsShipped + totals.palletsDestroyed)
  );
}

describe(`the shipped plant, ${DAYS} days at ×10,000`, () => {
  let run: PacksRun;
  const problems: string[] = [];
  const quarantine: number[] = [];
  let mostQueued = 0;
  let worstLitresL = 0;
  const fail = (message: string) => problems.length < 20 && problems.push(message);
  let end: Snapshot;
  let lastLog: readonly LogEntry[] = [];

  beforeAll(() => {
    run = startPacks(copyConfig(), { speed: 10_000 });
    let nextCheckS = 0;
    end = run.runTo(dayToS(DAYS), (snap) => {
      const tS = run.t();
      // The log stays newest first through every frame.
      for (let i = 1; i < snap.log.length; i++) if ((snap.log[i]?.timeS ?? 0) > (snap.log[i - 1]?.timeS ?? 0)) fail(`log out of order at ${tS}`);
      lastLog = snap.log;
      if (tS < nextCheckS) return;
      nextCheckS += hToS(1);
      const { totals } = run.packs;
      if (packsBalance(totals) !== 0) fail(`at ${tS} s the packs are off by ${packsBalance(totals)}`);
      if (palletBalance(totals) !== 0) fail(`at ${tS} s the pallets are off by ${palletBalance(totals)}`);
      // The fillers make one pack per litre drawn; only the pack each is still forming is not counted yet.
      const litresL = run.liquid.totals.toFillersL - totals.packsMade * plantConfig.product.packVolumeL;
      worstLitresL = Math.max(worstLitresL, Math.abs(litresL));
      mostQueued = Math.max(mostQueued, totals.packsQueued);
      if (tS >= hToS(8)) quarantine.push(totals.palletsInQuarantine);
      if (tS % dayToS(5) < hToS(1)) {
        try {
          expectWellFormedPacks(snap, plantConfig, `day ${tS / dayToS(1)}`);
          expectPacksMatchKpis(snap, `day ${tS / dayToS(1)}`);
        } catch (error) {
          fail(String(error));
        }
      }
    });
  }, 120_000);

  it('keeps every pack and pallet: nothing appears or vanishes (H61), checked every sim hour', () => {
    expect(problems).toEqual([]);
    expect(lastLog.length).toBeGreaterThan(0);
  });

  it('makes one pack per litre the fillers draw from the aseptic tank, within the packs still forming', () => {
    expect(worstLitresL).toBeLessThan(plantConfig.fillers.count);
  });

  it('keeps the queues short: at most the 2 min batch change at 8,000 packs/h a line', () => {
    expect(mostQueued).toBeLessThanOrEqual(2 * 268);
  });

  it('keeps the quarantine within the R9 range: about 2,500 pallets at 7 days (H49), never above 2,640 plus a blocked batch', () => {
    expect(Math.min(...quarantine)).toBeGreaterThan(2_300);
    expect(Math.max(...quarantine)).toBeLessThanOrEqual(2_640 + 60);
    const mean = quarantine.reduce((sum, pallets) => sum + pallets, 0) / quarantine.length;
    expectWithin(mean, 2_500, 100);
  });

  it('makes about 350 pallets a day (H58: 347 pallet-loads after breakdowns, ±3%)', () => {
    expectWithin(run.packs.totals.palletsMade / DAYS, 350, 350 * 0.03);
  });

  it('throttles about 9% of its production time, now that the fillers break down (H59, ±3 points)', () => {
    const { throttledProductionS, productionS } = run.liquid.totals;
    expectWithin((100 * throttledProductionS) / productionS, 9, 3);
  });

  it('runs its fillers at the long-run OEE: 0.97166 × 0.9375 (H52) × 0.998 for the rejects', () => {
    expectWithin(end.kpis.oeePct / 100, 0.91093 * 0.998, 0.004);
    for (const filler of end.packs.fillers) expectWithin(filler.availabilityPct / 100, 0.97166, 0.005);
  });

  it('ships 14.4 trucks a day (H41) of 22 pallets (H42), every one loaded on arrival, while stock grows by about 30 a day (H43)', () => {
    expectWithin(end.kpis.trucksShipped, 14.4 * DAYS, 1);
    expect(end.packs.warehouse.palletsShipped).toBe(22 * end.kpis.trucksShipped);
    expect(end.kpis.orderFillPct).toBe(100);
    const growthPerDay = (end.packs.warehouse.palletsInStock - 634) / DAYS;
    expect(growthPerDay).toBeGreaterThan(20);
    expect(growthPerDay).toBeLessThan(45);
  });

  it('releases about 6 batches a day once the opening week is through (H30), and blocks one now and then (R10)', () => {
    expectWithin(end.kpis.batchesReleased + end.kpis.batchesBlocked, 6 * DAYS, 2);
    // About one blocked batch every 50 days (H48); allow for a run of bad luck.
    expect(end.kpis.batchesBlocked).toBeLessThanOrEqual(6);
  });
});

describe('the step size', () => {
  it('3 days at 1 s steps (×1,000) and at 10 s steps (×10,000) give the same breakdowns, batches and trucks', () => {
    const fine = startPacks(copyConfig(), { speed: 1_000 });
    const coarse = startPacks(copyConfig(), { speed: 10_000 });
    const a = fine.runTo(dayToS(3));
    const b = coarse.runTo(dayToS(3));
    expect(b.packs.fillers.map((filler) => filler.breakdowns)).toEqual(a.packs.fillers.map((filler) => filler.breakdowns));
    expect(b.kpis.batchesReleased).toBe(a.kpis.batchesReleased);
    expect(b.kpis.trucksShipped).toBe(a.kpis.trucksShipped);
    expectWithin(b.kpis.palletsMade, a.kpis.palletsMade, a.kpis.palletsMade * 0.01);
    expectWithin(coarse.packs.totals.packsMade, fine.packs.totals.packsMade, fine.packs.totals.packsMade * 0.001);
  }, 60_000);
});
