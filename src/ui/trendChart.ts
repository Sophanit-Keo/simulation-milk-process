import { sToH, type Snapshot, type StageId } from '../contracts';
import { el } from './dom';
import { formatNumber } from './format';
import type { PanelPart } from './stagePanel';
import type { TrendDrawing } from './trendCanvas';
import type { TrendHistory, TrendSample } from './trends';

/** The colour tokens a trend line may take (tokens.css), so the lines follow the theme. */
type LineTone = 'accent' | 'bad';

export interface TrendLine {
  /** TrendSeries id in the history. */
  series: string;
  label: string;
  tone: LineTone;
  dashed?: boolean;
}

export interface TrendChartSpec {
  title: string;
  unit: string;
  /** Decimals of the value axis' labels. */
  decimals: number;
  lines: readonly TrendLine[];
  /** Fixed value axis; without one it fits the data. */
  min?: number;
  max?: number;
}

/** The trend chart of plan 08's info panel, for the stages that have one. */
export const TREND_CHARTS: Readonly<Partial<Record<StageId, TrendChartSpec>>> = {
  4: {
    title: 'UHT temperature',
    unit: '°C',
    decimals: 1,
    lines: [
      { series: 'uhtTempC', label: 'Holding-tube outlet', tone: 'accent' },
      { series: 'divertLimitC', label: 'Divert limit', tone: 'bad', dashed: true },
    ],
  },
  6: {
    title: 'Aseptic tank level',
    unit: '%',
    decimals: 0,
    min: 0,
    max: 100,
    lines: [{ series: 'tankLevelPct', label: 'Level', tone: 'accent' }],
  },
};

/** One line's points: hours before `nowS` across, the value up; a missing reading is NaN, a gap in the line. */
export function trendPoints(samples: readonly TrendSample[], series: string, nowS: number): { x: number; y: number }[] {
  return samples.map((sample) => ({ x: sToH(sample.timeS - nowS), y: sample.values[series] ?? Number.NaN }));
}

/** Labels of the time axis: "-3 h" … "now". */
export function hoursAgoLabel(hours: number): string {
  return hours === 0 ? 'now' : `${formatNumber(hours)} h`;
}

/**
 * A trend chart in the info panel: the spec's lines over the history's window, redrawn when the history
 * has a new sample (at most once a HUD update), in the theme's colours. The canvas sits in a box of fixed
 * height and takes its width, so the panel never jumps when the chart draws, and the chart follows the
 * panel's width. dispose() destroys the chart, so a panel that shows another stage leaves nothing behind.
 */
export function createTrendChart(host: HTMLElement, stage: StageId, spec: TrendChartSpec, history: TrendHistory): PanelPart {
  const windowH = sToH(history.windowS);
  const figure = el('figure', 'trend');
  figure.dataset.testid = `trend-${stage}`;
  const caption = el('figcaption', 'trend-head');
  caption.append(el('span', 'eyebrow', `${spec.title} · last ${formatNumber(windowH)} h`));
  const key = el('span', 'trend-key');
  for (const line of spec.lines) {
    const item = el('span', 'trend-key-item');
    const swatch = el('i', 'trend-swatch');
    swatch.dataset.tone = line.tone;
    if (line.dashed) swatch.dataset.dashed = '';
    item.append(swatch, line.label);
    key.append(item);
  }
  caption.append(key);
  const plot = el('div', 'trend-plot');
  const canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    `${spec.title} (${spec.unit}) over the last ${formatNumber(windowH)} sim hours: ${spec.lines.map((line) => line.label.toLowerCase()).join(' and ')}`,
  );
  plot.append(canvas);
  figure.append(caption, plot);
  host.append(figure);

  // Chart.js comes in its own chunk the first time a chart is shown; until then the box stands empty at
  // its full size. A part disposed before the chunk arrives never draws.
  let drawing: TrendDrawing | null = null;
  let disposed = false;
  let drawnVersion = -1;
  let nowS: number | null = null;

  function draw(): void {
    if (!drawing || nowS === null || history.version === drawnVersion) return;
    drawnVersion = history.version;
    const samples = history.samples();
    drawing.setLines(spec.lines.map((line) => trendPoints(samples, line.series, nowS ?? 0)));
    figure.dataset.samples = String(samples.length);
  }

  void import('./trendCanvas').then(({ drawTrend }) => {
    if (disposed) return;
    drawing = drawTrend(canvas, spec, windowH);
    figure.dataset.ready = '';
    draw();
  });

  return {
    update(snapshot: Snapshot) {
      // The newest sample's time: the right edge ("now") of a chart that redraws only on a new sample.
      nowS = history.samples().at(-1)?.timeS ?? snapshot.timeS;
      draw();
    },
    dispose() {
      disposed = true;
      drawing?.destroy();
      figure.remove();
    },
  };
}
