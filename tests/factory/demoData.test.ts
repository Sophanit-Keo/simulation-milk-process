// The demo's made-up day at the factory (src/factory/demoData.ts, D21): rows like Let Report's for the real
// layout, the 20-minute script of the phase 11 card just before and at each minute mark, the same rows for the
// same times, the loop, and the board's view of the rows (buildFactory reads them as it reads Let Report's).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoFactory } from '../../src/factory/demoData';
import { buildFactory } from '../../src/factory/model';
import { DEMO_CYCLE_MS, type FactoryData, type FactoryView, type LineRow, type LineView, type UhtView } from '../../src/factory/types';

const START_MS = Date.parse('2026-10-30T09:00:00Z');
const MIN_MS = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();
/** The time `min` minutes (and `extraMs` more) into the demo's first cycle. */
const at = (min: number, extraMs = 0): number => START_MS + min * MIN_MS + extraMs;
const demo = (nowMs: number): FactoryData => demoFactory(START_MS, nowMs);

const MILK = 'UHT milk 100 ml';
const CHOCOLATE_MILK = 'UHT chocolate milk 100 ml';
const NAMES = ['UHT-line 1', 'UHT- line 2', 'SCM', 'UHT-line 3', 'UHT line 4', 'UHT-line 6', 'UHT-line 7', 'Yogurt'];
/** The script's minute marks (the phase card's table). */
const MARKS = [2, 4, 6, 8, 10, 12, 13, 16, 17];

function rowOf(data: FactoryData, name: string): LineRow {
  const row = data.lines.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`no line ${name}`);
  return row;
}

/** What the script says of a line: everything but its output, which counts up each minute. */
const story = ({ status, status_since, updated_by_name, note, product, lot, lot_started_at, cip_started_at, cip_until, cip_reason }: LineRow) => ({
  status,
  status_since,
  updated_by_name,
  note,
  product,
  lot,
  lot_started_at,
  cip_started_at,
  cip_until,
  cip_reason,
});

/** A line running since 2 hours before the cycle, as the shift lead set it, on a lot started `lotStartMin` into it. */
const held = (lot: string, lotStartMin: number, product = MILK) => ({
  status: 'running',
  status_since: iso(at(-120)),
  updated_by_name: 'Shift lead',
  note: '',
  product,
  lot,
  lot_started_at: iso(at(lotStartMin)),
  cip_started_at: null,
  cip_until: null,
  cip_reason: '',
});

/** The lines whose story differs between two reads. */
const changed = (before: FactoryData, after: FactoryData): string[] =>
  NAMES.filter((name) => JSON.stringify(story(rowOf(before, name))) !== JSON.stringify(story(rowOf(after, name))));

describe('demoFactory: the factory at 0:00', () => {
  it("lists the real factory in Let Report's order: names, types, UHTs, fillers, speeds and 100 ml packs", () => {
    expect(demo(at(0)).lines.map((row) => [row.sort, row.name, row.type, row.uht, row.filler, row.filler_packs_per_h, row.pack_ml])).toEqual([
      [1, 'UHT-line 1', 'UHT', 'UHT 1', 'TFA', 3_600, 100],
      [2, 'UHT- line 2', 'UHT', 'UHT 2', 'TBA/19', 7_500, 100],
      [3, 'SCM', 'SCM', '', '', null, null],
      [4, 'UHT-line 3', 'UHT', 'UHT 2', 'A3/Speed', 24_000, 100],
      [5, 'UHT line 4', 'UHT', 'UHT 2', 'A3/Speed', 24_000, 100],
      [6, 'UHT-line 6', 'UHT', 'UHT 1', 'TBA/22', 20_000, 100],
      [7, 'UHT-line 7', 'UHT', 'UHT 3', 'A3/Speed', 24_000, 100],
      [8, 'Yogurt', 'Yogurt', '', '', null, null],
    ]);
  });

  it("gives each line every column of Let Report's production_lines row, and an id of its own", () => {
    const { lines } = demo(at(0));
    for (const row of lines) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'id',
          'name',
          'type',
          'product',
          'qty',
          'target',
          'status',
          'note',
          'sort',
          'status_since',
          'updated_by_name',
          'updated_at',
          'created_at',
          'lot',
          'lot_started_at',
          'cip_until',
          'cip_reason',
          'cip_started_at',
          'current_lot_id',
          'uht',
          'filler',
          'filler_packs_per_h',
          'pack_ml',
        ].sort(),
      );
    }
    expect(lines.map((row) => row.id)).toEqual(['demo-line-1', 'demo-line-2', 'demo-line-3', 'demo-line-4', 'demo-line-5', 'demo-line-6', 'demo-line-7', 'demo-line-8']);
  });

  it('names the site "Demo factory" and lists UHT 1 at 4,000, UHT 2 at 8,000 and UHT 3 at 4,000 L/h', () => {
    expect(demo(at(0)).settings).toEqual({
      id: 1,
      site_name: 'Demo factory',
      uht_units: [
        { name: 'UHT 1', capacityLph: 4_000 },
        { name: 'UHT 2', capacityLph: 8_000 },
        { name: 'UHT 3', capacityLph: 4_000 },
      ],
    });
  });

  it('runs every line on a lot started earlier in the shift, as the shift lead set it 2 hours before, with no trouble open', () => {
    const data = demo(at(0));
    expect(Object.fromEntries(data.lines.map((row) => [row.name, story(row)]))).toEqual({
      'UHT-line 1': held('DEMO-02', -110),
      'UHT- line 2': held('DEMO-04', -95),
      SCM: held('DEMO-03', -100, 'Sweetened condensed milk'),
      'UHT-line 3': held('DEMO-05', -80),
      'UHT line 4': held('DEMO-06', -65),
      'UHT-line 6': held('DEMO-07', -50),
      'UHT-line 7': held('DEMO-08', -40),
      Yogurt: held('DEMO-01', -115, 'Yogurt'),
    });
    // updated_at and current_lot_id are Let Report's too, though the board does not read them.
    const rows = data.lines as (LineRow & { updated_at: string; current_lot_id: number | null })[];
    expect(rows.map((row) => [row.qty, row.target, row.updated_at, row.current_lot_id])).toEqual(NAMES.map(() => [40, 100, iso(at(-120)), null]));
    expect(data.reports).toEqual([]);
  });
});

describe('demoFactory: the script, just before and at each minute mark', () => {
  it.each([
    [1, []],
    [2, ['UHT-line 3']],
    [3, []],
    [4, ['UHT-line 7']],
    [5, []],
    [6, ['UHT-line 3']],
    [7, []],
    [8, ['UHT- line 2']],
    [9, []],
    [10, []],
    [11, []],
    [12, ['UHT- line 2']],
    [13, ['UHT line 4']],
    [14, []],
    [15, []],
    [16, ['UHT line 4', 'UHT-line 7']],
    [17, []],
    [18, []],
    [19, []],
  ])('at %s:00 changes %j and no other line', (min, names) => {
    expect(changed(demo(at(min, -1)), demo(at(min)))).toEqual(names);
  });

  it('changes nothing within a minute, not even the output', () => {
    for (let min = 0; min < 20; min += 1) {
      expect(demo(at(min, 59_999))).toEqual(demo(at(min, 1)));
    }
  });

  it.each([
    [2, 'UHT-line 3', held('DEMO-05', -80), { ...held('DEMO-05', -80), status: 'stopped', status_since: iso(at(2)), updated_by_name: 'Operator', note: 'Jaws not sealing' }],
    [
      4,
      'UHT-line 7',
      held('DEMO-08', -40),
      {
        ...held('DEMO-08', -40),
        status: 'cleaning',
        status_since: iso(at(4)),
        updated_by_name: 'Operator',
        cip_started_at: iso(at(4)),
        cip_until: iso(at(16)),
        cip_reason: 'standard',
      },
    ],
    [
      6,
      'UHT-line 3',
      { ...held('DEMO-05', -80), status: 'stopped', status_since: iso(at(2)), updated_by_name: 'Operator', note: 'Jaws not sealing' },
      { ...held('DEMO-05', -80), status_since: iso(at(6)), updated_by_name: 'Operator' },
    ],
    [8, 'UHT- line 2', held('DEMO-04', -95), { ...held('DEMO-04', -95, CHOCOLATE_MILK), status: 'changeover', status_since: iso(at(8)), updated_by_name: 'Shift lead' }],
    [
      12,
      'UHT- line 2',
      { ...held('DEMO-04', -95, CHOCOLATE_MILK), status: 'changeover', status_since: iso(at(8)), updated_by_name: 'Shift lead' },
      { ...held('DEMO-09', 12, CHOCOLATE_MILK), status_since: iso(at(12)), updated_by_name: 'QA' },
    ],
    [13, 'UHT line 4', held('DEMO-06', -65), { ...held('DEMO-06', -65), status: 'maintenance', status_since: iso(at(13)), updated_by_name: 'Shift lead' }],
    [
      16,
      'UHT line 4',
      { ...held('DEMO-06', -65), status: 'maintenance', status_since: iso(at(13)), updated_by_name: 'Shift lead' },
      { ...held('DEMO-06', -65), status_since: iso(at(16)), updated_by_name: 'Operator' },
    ],
    [
      16,
      'UHT-line 7',
      {
        ...held('DEMO-08', -40),
        status: 'cleaning',
        status_since: iso(at(4)),
        updated_by_name: 'Operator',
        cip_started_at: iso(at(4)),
        cip_until: iso(at(16)),
        cip_reason: 'standard',
      },
      { ...held('DEMO-10', 16), status_since: iso(at(16)), updated_by_name: 'QA' },
    ],
  ])('at %s:00 %s goes from the first row to the second', (min, name, before, after) => {
    expect(story(rowOf(demo(at(min, -1)), name))).toEqual(before);
    expect(story(rowOf(demo(at(min)), name))).toEqual(after);
  });

  it.each([
    [2, [], [{ id: 'demo-report-1', loc: 'UHT-line 3', sev: 2, status: 'open' }]],
    [6, [{ id: 'demo-report-1', loc: 'UHT-line 3', sev: 2, status: 'open' }], [{ id: 'demo-report-1', loc: 'UHT-line 3', sev: 2, status: 'verify' }]],
    [10, [{ id: 'demo-report-1', loc: 'UHT-line 3', sev: 2, status: 'verify' }], []],
    [17, [], [{ id: 'demo-report-2', loc: 'UHT-line 1', sev: 0, status: 'open' }]],
  ])('at %s:00 the troubles go from the first list to the second', (min, before, after) => {
    expect(demo(at(min, -1)).reports).toEqual(before);
    expect(demo(at(min)).reports).toEqual(after);
  });

  it('changes the troubles only at 2:00, 6:00, 10:00 and 17:00', () => {
    const marks = [];
    for (let min = 1; min < 20; min += 1) {
      if (JSON.stringify(demo(at(min, -1)).reports) !== JSON.stringify(demo(at(min)).reports)) marks.push(min);
    }
    expect(marks).toEqual([2, 6, 10, 17]);
  });

  it("keeps UHT-line 1's low trouble open until the script starts again", () => {
    expect(demo(at(19, 59_999)).reports).toEqual([{ id: 'demo-report-2', loc: 'UHT-line 1', sev: 0, status: 'open' }]);
    expect(demo(at(20)).reports).toEqual([]);
  });
});

describe('demoFactory: the output', () => {
  const output = (nowMs: number): number[] => demo(nowMs).lines.map((row) => row.qty);

  it('counts up by one at each whole minute on every running line, from 40 against a target of 100', () => {
    expect(output(at(0))).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
    expect(output(at(1, -1))).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
    expect(output(at(1))).toEqual([41, 41, 41, 41, 41, 41, 41, 41]);
    expect(demo(at(19)).lines.map((row) => row.target)).toEqual(NAMES.map(() => 100));
  });

  it('counts only the minutes a line runs: UHT-line 3 holds 42 while stopped, and 43 a minute after it runs again', () => {
    expect([2, 4, 6, 7].map((min) => rowOf(demo(at(min)), 'UHT-line 3').qty)).toEqual([42, 42, 42, 43]);
  });

  it('ends the cycle at 59 on a line that ran it all, less on the lines that stopped, changed over, cleaned or were maintained', () => {
    expect(output(at(19, 59_999))).toEqual([59, 55, 59, 55, 56, 59, 47, 59]);
  });
});

describe('demoFactory: the same rows for the same times, and the loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives equal rows for the same two times, as fresh objects each call', () => {
    const first = demo(at(9, 30_000));
    const second = demo(at(9, 30_000));
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.lines).not.toBe(first.lines);
    expect(second.lines[0]).not.toBe(first.lines[0]);
    expect(second.settings?.uht_units).not.toBe(first.settings?.uht_units);
    first.lines[0].status = 'idle';
    first.settings?.uht_units?.splice(0, 3);
    first.reports.push({ id: 'r9', loc: 'SCM', sev: 3, status: 'open' });
    expect(demo(at(9, 30_000))).toEqual(second);
  });

  it('reads no clock of its own', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('demoFactory read Date.now()');
    });
    expect(() => demo(at(9))).not.toThrow();
  });

  it('starts again every 20 minutes: t and t + 20 min give the same statuses, notes, lots and troubles', () => {
    const plot = (data: FactoryData) => ({
      lines: data.lines.map(({ name, status, note, product, lot, cip_reason, qty }) => [name, status, note, product, lot, cip_reason, qty]),
      reports: data.reports,
    });
    expect(DEMO_CYCLE_MS).toBe(20 * MIN_MS);
    for (let min = 0; min < 20; min += 1) {
      expect(plot(demo(at(min + 20, 30_000)))).toEqual(plot(demo(at(min, 30_000))));
      expect(plot(demo(at(min + 60, 30_000)))).toEqual(plot(demo(at(min, 30_000))));
    }
  });

  it("moves the times with the cycle: the second cycle is the first started 20 minutes later", () => {
    for (const min of [0, ...MARKS, 19]) {
      expect(demo(at(min + 20))).toEqual(demoFactory(at(20), at(min + 20)));
    }
    expect(rowOf(demo(at(22)), 'UHT-line 3').status_since).toBe(iso(at(22)));
  });

  it('is back at 0:00 at 20:00', () => {
    expect(demo(at(20))).toEqual(demoFactory(at(20), at(20)));
    expect(demo(at(20)).lines.map((row) => [row.status, row.qty, row.status_since])).toEqual(NAMES.map(() => ['running', 40, iso(at(-100))]));
  });

  it('reads a time before the start as 0:00', () => {
    expect(demo(at(-5))).toEqual(demo(at(0)));
  });

  it('reads a start or a time that is not a number as the other, and both as 0:00 at the epoch, without throwing', () => {
    expect(demoFactory(Number.NaN, at(5))).toEqual(demoFactory(at(5), at(5)));
    expect(demoFactory(START_MS, Number.NaN)).toEqual(demo(at(0)));
    expect(demoFactory(Number.NaN, Number.POSITIVE_INFINITY)).toEqual(demoFactory(0, 0));
  });
});

describe('demoFactory: the board reads it as it reads Let Report', () => {
  const view = (nowMs: number): FactoryView => buildFactory(demo(nowMs), nowMs);
  const uhtOf = (board: FactoryView, name: string): UhtView => {
    const uht = board.uhts.find((candidate) => candidate.name === name);
    if (!uht) throw new Error(`no UHT ${name}`);
    return uht;
  };
  const lineOf = (board: FactoryView, name: string): LineView => {
    const line = [...board.uhts.flatMap((uht) => uht.lines), ...board.unassigned].find((candidate) => candidate.name === name);
    if (!line) throw new Error(`no line ${name}`);
    return line;
  };
  const statusTexts = (board: FactoryView): string[] => board.uhts.flatMap((uht) => uht.lines.map((line) => `${line.name}: ${line.statusText}`));

  it('at 0:00 every line runs, and UHT 2 draws 5,550 of 8,000 L/h', () => {
    const board = view(at(0));
    expect([board.siteName, board.unassigned, board.runningLines, board.totalDrawLph]).toEqual(['Demo factory', [], 6, 10_310]);
    expect(board.uhts.map((uht) => [uht.name, uht.lamp, uht.stateText])).toEqual([
      ['UHT 1', 'ok', 'Producing · 2,360 of 4,000 L/h'],
      ['UHT 2', 'ok', 'Producing · 5,550 of 8,000 L/h'],
      ['UHT 3', 'ok', 'Producing · 2,400 of 4,000 L/h'],
    ]);
    expect(board.uhts.flatMap((uht) => uht.lines.map((line) => [line.name, line.statusForS, line.changedBy, line.note, line.openTroubles]))).toEqual([
      ['UHT-line 1', 7_200, 'Shift lead', '', 0],
      ['UHT-line 6', 7_200, 'Shift lead', '', 0],
      ['UHT- line 2', 7_200, 'Shift lead', '', 0],
      ['UHT-line 3', 7_200, 'Shift lead', '', 0],
      ['UHT line 4', 7_200, 'Shift lead', '', 0],
      ['UHT-line 7', 7_200, 'Shift lead', '', 0],
    ]);
    expect(lineOf(board, 'UHT-line 7')).toMatchObject({ lot: 'DEMO-08', lotRunS: 2_400, qty: 40, target: 100 });
  });

  it('at 2:00 UHT-line 3 stops with one open high trouble, and UHT 2 draws 3,150', () => {
    const board = view(at(2));
    const line3 = lineOf(board, 'UHT-line 3');
    expect([line3.status, line3.lamp, line3.statusText, line3.note, line3.changedBy, line3.statusForS]).toEqual(['stopped', 'bad', 'Stopped', 'Jaws not sealing', 'Operator', 0]);
    expect([line3.openTroubles, line3.worstSev]).toEqual([1, 2]);
    expect(uhtOf(board, 'UHT 2').stateText).toBe('Producing · 3,150 of 8,000 L/h');
    expect(lineOf(view(at(3)), 'UHT-line 3').statusForS).toBe(60);
  });

  it('at 4:00 UHT-line 7 starts its standard CIP, 0 done, and UHT 3 is in CIP', () => {
    const board = view(at(4));
    const line7 = lineOf(board, 'UHT-line 7');
    expect([line7.status, line7.statusText, line7.cipReason, line7.cipDoneFrac, line7.cipLeftS, line7.changedBy]).toEqual([
      'cleaning',
      'CIP · 12 min left',
      'standard',
      0,
      720,
      'Operator',
    ]);
    expect([uhtOf(board, 'UHT 3').state, uhtOf(board, 'UHT 3').lamp, uhtOf(board, 'UHT 3').stateText]).toEqual(['cip', 'idle', 'CIP']);
  });

  it('the CIP is a quarter done at 7:00, half at 10:00, and nearly all a second before 16:00', () => {
    expect(lineOf(view(at(7)), 'UHT-line 7').cipDoneFrac).toBe(0.25);
    expect([lineOf(view(at(10)), 'UHT-line 7').cipDoneFrac, lineOf(view(at(10)), 'UHT-line 7').statusText]).toEqual([0.5, 'CIP · 6 min 00 s left']);
    expect([lineOf(view(at(16, -1_000)), 'UHT-line 7').cipLeftS, lineOf(view(at(16, -1_000)), 'UHT-line 7').statusText]).toEqual([1, 'CIP · 1 s left']);
  });

  it('at 6:00 UHT-line 3 runs again, its trouble still open while it waits for verification', () => {
    const board = view(at(6));
    const line3 = lineOf(board, 'UHT-line 3');
    expect([line3.status, line3.note, line3.openTroubles, line3.worstSev]).toEqual(['running', '', 1, 2]);
    expect(uhtOf(board, 'UHT 2').stateText).toBe('Producing · 5,550 of 8,000 L/h');
  });

  it('at 8:00 UHT- line 2 changes over to chocolate milk, and UHT 2 draws 4,800', () => {
    const board = view(at(8));
    const line2 = lineOf(board, 'UHT- line 2');
    expect([line2.status, line2.lamp, line2.statusText, line2.product, line2.lot, line2.changedBy]).toEqual([
      'changeover',
      'warn',
      'Changeover',
      CHOCOLATE_MILK,
      'DEMO-04',
      'Shift lead',
    ]);
    expect(uhtOf(board, 'UHT 2').stateText).toBe('Producing · 4,800 of 8,000 L/h');
  });

  it("at 10:00 UHT-line 3's trouble closes", () => {
    const line3 = lineOf(view(at(10)), 'UHT-line 3');
    expect([line3.openTroubles, line3.worstSev]).toEqual([0, null]);
  });

  it('at 12:00 UHT- line 2 runs the new product on a new lot', () => {
    const line2 = lineOf(view(at(12)), 'UHT- line 2');
    expect([line2.status, line2.product, line2.lot, line2.lotRunS, line2.changedBy]).toEqual(['running', CHOCOLATE_MILK, 'DEMO-09', 0, 'QA']);
  });

  it('at 13:00 UHT line 4 is in maintenance, and UHT 2 draws 3,150', () => {
    const board = view(at(13));
    const line4 = lineOf(board, 'UHT line 4');
    expect([line4.status, line4.lamp, line4.statusText, line4.changedBy]).toEqual(['maintenance', 'bad', 'Maintenance', 'Shift lead']);
    expect(uhtOf(board, 'UHT 2').stateText).toBe('Producing · 3,150 of 8,000 L/h');
  });

  it('at 16:00 every line runs again, UHT-line 7 on a new lot', () => {
    const board = view(at(16));
    expect(statusTexts(board)).toEqual([
      'UHT-line 1: Running',
      'UHT-line 6: Running',
      'UHT- line 2: Running',
      'UHT-line 3: Running',
      'UHT line 4: Running',
      'UHT-line 7: Running',
    ]);
    expect(board.uhts.map((uht) => uht.stateText)).toEqual(['Producing · 2,360 of 4,000 L/h', 'Producing · 5,550 of 8,000 L/h', 'Producing · 2,400 of 4,000 L/h']);
    const line7 = lineOf(board, 'UHT-line 7');
    expect([line7.lot, line7.lotRunS, line7.cipReason, line7.cipDoneFrac, line7.changedBy]).toEqual(['DEMO-10', 0, '', null, 'QA']);
  });

  it("at 17:00 UHT-line 1's low trouble opens, the line still running", () => {
    const line1 = lineOf(view(at(17)), 'UHT-line 1');
    expect([line1.status, line1.openTroubles, line1.worstSev]).toEqual(['running', 1, 0]);
    expect([lineOf(view(at(17, -1)), 'UHT-line 1').openTroubles]).toEqual([0]);
  });

  it('shows the status of every line at each minute mark of the script', () => {
    expect(Object.fromEntries([0, ...MARKS].map((min) => [min, view(at(min)).uhts.flatMap((uht) => uht.lines.map((line) => line.status))]))).toEqual({
      // UHT-line 1, UHT-line 6, UHT- line 2, UHT-line 3, UHT line 4, UHT-line 7.
      0: ['running', 'running', 'running', 'running', 'running', 'running'],
      2: ['running', 'running', 'running', 'stopped', 'running', 'running'],
      4: ['running', 'running', 'running', 'stopped', 'running', 'cleaning'],
      6: ['running', 'running', 'running', 'running', 'running', 'cleaning'],
      8: ['running', 'running', 'changeover', 'running', 'running', 'cleaning'],
      10: ['running', 'running', 'changeover', 'running', 'running', 'cleaning'],
      12: ['running', 'running', 'running', 'running', 'running', 'cleaning'],
      13: ['running', 'running', 'running', 'running', 'maintenance', 'cleaning'],
      16: ['running', 'running', 'running', 'running', 'running', 'running'],
      17: ['running', 'running', 'running', 'running', 'running', 'running'],
    });
  });
});
