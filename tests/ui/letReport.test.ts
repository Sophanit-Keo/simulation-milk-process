// The link to Let Report's new-report form (src/ui/letReport.ts, D18): what each fault is reported as, the
// description it carries, and that the address reads back exactly what was put in.
import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS, type LogEntry, type ScenarioId, type ScenarioRunSnapshot, type ScenarioVariant } from '../../src/contracts';
import { LET_REPORT, LET_REPORT_DESC_MAX, LET_REPORT_URL, letReportDesc, letReportHref } from '../../src/ui/letReport';

const DAY_8_0600_S = 7 * 86_400 + 6 * 3_600;

const run = (id: ScenarioId, log: LogEntry[] = [], variant: ScenarioVariant | null = null): ScenarioRunSnapshot => ({
  run: 2,
  id,
  variant,
  startedS: DAY_8_0600_S,
  endedS: null,
  following: true,
  summary: '',
  log,
});

/** The fields a link carries, as Let Report reads them back. */
function fields(href: string | null): Record<string, string> {
  expect(href).not.toBeNull();
  const prefix = `${LET_REPORT_URL}#new?`;
  expect(href?.startsWith(prefix)).toBe(true);
  return Object.fromEntries(new URLSearchParams(href?.slice(prefix.length)));
}

describe('the link to Let Report', () => {
  it('reports each fault with its category, severity and hold (D18), as UHT milk', () => {
    const reported = Object.fromEntries(
      SCENARIO_IDS.filter((id) => LET_REPORT[id]).map((id) => {
        const { cat, sev, hold, title, loc } = fields(letReportHref(run(id)));
        return [id, { cat, sev, hold, title, loc }];
      }),
    );
    expect(reported).toEqual({
      uhtTempDrop: { cat: 'temperature', sev: '2', hold: undefined, title: undefined, loc: undefined },
      fillerBreakdown: { cat: 'equipment', sev: '1', hold: undefined, title: undefined, loc: undefined },
      sterileAirFilterFailure: { cat: 'equipment', sev: '2', hold: '1', title: undefined, loc: undefined },
      failedIncubation: { cat: 'custom', sev: '3', hold: '1', title: 'Failed incubation: blown pack', loc: 'Packing' },
      homogenizerPressureLoss: { cat: 'equipment', sev: '1', hold: undefined, title: undefined, loc: undefined },
    });
    for (const id of Object.keys(reported) as ScenarioId[]) expect(fields(letReportHref(run(id))).ptype).toBe('UHT milk');
  });

  it('has no link for the demand spike or late trucks: logistics, not food safety', () => {
    expect(letReportHref(run('demandSpikeOrLateTruck', [], 'demandSpike'))).toBeNull();
    expect(letReportHref(run('demandSpikeOrLateTruck', [], 'lateTrucks'))).toBeNull();
  });

  it('carries only the fields Let Report reads', () => {
    expect(Object.keys(fields(letReportHref(run('uhtTempDrop'))))).toEqual(['cat', 'sev', 'ptype', 'desc']);
    expect(Object.keys(fields(letReportHref(run('failedIncubation'))))).toEqual(['cat', 'sev', 'ptype', 'title', 'loc', 'hold', 'desc']);
  });
});

describe('the report’s description', () => {
  it('names the scenario, its run and start, says what it is, then its log oldest first', () => {
    const log: LogEntry[] = [
      { timeS: DAY_8_0600_S, kind: 'warn', message: 'Steam supply dips: the UHT outlet falls toward 135.5 °C', scenario: 'uhtTempDrop' },
      { timeS: DAY_8_0600_S + 180, kind: 'info', message: 'Full CIP started after the divert: 80 min', scenario: 'uhtTempDrop' },
    ];
    expect(letReportDesc(run('uhtTempDrop', log))).toBe(
      'From the UHT milk plant simulation: UHT temperature drop, run 2, started day 8 · 06:00. ' +
        'Steam dips: the plant diverts, cleans and re-sterilizes for 113 min while the fillers drain the tank. ' +
        'What happened: day 8 · 06:00 Steam supply dips: the UHT outlet falls toward 135.5 °C; day 8 · 06:03 Full CIP started after the divert: 80 min.',
    );
  });

  it('says nothing of what happened before the log has an entry', () => {
    expect(letReportDesc(run('fillerBreakdown'))).not.toContain('What happened');
  });

  it(`stops at ${LET_REPORT_DESC_MAX} characters, with an ellipsis`, () => {
    const log = Array.from({ length: 40 }, (_, i): LogEntry => ({ timeS: DAY_8_0600_S + i * 300, kind: 'info', message: `Truck ${i + 1} waiting in the yard` }));
    const desc = letReportDesc(run('fillerBreakdown', log));
    expect(desc).toHaveLength(LET_REPORT_DESC_MAX);
    expect(desc.endsWith('…')).toBe(true);
    expect(fields(letReportHref(run('fillerBreakdown', log))).desc).toBe(desc);
  });

  it('reads back exactly, whatever the log says: & # + % = and line breaks', () => {
    const log: LogEntry[] = [{ timeS: DAY_8_0600_S, kind: 'bad', message: 'A & B #2 + 5% = odd\nnext line' }];
    expect(fields(letReportHref(run('homogenizerPressureLoss', log))).desc).toBe(letReportDesc(run('homogenizerPressureLoss', log)));
  });
});
