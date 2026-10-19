// The info panel's words for the liquid line (src/ui/liquidRows.ts): the UHT mode with the time left, the
// throttle and the fillers, and the margin over the divert limit that makes R6 visible in the stage 4 panel.
import { describe, expect, it } from 'vitest';
import { UHT_MODES, type LiquidSnapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { divertLimitC } from '../../src/sim/formulas';
import { DERIVED_ROWS, fillersText, marginText, STATE_ROWS, throttleText, uhtModeText } from '../../src/ui/liquidRows';
import { plantConfig } from '../helpers/plantConfig';

const liquid = (): LiquidSnapshot => createSim(plantConfig).snapshot().liquid;

describe('uhtModeText', () => {
  it('reads "Production", green, with no time left to show', () => {
    expect(uhtModeText({ uhtMode: 'production', modeRemainingS: 0 })).toEqual({ text: 'Production', status: 'ok' });
  });

  it.each([
    ['divert', 150, 'Diverting to reject · 2 min 30 s left', 'bad'],
    ['cip', 4_800, 'Cleaning (CIP) · 1 h 20 min left', 'warn'],
    ['sterilize', 1_800, 'Re-sterilizing · 30 min left', 'warn'],
    ['aic', 1_799.2, 'Intermediate clean · 30 min left', 'warn'],
  ] as const)('reads %s with %s s left as "%s", %s', (uhtMode, modeRemainingS, text, status) => {
    expect(uhtModeText({ uhtMode, modeRemainingS })).toEqual({ text, status });
  });

  it('leaves out the time left when the sim gives none', () => {
    expect(uhtModeText({ uhtMode: 'divert', modeRemainingS: 0 })).toEqual({ text: 'Diverting to reject', status: 'bad' });
    expect(uhtModeText({ uhtMode: 'cip', modeRemainingS: Number.NaN }).text).toBe('Cleaning (CIP)');
  });

  it('has words for every mode of the contract, each different', () => {
    const texts = UHT_MODES.map((uhtMode) => uhtModeText({ uhtMode, modeRemainingS: 0 }).text);
    expect(new Set(texts).size).toBe(UHT_MODES.length);
    expect(texts).not.toContain('—');
  });

  it('shows a dash, unlit, for a mode it does not know (a newer sim)', () => {
    expect(uhtModeText({ uhtMode: 'flush' as never, modeRemainingS: 60 })).toEqual({ text: '—', status: 'idle' });
  });
});

describe('throttleText and fillersText', () => {
  it('reads full flow in green, and the throttle in amber', () => {
    expect(throttleText({ throttled: false })).toEqual({ text: 'Full flow', status: 'ok' });
    expect(throttleText({ throttled: true })).toEqual({ text: 'Throttled · tank high', status: 'warn' });
  });

  it('counts the running fillers, and says when they wait for product', () => {
    expect(fillersText({ fillersRunning: 2, fillersStarved: false })).toEqual({ text: '2 running', status: 'ok' });
    expect(fillersText({ fillersRunning: 1, fillersStarved: false })).toEqual({ text: '1 running', status: 'ok' });
    expect(fillersText({ fillersRunning: 0, fillersStarved: true })).toEqual({ text: 'Waiting · tank low', status: 'warn' });
    expect(fillersText({ fillersRunning: 0, fillersStarved: false })).toEqual({ text: 'None running', status: 'idle' });
  });

  it('reads the static plant as producing at full flow with both fillers running', () => {
    const now = liquid();
    expect(uhtModeText(now).text).toBe('Production');
    expect(throttleText(now).text).toBe('Full flow');
    expect(fillersText(now).text).toBe(`${plantConfig.fillers.count} running`);
  });
});

describe('STATE_ROWS', () => {
  it('shows the UHT mode in stage 4, and the throttle where it starts and where it acts (stages 6 and 4)', () => {
    expect(STATE_ROWS[4]?.map((row) => row.key)).toEqual(['uhtMode', 'throttle']);
    expect(STATE_ROWS[6]?.map((row) => row.key)).toEqual(['throttle', 'fillers']);
    for (const stage of [1, 2, 3, 5, 7, 8, 9, 10] as const) expect(STATE_ROWS[stage], `stage ${stage}`).toBeUndefined();
  });

  it('reads every row from the liquid snapshot', () => {
    const throttled = { ...liquid(), throttled: true, uhtMode: 'divert' as const, modeRemainingS: 30 };
    expect(STATE_ROWS[4]?.map((row) => row.read(throttled).text)).toEqual(['Diverting to reject · 30 s left', 'Throttled · tank high']);
  });
});

describe('marginText (stage 4, R6)', () => {
  const { setpointC } = plantConfig.uht;

  it('reads the 0.78 °C margin of D4 at full flow (4 s hold) and 140 °C', () => {
    expect(marginText({ tempC: setpointC, divertLimitC: divertLimitC(4) })).toBe('+0.78 °C');
  });

  it('widens to about 3.9 °C at half flow, where the hold doubles to 8 s and the limit drops to about 136.1 °C', () => {
    expect(divertLimitC(8)).toBeCloseTo(136.06, 2);
    expect(marginText({ tempC: setpointC, divertLimitC: divertLimitC(8) })).toBe('+3.94 °C');
  });

  it('goes negative below the limit, where the plant diverts', () => {
    expect(marginText({ tempC: 139, divertLimitC: divertLimitC(4) })).toBe('-0.22 °C');
  });

  it('shows a dash when either reading is missing', () => {
    expect(marginText({ tempC: 140 })).toBe('—');
    expect(marginText({ divertLimitC: 139.22 })).toBe('—');
    expect(marginText({ tempC: Number.NaN, divertLimitC: 139.22 })).toBe('—');
  });

  it('sits right after the divert limit in the stage 4 panel', () => {
    expect(DERIVED_ROWS[4]).toEqual([expect.objectContaining({ key: 'marginC', after: 'divertLimitC' })]);
  });
});
