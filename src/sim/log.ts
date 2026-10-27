// The event log the UI shows, newest first and capped so a long run at ×10,000 stays small.
import { SECONDS_PER_DAY, SECONDS_PER_HOUR, sToDay, sToH, sToMin, type BatchFlag, type LogEntry, type LogKind, type ScenarioId } from '../contracts';

export const LOG_LIMIT = 50;

/** What a model's log entry is about, so a scenario can claim the plant's reactions it caused (phase 5). */
export type LogTopic =
  | 'divert'
  | 'cipStart'
  | 'sterilizeStart'
  | 'productionResumed'
  | 'aicStart'
  | 'aicDone'
  | 'throttled'
  | 'unthrottled'
  | 'fillersStarved'
  | 'fillersFed'
  | 'fillerDown'
  | 'fillerRepaired'
  | 'fillerSterile'
  | 'batchClosed'
  | 'batchFlagged'
  | 'batchReleased'
  | 'batchBlocked'
  | 'batchDestroyed'
  | 'truckDocked'
  | 'truckWaiting'
  | 'truckYard'
  | 'truckGotLoad'
  | 'truckLeft'
  | 'trucksArrived'
  | 'scenario';

export interface LogTag {
  topic: LogTopic;
  /** The filler, batch or truck the entry concerns, if one. */
  filler?: number;
  batchId?: number;
  truckId?: number;
  /** A batch's investigation (batchFlagged), and why a truck came: 'regular', 'extra' or 'late'. */
  flag?: BatchFlag;
  origin?: string;
  /** A scenario's own entry: which run, and why (topic 'scenario'). */
  scenario?: ScenarioId;
  run?: number;
  why?: string;
}

/** How the models write to the log: the entry, and what it is about. */
export type LogWriter = (timeS: number, kind: LogKind, message: string, tag?: LogTag) => void;

export interface SimLog {
  add(timeS: number, kind: LogKind, message: string, note?: Pick<LogEntry, 'scenario' | 'why'>): LogEntry;
  /** Fresh copies, newest first, so a snapshot can't change the log it came from. */
  entries(): LogEntry[];
}

export function createLog(limit = LOG_LIMIT): SimLog {
  const entries: LogEntry[] = [];
  return {
    add(timeS, kind, message, note) {
      const entry: LogEntry = { timeS, kind, message };
      if (note?.scenario) entry.scenario = note.scenario;
      if (note?.why) entry.why = note.why;
      entries.unshift(entry);
      if (entries.length > limit) entries.length = limit;
      return { ...entry };
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
