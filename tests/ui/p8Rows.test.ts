// Line P8's states in words (src/ui/p8Rows.ts) and the fill histogram's summary (src/ui/fillHistogram.ts), phase 18:
// on the live sim as it opens and runs, and on hand-made P8 snapshots.
import { describe, expect, it } from 'vitest';
import { hToS, type P8Snapshot, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { histogramSummary } from '../../src/ui/fillHistogram';
import { PANEL_STATE_ROWS } from '../../src/ui/panelRows';
import {
  p8BatchText,
  p8FillText,
  p8HepaText,
  p8HygieneText,
  p8MagazinesText,
  p8RejectsText,
  p8SealTestText,
  p8SealText,
  p8StateText,
} from '../../src/ui/p8Rows';
import { plantConfig } from '../helpers/plantConfig';

/** The live sim a minute in, at ×10: P8 running its first batch. */
const running = (): Snapshot => {
  const sim = createSim(plantConfig);
  for (let i = 0; i < 60; i++) sim.step(0.1);
  return sim.snapshot();
};

const p8With = (change: Partial<P8Snapshot>): P8Snapshot => ({ ...running().yogurt.p8, ...change });

describe('the stage 15 rows', () => {
  it('read the live line a minute in: running its first batch, every check in its limits', () => {
    const snap = running();
    const rows = Object.fromEntries((PANEL_STATE_ROWS[15] ?? []).map((row) => [row.key, row.read(snap)]));
    expect(rows.p8State).toEqual({ text: 'Running · 30 cycles a minute', status: 'ok' });
    expect(rows.p8Batch).toEqual({ text: 'P8-008-1 · plain stirred yogurt · best before day 36', status: 'ok' });
    expect(rows.p8Fill.text).toMatch(/^1[23]\d\.\d g · passes 120\.5–135 g$/);
    expect(rows.p8Rejects).toEqual({ text: 'Fill 0 · metal 0 · vision 0 · seal hold 0', status: 'ok' });
    expect(rows.p8Seal).toEqual({ text: '200 °C · 1.0 s · 5.0 bar · in its window', status: 'ok' });
    expect(rows.p8Hepa.text).toMatch(/^\+2[56]\.\d Pa · stops under \+15 Pa$/);
    expect(rows.p8Hygiene).toEqual({ text: 'SIP passed day 7 · 23:40 · ATP 4.0 RLU', status: 'ok' });
    expect(rows.p8SealTest.text).toMatch(/^In 1 h 5\d min · 0 passed, 0 failed$/);
    expect(rows.p8Magazines.text).toMatch(/^Cups 9\d % · foils 9\d %$/);
  });

  it('say why P8 stands', () => {
    expect(p8StateText(p8With({ state: 'stopped', stopReason: 'hepa' }))).toEqual({ text: 'Stopped: the HEPA cabin under +15 Pa', status: 'bad' });
    expect(p8StateText(p8With({ state: 'stopped', stopReason: 'cups' })).text).toBe('Stopped: the cup magazine is empty');
    expect(p8StateText(p8With({ state: 'stopped', stopReason: 'foils' })).text).toBe('Stopped: the foil magazine is empty');
    expect(p8StateText(p8With({ state: 'starved' }))).toEqual({ text: 'Waiting for yogurt · the buffer is empty', status: 'warn' });
    expect(p8StateText(p8With({ state: 'sterilizing' })).text).toBe('Sterilizing (SIP)');
    expect(p8StateText(p8With({ state: 'cleaning' })).text).toBe("Cleaning (the wing's CIP)");
    expect(p8StateText(p8With({ state: 'idle' }))).toEqual({ text: 'Ready', status: 'idle' });
    expect(p8StateText(undefined).text).toBe('—');
  });

  it('flag a fill, a seal, the cabin, the hygiene and the magazines outside their limits', () => {
    expect(p8FillText(p8With({ lastFillG: 119.8 }))).toEqual({ text: '119.8 g · rejected, outside 120.5–135 g', status: 'warn' });
    expect(p8FillText(p8With({ lastFillG: null })).text).toBe('No cup yet');
    expect(p8SealText(p8With({ seal: { tempC: 170, timeS: 1, bar: 5 } }))).toEqual({ text: '170 °C · 1.0 s · 5.0 bar · out of its window', status: 'bad' });
    expect(p8HepaText(p8With({ hepaPa: 12 }))).toEqual({ text: '+12.0 Pa · stops under +15 Pa', status: 'bad' });
    expect(p8HygieneText(p8With({ sip: { lastS: hToS(24 * 7 + 22), ok: false } })).status).toBe('bad');
    expect(p8HygieneText(p8With({ atpRlu: 14 })).text).toMatch(/ATP 14\.0 RLU$/);
    expect(p8HygieneText(p8With({ atpRlu: 14 })).status).toBe('bad');
    expect(p8MagazinesText(p8With({ magazines: { cupsPct: 20, foilsPct: 80 } }))).toEqual({ text: 'Cups 20 % · foils 80 %', status: 'warn' });
    expect(p8MagazinesText(p8With({ magazines: { cupsPct: 0, foilsPct: 80 } })).status).toBe('bad');
    expect(p8RejectsText(p8With({ rejects: { underFill: 2, overFill: 1, metal: 1, vision: 9, sealHold: 43_195 } }))).toEqual({
      text: 'Fill 3 · metal 1 · vision 9 · seal hold 43,195',
      status: 'warn',
    });
    expect(p8SealTestText(p8With({ nextSealTestS: null }), 0)).toEqual({ text: 'When P8 runs · 0 passed, 0 failed', status: 'idle' });
    expect(p8SealTestText(p8With({ sealTests: { passed: 3, failed: 1, cupsTaken: 20 } }), 0).status).toBe('warn');
    expect(p8BatchText(p8With({ currentBatch: null }))).toEqual({ text: 'None yet', status: 'idle' });
  });
});

describe('the fill histogram', () => {
  it('sums the batch in words', () => {
    const snap = running();
    expect(histogramSummary(snap.yogurt.p8)).toMatch(/^P8-008-1: \d{3} cups, mean 12[67]\.\d g, none outside 120\.5–135 g$/);
    const counts = Array.from({ length: 32 }, (_, i) => (i === 0 ? 2 : i === 14 ? 10 : 0));
    expect(histogramSummary(p8With({ fillHistogram: { fromG: 120, binG: 0.5, counts } }))).toBe('P8-008-1: 12 cups, mean 126.1 g, 2 outside 120.5–135 g');
    expect(histogramSummary(undefined)).toBe('No fill weights yet');
  });
});
