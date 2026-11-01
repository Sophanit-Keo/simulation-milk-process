// Phase 11 (D21): what a line's label on the factory floor adds to the board's words (board.ts) about the line's
// story: for how long it has been stopped, in maintenance or changing over, and, in its tooltip, its note and who
// changed it last. No DOM, so Vitest checks the words in Node; scene.ts writes them into the labels.
import { formatDuration } from '../../ui/format';
import type { LineStatus, LineView } from '../view';

/**
 * The statuses a label gives a clock: a CIP already says its time left, and a running or idle line needs none.
 */
const CLOCKED_STATUSES: ReadonlySet<LineStatus> = new Set<LineStatus>(['stopped', 'maintenance', 'changeover']);

/** A clock shows once the line has been in its status this long, so a line that has only just stopped says just that. */
export const STATUS_CLOCK_MIN_S = 60;

/**
 * A line's status as its label says it: "Stopped · 12 min" for a line stopped, in maintenance or changing over
 * for a minute or more; otherwise its status text as the board words it ("Running", "CIP · 1 h 10 min left").
 */
export function lineStatusText(line: Pick<LineView, 'status' | 'statusText' | 'statusForS'>): string {
  const forS = line.statusForS;
  if (!CLOCKED_STATUSES.has(line.status) || forS === null || !Number.isFinite(forS) || forS < STATUS_CLOCK_MIN_S) return line.statusText;
  return `${line.statusText} · ${formatDuration(forS)}`;
}

/**
 * A line's label's tooltip: its words (as its aria-label), then its note and who changed it last, each on a line
 * of its own, when Let Report has them.
 */
export function lineTitleText(words: string, line: Pick<LineView, 'note' | 'changedBy'>): string {
  return [words, line.note ? `Note: ${line.note}` : '', line.changedBy ? `Changed by ${line.changedBy}` : ''].filter(Boolean).join('\n');
}
