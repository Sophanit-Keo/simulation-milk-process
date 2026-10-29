// Phase 9: the Factory board's view of what Let Report holds (D19), built afresh from each read. Each UHT
// with its lines, what they draw from it, its load, state and lamp; each line's lamp, words, CIP and lot
// clocks and open troubles; the UHT lines no UHT claims. Pure and headless: the time comes in as nowMs, and
// tsconfig.headless.json checks this file without the DOM. The rules are the comments in types.ts.
//
// The rows come from Let Report's REST API as JSON, so nothing here trusts their types: a column an older
// database lacks, a null speed, a status this board does not know or a date that does not parse each fall
// back to what types.ts says the board shows without it.
import type { Status } from '../contracts';
import { formatDuration, formatNumber } from '../ui/format';
import {
  LINE_STATUSES,
  type BuildFactory,
  type FactoryData,
  type FactoryView,
  type LineStatus,
  type LineView,
  type UhtState,
  type UhtView,
} from './view';

const LINE_LAMPS: Readonly<Record<LineStatus, Status>> = {
  running: 'ok',
  stopped: 'bad',
  maintenance: 'bad',
  changeover: 'warn',
  cleaning: 'idle',
  idle: 'idle',
};

/** A line's words for each status but cleaning, whose words carry the CIP clock. */
const STATUS_TEXT: Readonly<Record<Exclude<LineStatus, 'cleaning'>, string>> = {
  running: 'Running',
  stopped: 'Stopped',
  maintenance: 'Maintenance',
  changeover: 'Changeover',
  idle: 'Idle',
};

const UHT_LAMPS: Readonly<Record<UhtState, Status>> = { producing: 'ok', cip: 'idle', stopped: 'bad' };

/** A JSON row: any column may be missing or of another type. */
type Row = Readonly<Record<string, unknown>>;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(isRow) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
/** What two names are compared by: trimmed, in any case ("UHT 2" is " uht 2 "). */
const nameKey = (value: unknown): string => text(value).trim().toLowerCase();
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = (value: number | null): value is number => value !== null && value > 0;

const MS_PER_S = 1_000;
const ML_PER_L = 1_000;

// A date and time with no zone: read as UTC, so the clocks do not depend on the machine's time zone.
// Let Report's timestamptz columns always carry one; this only guards a hand-made row.
const NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** An ISO time as ms since the epoch; null when it is missing or does not parse. */
function timeMs(value: unknown): number | null {
  const iso = text(value).trim();
  if (iso === '') return null;
  const ms = Date.parse(NO_ZONE.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso);
  return Number.isFinite(ms) ? ms : null;
}

function lineStatus(value: unknown): LineStatus {
  const status = nameKey(value);
  return (LINE_STATUSES as readonly string[]).includes(status) ? (status as LineStatus) : 'idle';
}

// Names with numbers in them sort as people read them ("UHT line 9" before "UHT line 10"), in a fixed
// locale so every machine agrees.
const byName = new Intl.Collator('en', { numeric: true });

/** Let Report's order: by `sort` (a line without one last), then by name. */
function byLetReportOrder(a: { sort: number | null; view: LineView }, b: { sort: number | null; view: LineView }): number {
  if (a.sort !== b.sort) {
    if (a.sort === null) return 1;
    if (b.sort === null) return -1;
    return a.sort - b.sort;
  }
  return byName.compare(a.view.name, b.view.name);
}

/** The severities of the reports that are not closed, by the place they are at (nameKey of `loc`). */
function openTroublesByPlace(reports: Row[]): Map<string, number[]> {
  const byPlace = new Map<string, number[]>();
  for (const report of reports) {
    const place = nameKey(report.loc);
    if (place === '' || nameKey(report.status) === 'closed') continue;
    const sevs = byPlace.get(place) ?? [];
    // A severity that is not a number still counts the trouble, as the lowest.
    sevs.push(finite(report.sev) ?? 0);
    byPlace.set(place, sevs);
  }
  return byPlace;
}

function buildLine(row: Row, troubles: Map<string, number[]>, nowMs: number | null): LineView {
  const name = text(row.name);
  const status = lineStatus(row.status);
  const packsPerH = finite(row.filler_packs_per_h);
  const packMl = finite(row.pack_ml);
  const ratedLph = positive(packsPerH) && positive(packMl) ? (packsPerH * packMl) / ML_PER_L : null;

  // Whole seconds: the CIP's left rounds up (it reads "1 s left" until it is overdue), the lot's run down.
  const cipUntilMs = status === 'cleaning' ? timeMs(row.cip_until) : null;
  const cipLeftS = cipUntilMs === null || nowMs === null ? null : Math.max(0, Math.ceil((cipUntilMs - nowMs) / MS_PER_S));
  const lot = text(row.lot);
  const lotStartMs = lot.trim() !== '' ? timeMs(row.lot_started_at) : null;
  // A start in the future (a clock ahead of this one) reads 0.
  const lotRunS = lotStartMs === null || nowMs === null ? null : Math.max(0, Math.floor((nowMs - lotStartMs) / MS_PER_S));

  // A blank name matches no report: openTroublesByPlace keeps none at ''.
  const sevs = troubles.get(nameKey(name)) ?? [];
  return {
    id: typeof row.id === 'number' ? String(row.id) : text(row.id),
    name,
    filler: text(row.filler),
    packsPerH,
    packMl,
    ratedLph,
    drawLph: status === 'running' ? (ratedLph ?? 0) : 0,
    status,
    lamp: LINE_LAMPS[status],
    statusText:
      status !== 'cleaning'
        ? STATUS_TEXT[status]
        : cipLeftS === null
          ? 'CIP'
          : cipLeftS > 0
            ? `CIP · ${formatDuration(cipLeftS)} left`
            : 'CIP · overdue',
    product: text(row.product),
    lot,
    lotRunS,
    cipLeftS,
    qty: finite(row.qty) ?? 0,
    target: finite(row.target) ?? 0,
    openTroubles: sevs.length,
    worstSev: sevs.length > 0 ? Math.max(...sevs) : null,
  };
}

/** The UHTs as `uht_units` lists them: an entry needs a name; a capacity that is not a number reads 0. */
function uhtUnits(settings: unknown): { name: string; capacityLph: number }[] {
  const units = isRow(settings) ? settings.uht_units : undefined;
  return rows(units)
    .filter((unit) => text(unit.name).trim() !== '')
    .map((unit) => ({ name: text(unit.name), capacityLph: finite(unit.capacityLph) ?? 0 }));
}

function buildUht(unit: { name: string; capacityLph: number }, lines: LineView[]): UhtView {
  const { name, capacityLph } = unit;
  const drawLph = lines.reduce((sum, line) => sum + line.drawLph, 0);
  const hasCapacity = capacityLph > 0;
  const overCapacity = hasCapacity && drawLph > capacityLph;
  const state: UhtState = lines.some((line) => line.status === 'running')
    ? 'producing'
    : lines.length > 0 && lines.every((line) => line.status === 'cleaning')
      ? 'cip'
      : 'stopped';
  const lamp: Status = state === 'producing' && overCapacity ? 'warn' : lines.length === 0 ? 'idle' : UHT_LAMPS[state];
  const stateText =
    state === 'producing'
      ? `Producing · ${formatNumber(drawLph)}${hasCapacity ? ` of ${formatNumber(capacityLph)}` : ''} L/h`
      : state === 'cip'
        ? 'CIP'
        : lines.length > 0
          ? 'Stopped'
          : 'No lines';
  return {
    name,
    capacityLph,
    drawLph,
    // × 100 first: 5,550 of 8,000 reads exactly 69.375.
    loadPct: hasCapacity ? (drawLph * 100) / capacityLph : 0,
    overCapacity,
    state,
    lamp,
    stateText,
    lines,
  };
}

export const buildFactory: BuildFactory = (data: FactoryData, nowMs: number): FactoryView => {
  // Typed, but read as JSON all the same.
  const input: unknown = data;
  const source: Row = isRow(input) ? input : {};
  const settings = isRow(source.settings) ? source.settings : null;
  // A clock that is not a number shows no CIP or lot clock.
  const clockMs = Number.isFinite(nowMs) ? nowMs : null;
  const troubles = openTroublesByPlace(rows(source.reports));

  const lines = rows(source.lines)
    .map((row) => ({ row, sort: finite(row.sort), view: buildLine(row, troubles, clockMs) }))
    .sort(byLetReportOrder);

  const units = uhtUnits(settings);
  // Each UHT by its name; of two with the same name, the first takes the lines.
  const unitIndex = new Map<string, number>();
  units.forEach((unit, index) => {
    if (!unitIndex.has(nameKey(unit.name))) unitIndex.set(nameKey(unit.name), index);
  });
  const linesOf: LineView[][] = units.map(() => []);
  const unassigned: LineView[] = [];
  for (const { row, view } of lines) {
    const index = unitIndex.get(nameKey(row.uht));
    if (index !== undefined) linesOf[index].push(view);
    else if (nameKey(row.type) === 'uht') unassigned.push(view);
  }

  const uhts = units.map((unit, index) => buildUht(unit, linesOf[index]));
  const onBoard = [...uhts.flatMap((uht) => uht.lines), ...unassigned];
  return {
    siteName: settings ? text(settings.site_name).trim() : '',
    uhts,
    unassigned,
    runningLines: onBoard.filter((line) => line.status === 'running').length,
    totalDrawLph: onBoard.reduce((sum, line) => sum + line.drawLph, 0),
  };
};
