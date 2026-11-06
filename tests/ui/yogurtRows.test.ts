// The yogurt line's states in words (src/ui/yogurtRows.ts, phase 17) and the next-product picker's shift change
// (src/ui/productPicker.ts), on the live sim and on hand-made snapshots.
import { describe, expect, it } from 'vitest';
import { hToS, type FermentTank, type Snapshot, type YogurtSnapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { PANEL_STATE_ROWS } from '../../src/ui/panelRows';
import { nextShiftS } from '../../src/ui/productPicker';
import {
  bufferProductText,
  changeoverText,
  heatCleaningText,
  heatModeText,
  nextProductText,
  PRODUCT_CHOICES,
  productName,
  productText,
  setWaitText,
  steamText,
  tankText,
} from '../../src/ui/yogurtRows';
import { plantConfig } from '../helpers/plantConfig';

const opening = (): Snapshot => {
  const sim = createSim(plantConfig);
  sim.step(0.1);
  return sim.snapshot();
};

const tank = (change: Partial<FermentTank>): FermentTank => ({
  levelL: 5_000,
  capacityL: 10_000,
  state: 'fermenting',
  product: 'plainStirred',
  ph: 5.214,
  taPct: 0.6,
  startedS: 0,
  readyAtS: hToS(4),
  ...change,
});

/** The opening snapshot's yogurt part, with a change on top. */
const yogurtWith = (change: (yogurt: YogurtSnapshot) => void): YogurtSnapshot => {
  const yogurt = structuredClone(opening().yogurt);
  change(yogurt);
  return yogurt;
};

describe('the products', () => {
  it('names each by plant.json, in its order, for the picker', () => {
    expect(PRODUCT_CHOICES).toEqual([
      { id: 'plainStirred', name: 'Plain stirred yogurt' },
      { id: 'strawberryStirred', name: 'Strawberry stirred yogurt' },
      { id: 'plainSet', name: 'Plain set yogurt' },
    ]);
    expect(productName('plainSet')).toBe('Plain set yogurt');
    expect(productName(null)).toBe('—');
  });

  it('says how each is made', () => {
    expect(productText(opening().yogurt)).toEqual({ text: 'Plain stirred yogurt · stirred', status: 'ok' });
    expect(productText(yogurtWith((y) => (y.product = { id: 'strawberryStirred', route: 'stirred', fruit: true, next: 'plainSet' })))).toEqual({
      text: 'Strawberry stirred yogurt · stirred, 15% fruit',
      status: 'ok',
    });
    expect(productText(yogurtWith((y) => (y.product = { id: 'plainSet', route: 'set', fruit: false, next: 'plainStirred' }))).text).toBe('Plain set yogurt · sets in the cup');
    expect(nextProductText(opening().yogurt)).toEqual({ text: 'Strawberry stirred yogurt', status: 'idle' });
  });

  it('changes the product at the next shift change: 14:00 on the opening day 8, 06:00 after 22:00', () => {
    expect(nextShiftS(hToS(7 * 24 + 6))).toBe(hToS(7 * 24 + 14));
    expect(nextShiftS(hToS(7 * 24 + 13.99))).toBe(hToS(7 * 24 + 14));
    expect(nextShiftS(hToS(7 * 24 + 22.5))).toBe(hToS(8 * 24 + 6));
    expect(nextShiftS(hToS(3))).toBe(hToS(6));
  });
});

describe('the heat treatment', () => {
  it('reads forward, a divert or a clean with the time left, and standing', () => {
    const yogurt = opening().yogurt;
    expect(heatModeText(yogurtWith((y) => (y.heat.mode = 'production')))).toEqual({ text: 'Forward to the tanks and the buffer', status: 'ok' });
    expect(heatModeText(yogurtWith((y) => Object.assign(y.heat, { mode: 'divert', modeRemainingS: 130 })))).toEqual({
      text: 'Diverting to the reprocess tank · 2 min 10 s left',
      status: 'bad',
    });
    expect(heatModeText(yogurtWith((y) => Object.assign(y.heat, { mode: 'cleaning', modeRemainingS: 4_800 })))).toEqual({
      text: "Cleaning (the wing's CIP) · 1 h 20 min left",
      status: 'warn',
    });
    expect(heatModeText(yogurtWith((y) => Object.assign(y.heat, { mode: 'idle', modeRemainingS: 0 }))).status).toBe('idle');
    expect(heatCleaningText(yogurt)).toEqual({ text: 'None', status: 'idle' });
    expect(heatModeText(undefined).text).toBe('—');
  });

  it('shows the CIP step while the wing cleans after a divert', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'yogurtHeatC', value: 84 });
    sim.dispatch({ type: 'setSpeed', speed: 1_000 });
    let snap = sim.snapshot();
    for (let frame = 0; frame < 2_000 && snap.yogurt.heat.mode !== 'cleaning'; frame++) {
      sim.step(0.1);
      snap = sim.snapshot();
    }
    expect(heatModeText(snap.yogurt).status).toBe('warn');
    expect(heatCleaningText(snap.yogurt).text).toMatch(/^Pre-rinse, \d+ °C · 1 of \d · .+ left$/);
  });

  it('reads the steam and the gas for it while the mix heats', () => {
    expect(steamText(yogurtWith((y) => (y.energy = { steamKgPerH: 255.27, gasKw: 197.85, steamKg: 0, gasKwh: 0 })))).toEqual({ text: '255 kg/h · gas 198 kW', status: 'ok' });
    expect(steamText(yogurtWith((y) => (y.energy = { steamKgPerH: 0, gasKw: 0, steamKg: 0, gasKwh: 0 })))).toEqual({ text: 'None now', status: 'idle' });
    expect(steamText(yogurtWith((y) => delete y.energy))).toEqual({ text: '—', status: 'idle' });
  });
});

describe('the fermentation tanks', () => {
  it.each([
    [{ state: 'empty', levelL: 0, product: null }, 'Empty · clean, waiting to fill', 'idle'],
    [{ state: 'filling', levelL: 4_500, ph: 6.6, readyAtS: null }, 'Filling · 45 % · pH 6.60', 'ok'],
    [{ state: 'fermenting' }, 'Fermenting · pH 5.21 · ready in 1 h 20 min', 'ok'],
    [{ state: 'fermenting', readyAtS: null }, 'Fermenting · pH 5.21', 'ok'],
    [{ state: 'ready', levelL: 10_000, ph: 4.55 }, 'Ready at pH 4.55 · cooled, waiting to empty', 'ok'],
    [{ state: 'emptying', levelL: 6_000, ph: 4.55 }, 'Emptying to the buffer · 60 % · pH 4.55', 'ok'],
    [{ state: 'cleaning', levelL: 0, product: null }, 'Cleaning in place', 'warn'],
  ] as const)('%o reads "%s"', (change, text, status) => {
    expect(tankText(tank(change), hToS(4) - hToS(4 / 3))).toEqual({ text, status });
  });

  it('reads the three tanks of the opening plant: the first emptying, the second ready, the third fermenting', () => {
    const snap = opening();
    const texts = PANEL_STATE_ROWS[13]?.map((row) => row.read(snap).text) ?? [];
    expect(texts[0]).toMatch(/^Emptying to the buffer · 100 % · pH 4\.55$/);
    expect(texts[1]).toBe('Ready at pH 4.55 · cooled, waiting to empty');
    // Half way through its 4 h (H125), at the halfway pH.
    expect(texts[2]).toBe('Fermenting · pH 5.57 · ready in 1 h 59 min');
    expect(tankText(undefined, 0).text).toBe('—');
  });
});

describe('the P8 buffer', () => {
  it('names its product, or changing over', () => {
    expect(bufferProductText(yogurtWith((y) => Object.assign(y.buffer, { product: 'plainStirred', levelL: 2_000 })))).toEqual({ text: 'Plain stirred yogurt', status: 'ok' });
    expect(bufferProductText(yogurtWith((y) => (y.buffer.product = null)))).toEqual({ text: 'Changing over', status: 'warn' });
    expect(bufferProductText(yogurtWith((y) => delete y.buffer.product)).text).toBe('—');
  });

  it('reads the changeover and the time left in it', () => {
    expect(changeoverText(yogurtWith((y) => (y.buffer.changeover = null)))).toEqual({ text: 'None', status: 'idle' });
    expect(changeoverText(yogurtWith((y) => (y.buffer.changeover = { kind: 'rinse', remainingS: 600 })))).toEqual({
      text: 'Rinse of the buffer and the fruit line · 10 min left',
      status: 'warn',
    });
    expect(changeoverText(yogurtWith((y) => (y.buffer.changeover = { kind: 'cip', remainingS: 4_800 }))).text).toBe('CIP of the buffer and P8 · 1 h 20 min left');
    expect(changeoverText(yogurtWith((y) => (y.buffer.changeover = { kind: 'sip', remainingS: 1_200 }))).text).toBe('P8 sterilizing (SIP) · 20 min left');
  });

  it("reads the set mix's wait against its 45 min, amber past 80% of it", () => {
    expect(setWaitText(yogurtWith((y) => (y.buffer.waitS = null)))).toEqual({ text: '— · stirred yogurt keeps', status: 'idle' });
    expect(setWaitText(yogurtWith((y) => (y.buffer.waitS = 1_200)))).toEqual({ text: '20 min of 45 min', status: 'ok' });
    expect(setWaitText(yogurtWith((y) => (y.buffer.waitS = 2_400)))).toEqual({ text: '40 min of 45 min', status: 'warn' });
  });

  it('reads the opening plant: plain stirred in the buffer, no changeover', () => {
    const snap = opening();
    expect(PANEL_STATE_ROWS[14]?.map((row) => row.read(snap))).toEqual([
      { text: 'Plain stirred yogurt', status: 'ok' },
      { text: 'None', status: 'idle' },
      { text: '— · stirred yogurt keeps', status: 'idle' },
    ]);
    expect(PANEL_STATE_ROWS[11]?.map((row) => row.read(snap).text)).toEqual(['Plain stirred yogurt · stirred', 'Strawberry stirred yogurt']);
  });
});
