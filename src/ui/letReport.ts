// Let Report (https://let-report.vercel.app), the QC/QA trouble-report app: a fault scenario's banner and its
// section of the scenario log link to Let Report's new-report form, filled in with what the fault would be
// reported as (D18). The link only opens the form; a person signs in, signs and sends the report there, so
// the simulation never writes to Let Report itself. Everything travels in the address's hash, which Let Report
// reads and clears, and which never reaches a server.
import type { ScenarioId, ScenarioRunSnapshot } from '../contracts';
import letReportJson from '../data/letReport.json';
import { formatSimTime } from './format';
import { SCENARIO_MENU, scenarioName } from './scenarioMenu';

/** Let Report's address, from src/data/letReport.json, which also names its database for the Factory board. */
export const LET_REPORT_URL: string = letReportJson.appUrl;

/** Let Report's categories, as its links name them. */
export type LetReportCat = 'temperature' | 'hygiene' | 'foreign' | 'pest' | 'equipment' | 'allergen' | 'labelling' | 'cleaning' | 'custom';

/** Let Report's severities: 0 low, 1 medium, 2 high, 3 critical. */
export type LetReportSev = 0 | 1 | 2 | 3;

export interface LetReportFields {
  cat: LetReportCat;
  sev: LetReportSev;
  /** Hold the product made while the fault acted. */
  hold: boolean;
  /** The report's title, for the 'custom' category only (the others take Let Report's own). */
  title?: string;
  /** One of Let Report's places; without it, Let Report takes its first UHT line. */
  loc?: string;
}

/** What each fault is reported as (D18). The demand spike and late trucks are logistics, not food safety: no report. */
export const LET_REPORT: Readonly<Record<ScenarioId, LetReportFields | null>> = {
  uhtTempDrop: { cat: 'temperature', sev: 2, hold: false },
  fillerBreakdown: { cat: 'equipment', sev: 1, hold: false },
  sterileAirFilterFailure: { cat: 'equipment', sev: 2, hold: true },
  failedIncubation: { cat: 'custom', sev: 3, hold: true, title: 'Failed incubation: blown pack', loc: 'Packing' },
  homogenizerPressureLoss: { cat: 'equipment', sev: 1, hold: false },
  demandSpikeOrLateTruck: null,
};

/** The product type every report from the plant carries: Let Report's name for it. */
export const LET_REPORT_PTYPE = 'UHT milk';

/** The longest description a link carries, ellipsis included; Let Report cuts at the same length. */
export const LET_REPORT_DESC_MAX = 800;

type ReportedRun = Pick<ScenarioRunSnapshot, 'run' | 'id' | 'variant' | 'startedS' | 'log'>;

/**
 * The report's description: the scenario, when it started, what it is, and its log so far, oldest first, e.g.
 * "From the UHT milk plant simulation: UHT temperature drop, run 1, started day 8 · 06:00. Steam dips: … What
 * happened: day 8 · 06:00 Steam supply dips: …; day 8 · 06:00 UHT outlet below the divert limit: …".
 */
export function letReportDesc(run: ReportedRun): string {
  const item = SCENARIO_MENU.find((entry) => entry.id === run.id && (entry.variant ?? null) === (run.variant ?? null));
  const happened = run.log.map((entry) => `${formatSimTime(entry.timeS)} ${entry.message}`).join('; ');
  const text = [
    `From the UHT milk plant simulation: ${scenarioName(run.id, run.variant)}, run ${run.run}, started ${formatSimTime(run.startedS)}.`,
    item?.description ?? '',
    happened ? `What happened: ${happened}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return text.length <= LET_REPORT_DESC_MAX ? text : `${text.slice(0, LET_REPORT_DESC_MAX - 1).trimEnd()}…`;
}

/** The link that opens Let Report's new-report form filled in for this run, or null for a fault it doesn't report. */
export function letReportHref(run: ReportedRun): string | null {
  const fields = LET_REPORT[run.id];
  if (!fields) return null;
  const params = new URLSearchParams({ cat: fields.cat, sev: String(fields.sev), ptype: LET_REPORT_PTYPE });
  if (fields.title) params.set('title', fields.title);
  if (fields.loc) params.set('loc', fields.loc);
  if (fields.hold) params.set('hold', '1');
  params.set('desc', letReportDesc(run));
  return `${LET_REPORT_URL}#new?${params.toString()}`;
}
