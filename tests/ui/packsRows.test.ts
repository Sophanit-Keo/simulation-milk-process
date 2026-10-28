// The info panel's words for stages 7–10 (src/ui/packsRows.ts, panelRows.ts, batchList.ts, stockList.ts):
// filler and packer states, pallets and their SSCCs, batches due, the dock and the stock.
import { describe, expect, it } from 'vitest';
import { BATCH_STATUSES, FILLER_STATES, PACKER_STATES, type FillerSnapshot, type PackLaneSnapshot, type TruckSnapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { BATCH_LAMP, BATCH_STATUS_TEXT, batchDueText, palletLines } from '../../src/ui/batchList';
import { fillerOeeText, formatDay, formatLongDuration } from '../../src/ui/format';
import { PANEL_STATE_ROWS } from '../../src/ui/panelRows';
import { dockText, fillerText, lastPalletText, lastSsccText, nextPickText, packerText, palletText } from '../../src/ui/packsRows';
import { stockText, truckText } from '../../src/ui/stockList';
import { plantConfig } from '../helpers/plantConfig';

const filler = (change: Partial<FillerSnapshot>): FillerSnapshot => ({
  name: 'A',
  state: 'running',
  stateRemainingS: 0,
  packsPerH: 7_500,
  batchId: 54,
  packsMade: 0,
  packsRejected: 0,
  breakdowns: 0,
  availabilityPct: 100,
  performancePct: 93.75,
  qualityPct: 100,
  oeePct: 93.75,
  ...change,
});

const lane = (change: Partial<PackLaneSnapshot>): PackLaneSnapshot => ({
  name: 'A',
  packerState: 'running',
  changeoverRemainingS: 0,
  queuePacks: 0,
  trayPacks: 0,
  palletTrays: 37,
  batchId: 54,
  ...change,
});

const truck = (change: Partial<TruckSnapshot>): TruckSnapshot => ({ id: 7, door: 0, state: 'loading', arrivedS: 0, remainingS: 720, pallets: 22, ...change });

describe('formatLongDuration and formatDay', () => {
  it.each([
    [45, '45 s'],
    [hours(5) + 600, '5 h 10 min'],
    [hours(23) + 3_599, '1 d 00 h'],
    [hours(24 * 6 + 23), '6 d 23 h'],
    [hours(24 * 7), '7 d 00 h'],
    [-1, '—'],
    [Number.NaN, '—'],
  ])('%s s reads "%s"', (durationS, text) => {
    expect(formatLongDuration(durationS)).toBe(text);
  });

  it('dates a sim time by its day, day 1 at 0 s: the plant opens on day 8, a pack best before day 190', () => {
    expect(formatDay(0)).toBe('day 1');
    expect(formatDay(plantConfig.clock.startTimeS)).toBe('day 8');
    expect(formatDay(plantConfig.clock.startTimeS + 182 * 86_400)).toBe('day 190');
    expect(formatDay(Number.NaN)).toBe('—');
  });
});

function hours(h: number): number {
  return h * 3_600;
}

describe('fillerText', () => {
  it.each([
    [{ state: 'running' }, 'Running · batch 54', 'ok'],
    [{ state: 'starved' }, 'Waiting for product · tank low', 'idle'],
    [{ state: 'stopped' }, 'Stopped · rate set to 0', 'warn'],
    [{ state: 'repair', stateRemainingS: 480 }, 'Broken down · repair · 8 min 00 s left', 'bad'],
    [{ state: 'cleaning', stateRemainingS: 90 }, 'Re-sterilizing · 1 min 30 s left', 'warn'],
  ] as const)('%o reads "%s", %s', (change, text, status) => {
    expect(fillerText(filler(change))).toEqual({ text, status });
  });

  it('has words for every state of the contract, each different, and a dash for none', () => {
    const texts = FILLER_STATES.map((state) => fillerText(filler({ state })).text);
    expect(new Set(texts).size).toBe(FILLER_STATES.length);
    expect(fillerText(undefined)).toEqual({ text: '—', status: 'idle' });
    expect(fillerText(filler({ state: 'jammed' as never })).text).toBe('—');
  });
});

describe('packerText and palletText', () => {
  it.each([
    [{ packerState: 'running' }, 'Running', 'ok'],
    [{ packerState: 'changeover', changeoverRemainingS: 75 }, 'Batch change · 1 min 15 s left', 'warn'],
    [{ packerState: 'catchUp', queuePacks: 180 }, 'Catching up · 180 packs waiting', 'ok'],
    [{ packerState: 'idle' }, 'Idle · no packs coming', 'idle'],
  ] as const)('%o reads "%s", %s', (change, text, status) => {
    expect(packerText(lane(change))).toEqual({ text, status });
  });

  it('has words for every packer state', () => {
    expect(new Set(PACKER_STATES.map((packerState) => packerText(lane({ packerState })).text)).size).toBe(PACKER_STATES.length);
  });

  it('counts the trays on the pallet being built, and its batch', () => {
    expect(palletText(lane({}), 84)).toEqual({ text: '37 of 84 trays · batch 54', status: 'ok' });
    expect(palletText(lane({ palletTrays: 0 }), 84)).toEqual({ text: '0 of 84 trays · batch 54', status: 'idle' });
  });
});

describe('pallet labels', () => {
  it("lists a batch's pallets with consecutive SSCCs, every one full but the part-full last (D1)", () => {
    const lines = palletLines({ id: 54, pallets: 60, lastPalletPacks: 392 }, 1_008);
    expect(lines).toHaveLength(60);
    expect(lines[0]).toEqual({ palletNo: 1, sscc: '(00) 3 0614141 000054001 4', packs: 1_008 });
    expect(lines.at(-1)).toMatchObject({ palletNo: 60, packs: 392 });
    expect(new Set(lines.map((line) => line.sscc)).size).toBe(60);
  });

  it('names the newest pallet by its batch and number, and gives its SSCC', () => {
    const packaging = { lanes: [], traysMade: 0, palletsMade: 1, packsSampled: 0, lastPallet: { batchId: 54, palletNo: 1, atS: 0 } };
    expect(lastPalletText({ packaging })).toEqual({ text: 'Batch 54 · pallet 1', status: 'ok' });
    expect(lastSsccText({ packaging })).toEqual({ text: '(00) 3 0614141 000054001 4', status: 'ok' });
    expect(lastPalletText({ packaging: { ...packaging, palletsMade: 0, lastPallet: null } }).text).toBe('None yet');
    expect(lastSsccText({ packaging: { ...packaging, palletsMade: 0, lastPallet: null } }).text).toBe('—');
  });
});

describe('batches', () => {
  it('says what is due next: the close while filling, the release on hold, the destruction once blocked', () => {
    expect(batchDueText({ status: 'filling', endS: 50_400, releaseAtS: 655_200 }, 30_000)).toBe('closes in 5 h 40 min');
    expect(batchDueText({ status: 'hold', endS: 50_400, releaseAtS: 655_200 }, 50_400)).toBe('releases in 7 d 00 h');
    expect(batchDueText({ status: 'blocked', endS: 50_400, releaseAtS: 100_000 }, 90_000)).toBe('destroyed in 2 h 46 min');
    expect(batchDueText({ status: 'blocked', endS: 50_400, releaseAtS: 655_200 }, 700_000)).toBe('blocked');
  });

  it('lights a batch green while it fills, amber on hold and red once blocked (plan 08)', () => {
    expect(BATCH_LAMP).toEqual({ filling: 'ok', hold: 'warn', released: 'ok', blocked: 'bad' });
    expect(Object.keys(BATCH_STATUS_TEXT).sort()).toEqual([...BATCH_STATUSES].sort());
  });
});

describe('the warehouse', () => {
  it('names the next pick, first-expired-first-out, or says there is no stock', () => {
    expect(nextPickText({ stock: [{ batchId: 3, pallets: 41, bestBeforeS: 0 }] })).toEqual({ text: 'Batch 3 · 41 pallets', status: 'ok' });
    expect(nextPickText({ stock: [] })).toEqual({ text: 'No stock released', status: 'warn' });
    expect(stockText({ batchId: 3, pallets: 41, bestBeforeS: 182 * 86_400 })).toBe('Batch 3 · 41 pallets · best before day 183');
  });

  it('reads the dock: a loading truck in green, a waiting one in amber, the yard, and how many more', () => {
    expect(dockText({ trucks: [] })).toEqual({ text: 'No truck at the dock', status: 'idle' });
    expect(dockText({ trucks: [truck({})] })).toEqual({ text: 'Truck 7 loading at door 1 · 12 min left', status: 'ok' });
    expect(dockText({ trucks: [truck({ state: 'waiting', remainingS: 0, pallets: 0 }), truck({ id: 8, door: 1, state: 'waiting' })] })).toEqual({
      text: 'Truck 7 waiting at door 1 for stock · 1 more',
      status: 'warn',
    });
    expect(truckText(truck({ id: 9, door: -1, state: 'waiting' }))).toBe('Truck 9 · yard · waiting for stock');
    expect(truckText(truck({ door: 2 }))).toBe('Truck 7 · door 3 · loading, 12 min left');
  });
});

describe("the OEE card's filler line", () => {
  it('gives each filler its OEE, short enough for the card', () => {
    expect(fillerOeeText([{ name: 'A', oeePct: 91.2 }, { name: 'B', oeePct: 89.6 }])).toBe('A 91 · B 90');
    expect(fillerOeeText([])).toBe('—');
    expect(fillerOeeText(undefined)).toBe('—');
  });
});

describe('PANEL_STATE_ROWS', () => {
  it('reads the fillers in stage 7, the packers and pallets in stage 8, the pick and dock in stage 10, and the liquid line as before', () => {
    expect(PANEL_STATE_ROWS[4]?.map((row) => row.key)).toEqual(['uhtMode', 'cleaning', 'throttle']);
    expect(PANEL_STATE_ROWS[6]?.map((row) => row.key)).toEqual(['throttle', 'fillers', 'sterileAir']);
    expect(PANEL_STATE_ROWS[7]?.map((row) => row.key)).toEqual(['fillerA', 'fillerB']);
    expect(PANEL_STATE_ROWS[8]?.map((row) => row.key)).toEqual(['packerA', 'packerB', 'palletA', 'palletB', 'lastPallet', 'lastSscc']);
    expect(PANEL_STATE_ROWS[10]?.map((row) => row.key)).toEqual(['nextPick', 'dock']);
    for (const stage of [1, 2, 3, 5, 9] as const) expect(PANEL_STATE_ROWS[stage], `stage ${stage}`).toBeUndefined();
  });

  it('reads the live plant as it opens', () => {
    const snap = createSim(plantConfig).snapshot();
    const read = (stage: 7 | 8 | 10) => PANEL_STATE_ROWS[stage]?.map((row) => row.read(snap).text);
    const [a, b] = snap.packs.fillers;
    expect(read(7)).toEqual([`Running · batch ${a?.batchId}`, `Running · batch ${b?.batchId}`]);
    expect(read(8)).toEqual(['Running', 'Running', `0 of 84 trays · batch ${a?.batchId}`, `0 of 84 trays · batch ${b?.batchId}`, 'None yet', '—']);
    expect(read(10)?.[1]).toBe('No truck at the dock');
  });
});
