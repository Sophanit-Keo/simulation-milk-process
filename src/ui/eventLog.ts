import type { LogEntry, LogKind, Snapshot, Status } from '../contracts';
import { el } from './dom';
import { formatSimTime } from './format';

/** Entries on screen at most; the sim keeps more (src/sim/log.ts), the newest first. */
export const LOG_SHOWN = 20;

/** Each kind's lamp, in the plan 08 colours; a plain note is the hollow idle ring. */
export const LOG_LAMP: Readonly<Record<LogKind, Status>> = { info: 'idle', ok: 'ok', warn: 'warn', bad: 'bad' };

/** Each kind in words, for screen readers and tooltips, so the colour is never the only cue. */
export const LOG_KIND_TEXT: Readonly<Record<LogKind, string>> = { info: 'Note', ok: 'Back to normal', warn: 'Warning', bad: 'Alarm' };

const sameEntry = (a: LogEntry, b: LogEntry): boolean => a.timeS === b.timeS && a.kind === b.kind && a.message === b.message;

/**
 * How many entries at the top of `next` are new since `shown` (both newest first): `next` is `shown` with
 * that many put in front, its tail cut to the sim's cap. Null if `next` doesn't continue `shown` that way
 * (a new sim, or more new entries than the sim keeps), so the whole list has to be redrawn.
 */
export function newEntryCount(shown: readonly LogEntry[], next: readonly LogEntry[]): number | null {
  if (shown.length === 0) return next.length;
  for (let added = 0; added < next.length; added++) {
    const overlap = Math.min(shown.length, next.length - added);
    let matches = true;
    for (let i = 0; i < overlap && matches; i++) matches = sameEntry(next[added + i], shown[i]);
    if (matches) return added;
  }
  return null;
}

export interface EventLog {
  update(snapshot: Snapshot): void;
  dispose(): void;
}

/**
 * The event log (#log, "What happened"): the snapshot's log entries, newest first, each with its sim
 * time and a lamp for its kind. The list is a polite live region (role="log"), so new entries are put in
 * front of the old ones rather than redrawn with them, and a screen reader reads only what is new. The
 * card has a fixed place and size in the layout (app.css); the list scrolls inside it and keeps LOG_SHOWN
 * entries, so a busy run never moves anything else on screen.
 */
export function createEventLog(root: HTMLElement): EventLog {
  const list = root.querySelector<HTMLOListElement>('ol.log') ?? root.appendChild(el('ol', 'log'));
  const original = [...list.childNodes];
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  list.dataset.testid = 'event-log';
  list.replaceChildren();
  let shown: LogEntry[] = [];

  function item(entry: LogEntry): HTMLLIElement {
    const li = el('li', 'log-entry');
    li.dataset.kind = entry.kind;
    const lamp = el('span', 'lamp');
    lamp.dataset.status = LOG_LAMP[entry.kind];
    lamp.setAttribute('role', 'img');
    lamp.setAttribute('aria-label', LOG_KIND_TEXT[entry.kind]);
    const time = el('time', '', formatSimTime(entry.timeS));
    if (entry.timeS >= 0) time.dateTime = `PT${Math.floor(entry.timeS)}S`;
    // Spaces keep "Warning day 1 · 06:00 UHT plant throttled" apart in the item's text; the grid ignores them.
    li.append(lamp, ' ', time, ' ', el('span', 'log-text', entry.message));
    // What a fault scenario caused says why (contracts v4); the scenario log shows it in full.
    if (entry.why) li.title = entry.why;
    return li;
  }

  return {
    update(snapshot) {
      const next = snapshot.log.slice(0, LOG_SHOWN);
      const added = newEntryCount(shown, next);
      if (added === 0) return;
      if (added === null) list.replaceChildren(...next.map(item));
      else {
        list.prepend(...next.slice(0, added).map(item));
        while (list.children.length > LOG_SHOWN) list.lastElementChild?.remove();
      }
      shown = next;
    },
    dispose() {
      list.replaceChildren(...original);
    },
  };
}
