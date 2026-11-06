// Stage 15's fill-weight histogram (phase 18): the current batch's cups by fill weight, in the snapshot's 0.5 g bins,
// with the checkweigher's limits and the target marked. Bars are plain elements, sized by the tallest bin, so the theme's
// tokens colour them; the figure says the same in words for a screen reader.
import type { P8Snapshot, Snapshot } from '../contracts';
import plantJson from '../data/plant.json';
import { el, setAttr, setText } from './dom';
import { formatNumber } from './format';
import { p8Of } from './p8Rows';
import type { PanelPart } from './stagePanel';

const { fill } = plantJson.yogurt.p8;

/** The histogram's numbers in words: "Batch P8-008-1: 21,600 cups, mean 127.0 g, none outside 120.5–135 g". */
export function histogramSummary(p8: P8Snapshot | undefined): string {
  const histogram = p8?.fillHistogram;
  if (!histogram) return 'No fill weights yet';
  const { fromG, binG, counts } = histogram;
  const cups = counts.reduce((sum, count) => sum + count, 0);
  const batch = p8?.currentBatch?.code ?? 'this batch';
  if (cups === 0) return `${batch}: no cups weighed yet`;
  const meanG = counts.reduce((sum, count, i) => sum + count * (fromG + (i + 0.5) * binG), 0) / cups;
  const outside = counts.reduce((sum, count, i) => {
    const lowG = fromG + i * binG;
    return sum + (lowG + binG <= fill.underBelowG || lowG >= fill.overAboveG ? count : 0);
  }, 0);
  const limits = `${formatNumber(fill.underBelowG, 1)}–${formatNumber(fill.overAboveG)} g`;
  return `${batch}: ${formatNumber(cups)} cups, mean ${formatNumber(meanG, 1)} g, ${outside === 0 ? 'none' : formatNumber(outside)} outside ${limits}`;
}

export function createFillHistogram(host: HTMLElement): PanelPart {
  const figure = el('figure', 'trend fill-hist');
  figure.dataset.testid = 'fill-histogram';
  const caption = el('figcaption', 'trend-head');
  caption.append(el('span', 'eyebrow', 'Fill weights · this batch'));
  const summary = el('span', 'trend-key');
  summary.dataset.testid = 'fill-histogram-summary';
  caption.append(summary);
  const plot = el('div', 'fill-hist-plot');
  plot.setAttribute('role', 'img');
  const bars = el('div', 'fill-hist-bars');
  plot.append(bars);
  const ends = el('div', 'fill-hist-ends');
  ends.setAttribute('aria-hidden', 'true');
  figure.append(caption, plot, ends);
  host.append(figure);

  let shownBins = -1;
  let barNodes: HTMLElement[] = [];
  let shownRange = '';

  /** Lays out the bars and the marks for a histogram's bins, once per shape. */
  function layout(fromG: number, binG: number, bins: number): void {
    const range = `${fromG}|${binG}|${bins}`;
    if (range === shownRange) return;
    shownRange = range;
    shownBins = bins;
    barNodes = Array.from({ length: bins }, () => el('span', 'fill-hist-bar'));
    bars.replaceChildren(...barNodes);
    const spanG = binG * bins;
    const at = (g: number): string => `${(100 * (g - fromG)) / spanG}%`;
    for (const [g, tone, label] of [
      [fill.underBelowG, 'bad', `${formatNumber(fill.underBelowG, 1)} g`],
      [fill.targetG, 'target', `${formatNumber(fill.targetG)} g`],
      [fill.overAboveG, 'bad', `${formatNumber(fill.overAboveG)} g`],
    ] as const) {
      const mark = el('span', 'fill-hist-mark');
      mark.dataset.tone = tone;
      mark.style.left = at(g);
      mark.title = label;
      bars.append(mark);
    }
    ends.replaceChildren(
      el('span', '', `${formatNumber(fromG)} g`),
      el('span', '', `target ${formatNumber(fill.targetG)} g · limits ${formatNumber(fill.underBelowG, 1)}, ${formatNumber(fill.overAboveG)} g`),
      el('span', '', `${formatNumber(fromG + spanG)} g`),
    );
  }

  return {
    update(snapshot: Snapshot) {
      const p8 = p8Of(snapshot);
      const histogram = p8?.fillHistogram;
      const text = histogramSummary(p8);
      setText(summary, text);
      setAttr(plot, 'aria-label', `Fill weights of the current batch: ${text}`);
      if (!histogram) return;
      layout(histogram.fromG, histogram.binG, histogram.counts.length);
      const tallest = Math.max(1, ...histogram.counts);
      for (let i = 0; i < shownBins; i++) {
        const height = `${(100 * (histogram.counts[i] ?? 0)) / tallest}%`;
        if (barNodes[i].style.height !== height) barNodes[i].style.height = height;
      }
    },
    dispose() {
      figure.remove();
    },
  };
}
