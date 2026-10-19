// Chart.js behind the trend charts. trendChart.ts loads this module with import() when a panel first shows
// a chart, so Chart.js is neither in the main bundle nor on the page's critical path.
import { Chart, LinearScale, LineController, LineElement, PointElement } from 'chart.js';
import { readToken, watchTheme } from './dom';
import { formatNumber } from './format';
import { hoursAgoLabel, type TrendChartSpec } from './trendChart';

// Only what a line chart on two linear axes needs, so the chunk carries no other chart types, scales or
// plugins (no legend, title or tooltip: the figure's caption is the legend).
Chart.register(LineController, LineElement, PointElement, LinearScale);

export interface TrendDrawing {
  /** One list of points per line of the spec, in its order. */
  setLines(lines: readonly { x: number; y: number }[][]): void;
  destroy(): void;
}

/**
 * A Chart.js line chart on `canvas`: hours before now across (-windowH to 0), the spec's value axis up,
 * in the theme's colours, following theme changes. No animation and no mouse handling; the canvas takes
 * the size of its box (responsive, no aspect ratio of its own).
 */
export function drawTrend(canvas: HTMLCanvasElement, spec: TrendChartSpec, windowH: number): TrendDrawing {
  const listeners = new AbortController();
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: spec.lines.map((line) => ({
        label: line.label,
        data: [] as { x: number; y: number }[],
        parsing: false as const,
        borderWidth: line.dashed ? 1.5 : 2,
        borderDash: line.dashed ? [5, 4] : [],
        // A dot on the newest reading only, so a fresh chart with one sample already shows where it stands.
        pointRadius: (context: { dataIndex: number; dataset: { data: unknown[] } }) =>
          context.dataIndex === context.dataset.data.length - 1 ? 2.5 : 0,
        pointBorderWidth: 0,
        tension: 0,
      })),
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      events: [],
      layout: { padding: { top: 4, right: 4 } },
      scales: {
        x: {
          type: 'linear',
          min: -windowH,
          max: 0,
          ticks: { stepSize: 1, maxRotation: 0, callback: (value) => hoursAgoLabel(Number(value)) },
        },
        y: {
          type: 'linear',
          min: spec.min,
          max: spec.max,
          grace: spec.min === undefined ? '10%' : 0,
          ticks: { maxTicksLimit: 4, callback: (value) => formatNumber(Number(value), spec.decimals) },
        },
      },
    },
  });

  function applyTheme(): void {
    const muted = readToken('--muted');
    const line = readToken('--line');
    const font = { family: readToken('--font-data') || 'monospace', size: 11 };
    for (const [index, { tone }] of spec.lines.entries()) {
      const dataset = chart.data.datasets[index];
      if (dataset) dataset.borderColor = dataset.backgroundColor = readToken(`--${tone}`);
    }
    for (const scale of [chart.options.scales?.x, chart.options.scales?.y]) {
      if (!scale) continue;
      scale.grid = { ...scale.grid, color: line };
      scale.border = { ...scale.border, color: line };
      scale.ticks = { ...scale.ticks, color: muted, font };
    }
    chart.update('none');
  }
  applyTheme();
  watchTheme(applyTheme, listeners.signal);

  return {
    setLines(lines) {
      for (const [index, points] of lines.entries()) {
        const dataset = chart.data.datasets[index];
        if (dataset) dataset.data = points;
      }
      chart.update('none');
    },
    destroy() {
      listeners.abort();
      chart.destroy();
    },
  };
}
