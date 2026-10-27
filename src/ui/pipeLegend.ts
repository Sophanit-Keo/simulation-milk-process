// The pipe legend over the 3D view (index.html): the milk temperatures the pipes show, and, while the UHT
// plant runs a cleaning programme (phase 7), the three cleaning fluids, the one the circuit carries marked.
import { CLEANING_FLUIDS, type CleaningFluid, type Snapshot } from '../contracts';
import { el, setAttr } from './dom';

/** The legend's label for screen readers while the pipes carry milk; index.html starts with it. */
export const MILK_LEGEND_LABEL = 'Pipe colour shows milk temperature: blue 4 °C, teal 20 °C, amber 60 °C, orange 80 °C, red 140 °C';

/** Each fluid's colour in words (the --clean-* tokens), so the colour is never the only cue. */
export const FLUID_COLOUR_TEXT: Readonly<Record<CleaningFluid, string>> = {
  water: 'pale blue',
  lye: 'violet',
  acid: 'magenta',
};

/**
 * The legend's label: the milk temperatures, and while a programme runs, the fluids' colours and the one in
 * the circuit now, e.g. "… Cleaning, lye now: pale blue water, violet lye, magenta acid".
 */
export function legendLabel(fluid: CleaningFluid | null): string {
  if (!fluid) return MILK_LEGEND_LABEL;
  const colours = CLEANING_FLUIDS.map((each) => `${FLUID_COLOUR_TEXT[each]} ${each}`).join(', ');
  return `${MILK_LEGEND_LABEL}. Cleaning, ${fluid} now: ${colours}`;
}

/** The fluid in the UHT circuit, or null while it carries milk (or the snapshot predates contracts v5). */
export function circuitFluid(snapshot: Pick<Snapshot, 'liquid'>): CleaningFluid | null {
  return snapshot.liquid?.cleaning?.fluid ?? null;
}

export interface PipeLegend {
  update(snapshot: Snapshot): void;
  dispose(): void;
}

/** Adds the cleaning fluids to the legend inside `view`, shown only while a programme runs. */
export function createPipeLegend(view: HTMLElement): PipeLegend {
  const legend = view.querySelector<HTMLElement>('.overlay-legend');
  const group = el('span', 'legend-clean');
  group.dataset.testid = 'legend-cleaning';
  group.hidden = true;
  group.append(el('span', 'legend-clean-title', 'Cleaning:'));
  const items = {} as Record<CleaningFluid, HTMLSpanElement>;
  for (const fluid of CLEANING_FLUIDS) {
    const item = el('span', 'legend-fluid');
    item.dataset.fluid = fluid;
    item.append(el('i', `swatch clean-${fluid}`), fluid);
    items[fluid] = item;
    group.append(item);
  }
  legend?.append(group);

  let shown: CleaningFluid | null = null;
  return {
    update(snapshot) {
      const fluid = circuitFluid(snapshot);
      if (fluid === shown) return;
      shown = fluid;
      group.hidden = fluid === null;
      for (const each of CLEANING_FLUIDS) items[each].classList.toggle('active', each === fluid);
      if (legend) setAttr(legend, 'aria-label', legendLabel(fluid));
    },
    dispose() {
      group.remove();
      if (legend) setAttr(legend, 'aria-label', MILK_LEGEND_LABEL);
    },
  };
}
