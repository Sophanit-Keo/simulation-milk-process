// The info panel's words for the liquid line (src/ui/liquidRows.ts): the UHT mode with the time left, the
// throttle and the fillers, and the margin over the divert limit that makes R6 visible in the stage 4 panel.
import { describe, expect, it } from 'vitest';
import { CLEANING_STEP_IDS, UHT_MODES, type CleaningSnapshot, type LiquidSnapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { divertLimitC } from '../../src/sim/formulas';
import {
  CLEANING_STEP_TEXT,
  cleaningText,
  DERIVED_ROWS,
  feedText,
  fillersText,
  marginText,
  STATE_ROWS,
  supplyText,
  throttleText,
  uhtModeText,
} from '../../src/ui/liquidRows';
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

describe('cleaningText (phase 7)', () => {
  const lye: CleaningSnapshot = {
    program: 'cip',
    step: 'lye',
    fluid: 'lye',
    stepIndex: 1,
    stepCount: 6,
    stepRemainingS: 1_740,
    tempC: 75,
    flowLph: plantConfig.cleaning.circulateLph,
  };

  it('reads a CIP step with its temperature, its place in the programme and the time left, in amber', () => {
    expect(cleaningText({ cleaning: lye })).toEqual({ text: 'Lye (NaOH), 75 °C · 2 of 6 · 29 min left', status: 'warn' });
    expect(cleaningText({ cleaning: { ...lye, step: 'acid', fluid: 'acid', stepIndex: 3, tempC: 70, stepRemainingS: 90 } }).text).toBe(
      'Acid (HNO₃), 70 °C · 4 of 6 · 1 min 30 s left',
    );
  });

  it('leaves out the temperature of an AIC step, which holds the UHT set point', () => {
    const displace: CleaningSnapshot = { ...lye, program: 'aic', step: 'displace', fluid: 'water', stepIndex: 0, stepCount: 3, tempC: null, stepRemainingS: 300 };
    expect(cleaningText({ cleaning: displace }).text).toBe('Water displaces milk · 1 of 3 · 5 min 00 s left');
  });

  it('reads "None", unlit, while no programme runs, and from a snapshot older than contracts v5', () => {
    expect(cleaningText({ cleaning: null })).toEqual({ text: 'None', status: 'idle' });
    expect(cleaningText({})).toEqual({ text: 'None', status: 'idle' });
    expect(cleaningText(liquid())).toEqual({ text: 'None', status: 'idle' });
  });

  it('has words for every step of the contract, each different', () => {
    const texts = CLEANING_STEP_IDS.map((step) => CLEANING_STEP_TEXT[step]);
    expect(texts.every(Boolean)).toBe(true);
    expect(new Set(texts).size).toBe(CLEANING_STEP_IDS.length);
  });
});

describe('throttleText and fillersText', () => {
  it('reads full flow in green, and the throttle in amber', () => {
    expect(throttleText({ throttled: false })).toEqual({ text: 'Full flow', status: 'ok' });
    expect(throttleText({ throttled: true })).toEqual({ text: 'Throttled · tank high', status: 'warn' });
  });

  it('stage 4\'s feed keeps flowing while diverting and stops for a clean; stage 6 gets nothing in either', () => {
    for (const throttled of [false, true]) {
      expect(feedText({ throttled, uhtMode: 'divert' })).toEqual(throttleText({ throttled }));
      expect(supplyText({ throttled, uhtMode: 'production' })).toEqual(throttleText({ throttled }));
    }
    for (const uhtMode of ['cip', 'sterilize', 'aic'] as const) {
      expect(feedText({ throttled: false, uhtMode })).toEqual({ text: 'Stopped · no milk', status: 'idle' });
      expect(supplyText({ throttled: false, uhtMode })).toEqual({ text: 'No inflow · cleaning', status: 'warn' });
    }
    expect(supplyText({ throttled: false, uhtMode: 'divert' })).toEqual({ text: 'No inflow · diverting', status: 'warn' });
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
  it('shows the UHT mode and the cleaning step in stage 4, and the throttle where it starts and where it acts (stages 6 and 4)', () => {
    expect(STATE_ROWS[4]?.map((row) => row.key)).toEqual(['uhtMode', 'cleaning', 'throttle']);
    expect(STATE_ROWS[6]?.map((row) => row.key)).toEqual(['throttle', 'fillers']);
    for (const stage of [1, 2, 3, 5, 7, 8, 9, 10] as const) expect(STATE_ROWS[stage], `stage ${stage}`).toBeUndefined();
  });

  it('reads every row from the liquid snapshot', () => {
    const throttled = { ...liquid(), throttled: true, uhtMode: 'divert' as const, modeRemainingS: 30 };
    expect(STATE_ROWS[4]?.map((row) => row.read(throttled).text)).toEqual(['Diverting to reject · 30 s left', 'None', 'Throttled · tank high']);
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

  it('shows a dash while no milk flows through the holding tube (a clean), whatever the lye or hot water reads', () => {
    expect(marginText({ tempC: 75, divertLimitC: divertLimitC(4), flowLph: 0 })).toBe('—');
    expect(marginText({ tempC: setpointC, divertLimitC: divertLimitC(4), flowLph: 16_000 })).toBe('+0.78 °C');
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
