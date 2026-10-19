import { hToS, minToS, type Snapshot, type StageId } from '../contracts';

/** One reading of every trended value at one sim time. Missing or non-finite readings are NaN, drawn as a gap. */
export interface TrendSample {
  timeS: number;
  values: Readonly<Record<string, number>>;
}

/** A trended value: a stage value of the snapshot. */
export interface TrendSeries {
  /** Key of the sample's values, e.g. 'uhtTempC'. */
  id: string;
  stage: StageId;
  /** Key in that stage's values. */
  key: string;
}

/**
 * What the trends record (plan 08's trend chart): the UHT temperature at the holding-tube outlet with
 * the divert limit it must stay above, and the aseptic tank level.
 */
export const TREND_SERIES: readonly TrendSeries[] = [
  { id: 'uhtTempC', stage: 4, key: 'tempC' },
  { id: 'divertLimitC', stage: 4, key: 'divertLimitC' },
  { id: 'tankLevelPct', stage: 6, key: 'levelPct' },
];

export interface TrendHistoryOptions {
  /** How far back the trends reach, in sim time. */
  windowS?: number;
  /** Sim time between two samples. */
  everyS?: number;
  series?: readonly TrendSeries[];
}

/** The last few sim hours, one sample every minute of sim time: at most 240 points a line. */
export const TREND_WINDOW_S = hToS(4);
export const TREND_EVERY_S = minToS(1);

export interface TrendHistory {
  /** Takes a sample if at least everyS of sim time has passed since the last one; true if it did. */
  record(snapshot: Pick<Snapshot, 'timeS' | 'stages'>): boolean;
  /** Oldest first, all within windowS of the newest. */
  samples(): readonly TrendSample[];
  /** Counts every change to the samples, so a chart redraws only when there is something new. */
  readonly version: number;
  readonly windowS: number;
}

/**
 * The trends' memory, sampled on sim time, not per frame or per HUD update: a paused clock adds nothing,
 * and at ×10,000 a sample is taken at most once a HUD update, whatever the frame rate. Recorded for every
 * stage all the time, so a chart opened later already shows the last few hours.
 */
export function createTrendHistory(options: TrendHistoryOptions = {}): TrendHistory {
  const { windowS = TREND_WINDOW_S, everyS = TREND_EVERY_S, series = TREND_SERIES } = options;
  let samples: TrendSample[] = [];
  let version = 0;

  return {
    record(snapshot) {
      const { timeS } = snapshot;
      if (!Number.isFinite(timeS)) return false;
      const last = samples.at(-1);
      // The clock never runs backwards; a new sim behind the same HUD would, and its past is not this one's.
      if (last && timeS < last.timeS) samples = [];
      else if (last && timeS - last.timeS < everyS) return false;
      const values: Record<string, number> = {};
      for (const { id, stage, key } of series) {
        const value = snapshot.stages[stage]?.values[key];
        values[id] = typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
      }
      samples.push({ timeS, values });
      const oldest = samples.findIndex((sample) => sample.timeS >= timeS - windowS);
      if (oldest > 0) samples.splice(0, oldest);
      version += 1;
      return true;
    },
    samples: () => samples,
    get version() {
      return version;
    },
    windowS,
  };
}
