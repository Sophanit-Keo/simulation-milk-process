// The yogurt cold chain in words (src/ui/coldChainRows.ts) and the yogurt batch list (src/ui/yogurtBatchList.ts),
// phase 19: on the live sim as it opens, and on hand-made cold chains.
import { describe, expect, it } from 'vitest';
import { hToS, type ColdChainSnapshot, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { chillerText, coldRoomText, reefersText, releaseText, traysText, warmRoomText } from '../../src/ui/coldChainRows';
import { PANEL_STATE_ROWS } from '../../src/ui/panelRows';
import { batchPlacesText, batchReleaseText, yogurtBatchRows } from '../../src/ui/yogurtBatchList';
import { plantConfig } from '../helpers/plantConfig';

const opening = (): Snapshot => {
  const sim = createSim(plantConfig);
  sim.step(0.1);
  return sim.snapshot();
};

const chainWith = (change: (chain: ColdChainSnapshot) => void): ColdChainSnapshot => {
  const chain = structuredClone(opening().yogurt.coldChain);
  change(chain);
  return chain;
};

describe('the stage 16 rows', () => {
  it('read the cold chain as it opens: the last two days in its rooms, a release due within the hour', () => {
    const snap = opening();
    const rows = Object.fromEntries((PANEL_STATE_ROWS[16] ?? []).map((row) => [row.key, row.read(snap)]));
    expect(rows.trays.text).toMatch(/^\d+ trays? packed · (P8-008-1's pallet at \d+ of 120 trays|no pallet building)$/);
    expect(rows.warmRoom).toEqual({ text: expect.stringMatching(/^30 of 36 pallets · pH 4\.\d\d to \d\.\d\d, out at 4\.60$/), status: 'ok' });
    expect(rows.chiller.text).toMatch(/^18 of 32 pallets · air −?-?2 °C · warmest core \d+\.\d °C$/);
    expect(rows.coldRoom).toEqual({ text: '180 of 360 positions · 3.0 °C', status: 'ok' });
    expect(rows.release.text).toMatch(/^In \d+ (min|s|min \d\d s) · \d+ pallets? released, waiting for a reefer$/);
    expect(rows.reefers).toEqual({ text: 'None at the dock · 0 shipped', status: 'idle' });
  });

  it('flag a full room, a cold room out of its band, and say what the reefers do', () => {
    expect(warmRoomText(chainWith((chain) => (chain.warmRoom.pallets = 36))).status).toBe('warn');
    expect(chillerText(chainWith((chain) => (chain.chiller.pallets = 32))).status).toBe('warn');
    expect(coldRoomText(chainWith((chain) => (chain.coldRoom.tempC = 5.2)))).toEqual({ text: '180 of 360 positions · 5.2 °C', status: 'warn' });
    // An excursion (phase 20): the cooling down, then pallets on QA hold (red), then QA's verdict.
    const excursion = { coolingDown: true, overSinceS: null, limitC: 6, holdS: null, palletsHeld: 0, peakCoreC: 4, decisionS: null, verdict: null } as const;
    expect(coldRoomText(chainWith((chain) => Object.assign(chain.coldRoom, { tempC: 5.2, excursion })))).toEqual({ text: '180 of 360 positions · 5.2 °C · cooling down', status: 'warn' });
    expect(coldRoomText(chainWith((chain) => Object.assign(chain.coldRoom, { tempC: 9.6, excursion: { ...excursion, holdS: 1, palletsHeld: 176 } })))).toEqual({
      text: '180 of 360 positions · 9.6 °C · 176 pallets on QA hold',
      status: 'bad',
    });
    expect(coldRoomText(chainWith((chain) => Object.assign(chain.coldRoom, { tempC: 3.4, excursion: { ...excursion, coolingDown: false, verdict: 'destroyed' } })))).toEqual({
      text: '180 of 360 positions · 3.4 °C · QA destroyed the held pallets',
      status: 'ok',
    });
    const timeS = hToS(24 * 7 + 8);
    const reefers = chainWith((chain) => {
      chain.reefers = [
        { id: 7, door: 0, state: 'loading', pallets: 13, load: 26, untilS: timeS + 600 },
        { id: 8, door: 1, state: 'arriving', pallets: 0, load: 26, untilS: timeS + 900 },
      ];
      chain.reefersShipped = 6;
    });
    expect(reefersText(reefers, timeS)).toEqual({ text: 'Reefer 7 loading at door 1, 13 of 26 · reefer 8 backing to door 2 in 15 min · 6 shipped', status: 'ok' });
    expect(releaseText(chainWith((chain) => (chain.coldRoom.nextReleaseS = null)), 0).text).toMatch(/^None on hold · /);
    expect(traysText(chainWith((chain) => (chain.trays = { made: 1, openBatch: null, openCups: 0, openTrays: 0 })))).toEqual({ text: '1 tray packed · no pallet building', status: 'idle' });
    expect(warmRoomText(undefined).text).toBe('—');
  });
});

describe('the yogurt batch list', () => {
  it('groups the opening\'s pallets by batch, oldest first, with where they stand and when the first is out', () => {
    const snap = opening();
    const rows = yogurtBatchRows(snap.yogurt.coldChain);
    // Pallets hold up to about 30 h, so day 6's last two batches are still there with day 7's three.
    expect(rows.map((row) => row.code)).toEqual(['P8-006-2', 'P8-006-3', 'P8-007-1', 'P8-007-2', 'P8-007-3']);
    const night = rows.at(-1);
    expect(night?.product).toBe('plainSet');
    expect(night && batchPlacesText(night)).toMatch(/warm room/);
    const total = rows.reduce((sum, row) => sum + Object.values(row.places).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(snap.yogurt.coldChain.pallets?.length);
    const first = rows[0];
    expect(batchReleaseText(first, snap.timeS)).toMatch(/^\d+ released$|^first out in /);
  });
});
