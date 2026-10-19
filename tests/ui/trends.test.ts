// The trends' memory (src/ui/trends.ts) and the chart's points (src/ui/trendChart.ts): sampled on sim time,
// trimmed to the last few sim hours, and drawn as hours before now.
import { describe, expect, it } from 'vitest';
import { hToS, minToS, type Snapshot } from '../../src/contracts';
import { createMockSim } from '../../src/sim/mock';
import { hoursAgoLabel, TREND_CHARTS, trendPoints } from '../../src/ui/trendChart';
import { createTrendHistory, TREND_EVERY_S, TREND_SERIES, TREND_WINDOW_S } from '../../src/ui/trends';
import { plantConfig } from '../helpers/plantConfig';

/** Just what the history reads: the sim time and the trended stage values. */
function at(timeS: number, tempC = 140, levelPct = 50): Pick<Snapshot, 'timeS' | 'stages'> {
  return {
    timeS,
    stages: {
      4: { id: 4, status: 'ok', values: { tempC, divertLimitC: 139.22 } },
      6: { id: 6, status: 'ok', values: { levelPct } },
    } as unknown as Snapshot['stages'],
  };
}

describe('createTrendHistory', () => {
  it('keeps the UHT temperature, the divert limit and the tank level, the last 4 sim hours at one sample a sim minute', () => {
    expect(TREND_SERIES.map((series) => series.id)).toEqual(['uhtTempC', 'divertLimitC', 'tankLevelPct']);
    expect(TREND_WINDOW_S).toBe(hToS(4));
    expect(TREND_EVERY_S).toBe(minToS(1));
  });

  it('samples on sim time: however often it is called, one sample per interval of sim time', () => {
    const history = createTrendHistory({ everyS: 60 });
    // 4 calls a second of real time at ×1 for 3 minutes: 720 calls, 180 s of sim time.
    let taken = 0;
    for (let call = 0; call <= 720; call++) if (history.record(at(1_000 + call * 0.25))) taken++;
    expect(taken).toBe(4);
    expect(history.samples().map((sample) => sample.timeS)).toEqual([1_000, 1_060, 1_120, 1_180]);
  });

  it('takes nothing while the clock stands still (paused)', () => {
    const history = createTrendHistory();
    expect(history.record(at(500))).toBe(true);
    const version = history.version;
    for (let call = 0; call < 100; call++) history.record(at(500));
    expect(history.samples()).toHaveLength(1);
    expect(history.version).toBe(version);
  });

  it('at high speed takes one sample per call, at the sim time of each call', () => {
    const history = createTrendHistory();
    // ×10,000 at 4 HUD updates a second: 2,500 s of sim time between calls.
    for (let call = 0; call < 6; call++) history.record(at(call * 2_500));
    expect(history.samples().map((sample) => sample.timeS)).toEqual([0, 2_500, 5_000, 7_500, 10_000, 12_500]);
  });

  it('drops samples older than the window, and holds no more than window ÷ interval + 1', () => {
    const history = createTrendHistory({ windowS: hToS(4), everyS: 60 });
    for (let timeS = 0; timeS <= hToS(10); timeS += 30) history.record(at(timeS));
    const samples = history.samples();
    expect(samples.at(-1)?.timeS).toBe(hToS(10));
    expect(samples[0].timeS).toBe(hToS(6));
    expect(samples).toHaveLength(241);
  });

  it('starts again if the clock goes back (a new sim behind the same page)', () => {
    const history = createTrendHistory();
    history.record(at(10_000));
    history.record(at(10_060));
    history.record(at(200));
    expect(history.samples().map((sample) => sample.timeS)).toEqual([200]);
  });

  it('records a missing or non-finite reading as NaN, a gap in the line', () => {
    const history = createTrendHistory();
    history.record({ timeS: 0, stages: { 4: { id: 4, status: 'ok', values: {} } } as unknown as Snapshot['stages'] });
    history.record(at(60, Number.POSITIVE_INFINITY));
    const [first, second] = history.samples();
    expect(first.values).toEqual({ uhtTempC: Number.NaN, divertLimitC: Number.NaN, tankLevelPct: Number.NaN });
    expect(second.values.uhtTempC).toBeNaN();
    expect(second.values.tankLevelPct).toBe(50);
  });

  it('counts a version up with every new sample', () => {
    const history = createTrendHistory();
    const before = history.version;
    history.record(at(0));
    history.record(at(10));
    history.record(at(60));
    expect(history.version).toBe(before + 2);
  });

  it('reads every trended value from the mock snapshot', () => {
    const sim = createMockSim(plantConfig);
    const history = createTrendHistory();
    history.record(sim.snapshot());
    for (const value of Object.values(history.samples()[0].values)) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('trendPoints and the time axis', () => {
  it('puts each sample at its hours before now, with its value', () => {
    const history = createTrendHistory();
    history.record(at(hToS(1), 139.8));
    history.record(at(hToS(2.5), 140.1));
    expect(trendPoints(history.samples(), 'uhtTempC', hToS(3))).toEqual([
      { x: -2, y: 139.8 },
      { x: -0.5, y: 140.1 },
    ]);
    expect(trendPoints(history.samples(), 'divertLimitC', hToS(2.5)).map((point) => point.x)).toEqual([-1.5, 0]);
  });

  it('gives a series the samples lack a NaN value, not a made-up one', () => {
    const history = createTrendHistory();
    history.record(at(0));
    expect(trendPoints(history.samples(), 'nothing', 0)).toEqual([{ x: 0, y: Number.NaN }]);
  });

  it('labels the axis in hours before now', () => {
    expect([-4, -3, -2, -1, 0].map(hoursAgoLabel)).toEqual(['-4 h', '-3 h', '-2 h', '-1 h', 'now']);
  });
});

describe('TREND_CHARTS', () => {
  it('draws the UHT temperature with its divert limit in stage 4, and the tank level in stage 6, from recorded series', () => {
    expect(TREND_CHARTS[4]?.lines.map((line) => line.series)).toEqual(['uhtTempC', 'divertLimitC']);
    expect(TREND_CHARTS[6]?.lines.map((line) => line.series)).toEqual(['tankLevelPct']);
    const recorded = new Set(TREND_SERIES.map((series) => series.id));
    for (const spec of Object.values(TREND_CHARTS)) for (const line of spec.lines) expect(recorded).toContain(line.series);
  });

  it('draws the limit dashed, in the alarm colour, so it reads as a line not to cross', () => {
    expect(TREND_CHARTS[4]?.lines[1]).toMatchObject({ tone: 'bad', dashed: true });
  });

  it('keeps the tank level on a fixed 0–100 % axis', () => {
    expect(TREND_CHARTS[6]).toMatchObject({ unit: '%', min: 0, max: 100 });
  });
});
