// The UHT line's part of a recorded snapshot (phase 15, D25): everything but what contracts v8 added for the
// yogurt line (Snapshot.yogurt, stages 11–16 and the yogurt line points) and the version number itself. Its
// fingerprint is the same at v8 as at v7, which shows the yogurt line changed nothing in the UHT line's numbers. Since v12
// the yogurt line's scenarios are left out too: their runs, and their entries in `scenarios.unavailable`.
import { createHash } from 'node:crypto';
import { YOGURT_LINE_POINT_IDS, YOGURT_SCENARIO_IDS, YOGURT_STAGE_IDS } from '../../src/contracts';

/** JSON with every object's keys sorted, so the fingerprint depends on the values alone. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The snapshot without its version and without what the yogurt line added: its part, stages, points and log entries. */
export function uhtPart(snapshot: unknown): Record<string, unknown> {
  const { version: _version, yogurt: _yogurt, ...rest } = snapshot as Record<string, unknown>;
  // Since contracts v9 the yogurt line logs too; its entries say so (LogEntry.line).
  if (Array.isArray(rest.log)) rest.log = (rest.log as { line?: string }[]).filter((entry) => entry.line !== 'yogurt');
  const stages = { ...(rest.stages as Record<string, unknown>) };
  for (const id of YOGURT_STAGE_IDS) delete stages[id];
  const line = { ...(rest.line as Record<string, unknown>) };
  for (const id of YOGURT_LINE_POINT_IDS) delete line[id];
  // Since contracts v12 the yogurt line has scenarios too: what says why they cannot start is theirs.
  if (rest.scenarios && typeof rest.scenarios === 'object') {
    const scenarios = { ...(rest.scenarios as Record<string, unknown>) };
    const unavailable = { ...(scenarios.unavailable as Record<string, unknown>) };
    for (const id of YOGURT_SCENARIO_IDS) delete unavailable[id];
    const runs = Array.isArray(scenarios.runs) ? (scenarios.runs as { id: string }[]).filter((run) => !(YOGURT_SCENARIO_IDS as readonly string[]).includes(run.id)) : scenarios.runs;
    rest.scenarios = { ...scenarios, runs, unavailable };
  }
  return { ...rest, stages, line };
}

/** SHA-256 of the UHT part, as hex. */
export const uhtFingerprint = (snapshot: unknown): string => createHash('sha256').update(canonical(uhtPart(snapshot))).digest('hex');
