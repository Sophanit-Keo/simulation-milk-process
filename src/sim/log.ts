// The event log the UI shows, newest first and capped so a long run at ×10,000 stays small.
import { SECONDS_PER_DAY, SECONDS_PER_HOUR, sToDay, sToH, sToMin, type LogEntry, type LogKind } from '../contracts';

export const LOG_LIMIT = 50;

export interface SimLog {
  add(timeS: number, kind: LogKind, message: string): void;
  /** Fresh copies, newest first, so a snapshot can't change the log it came from. */
  entries(): LogEntry[];
}

export function createLog(limit = LOG_LIMIT): SimLog {
  const entries: LogEntry[] = [];
  return {
    add(timeS, kind, message) {
      entries.unshift({ timeS, kind, message });
      if (entries.length > limit) entries.length = limit;
    },
    entries: () => entries.map((entry) => ({ ...entry })),
  };
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** "day 1, 06:00" for sim time in seconds since day 1, 00:00. */
export function formatDayTime(timeS: number): string {
  const day = Math.floor(sToDay(timeS)) + 1;
  const hours = Math.floor(sToH(timeS % SECONDS_PER_DAY));
  const minutes = Math.floor(sToMin(timeS % SECONDS_PER_HOUR));
  return `day ${day}, ${pad2(hours)}:${pad2(minutes)}`;
}
