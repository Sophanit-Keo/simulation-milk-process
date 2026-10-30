// Phase 11 (D21): the demo's made-up day at the factory, as rows like Let Report's own, so the model, the board
// and the floor read it as they read Let Report. It has the real factory's layout (D19: three UHTs, six UHT lines,
// the SCM and Yogurt lines) and plays the 20-minute script of the phase card
// (plan/agent-plan/phase-11-demo-and-line-story.md), then starts it again.
//
// Pure and headless: the times come in as startMs and nowMs, and tsconfig.headless.json checks this file without
// the DOM. The same two times give the same rows, built afresh at each call. Every change names a role, never a
// real person.
import { DEMO_CYCLE_MS, type DemoFactory, type FactoryData, type LineRow, type LineStatus, type ReportRow, type SettingsRow } from './view';

const MIN_MS = 60_000;

/** Who makes the script's changes: a role, never a real person. */
type Role = 'Shift lead' | 'Operator' | 'QA';

/** Each line is running at the start of the cycle, as it has been since two hours before it. */
const HELD_SINCE_MIN = -120;
const HELD_BY: Role = 'Shift lead';

/** Each line's output at the start of the cycle, against its target; it counts up by one a minute while the line runs. */
const START_QTY = 40;
const TARGET = 100;

const MILK = 'UHT milk 100 ml';
const CHOCOLATE_MILK = 'UHT chocolate milk 100 ml';
const UHT_PACK_ML = 100;

/** A fixed time before any demo, for the rows' created_at. */
const CREATED_AT = '2026-01-05T08:00:00.000Z';

/** A change the script makes to a line, from `atMin` minutes into the cycle until the line's next change. */
interface LineChange {
  atMin: number;
  status: LineStatus;
  by: Role;
  /** The line's note while this change holds; '' without one. */
  note?: string;
  /** The product from this change on. */
  product?: string;
  /** A new lot, started at this change. */
  lot?: string;
  /** While cleaning: when the CIP is planned to end, in minutes into the cycle, and why it runs. */
  cip?: { untilMin: number; reason: string };
}

/** One line of the factory (as e2e/letReportFake.ts's FACTORY lists it), and its part in the script. */
interface DemoLine {
  sort: number;
  name: string;
  type: string;
  uht: string;
  filler: string;
  packsPerH: number | null;
  packMl: number | null;
  product: string;
  /** The lot it runs at the start of the cycle, started this many minutes into it (before it: negative). */
  lot: string;
  lotStartMin: number;
  /** In time order, all within the cycle. */
  changes: readonly LineChange[];
}

/** A trouble the script reports at a place, with its status from each minute mark on; 'closed' takes it off. */
interface DemoTrouble {
  id: string;
  loc: string;
  /** 0 low to 3 critical. */
  sev: number;
  steps: readonly { atMin: number; status: 'open' | 'action' | 'verify' | 'closed' }[];
}

/** The script, line by line, in Let Report's order. The lots running at 0:00 are numbered in the order they started. */
const DEMO_LINES: readonly DemoLine[] = [
  { sort: 1, name: 'UHT-line 1', type: 'UHT', uht: 'UHT 1', filler: 'TFA', packsPerH: 3_600, packMl: UHT_PACK_ML, product: MILK, lot: 'DEMO-02', lotStartMin: -110, changes: [] },
  {
    sort: 2,
    name: 'UHT- line 2',
    type: 'UHT',
    uht: 'UHT 2',
    filler: 'TBA/19',
    packsPerH: 7_500,
    packMl: UHT_PACK_ML,
    product: MILK,
    lot: 'DEMO-04',
    lotStartMin: -95,
    changes: [
      { atMin: 8, status: 'changeover', by: 'Shift lead', product: CHOCOLATE_MILK },
      { atMin: 12, status: 'running', by: 'QA', lot: 'DEMO-09' },
    ],
  },
  { sort: 3, name: 'SCM', type: 'SCM', uht: '', filler: '', packsPerH: null, packMl: null, product: 'Sweetened condensed milk', lot: 'DEMO-03', lotStartMin: -100, changes: [] },
  {
    sort: 4,
    name: 'UHT-line 3',
    type: 'UHT',
    uht: 'UHT 2',
    filler: 'A3/Speed',
    packsPerH: 24_000,
    packMl: UHT_PACK_ML,
    product: MILK,
    lot: 'DEMO-05',
    lotStartMin: -80,
    changes: [
      { atMin: 2, status: 'stopped', by: 'Operator', note: 'Jaws not sealing' },
      { atMin: 6, status: 'running', by: 'Operator' },
    ],
  },
  {
    sort: 5,
    name: 'UHT line 4',
    type: 'UHT',
    uht: 'UHT 2',
    filler: 'A3/Speed',
    packsPerH: 24_000,
    packMl: UHT_PACK_ML,
    product: MILK,
    lot: 'DEMO-06',
    lotStartMin: -65,
    changes: [
      { atMin: 13, status: 'maintenance', by: 'Shift lead' },
      { atMin: 16, status: 'running', by: 'Operator' },
    ],
  },
  { sort: 6, name: 'UHT-line 6', type: 'UHT', uht: 'UHT 1', filler: 'TBA/22', packsPerH: 20_000, packMl: UHT_PACK_ML, product: MILK, lot: 'DEMO-07', lotStartMin: -50, changes: [] },
  {
    sort: 7,
    name: 'UHT-line 7',
    type: 'UHT',
    uht: 'UHT 3',
    filler: 'A3/Speed',
    packsPerH: 24_000,
    packMl: UHT_PACK_ML,
    product: MILK,
    lot: 'DEMO-08',
    lotStartMin: -40,
    changes: [
      { atMin: 4, status: 'cleaning', by: 'Operator', cip: { untilMin: 16, reason: 'standard' } },
      { atMin: 16, status: 'running', by: 'QA', lot: 'DEMO-10' },
    ],
  },
  { sort: 8, name: 'Yogurt', type: 'Yogurt', uht: '', filler: '', packsPerH: null, packMl: null, product: 'Yogurt', lot: 'DEMO-01', lotStartMin: -115, changes: [] },
];

/** UHT-line 3's high trouble while it stops, waiting for verification once it runs again; and UHT-line 1's low one. */
const DEMO_TROUBLES: readonly DemoTrouble[] = [
  {
    id: 'demo-report-1',
    loc: 'UHT-line 3',
    sev: 2,
    steps: [
      { atMin: 2, status: 'open' },
      { atMin: 6, status: 'verify' },
      { atMin: 10, status: 'closed' },
    ],
  },
  { id: 'demo-report-2', loc: 'UHT-line 1', sev: 0, steps: [{ atMin: 17, status: 'open' }] },
];

/** The factory's UHT plants, in their order (D19). */
const UHT_UNITS: readonly { name: string; capacityLph: number }[] = [
  { name: 'UHT 1', capacityLph: 4_000 },
  { name: 'UHT 2', capacityLph: 8_000 },
  { name: 'UHT 3', capacityLph: 4_000 },
];

const SITE_NAME = 'Demo factory';

/** A production_lines row with the columns of Let Report's that the board does not read as well. */
interface DemoLineRow extends LineRow {
  updated_at: string;
  created_at: string;
  current_lot_id: number | null;
}

interface DemoSettingsRow extends SettingsRow {
  id: number;
}

/** When the current cycle began, and how far into it nowMs is (0 for a time before the demo began). */
function cycleAt(startMs: number, nowMs: number): { cycleStartMs: number; intoMs: number } {
  // A time that is not a number reads as the other one, or as the epoch: the demo then stands at 0:00.
  const start = Number.isFinite(startMs) ? startMs : Number.isFinite(nowMs) ? nowMs : 0;
  const now = Number.isFinite(nowMs) ? nowMs : start;
  const elapsedMs = Math.max(0, now - start);
  const cyclesDone = Math.floor(elapsedMs / DEMO_CYCLE_MS);
  return { cycleStartMs: start + cyclesDone * DEMO_CYCLE_MS, intoMs: elapsedMs - cyclesDone * DEMO_CYCLE_MS };
}

/** Whole minutes the line has run in the cycle up to intoMs. */
function runningMin(line: DemoLine, intoMs: number): number {
  const spans = [{ atMin: HELD_SINCE_MIN, status: 'running' as LineStatus }, ...line.changes];
  let runMs = 0;
  spans.forEach((span, index) => {
    if (span.status !== 'running') return;
    const fromMs = Math.max(0, span.atMin * MIN_MS);
    const next = spans[index + 1];
    const toMs = Math.min(intoMs, next ? next.atMin * MIN_MS : Number.POSITIVE_INFINITY);
    if (toMs > fromMs) runMs += toMs - fromMs;
  });
  return Math.floor(runMs / MIN_MS);
}

function lineRow(line: DemoLine, cycleStartMs: number, intoMs: number): DemoLineRow {
  const at = (minutes: number): string => new Date(cycleStartMs + minutes * MIN_MS).toISOString();
  // The changes made by now, the last of them the line's current status.
  const made = line.changes.filter((change) => change.atMin * MIN_MS <= intoMs);
  const last = made.at(-1);
  const sinceMin = last ? last.atMin : HELD_SINCE_MIN;
  const lotChange = made.filter((change) => change.lot !== undefined).at(-1);
  const cip = last?.status === 'cleaning' && last.cip ? { fromMin: last.atMin, ...last.cip } : null;
  return {
    id: `demo-line-${line.sort}`,
    name: line.name,
    type: line.type,
    product: made.filter((change) => change.product !== undefined).at(-1)?.product ?? line.product,
    qty: START_QTY + runningMin(line, intoMs),
    target: TARGET,
    status: last ? last.status : 'running',
    note: last?.note ?? '',
    sort: line.sort,
    status_since: at(sinceMin),
    updated_by_name: last ? last.by : HELD_BY,
    updated_at: at(sinceMin),
    created_at: CREATED_AT,
    lot: lotChange?.lot ?? line.lot,
    lot_started_at: at(lotChange ? lotChange.atMin : line.lotStartMin),
    cip_until: cip ? at(cip.untilMin) : null,
    cip_reason: cip ? cip.reason : '',
    cip_started_at: cip ? at(cip.fromMin) : null,
    current_lot_id: null,
    uht: line.uht,
    filler: line.filler,
    filler_packs_per_h: line.packsPerH,
    pack_ml: line.packMl,
  };
}

/** The troubles reported by now and not closed, as the board reads them (status=neq.closed). */
function openReports(intoMs: number): ReportRow[] {
  const reports: ReportRow[] = [];
  for (const trouble of DEMO_TROUBLES) {
    const step = trouble.steps.filter((candidate) => candidate.atMin * MIN_MS <= intoMs).at(-1);
    if (step && step.status !== 'closed') reports.push({ id: trouble.id, loc: trouble.loc, sev: trouble.sev, status: step.status });
  }
  return reports;
}

export const demoFactory: DemoFactory = (startMs: number, nowMs: number): FactoryData => {
  const { cycleStartMs, intoMs } = cycleAt(startMs, nowMs);
  const settings: DemoSettingsRow = {
    id: 1,
    site_name: SITE_NAME,
    uht_units: UHT_UNITS.map((unit) => ({ ...unit })),
  };
  return {
    lines: DEMO_LINES.map((line) => lineRow(line, cycleStartMs, intoMs)),
    settings,
    reports: openReports(intoMs),
  };
};
