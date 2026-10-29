// The Factory board's view (src/factory/model.ts, D19): what each UHT draws of its capacity, its state and
// lamp, each line's lamp, words and clocks, and its open troubles, from the rows Let Report gives. The main
// fixture is the real factory: three UHTs, six filling lines (no line 5) and the SCM and Yogurt lines.
import { describe, expect, it } from 'vitest';
import { buildFactory } from '../../src/factory/model';
import {
  LINE_STATUSES,
  type FactoryData,
  type FactoryView,
  type LineRow,
  type LineStatus,
  type LineView,
  type ReportRow,
  type SettingsRow,
  type UhtView,
} from '../../src/factory/types';

const NOW_MS = Date.parse('2026-10-29T08:00:00Z');
const MIN_MS = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/** A filling line on a UHT, running at 100 ml, as Let Report gives it after migration 0013. */
function uhtLine(name: string, sort: number, uht: string, filler: string, packsPerH: number): LineRow {
  return {
    id: `line-${sort}`,
    name,
    type: 'UHT',
    product: 'UHT milk 100 ml',
    qty: 40,
    target: 100,
    status: 'running',
    sort,
    status_since: '2026-10-29T06:00:00+00:00',
    lot: '',
    lot_started_at: null,
    cip_until: null,
    uht,
    filler,
    filler_packs_per_h: packsPerH,
    pack_ml: 100,
  };
}

/** A line of another kind, which feeds from no UHT. */
function otherLine(name: string, sort: number, type: string): LineRow {
  return { ...uhtLine(name, sort, '', '', 0), type, filler_packs_per_h: null, pack_ml: null, product: name };
}

const LINES: LineRow[] = [
  uhtLine('UHT-line 1', 1, 'UHT 1', 'TFA', 3_600),
  uhtLine('UHT- line 2', 2, 'UHT 2', 'TBA/19', 7_500),
  uhtLine('UHT-line 3', 3, 'UHT 2', 'A3/Speed', 24_000),
  uhtLine('UHT line 4', 4, 'UHT 2', 'A3/Speed', 24_000),
  uhtLine('UHT-line 6', 6, 'UHT 1', 'TBA/22', 20_000),
  uhtLine('UHT-line 7', 7, 'UHT 3', 'A3/Speed', 24_000),
  otherLine('SCM', 8, 'SCM'),
  otherLine('Yogurt', 9, 'Yogurt'),
];

const SETTINGS: SettingsRow = {
  site_name: '  Main plant ',
  uht_units: [
    { name: 'UHT 1', capacityLph: 4_000 },
    { name: 'UHT 2', capacityLph: 8_000 },
    { name: 'UHT 3', capacityLph: 4_000 },
  ],
};

function board(data: Partial<FactoryData> = {}, nowMs = NOW_MS): FactoryView {
  return buildFactory({ lines: LINES, settings: SETTINGS, reports: [], ...data }, nowMs);
}

/** The factory with one line changed. */
function withLine(name: string, patch: Partial<LineRow>): LineRow[] {
  return LINES.map((line) => (line.name === name ? { ...line, ...patch } : line));
}

function uhtOf(view: FactoryView, name: string): UhtView {
  const uht = view.uhts.find((candidate) => candidate.name === name);
  if (!uht) throw new Error(`no UHT ${name}`);
  return uht;
}

function lineOf(view: FactoryView, name: string): LineView {
  const line = [...view.uhts.flatMap((uht) => uht.lines), ...view.unassigned].find((candidate) => candidate.name === name);
  if (!line) throw new Error(`no line ${name}`);
  return line;
}

const uhtSummary = ({ name, drawLph, loadPct, overCapacity, state, lamp, stateText }: UhtView) => ({
  name,
  drawLph,
  loadPct,
  overCapacity,
  state,
  lamp,
  stateText,
});

describe('buildFactory: the factory with every line running', () => {
  it('lists the three UHTs in the order of uht_units, each with its lines in Let Report order', () => {
    expect(board().uhts.map((uht) => [uht.name, uht.capacityLph, uht.lines.map((line) => `${line.name} · ${line.filler}`)])).toEqual([
      ['UHT 1', 4_000, ['UHT-line 1 · TFA', 'UHT-line 6 · TBA/22']],
      ['UHT 2', 8_000, ['UHT- line 2 · TBA/19', 'UHT-line 3 · A3/Speed', 'UHT line 4 · A3/Speed']],
      ['UHT 3', 4_000, ['UHT-line 7 · A3/Speed']],
    ]);
  });

  it('rates each line at packs/h × ml ÷ 1,000, and a running line draws all of it', () => {
    const view = board();
    expect(view.uhts.flatMap((uht) => uht.lines.map((line) => [line.name, line.ratedLph, line.drawLph]))).toEqual([
      ['UHT-line 1', 360, 360],
      ['UHT-line 6', 2_000, 2_000],
      ['UHT- line 2', 750, 750],
      ['UHT-line 3', 2_400, 2_400],
      ['UHT line 4', 2_400, 2_400],
      ['UHT-line 7', 2_400, 2_400],
    ]);
  });

  it('UHT 1 draws 2,360, UHT 2 5,550 of 8,000 (69.375 %) and UHT 3 2,400 of 4,000 L/h, all green', () => {
    expect(board().uhts.map(uhtSummary)).toEqual([
      { name: 'UHT 1', drawLph: 2_360, loadPct: 59, overCapacity: false, state: 'producing', lamp: 'ok', stateText: 'Producing · 2,360 of 4,000 L/h' },
      { name: 'UHT 2', drawLph: 5_550, loadPct: 69.375, overCapacity: false, state: 'producing', lamp: 'ok', stateText: 'Producing · 5,550 of 8,000 L/h' },
      { name: 'UHT 3', drawLph: 2_400, loadPct: 60, overCapacity: false, state: 'producing', lamp: 'ok', stateText: 'Producing · 2,400 of 4,000 L/h' },
    ]);
  });

  it('leaves the SCM and Yogurt lines off the board, and counts only the lines on it', () => {
    const view = board();
    expect(view.unassigned).toEqual([]);
    expect(view.uhts.flatMap((uht) => uht.lines.map((line) => line.name))).not.toContain('SCM');
    expect(view.uhts.flatMap((uht) => uht.lines.map((line) => line.name))).not.toContain('Yogurt');
    expect(view.runningLines).toBe(6);
    expect(view.totalDrawLph).toBe(10_310);
  });

  it('shows a line as Let Report gives it', () => {
    expect(lineOf(board(), 'UHT- line 2')).toEqual({
      id: 'line-2',
      name: 'UHT- line 2',
      filler: 'TBA/19',
      packsPerH: 7_500,
      packMl: 100,
      ratedLph: 750,
      drawLph: 750,
      status: 'running',
      lamp: 'ok',
      statusText: 'Running',
      product: 'UHT milk 100 ml',
      lot: '',
      lotRunS: null,
      cipLeftS: null,
      qty: 40,
      target: 100,
      openTroubles: 0,
      worstSev: null,
    } satisfies LineView);
  });

  it("shows Let Report's site name, trimmed, and '' when it has none", () => {
    expect(board().siteName).toBe('Main plant');
    expect(board({ settings: { ...SETTINGS, site_name: undefined } }).siteName).toBe('');
    expect(board({ settings: null }).siteName).toBe('');
  });
});

describe('buildFactory: a line stopping', () => {
  it("UHT line 3 stopped: UHT 2 falls from 5,550 to 3,150 L/h, and line 3's lamp turns red", () => {
    const view = board({ lines: withLine('UHT-line 3', { status: 'stopped' }) });
    expect(uhtSummary(uhtOf(view, 'UHT 2'))).toEqual({
      name: 'UHT 2',
      drawLph: 3_150,
      loadPct: 39.375,
      overCapacity: false,
      state: 'producing',
      lamp: 'ok',
      stateText: 'Producing · 3,150 of 8,000 L/h',
    });
    const line3 = lineOf(view, 'UHT-line 3');
    expect([line3.lamp, line3.statusText, line3.ratedLph, line3.drawLph]).toEqual(['bad', 'Stopped', 2_400, 0]);
    expect([view.runningLines, view.totalDrawLph]).toEqual([5, 7_910]);
  });

  it('the other UHTs do not change', () => {
    const view = board({ lines: withLine('UHT-line 3', { status: 'stopped' }) });
    expect([uhtOf(view, 'UHT 1').drawLph, uhtOf(view, 'UHT 3').drawLph]).toEqual([2_360, 2_400]);
  });
});

describe("buildFactory: a line's lamp and words for each status", () => {
  it.each([
    ['running', 'ok', 'Running', 2_400],
    ['stopped', 'bad', 'Stopped', 0],
    ['maintenance', 'bad', 'Maintenance', 0],
    ['changeover', 'warn', 'Changeover', 0],
    ['cleaning', 'idle', 'CIP', 0],
    ['idle', 'idle', 'Idle', 0],
  ] as const)('%s: lamp %s, "%s", drawing %s L/h', (status, lamp, statusText, drawLph) => {
    const line = lineOf(board({ lines: withLine('UHT-line 7', { status }) }), 'UHT-line 7');
    expect({ status: line.status, lamp: line.lamp, statusText: line.statusText, drawLph: line.drawLph }).toEqual({ status, lamp, statusText, drawLph });
  });

  it('covers every status of the contract', () => {
    const texts = LINE_STATUSES.map((status) => lineOf(board({ lines: withLine('UHT-line 7', { status }) }), 'UHT-line 7').statusText);
    expect(new Set(texts).size).toBe(LINE_STATUSES.length);
  });

  it.each(['paused', '', null, 42])('treats a status it does not know (%s) as idle', (status) => {
    const line = lineOf(board({ lines: withLine('UHT-line 7', { status: status as LineStatus }) }), 'UHT-line 7');
    expect([line.status, line.lamp, line.statusText, line.drawLph]).toEqual(['idle', 'idle', 'Idle', 0]);
  });

  it('reads a status in capitals or with spaces around it', () => {
    const line = lineOf(board({ lines: withLine('UHT-line 7', { status: ' Running ' as LineStatus }) }), 'UHT-line 7');
    expect([line.status, line.lamp, line.drawLph]).toEqual(['running', 'ok', 2_400]);
  });
});

describe('buildFactory: the CIP clock', () => {
  const cleaning = (cipUntil: string | null | undefined, nowMs = NOW_MS): LineView =>
    lineOf(board({ lines: withLine('UHT-line 7', { status: 'cleaning', cip_until: cipUntil }) }, nowMs), 'UHT-line 7');

  it('reads "CIP · 1 h 10 min left" with 70 minutes to go, unlit', () => {
    const line = cleaning(iso(NOW_MS + 70 * MIN_MS));
    expect([line.statusText, line.cipLeftS, line.lamp]).toEqual(['CIP · 1 h 10 min left', 4_200, 'idle']);
  });

  it.each([
    [90_000, 'CIP · 1 min 30 s left', 90],
    [25 * MIN_MS, 'CIP · 25 min left', 1_500],
    [400, 'CIP · 1 s left', 1],
    [89_200, 'CIP · 1 min 30 s left', 90],
  ])('with %s ms to go reads "%s" (%s s, whole seconds rounded up)', (leftMs, statusText, cipLeftS) => {
    const line = cleaning(iso(NOW_MS + leftMs));
    expect([line.statusText, line.cipLeftS]).toEqual([statusText, cipLeftS]);
  });

  it('reads "CIP · overdue", 0 s left, once the planned end has passed or is now', () => {
    expect([cleaning(iso(NOW_MS - 5 * MIN_MS)).statusText, cleaning(iso(NOW_MS - 5 * MIN_MS)).cipLeftS]).toEqual(['CIP · overdue', 0]);
    expect([cleaning(iso(NOW_MS)).statusText, cleaning(iso(NOW_MS)).cipLeftS]).toEqual(['CIP · overdue', 0]);
  });

  it.each([null, undefined, '', 'soon', '2026-13-45T99:00:00Z'])('reads plain "CIP" with no clock when cip_until is %s', (cipUntil) => {
    const line = cleaning(cipUntil);
    expect([line.statusText, line.cipLeftS]).toEqual(['CIP', null]);
  });

  it('reads Let Report times with microseconds and an offset', () => {
    expect(cleaning('2026-10-29T09:10:00.000000+00:00').cipLeftS).toBe(4_200);
    expect(cleaning('2026-10-29T16:10:00+07:00').cipLeftS).toBe(4_200);
  });

  it('reads a time with no zone as UTC, whatever the machine', () => {
    expect(cleaning('2026-10-29T09:10:00').cipLeftS).toBe(4_200);
    expect(cleaning('2026-10-29 09:10:00').cipLeftS).toBe(4_200);
  });

  it('shows no clock when the time it is given is not a number', () => {
    expect([cleaning(iso(NOW_MS + 70 * MIN_MS), Number.NaN).statusText, cleaning(iso(NOW_MS + 70 * MIN_MS), Number.NaN).cipLeftS]).toEqual([
      'CIP',
      null,
    ]);
  });

  it('ignores a planned end left on a line that is no longer cleaning', () => {
    const line = lineOf(board({ lines: withLine('UHT-line 7', { status: 'running', cip_until: iso(NOW_MS + 70 * MIN_MS) }) }), 'UHT-line 7');
    expect([line.statusText, line.cipLeftS]).toEqual(['Running', null]);
  });
});

describe('buildFactory: the lot clock', () => {
  const onLot = (patch: Partial<LineRow>, nowMs = NOW_MS): LineView =>
    lineOf(board({ lines: withLine('UHT-line 6', patch) }, nowMs), 'UHT-line 6');

  it('counts the seconds since the lot started', () => {
    const line = onLot({ lot: 'L261029-06', lot_started_at: iso(NOW_MS - 125 * MIN_MS) });
    expect([line.lot, line.lotRunS]).toEqual(['L261029-06', 7_500]);
  });

  it('counts whole seconds, rounded down', () => {
    expect(onLot({ lot: 'L261029-06', lot_started_at: iso(NOW_MS - 59_600) }).lotRunS).toBe(59);
  });

  it('reads 0 for a start a little in the future (a clock ahead of this one)', () => {
    expect(onLot({ lot: 'L261029-06', lot_started_at: iso(NOW_MS + 30_000) }).lotRunS).toBe(0);
  });

  it.each([
    ['no lot', { lot: '', lot_started_at: iso(NOW_MS - 10 * MIN_MS) }],
    ['a lot of spaces', { lot: '   ', lot_started_at: iso(NOW_MS - 10 * MIN_MS) }],
    ['no start', { lot: 'L261029-06', lot_started_at: null }],
    ['a start that does not parse', { lot: 'L261029-06', lot_started_at: 'this morning' }],
  ])('has no clock with %s', (_case, patch) => {
    expect(onLot(patch).lotRunS).toBeNull();
  });

  it('keeps the lot clock running while the line cleans', () => {
    const line = onLot({ status: 'cleaning', lot: 'L261029-06', lot_started_at: iso(NOW_MS - 60 * MIN_MS), cip_until: iso(NOW_MS + 10 * MIN_MS) });
    expect([line.lotRunS, line.cipLeftS, line.statusText]).toEqual([3_600, 600, 'CIP · 10 min left']);
  });
});

describe('buildFactory: open troubles', () => {
  const reports: ReportRow[] = [
    { id: 'r1', loc: 'UHT-line 3', sev: 1, status: 'open' },
    { id: 'r2', loc: '  uht-LINE 3 ', sev: 2, status: 'action' },
    { id: 'r3', loc: 'UHT-line 3', sev: 3, status: 'closed' },
    { id: 'r4', loc: 'UHT line 4', sev: 0, status: 'verify' },
    { id: 'r5', loc: 'Packing', sev: 3, status: 'open' },
    { id: 'r6', loc: 'SCM', sev: 3, status: 'open' },
  ];

  it('counts the reports at a line that are not closed, with the worst severity, matching the name in any case', () => {
    const view = board({ reports });
    expect([lineOf(view, 'UHT-line 3').openTroubles, lineOf(view, 'UHT-line 3').worstSev]).toEqual([2, 2]);
    expect([lineOf(view, 'UHT line 4').openTroubles, lineOf(view, 'UHT line 4').worstSev]).toEqual([1, 0]);
  });

  it('shows none, with no severity, at a line with no report or only closed ones', () => {
    const view = board({ reports: [{ id: 'r3', loc: 'UHT-line 7', sev: 3, status: 'closed' }] });
    expect([lineOf(view, 'UHT-line 7').openTroubles, lineOf(view, 'UHT-line 7').worstSev]).toEqual([0, null]);
    expect([lineOf(view, 'UHT-line 1').openTroubles, lineOf(view, 'UHT-line 1').worstSev]).toEqual([0, null]);
  });

  it('reads a closed status in any case, and counts a report with no severity as the lowest', () => {
    const view = board({
      reports: [
        { id: 'r1', loc: 'UHT-line 1', sev: 3, status: ' Closed' },
        { id: 'r2', loc: 'UHT-line 1', sev: null as unknown as number, status: 'open' },
      ],
    });
    expect([lineOf(view, 'UHT-line 1').openTroubles, lineOf(view, 'UHT-line 1').worstSev]).toEqual([1, 0]);
  });

  it('a trouble does not change what the line draws or its lamp', () => {
    const line = lineOf(board({ reports }), 'UHT-line 3');
    expect([line.lamp, line.drawLph]).toEqual(['ok', 2_400]);
  });
});

describe('buildFactory: the UHT state', () => {
  it('a UHT whose lines all clean is in CIP, unlit, and draws nothing', () => {
    const lines = LINES.map((line) => (line.uht === 'UHT 2' ? { ...line, status: 'cleaning' as const } : line));
    expect(uhtSummary(uhtOf(board({ lines }), 'UHT 2'))).toEqual({
      name: 'UHT 2',
      drawLph: 0,
      loadPct: 0,
      overCapacity: false,
      state: 'cip',
      lamp: 'idle',
      stateText: 'CIP',
    });
  });

  it('a UHT still produces while one of its lines runs and the others clean', () => {
    const lines = LINES.map((line) => (line.uht === 'UHT 2' && line.name !== 'UHT- line 2' ? { ...line, status: 'cleaning' as const } : line));
    expect(uhtOf(board({ lines }), 'UHT 2').stateText).toBe('Producing · 750 of 8,000 L/h');
  });

  it.each([
    ['all stopped', ['stopped', 'stopped', 'stopped']],
    ['some cleaning, the rest stopped', ['cleaning', 'stopped', 'cleaning']],
    ['in changeover, maintenance and idle', ['changeover', 'maintenance', 'idle']],
  ] as const)('a UHT with its lines %s is stopped, red', (_case, statuses) => {
    const names = ['UHT- line 2', 'UHT-line 3', 'UHT line 4'];
    const lines = LINES.map((line) => (names.includes(line.name) ? { ...line, status: statuses[names.indexOf(line.name)] } : line));
    const uht = uhtOf(board({ lines }), 'UHT 2');
    expect([uht.state, uht.lamp, uht.stateText, uht.drawLph]).toEqual(['stopped', 'bad', 'Stopped', 0]);
  });

  it('warns when its lines draw more than it makes', () => {
    const view = board({ lines: withLine('UHT-line 6', { filler_packs_per_h: 40_000 }) });
    expect(uhtSummary(uhtOf(view, 'UHT 1'))).toEqual({
      name: 'UHT 1',
      drawLph: 4_360,
      loadPct: 109,
      overCapacity: true,
      state: 'producing',
      lamp: 'warn',
      stateText: 'Producing · 4,360 of 4,000 L/h',
    });
  });

  it('does not warn at exactly its capacity', () => {
    const view = board({ lines: withLine('UHT-line 6', { filler_packs_per_h: 36_400 }) });
    expect([uhtOf(view, 'UHT 1').drawLph, uhtOf(view, 'UHT 1').overCapacity, uhtOf(view, 'UHT 1').lamp]).toEqual([4_000, false, 'ok']);
  });

  it('a UHT with no lines reads "No lines", unlit', () => {
    const settings: SettingsRow = { ...SETTINGS, uht_units: [...(SETTINGS.uht_units ?? []), { name: 'UHT 4', capacityLph: 6_000 }] };
    const uht = uhtOf(board({ settings }), 'UHT 4');
    expect({ ...uhtSummary(uht), capacityLph: uht.capacityLph, lines: uht.lines }).toEqual({
      name: 'UHT 4',
      drawLph: 0,
      loadPct: 0,
      overCapacity: false,
      state: 'stopped',
      lamp: 'idle',
      stateText: 'No lines',
      capacityLph: 6_000,
      lines: [],
    });
  });

  it.each([0, -500, Number.NaN, null, '4000'])('a UHT with a capacity of %s reads 0 load, never over, and no "of" in its words', (capacityLph) => {
    const settings: SettingsRow = { uht_units: [{ name: 'UHT 3', capacityLph: capacityLph as number }] };
    const uht = uhtOf(board({ settings }), 'UHT 3');
    expect([uht.loadPct, uht.overCapacity, uht.lamp, uht.stateText]).toEqual([0, false, 'ok', 'Producing · 2,400 L/h']);
    expect(uht.capacityLph).toBe(typeof capacityLph === 'number' && Number.isFinite(capacityLph) ? capacityLph : 0);
  });
});

describe('buildFactory: lines no UHT claims', () => {
  it.each([
    ['names a UHT that is not in the list', { uht: 'UHT 9' }],
    ['names none', { uht: '' }],
    ['has no uht column', { uht: undefined }],
  ])('a UHT line that %s goes to unassigned, still counted', (_case, patch) => {
    const view = board({ lines: withLine('UHT-line 7', patch) });
    expect(view.unassigned.map((line) => line.name)).toEqual(['UHT-line 7']);
    expect(uhtOf(view, 'UHT 3')).toMatchObject({ lines: [], stateText: 'No lines', lamp: 'idle' });
    expect([view.runningLines, view.totalDrawLph]).toEqual([6, 10_310]);
  });

  it('keeps the SCM, Yogurt and other lines off the board, also one that names a UHT not in the list', () => {
    const view = board({ lines: [...withLine('UHT-line 7', { uht: '' }), { ...otherLine('Other line', 10, 'Other'), uht: 'UHT 7' }] });
    expect(view.unassigned.map((line) => line.name)).toEqual(['UHT-line 7']);
  });

  it("reads the line's type in any case", () => {
    const view = board({ lines: withLine('UHT-line 7', { uht: '', type: ' uht ' }) });
    expect(view.unassigned.map((line) => line.name)).toEqual(['UHT-line 7']);
  });

  it('matches the UHT by name in any case and with spaces around it', () => {
    const view = board({ lines: withLine('UHT-line 7', { uht: '  uht 2 ' }) });
    expect(uhtOf(view, 'UHT 2').lines.map((line) => line.name)).toEqual(['UHT- line 2', 'UHT-line 3', 'UHT line 4', 'UHT-line 7']);
    expect(uhtOf(view, 'UHT 2').drawLph).toBe(7_950);
  });

  it('shows a line of another type under the UHT it names', () => {
    const view = board({ lines: withLine('SCM', { uht: 'UHT 3', filler_packs_per_h: 6_000, pack_ml: 200 }) });
    expect(uhtOf(view, 'UHT 3').lines.map((line) => [line.name, line.drawLph])).toEqual([
      ['UHT-line 7', 2_400],
      ['SCM', 1_200],
    ]);
  });

  it('lists the unassigned lines in Let Report order', () => {
    const lines = LINES.map((line) => (line.uht === 'UHT 2' ? { ...line, uht: '' } : line)).reverse();
    expect(board({ lines }).unassigned.map((line) => line.name)).toEqual(['UHT- line 2', 'UHT-line 3', 'UHT line 4']);
  });
});

describe('buildFactory: a missing speed or pack size', () => {
  it.each([
    ['no speed', { filler_packs_per_h: null }, null, 100],
    ['a speed that is not a number', { filler_packs_per_h: Number.NaN }, null, 100],
    ['a speed of 0', { filler_packs_per_h: 0 }, 0, 100],
    ['no pack size', { pack_ml: null }, 24_000, null],
    ['a pack size of 0', { pack_ml: 0 }, 24_000, 0],
  ])('%s: rated null and draws 0 while running, and its UHT draws the rest', (_case, patch, packsPerH, packMl) => {
    const view = board({ lines: withLine('UHT-line 3', patch) });
    const line = lineOf(view, 'UHT-line 3');
    expect({ packsPerH: line.packsPerH, packMl: line.packMl, ratedLph: line.ratedLph, drawLph: line.drawLph, lamp: line.lamp }).toEqual({
      packsPerH,
      packMl,
      ratedLph: null,
      drawLph: 0,
      lamp: 'ok',
    });
    expect(uhtOf(view, 'UHT 2').stateText).toBe('Producing · 3,150 of 8,000 L/h');
  });

  it('a running line with no rating still makes its UHT producing', () => {
    const view = board({ lines: withLine('UHT-line 7', { filler_packs_per_h: null }) });
    expect(uhtSummary(uhtOf(view, 'UHT 3'))).toMatchObject({ drawLph: 0, state: 'producing', lamp: 'ok', stateText: 'Producing · 0 of 4,000 L/h' });
  });
});

describe('buildFactory: an older database', () => {
  // A production_lines row from before migrations 0008 and 0013.
  const OLD_LINE = {
    id: 'old-4',
    name: 'UHT line 4',
    type: 'UHT',
    product: 'Bestcows',
    qty: 0,
    target: 90,
    status: 'cleaning',
    sort: 4,
    status_since: '2026-10-29T07:00:00+00:00',
  } as LineRow;

  it('shows a line without the newer columns as a UHT line no UHT claims, with no rating, filler or clocks', () => {
    expect(board({ lines: [OLD_LINE], settings: { site_name: 'Main plant' } }).unassigned).toEqual([
      {
        id: 'old-4',
        name: 'UHT line 4',
        filler: '',
        packsPerH: null,
        packMl: null,
        ratedLph: null,
        drawLph: 0,
        status: 'cleaning',
        lamp: 'idle',
        statusText: 'CIP',
        product: 'Bestcows',
        lot: '',
        lotRunS: null,
        cipLeftS: null,
        qty: 0,
        target: 90,
        openTroubles: 0,
        worstSev: null,
      } satisfies LineView,
    ]);
  });

  it.each([
    ['no settings row', null],
    ['no uht_units', { site_name: 'Main plant' }],
    ['uht_units null', { uht_units: null }],
    ['uht_units an object', { uht_units: { name: 'UHT 1', capacityLph: 4_000 } }],
    ['uht_units a string', { uht_units: 'UHT 1, UHT 2' }],
  ])('with %s, shows no UHT and every UHT line unassigned', (_case, settings) => {
    const view = board({ settings: settings as SettingsRow | null });
    expect(view.uhts).toEqual([]);
    expect(view.unassigned.map((line) => line.name)).toEqual(['UHT-line 1', 'UHT- line 2', 'UHT-line 3', 'UHT line 4', 'UHT-line 6', 'UHT-line 7']);
    expect([view.runningLines, view.totalDrawLph]).toEqual([6, 10_310]);
  });

  it('skips UHT entries without a name, and keeps the rest in order', () => {
    const settings = {
      uht_units: [null, { capacityLph: 9_000 }, { name: 7, capacityLph: 1 }, { name: '  ', capacityLph: 1 }, 'UHT 9', { name: 'UHT 3' }, { name: 'UHT 1', capacityLph: 4_000 }],
    } as unknown as SettingsRow;
    expect(board({ settings }).uhts.map((uht) => [uht.name, uht.capacityLph, uht.lines.length])).toEqual([
      ['UHT 3', 0, 1],
      ['UHT 1', 4_000, 2],
    ]);
  });

  it('gives the lines of two UHTs of the same name to the first', () => {
    const settings: SettingsRow = { uht_units: [{ name: 'UHT 1', capacityLph: 4_000 }, { name: 'uht 1', capacityLph: 5_000 }] };
    expect(board({ settings }).uhts.map((uht) => [uht.name, uht.lines.length, uht.stateText])).toEqual([
      ['UHT 1', 2, 'Producing · 2,360 of 4,000 L/h'],
      ['uht 1', 0, 'No lines'],
    ]);
  });

  it('reads lines or reports that are not lists as none', () => {
    const view = buildFactory({ lines: null, settings: SETTINGS, reports: { id: 'r1' } } as unknown as FactoryData, NOW_MS);
    expect(view.uhts.map((uht) => uht.stateText)).toEqual(['No lines', 'No lines', 'No lines']);
    expect([view.unassigned, view.runningLines, view.totalDrawLph]).toEqual([[], 0, 0]);
  });

  it('skips list entries that are not rows', () => {
    const lines = [null, 'UHT-line 1', ...LINES] as unknown as LineRow[];
    const reports = [null, { id: 'r1', loc: 'UHT-line 1', sev: 2, status: 'open' }] as unknown as ReportRow[];
    const view = board({ lines, reports });
    expect(view.runningLines).toBe(6);
    expect(lineOf(view, 'UHT-line 1').worstSev).toBe(2);
  });

  it("reads '' and 0 for a line's missing words and numbers", () => {
    const bare = { id: 'bare', name: 'UHT-line 7', type: 'UHT', status: 'running', uht: 'UHT 3' } as LineRow;
    expect(lineOf(board({ lines: [bare] }), 'UHT-line 7')).toMatchObject({ product: '', lot: '', filler: '', qty: 0, target: 0 });
  });
});

describe('buildFactory: order', () => {
  it("lists the lines by Let Report's sort, whatever order they come in", () => {
    const shuffled = [LINES[3], LINES[7], LINES[0], LINES[5], LINES[2], LINES[6], LINES[4], LINES[1]];
    expect(board({ lines: shuffled }).uhts.map((uht) => uht.lines.map((line) => line.name))).toEqual([
      ['UHT-line 1', 'UHT-line 6'],
      ['UHT- line 2', 'UHT-line 3', 'UHT line 4'],
      ['UHT-line 7'],
    ]);
  });

  it('follows sort over the name: a line moved first in Let Report shows first', () => {
    const view = board({ lines: withLine('UHT line 4', { sort: 0 }) });
    expect(uhtOf(view, 'UHT 2').lines.map((line) => line.name)).toEqual(['UHT line 4', 'UHT- line 2', 'UHT-line 3']);
  });

  it('orders lines of the same sort by name, numbers as numbers, and a line with no sort last', () => {
    const lines = [
      { ...uhtLine('UHT line 10', 5, 'UHT 2', 'A3/Speed', 24_000) },
      { ...uhtLine('UHT line 9', 5, 'UHT 2', 'A3/Speed', 24_000) },
      { ...uhtLine('UHT line 8', 5, 'UHT 2', 'A3/Speed', 24_000), sort: undefined as unknown as number },
      { ...uhtLine('UHT line 11', 5, 'UHT 2', 'A3/Speed', 24_000) },
      { ...uhtLine('UHT line 12', 1, 'UHT 2', 'A3/Speed', 24_000) },
    ];
    expect(board({ lines }).uhts[1].lines.map((line) => line.name)).toEqual(['UHT line 12', 'UHT line 9', 'UHT line 10', 'UHT line 11', 'UHT line 8']);
  });

  it('lists the UHTs as uht_units does, not by name', () => {
    const settings: SettingsRow = { uht_units: [...(SETTINGS.uht_units ?? [])].reverse() };
    expect(board({ settings }).uhts.map((uht) => [uht.name, uht.drawLph])).toEqual([
      ['UHT 3', 2_400],
      ['UHT 2', 5_550],
      ['UHT 1', 2_360],
    ]);
  });
});

describe('buildFactory: purity', () => {
  it('builds the same view from the same rows and time, and leaves the rows as they were', () => {
    const data: FactoryData = { lines: structuredClone(LINES), settings: structuredClone(SETTINGS), reports: [] };
    const before = structuredClone(data);
    expect(buildFactory(data, NOW_MS)).toEqual(buildFactory(data, NOW_MS));
    expect(data).toEqual(before);
  });
});
