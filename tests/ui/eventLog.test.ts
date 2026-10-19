// The event log's bookkeeping (src/ui/eventLog.ts): which entries are new, so the live region gets only
// those, and a lamp and words for every kind.
import { describe, expect, it } from 'vitest';
import type { LogEntry, LogKind } from '../../src/contracts';
import { createLog, LOG_LIMIT } from '../../src/sim/log';
import { LOG_KIND_TEXT, LOG_LAMP, LOG_SHOWN, newEntryCount } from '../../src/ui/eventLog';

const entry = (timeS: number, message = `at ${timeS}`, kind: LogKind = 'info'): LogEntry => ({ timeS, kind, message });

/** The sim's own log, so the tests follow its order and cap. */
function simLog(count: number): { add(n: number): void; entries(): LogEntry[] } {
  const log = createLog();
  let next = 0;
  const add = (n: number) => {
    for (let i = 0; i < n; i++, next++) log.add(next * 60, i % 2 ? 'warn' : 'info', `entry ${next}`);
  };
  add(count);
  return { add, entries: () => log.entries().slice(0, LOG_SHOWN) };
}

describe('newEntryCount', () => {
  it('counts everything as new on the first look', () => {
    expect(newEntryCount([], [entry(2), entry(1)])).toBe(2);
    expect(newEntryCount([], [])).toBe(0);
  });

  it('finds nothing new when the log has not changed', () => {
    const log = simLog(5);
    expect(newEntryCount(log.entries(), log.entries())).toBe(0);
  });

  it('counts the entries the sim put in front since the last look', () => {
    const log = simLog(5);
    const shown = log.entries();
    log.add(3);
    expect(newEntryCount(shown, log.entries())).toBe(3);
  });

  it('still counts them once the list is full and old entries fall off the end', () => {
    const log = simLog(LOG_LIMIT + 10);
    const shown = log.entries();
    expect(shown).toHaveLength(LOG_SHOWN);
    log.add(4);
    expect(newEntryCount(shown, log.entries())).toBe(4);
  });

  it('tells two entries with the same message apart by their time', () => {
    const shown = [entry(60, 'Shift change'), entry(0, 'Plant opens')];
    expect(newEntryCount(shown, [entry(120, 'Shift change'), ...shown])).toBe(1);
  });

  it('gives up (null: redraw all) when the new list does not continue the shown one', () => {
    expect(newEntryCount([entry(5), entry(4)], [entry(2), entry(1)])).toBeNull();
    // More new entries than the screen holds: nothing of the shown list is left.
    const log = simLog(3);
    const shown = log.entries();
    log.add(LOG_SHOWN + 1);
    expect(newEntryCount(shown, log.entries())).toBeNull();
  });

  it('shows fewer entries than the sim keeps', () => {
    expect(LOG_SHOWN).toBeLessThanOrEqual(LOG_LIMIT);
  });
});

describe('log lamps', () => {
  it('lights each kind in the plan 08 colours, a plain note as the unlit ring', () => {
    expect(LOG_LAMP).toEqual({ info: 'idle', ok: 'ok', warn: 'warn', bad: 'bad' });
  });

  it('names every kind in words, each differently, so colour is never the only cue', () => {
    const words = Object.values(LOG_KIND_TEXT);
    expect(Object.keys(LOG_KIND_TEXT).sort()).toEqual(['bad', 'info', 'ok', 'warn']);
    expect(new Set(words).size).toBe(words.length);
  });
});
