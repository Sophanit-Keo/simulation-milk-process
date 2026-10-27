// The pipe legend (src/ui/pipeLegend.ts, phase 7), without a DOM: its words for screen readers, the fluid it
// marks, and the markup and styles it relies on in index.html and app.css.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLEANING_FLUIDS, type CleaningSnapshot, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { circuitFluid, FLUID_COLOUR_TEXT, legendLabel, MILK_LEGEND_LABEL } from '../../src/ui/pipeLegend';
import { plantConfig } from '../helpers/plantConfig';

const base = createSim(plantConfig).snapshot();
const cleaning: CleaningSnapshot = {
  program: 'cip',
  step: 'acid',
  fluid: 'acid',
  stepIndex: 3,
  stepCount: 6,
  stepRemainingS: 1_200,
  tempC: 70,
  flowLph: plantConfig.cleaning.circulateLph,
};

describe('the pipe legend', () => {
  it('names the milk temperatures alone while the pipes carry milk, as index.html starts', () => {
    expect(legendLabel(null)).toBe(MILK_LEGEND_LABEL);
    expect(readFileSync('index.html', 'utf8')).toContain(`aria-label="${MILK_LEGEND_LABEL}"`);
  });

  it('adds each fluid’s colour in words, and the one in the circuit, while the plant cleans', () => {
    expect(legendLabel('lye')).toBe(`${MILK_LEGEND_LABEL}. Cleaning, lye now: pale blue water, violet lye, magenta acid`);
    expect(new Set(CLEANING_FLUIDS.map((fluid) => FLUID_COLOUR_TEXT[fluid])).size).toBe(CLEANING_FLUIDS.length);
  });

  it('reads the fluid from the liquid snapshot: none while it makes product, or from a snapshot older than contracts v5', () => {
    expect(circuitFluid(base)).toBeNull();
    expect(circuitFluid({ liquid: { ...base.liquid, cleaning } })).toBe('acid');
    const { cleaning: _dropped, ...older } = base.liquid;
    expect(circuitFluid({ liquid: older } as Pick<Snapshot, 'liquid'>)).toBeNull();
  });

  it('has a swatch per fluid in app.css, in the colour token the 3D pipes use', () => {
    const css = readFileSync('src/styles/app.css', 'utf8');
    for (const fluid of CLEANING_FLUIDS) expect(css, fluid).toMatch(new RegExp(`\\.swatch\\.clean-${fluid} \\{\\s*background: var\\(--clean-${fluid}\\);`));
  });
});
