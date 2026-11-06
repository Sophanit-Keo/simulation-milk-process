// The yogurt cold chain (src/sim/yogurt/coldChain.ts, phase 19, D29) against H130–H133: on its own, fed P8's events by
// hand, and in the live line, a day at ×1,000 and seven at ×10,000 from the opening. Every cup filled is rejected or
// held, taken for a seal test, in the chain or shipped.
import { beforeAll, describe, expect, it } from 'vitest';
import { hToS, type LogKind, type PlantConfig, type Sim, type Snapshot, type YogurtProductId } from '../../../src/contracts';
import { createSim, type SimOptions } from '../../../src/sim';
import { createColdChain, type ColdChain } from '../../../src/sim/yogurt/coldChain';
import { timeToPhS } from '../../../src/sim/yogurt/formulas';
import type { P8Event } from '../../../src/sim/yogurt/p8';
import type { YogurtLine } from '../../../src/sim/yogurt/yogurtLine';
import { expectWithin } from '../../helpers/expectWithin';
import { copyConfig, plantConfig } from '../../helpers/plantConfig';
import { expectWellFormedYogurt } from '../../helpers/yogurtShape';

const chainConfig = plantConfig.yogurt.coldChain;
const PALLET_CUPS = chainConfig.cupsPerTray * chainConfig.traysPerPallet;

/** A cold chain without the opening's history, fed by hand on 10 s steps. */
function bare(config: PlantConfig = plantConfig) {
  const openS = config.clock.startTimeS;
  const chain: ColdChain = createColdChain(config, openS, { history: false });
  const log: { timeS: number; kind: LogKind; message: string }[] = [];
  let timeS = openS;
  return {
    chain,
    log,
    openS,
    get timeS() {
      return timeS;
    },
    /** Steps to `toS` after the opening, feeding `events` with the first step. */
    to(toS: number, events: P8Event[] = []) {
      let first = events;
      while (timeS < openS + toS - 1e-9) {
        timeS = Math.min(openS + toS, timeS + 10);
        chain.step(timeS, first, (atS, kind, message) => log.push({ timeS: atS, kind, message }));
        first = [];
      }
      return chain.view(timeS);
    },
  };
}

const made = (batch: string, product: YogurtProductId, cups: number, atS: number, sealWindow = 0): P8Event => ({ kind: 'made', batch, product, sealWindow, cups, atS });
const test = (sealWindow: number, passed: boolean, atS: number): P8Event => ({ kind: 'test', sealWindow, passed, atS });

describe('H130: trays and pallets, one batch to a pallet', () => {
  it('packs 2,880 cups to a pallet of 120 trays, and closes a batch\'s last tray and pallet part-full', () => {
    const h = bare();
    let view = h.to(10, [made('P8-008-1', 'plainStirred', PALLET_CUPS + 30, h.openS + 10)]);
    expect(view.pallets?.map((pallet) => [pallet.cups, pallet.trays])).toEqual([[PALLET_CUPS, 120]]);
    expect(view.trays).toEqual({ made: 121, openBatch: 'P8-008-1', openCups: 6, openTrays: 1 });
    // The next batch's cups close the last one's tray and pallet: 30 cups on 2 trays.
    view = h.to(20, [made('P8-008-2', 'strawberryStirred', 10, h.openS + 20)]);
    expect(view.pallets?.map((pallet) => [pallet.batch, pallet.cups, pallet.trays])).toEqual([
      ['P8-008-1', PALLET_CUPS, 120],
      ['P8-008-1', 30, 2],
    ]);
    expect(view.trays).toMatchObject({ made: 122, openBatch: 'P8-008-2', openCups: 10, openTrays: 0 });
    h.chain.closeBatch(h.timeS);
    expect(h.chain.view(h.timeS).pallets?.at(-1)).toMatchObject({ batch: 'P8-008-2', cups: 10, trays: 1 });
    expect(h.chain.totals()).toMatchObject({ traysMade: 123, palletsMade: 3, cupsIn: PALLET_CUPS + 40 });
  });

  it('packs the day of H125e into 19,872 trays on 60 + 59 + 48 pallets', () => {
    // Each batch's cups as the live day makes them (yogurtLine.test.ts); ⌈n ÷ 24⌉ trays, ⌈trays ÷ 120⌉ pallets.
    const trays = (cups: number): number => Math.ceil(cups / chainConfig.cupsPerTray);
    const pallets = (cups: number): number => Math.ceil(trays(cups) / chainConfig.traysPerPallet);
    expect(trays(172_800)).toBe(7_200);
    expect(pallets(172_800)).toBe(60);
    expect(PALLET_CUPS * 0.127).toBeCloseTo(365.76, 6);
    const run = liveDay();
    const byBatch = run.batchCups;
    expect([...byBatch.keys()]).toEqual(['P8-008-1', 'P8-008-2', 'P8-008-3']);
    const expectedTrays = [...byBatch.values()].reduce((sum, cups) => sum + trays(cups), 0);
    expect(run.totals.traysMade).toBe(expectedTrays);
    expect(expectedTrays).toBe(19_872);
    expect([...byBatch.values()].map(pallets)).toEqual([60, 59, 48]);
  });
});

describe('H131: the warm room and the chiller', () => {
  it('holds set yogurt in the warm room at 43 °C until pH 4.60, 13,821.9 s after its pallet closes, then chills it in 2.418 h', () => {
    expectWithin(timeToPhS(plantConfig.yogurt.ferment, 4.6, 43), 13_821.9, 0.1);
    const h = bare();
    h.to(10, [made('P8-008-3', 'plainSet', PALLET_CUPS, h.openS + 10)]);
    let view = h.to(hToS(3));
    expect(view.pallets?.[0]).toMatchObject({ place: 'warmRoom', tempC: 43, route: 'set' });
    expect(view.pallets?.[0].ph).toBeGreaterThan(4.6);
    view = h.to(10 + 13_830);
    expect(view.pallets?.[0].place).toBe('chiller');
    expect(view.pallets?.[0].ph).toBeCloseTo(4.6, 2);
    // 43 °C to 4 °C in −2 °C air with τ 1.2 h: 8,704 s, then the cold room.
    view = h.to(10 + 13_830 + 8_690);
    expect(view.pallets?.[0].place).toBe('chiller');
    view = h.to(10 + 13_830 + 8_720);
    expect(view.pallets?.[0]).toMatchObject({ place: 'coldRoom' });
    expect(view.pallets?.[0].tempC).toBeLessThanOrEqual(4);
  });

  it('sends stirred yogurt straight to the chiller at 18 °C, 1.445 h to 4 °C, at the end pH of its tank', () => {
    const h = bare();
    let view = h.to(10, [made('P8-008-1', 'plainStirred', PALLET_CUPS, h.openS + 10)]);
    expect(view.pallets?.[0]).toMatchObject({ place: 'chiller', ph: plantConfig.yogurt.ferment.endPh });
    expectWithin(view.pallets?.[0].tempC ?? 0, 18, 1e-9);
    view = h.to(10 + 5_190);
    expect(view.pallets?.[0].place).toBe('chiller');
    view = h.to(10 + 5_210);
    expect(view.pallets?.[0].place).toBe('coldRoom');
  });

  it('keeps a pallet waiting, first in first out, while the next room is full', () => {
    const config = copyConfig();
    config.yogurt.coldChain.chillerPallets = 2;
    config.yogurt.coldChain.warmRoomPallets = 1;
    const h = bare(config);
    const view = h.to(10, [
      made('P8-008-1', 'plainStirred', PALLET_CUPS * 3, h.openS + 10),
      made('P8-008-3', 'plainSet', PALLET_CUPS * 2, h.openS + 10),
    ]);
    // In the chain's order: the chiller's two stirred, the warm room's set, then the set and the stirred waiting.
    expect(view.pallets?.map((pallet) => [pallet.place, pallet.route])).toEqual([
      ['chiller', 'stirred'],
      ['chiller', 'stirred'],
      ['warmRoom', 'set'],
      ['staging', 'set'],
      ['staging', 'stirred'],
    ]);
    expect(view.chiller).toMatchObject({ pallets: 2, capacity: 2 });
    expect(view.warmRoom).toMatchObject({ pallets: 1, capacity: 1 });
  });
});

describe('the cold room\'s hold and a failed seal test', () => {
  it('releases a pallet 24 h after it comes in, once every seal test covering it has passed', () => {
    const h = bare();
    h.to(10, [made('P8-008-1', 'plainStirred', PALLET_CUPS, h.openS + 10, 4)]);
    let view = h.to(hToS(2));
    const holdUntilS = view.pallets?.[0].holdUntilS ?? 0;
    expect(view.coldRoom.nextReleaseS).toBe(holdUntilS);
    view = h.to(holdUntilS - h.openS + 10);
    // Its window, 4, is not yet tested: held.
    expect(view.pallets?.[0].released).toBe(false);
    view = h.to(holdUntilS - h.openS + 20, [test(4, true, h.timeS)]);
    expect(view.pallets?.[0].released).toBe(true);
    expect(view.coldRoom.nextReleaseS).toBeNull();
  });

  it('pulls a failed test\'s cups wherever they are, emptying a pallet that holds only them', () => {
    const h = bare();
    h.to(10, [
      made('P8-008-1', 'plainStirred', PALLET_CUPS - 100, h.openS + 10, 1),
      made('P8-008-1', 'plainStirred', 200, h.openS + 10, 2),
      made('P8-008-1', 'plainStirred', PALLET_CUPS, h.openS + 10, 3),
    ]);
    // Window 2's 200 cups: 100 on the first pallet, 100 on the second.
    const view = h.to(20, [test(2, false, h.timeS)]);
    expect(view.pallets?.map((pallet) => pallet.cups)).toEqual([PALLET_CUPS - 100, PALLET_CUPS - 100]);
    expect(view.cupsHeld).toBe(200);
    expect(h.log.find((entry) => /pulled/.test(entry.message))?.message).toBe('Cold chain: 200 cups pulled for the failed seal test');
    // Window 3's 2,880 cups: 2,780 on the second pallet, which it empties, and 100 still at the palletizer.
    h.to(30, [test(3, false, h.timeS)]);
    expect(h.chain.totals()).toMatchObject({ cupsHeld: 200 + PALLET_CUPS, palletsHeld: 1 });
    // Window 1 failing too empties the first.
    h.to(40, [test(1, false, h.timeS)]);
    expect(h.chain.totals()).toMatchObject({ palletsHeld: 2 });
    expect(h.chain.cupsInChain()).toBe(0);
  });
});

describe('H133: reefers', () => {
  it('calls a reefer for a load of 26 released pallets: it backs up in 30 min, loads them oldest first in 20 min, and leaves', () => {
    const h = bare();
    h.to(10, [made('P8-008-1', 'plainStirred', PALLET_CUPS * 27, h.openS + 10, -1)]);
    // Chilled in 1.445 h, released 24 h on; the call comes within a minute.
    const releaseS = hToS(24) + 5_210;
    let view = h.to(releaseS + 60);
    expect(view.reefers).toEqual([{ id: 1, door: 0, state: 'arriving', pallets: 0, load: 26, untilS: expect.any(Number) }]);
    const dockS = view.reefers?.[0].untilS ?? 0;
    expectWithin(dockS - h.timeS, 1_800, 60);
    view = h.to(dockS - h.openS + 600);
    expect(view.reefers?.[0]).toMatchObject({ state: 'loading', pallets: 13, load: 26 });
    view = h.to(dockS - h.openS + 1_210);
    expect(view.reefers).toEqual([]);
    expect(view).toMatchObject({ palletsShipped: 26, reefersShipped: 1, cupsShipped: PALLET_CUPS * 26 });
    expect(view.pallets?.map((pallet) => pallet.place)).toEqual(['coldRoom']);
    expect(h.log.at(-1)?.message).toBe(`Reefer 1 left door 1 with 26 pallets, ${(PALLET_CUPS * 26).toLocaleString('en-US')} cups`);
  });

  it('sends a part load for the oldest released pallet once it has held 42 h', () => {
    const h = bare();
    h.to(10, [made('P8-008-1', 'plainStirred', PALLET_CUPS * 3, h.openS + 10, -1)]);
    let view = h.to(hToS(41) + 5_210);
    expect(view.reefers).toEqual([]);
    view = h.to(hToS(42) + 5_280);
    expect(view.reefers?.[0]).toMatchObject({ state: 'arriving', load: 3 });
    h.to(hToS(43.5) + 5_280);
    expect(h.chain.totals()).toMatchObject({ palletsShipped: 3, reefersShipped: 1, overHold: 0 });
    expect(h.chain.totals().longestHoldS).toBeLessThan(chainConfig.maxHoldS);
  });
});

/** The live line from the opening, stepping exactly to each mark at `speed`. */
function runner(speed: 1_000 | 10_000, options: SimOptions = {}) {
  let line: YogurtLine | undefined;
  const sim: Sim = createSim(plantConfig, { ...options, onYogurtLine: (made_) => (line = made_) });
  sim.dispatch({ type: 'setSpeed', speed });
  const openS = sim.snapshot().timeS;
  return {
    openS,
    sim,
    line: () => line as YogurtLine,
    runTo(toS: number, look?: (snap: Snapshot) => void): Snapshot {
      while (sim.snapshot().timeS - openS < toS - 1e-6) {
        sim.step(Math.min(0.1, (toS - (sim.snapshot().timeS - openS)) / speed));
        look?.(sim.snapshot());
      }
      return sim.snapshot();
    },
  };
}

let day: { totals: ReturnType<ColdChain['totals']>; batchCups: Map<string, number> } | undefined;
/** A day of the live line at ×1,000 (1 s steps), with the cups each batch made. */
function liveDay() {
  if (day) return day;
  const run = runner(1_000);
  const batchCups = new Map<string, number>();
  let lastBatch = '';
  let lastCups = 0;
  run.runTo(hToS(24), (snap) => {
    const batch = snap.yogurt.p8.currentBatch;
    if (!batch) return;
    if (batch.code !== lastBatch) lastCups = 0;
    lastBatch = batch.code;
    batchCups.set(batch.code, batch.cups);
    lastCups = batch.cups;
  });
  expect(lastCups).toBeGreaterThan(0);
  // The night's set batch closes at the next opening's changeover, past this day: close it to count its trays.
  run.line().coldChain.closeBatch(run.sim.snapshot().timeS);
  day = { totals: run.line().coldChain.totals(), batchCups };
  return day;
}

describe('the live line from the opening (D29)', () => {
  it('opens as the last two days left it: the cold room near a day\'s pallets, the night\'s set yogurt in the warm room and the chiller, releases due', () => {
    const run = runner(1_000);
    const snap = run.sim.snapshot();
    const { coldChain } = snap.yogurt;
    expect(coldChain.coldRoom.positionsUsed).toBe(180);
    expect(coldChain.warmRoom.pallets).toBe(30);
    expect(coldChain.chiller.pallets).toBe(18);
    expect(coldChain.pallets?.filter((pallet) => pallet.place === 'warmRoom').every((pallet) => pallet.route === 'set')).toBe(true);
    expect((coldChain.coldRoom.nextReleaseS ?? Infinity) - run.openS).toBeLessThan(hToS(1));
    expect(coldChain).toMatchObject({ palletsShipped: 0, reefersShipped: 0, cupsShipped: 0, cupsHeld: 0 });
    expectWellFormedYogurt(snap, plantConfig, 'opening');
  });
});

describe('seven days from the opening at ×10,000 (H132, H133)', () => {
  let totals: ReturnType<ColdChain['totals']>;
  let line: YogurtLine;
  let end: Snapshot;
  let p8: ReturnType<YogurtLine['p8']['totals']>;
  beforeAll(() => {
    const run = runner(10_000);
    let frame = 0;
    end = run.runTo(hToS(24 * 7), (snap) => {
      // Every 100th frame, the shape of the whole yogurt part.
      if (frame++ % 100 === 0) expectWellFormedYogurt(snap, plantConfig, `frame ${frame}`);
    });
    line = run.line();
    totals = line.coldChain.totals();
    p8 = line.p8.totals();
  }, 240_000);

  it('conserves every cup: filled = rejected or held + taken for a seal test + in the chain + shipped, less what the chain opened with', () => {
    const { underFill, overFill, metal, vision, sealHold } = p8.rejects;
    expect(p8.cupsMade + p8.sealTestCups + underFill + overFill + metal + vision + sealHold).toBe(p8.cupsFilled);
    expect(totals.cupsIn - totals.cupsHeld).toBe(p8.cupsMade);
    expect(totals.cupsHeld).toBe(sealHold);
    expect(totals.openingCups + totals.cupsIn - totals.cupsHeld).toBe(line.coldChain.cupsInChain() + totals.cupsShipped);
  });

  it('ships about 6.4 reefers a day, both routes, every pallet inside the 48 h maximum', () => {
    expectWithin(totals.reefersShipped, 45, 2);
    expect(totals.shippedByRoute.set).toBeGreaterThan(0);
    expect(totals.shippedByRoute.stirred).toBeGreaterThan(totals.shippedByRoute.set);
    expect(totals.overHold).toBe(0);
    expect(totals.longestHoldS).toBeLessThan(chainConfig.reeferLatestS);
    expect(end.yogurt.coldChain.reefersShipped).toBe(totals.reefersShipped);
  });

  it('stays inside every room\'s positions: the cold room peaks near 200 of its 360, the chiller near 30 of 32, nothing waits', () => {
    expectWithin(totals.peak.coldRoom, 200, 20);
    expect(totals.peak.coldRoom).toBeLessThanOrEqual(chainConfig.coldRoomPallets);
    expect(totals.peak.chiller).toBeLessThanOrEqual(chainConfig.chillerPallets);
    expect(totals.peak.chiller).toBeGreaterThanOrEqual(28);
    expect(totals.peak.warmRoom).toBeLessThanOrEqual(chainConfig.warmRoomPallets);
    expect(totals.peak.staging).toBeLessThanOrEqual(1);
  });
});

describe('a failed seal test in the live line (D28, D29)', () => {
  it('pulls from the trays and pallets exactly the cups P8 holds, and the log says so', () => {
    // The sealing heads fall to 170 °C 3 h in: the test at 4 h fails (96.9%, H128) and holds two hours of cups.
    const run = runner(1_000, {
      p8Conditions: { seal: (timeS) => ({ tempC: timeS - plantConfig.clock.startTimeS > hToS(3) ? 170 : 200, timeS: 1, bar: 5 }) },
      yogurtRng: undefined,
    });
    const snap = run.runTo(hToS(4.5));
    const p8 = run.line().p8.totals();
    const chain = run.line().coldChain.totals();
    expect(p8.sealTestsFailed).toBeGreaterThanOrEqual(1);
    expect(p8.rejects.sealHold).toBeGreaterThan(40_000);
    expect(chain.cupsHeld).toBe(p8.rejects.sealHold);
    expect(chain.cupsIn - chain.cupsHeld).toBe(p8.cupsMade);
    expect(snap.yogurt.coldChain.cupsHeld).toBe(p8.rejects.sealHold);
    expect(snap.log.some((entry) => /^Cold chain: [\d,]+ cups pulled for the failed seal test/.test(entry.message))).toBe(true);
    expectWellFormedYogurt(snap, plantConfig, 'after the hold');
  });
});
