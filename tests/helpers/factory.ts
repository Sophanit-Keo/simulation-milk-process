// The real factory as Let Report holds it since its migration 0013 (D19), for the floor's tests (phase 10):
// three UHTs, six filling lines (no line 5), all running at 100 ml, and the SCM and Yogurt lines the board
// leaves out. The same rows as tests/factory/model.test.ts's main fixture.
import { buildFactory } from '../../src/factory/model';
import type { FactoryData, FactoryView, LineRow, SettingsRow } from '../../src/factory/types';

export const NOW_MS = Date.parse('2026-10-29T08:00:00Z');

/** A filling line on a UHT, running at 100 ml. */
export function uhtLine(name: string, sort: number, uht: string, filler: string, packsPerH: number): LineRow {
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

function otherLine(name: string, sort: number, type: string): LineRow {
  return { ...uhtLine(name, sort, '', '', 0), type, filler_packs_per_h: null, pack_ml: null, product: name };
}

export const LINES: readonly LineRow[] = [
  uhtLine('UHT-line 1', 1, 'UHT 1', 'TFA', 3_600),
  uhtLine('UHT- line 2', 2, 'UHT 2', 'TBA/19', 7_500),
  uhtLine('UHT-line 3', 3, 'UHT 2', 'A3/Speed', 24_000),
  uhtLine('UHT line 4', 4, 'UHT 2', 'A3/Speed', 24_000),
  uhtLine('UHT-line 6', 6, 'UHT 1', 'TBA/22', 20_000),
  uhtLine('UHT-line 7', 7, 'UHT 3', 'A3/Speed', 24_000),
  otherLine('SCM', 8, 'SCM'),
  otherLine('Yogurt', 9, 'Yogurt'),
];

export const SETTINGS: SettingsRow = {
  site_name: 'Main plant',
  uht_units: [
    { name: 'UHT 1', capacityLph: 4_000 },
    { name: 'UHT 2', capacityLph: 8_000 },
    { name: 'UHT 3', capacityLph: 4_000 },
  ],
};

/** The board's view of the factory, with whatever `data` replaces. */
export function factoryView(data: Partial<FactoryData> = {}, nowMs = NOW_MS): FactoryView {
  return buildFactory({ lines: [...LINES], settings: SETTINGS, reports: [], ...data }, nowMs);
}

/** The factory's lines with one changed. */
export function withLine(name: string, patch: Partial<LineRow>): LineRow[] {
  return LINES.map((line) => (line.name === name ? { ...line, ...patch } : line));
}
