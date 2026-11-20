// The pipe legend over the 3D view (index.html): the milk temperatures the pipes show, and, while the UHT
// plant runs a cleaning programme (phase 7), the three cleaning fluids, the one the circuit carries marked. Since phase
// 32 the fluids show too while the yogurt wing's CIP station runs a circuit, its fluid marked when the UHT plant's
// circuit carries milk.
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

/**
 * The fluid the yogurt wing's CIP station pumps now (phase 32, D34): the heat treatment's circuit's, a cleaning tank's,
 * then the buffer and P8's (a rinse is water); null while none runs. A clean that names no step (a snapshot older than
 * contracts v13) pumps water.
 */
export function wingCleaningFluid(snapshot: Pick<Snapshot, 'yogurt'>): CleaningFluid | null {
  const yogurt = (snapshot as Partial<Snapshot>).yogurt;
  if (!yogurt) return null;
  if (yogurt.heat.mode === 'cleaning') return yogurt.heat.cleaning?.fluid ?? 'water';
  const tank = yogurt.ferment.tanks.find((each) => each.state === 'cleaning');
  if (tank) return tank.cleaning?.fluid ?? 'water';
  const changeover = yogurt.buffer.changeover;
  if (changeover?.kind === 'cip') return changeover.cleaning?.fluid ?? 'water';
  return changeover?.kind === 'rinse' ? 'water' : null;
}

/**
 * The fluid the legend marks: the UHT circuit's, else the yogurt wing's (phase 32); null while both carry milk (or the
 * snapshot predates contracts v5).
 */
export function circuitFluid(snapshot: Pick<Snapshot, 'liquid'> & Partial<Pick<Snapshot, 'yogurt'>>): CleaningFluid | null {
  return snapshot.liquid?.cleaning?.fluid ?? wingCleaningFluid(snapshot as Pick<Snapshot, 'yogurt'>);
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
