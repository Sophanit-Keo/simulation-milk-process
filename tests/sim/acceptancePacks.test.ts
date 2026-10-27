// The phase 4 logistics acceptance runs of plan/hand-calculations.md (H97–H103), run through createSim as the
// rows describe: the shipped config, or a full-rate plant (no breakdowns, no opening history or stock) to
// check the counts that follow from the rates alone; seed 81006; t = snapshot.timeS − the opening time.
// The long-run rows at the defaults (H52, H58, H59, H41–H43, the R9 range) run in packsLongRun.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { dayToS, gs1CheckDigit, ssccFor, type PlantConfig, type Snapshot } from '../../src/contracts';
import { expectWithin } from '../helpers/expectWithin';
import { emptyPlantConfig, startPacks, type PacksRun } from '../helpers/packsRun';
import { copyConfig, NO_BREAKDOWNS_MTBF_S } from '../helpers/plantConfig';

/** The plant at full rate: both fillers run all the time, from an empty quarantine and warehouse on day 8. */
function fullRateConfig(): PlantConfig {
  const config = emptyPlantConfig();
  config.fillers.mtbfMeanS = NO_BREAKDOWNS_MTBF_S;
  return config;
}

describe('the full-rate plant, 9 days at ×10,000 (H97–H100)', () => {
  const DAYS = 9;
  let run: PacksRun;
  let end: Snapshot;
  const quarantine: number[] = [];
  const perDay: number[] = [];

  beforeAll(() => {
    run = startPacks(fullRateConfig(), { speed: 10_000 });
    let madeBefore = 0;
    // Day by day, each run landing on the day's end (06:00, a shift change).
    for (let day = 1; day <= DAYS; day++) {
      end = run.runTo(dayToS(day), () => {
        if (run.t() >= dayToS(7)) quarantine.push(run.packs.totals.palletsInQuarantine);
      });
      perDay.push(run.packs.totals.palletsMade - madeBefore);
      madeBefore = run.packs.totals.palletsMade;
    }
  }, 60_000);

  it('makes at most 360 pallets a day, 6 batches of 60 (H97)', () => {
    expect(perDay).toHaveLength(DAYS);
    for (const [day, pallets] of perDay.entries()) expect(pallets, `day ${day + 1}`).toBe(360);
  });

  it('closes every batch with 60 pallets, the last part-full with 392 packs, and 16 samples (H98)', () => {
    const closed = end.packs.batches.filter((batch) => batch.status !== 'filling');
    expect(closed.length).toBeGreaterThanOrEqual(12);
    for (const batch of closed) {
      expect(batch.pallets, `batch ${batch.id}`).toBe(60);
      expect(batch.packs, `batch ${batch.id}`).toBe(59_864);
      expect(batch.lastPalletPacks, `batch ${batch.id}`).toBe(392);
      expect(batch.samples, `batch ${batch.id}`).toBe(16);
    }
  });

  it('holds 2,520 pallets in quarantine just after a release, up to 2,640 just before one (H99)', () => {
    expect(Math.min(...quarantine)).toBe(2_520);
    expect(Math.max(...quarantine)).toBeLessThanOrEqual(2_640);
    expect(Math.max(...quarantine)).toBeGreaterThan(2_620);
  });

  it('runs both fillers at 0.9375 × 0.998 OEE: always available, 7,500 of 8,000 packs/h, 0.2% rejected (H100)', () => {
    expectWithin(end.kpis.oeePct / 100, 0.935625, 0.00001);
    for (const filler of end.packs.fillers) expectWithin(filler.oeePct / 100, 0.935625, 0.00001);
  });
});

describe('trucks and labels (H101–H103)', () => {
  it('sends a truck every 100 min, 1.67 h, for 22 pallets: 14.4 trucks and 316.8 pallets a day (H101)', () => {
    const run = startPacks(copyConfig(), { speed: 10_000 });
    // Each truck stands 20 min at the dock, longer than a 1,000 s frame, so every one shows in a snapshot.
    const arrivedS = new Map<number, number>();
    const end = run.runTo(dayToS(1), (snap) => {
      for (const truck of snap.packs.warehouse.trucks) arrivedS.set(truck.id, truck.arrivedS);
    });
    const times = [...arrivedS.values()].sort((a, b) => a - b);
    expect(end.packs.warehouse.trucksArrived).toBe(14);
    expect(times).toHaveLength(14);
    expectWithin((times[0] ?? 0) - run.openS, 6_000, 0.001);
    for (let i = 1; i < times.length; i++) expectWithin((times[i] ?? 0) - (times[i - 1] ?? 0), 6_000, 0.001);
    expect(end.packs.warehouse.palletsShipped).toBe(22 * end.packs.warehouse.trucksShipped);
  });

  it('labels each pallet with an 18-digit SSCC whose GS1 check digit is 4 for batch 54, pallet 1 (H102)', () => {
    expect(gs1CheckDigit('30614141000054001')).toBe(4);
    expect(ssccFor(54, 1)).toBe('306141410000540014');
  });

  it('opens with 2 days of cover: 634 pallets ÷ 316.8 a day (H44, H103)', () => {
    const snap = startPacks(copyConfig()).sim.snapshot();
    expect(snap.kpis.palletsInStock).toBe(634);
    expectWithin(snap.kpis.daysOfCover, 2.0, 0.01);
  });
});
