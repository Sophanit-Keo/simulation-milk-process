// Line P8's states in words (phase 18, D28), for the stage 15 panel: what it does and why it stopped, the batch it
// codes, the last fill against the checkweigher's limits, the rejects by cause, the seal against its window, the HEPA
// cabin, the SIP and the ATP swab, the next seal test, and the magazines. Each reads the snapshot's p8 part; a field an
// older snapshot lacks reads "—".
import type { P8Snapshot, P8StopReason, PlantConfig, Snapshot } from '../contracts';
import plantJson from '../data/plant.json';
import { formatDay, formatDuration, formatNumber, formatSimTime, NO_VALUE, withUnit } from './format';
import type { StateText } from './liquidRows';
import { productName } from './yogurtRows';

const P8: PlantConfig['yogurt']['p8'] = plantJson.yogurt.p8;
const NONE: StateText = { text: NO_VALUE, status: 'idle' };

const STOPS: Readonly<Record<P8StopReason, string>> = {
  hepa: `the HEPA cabin under +${P8.hepa.minPa} Pa`,
  cups: 'the cup magazine is empty',
  foils: 'the foil magazine is empty',
};

/** What P8 does: "Running · 30 cycles a minute", "Stopped: the cup magazine is empty", "Sterilizing (SIP)". */
export function p8StateText(p8: P8Snapshot | undefined): StateText {
  if (!p8) return NONE;
  switch (p8.state) {
    case 'running': {
      const cycles = p8.cyclesPerMin;
      return { text: cycles === undefined ? 'Running' : `Running · ${formatNumber(cycles)} cycles a minute`, status: 'ok' };
    }
    case 'starved':
      return { text: 'Waiting for yogurt · the buffer is empty', status: 'warn' };
    case 'stopped':
      return { text: p8.stopReason ? `Stopped: ${STOPS[p8.stopReason] ?? p8.stopReason}` : 'Stopped', status: 'bad' };
    case 'cleaning':
      return { text: 'Cleaning (the wing\'s CIP)', status: 'warn' };
    case 'sterilizing':
      return { text: 'Sterilizing (SIP)', status: 'warn' };
    case 'idle':
      return { text: 'Ready', status: 'idle' };
    default:
      return NONE;
  }
}

/** The batch it codes on each cup: "P8-008-1 · plain stirred yogurt · best before day 36". */
export function p8BatchText(p8: P8Snapshot | undefined): StateText {
  const batch = p8?.currentBatch;
  if (!batch) return p8?.currentBatch === null ? { text: 'None yet', status: 'idle' } : NONE;
  return { text: `${batch.code} · ${productName(batch.product).toLowerCase()} · best before ${formatDay(batch.expiresS)}`, status: 'ok' };
}

/** The last cup's fill against the checkweigher's limits: "127.2 g · passes 120.5–135 g", amber outside. */
export function p8FillText(p8: P8Snapshot | undefined): StateText {
  const fillG = p8?.lastFillG;
  if (fillG === undefined) return NONE;
  if (fillG === null) return { text: 'No cup yet', status: 'idle' };
  const { underBelowG, overAboveG } = P8.fill;
  const inside = fillG >= underBelowG && fillG <= overAboveG;
  const limits = `${formatNumber(underBelowG, 1)}–${formatNumber(overAboveG)} g`;
  return { text: `${withUnit(formatNumber(fillG, 1), 'g')} · ${inside ? 'passes' : 'rejected, outside'} ${limits}`, status: inside ? 'ok' : 'warn' };
}

/** The rejects by cause since the plant opened: "Fill 0 · metal 4 · vision 21 · seal hold 0"; amber once a seal test held cups. */
export function p8RejectsText(p8: P8Snapshot | undefined): StateText {
  const rejects = p8?.rejects;
  if (!rejects) return NONE;
  const count = (value: number): string => formatNumber(value);
  const text = `Fill ${count(rejects.underFill + rejects.overFill)} · metal ${count(rejects.metal)} · vision ${count(rejects.vision)} · seal hold ${count(rejects.sealHold)}`;
  return { text, status: rejects.sealHold > 0 ? 'warn' : 'ok' };
}

/** The sealing heads against their window (SOP P8 step 5): "200 °C · 1.0 s · 5.0 bar · in its window", red outside. */
export function p8SealText(p8: P8Snapshot | undefined): StateText {
  const seal = p8?.seal;
  if (!seal) return NONE;
  const { minTempC, maxTempC, minTimeS, maxTimeS, minBar, maxBar } = P8.seal;
  const inside = seal.tempC >= minTempC && seal.tempC <= maxTempC && seal.timeS >= minTimeS && seal.timeS <= maxTimeS && seal.bar >= minBar && seal.bar <= maxBar;
  const text = `${withUnit(formatNumber(seal.tempC), '°C')} · ${withUnit(formatNumber(seal.timeS, 1), 's')} · ${withUnit(formatNumber(seal.bar, 1), 'bar')}`;
  return { text: `${text} · ${inside ? 'in its window' : 'out of its window'}`, status: inside ? 'ok' : 'bad' };
}

/** The HEPA cabin's overpressure: "+25.0 Pa · stops under +15 Pa", red under the limit. */
export function p8HepaText(p8: P8Snapshot | undefined): StateText {
  const pa = p8?.hepaPa;
  if (pa === undefined || !Number.isFinite(pa)) return NONE;
  return { text: `+${withUnit(formatNumber(pa, 1), 'Pa')} · stops under +${P8.hepa.minPa} Pa`, status: pa < P8.hepa.minPa ? 'bad' : 'ok' };
}

/** The last SIP and ATP swab: "SIP passed day 7 · 23:40 · ATP 4.0 RLU", red when either failed. */
export function p8HygieneText(p8: P8Snapshot | undefined): StateText {
  const { sip, atpRlu } = p8 ?? {};
  if (!sip) return NONE;
  const when = sip.lastS === null ? '' : ` ${formatSimTime(sip.lastS)}`;
  const swab = atpRlu === null || atpRlu === undefined ? '' : ` · ATP ${withUnit(formatNumber(atpRlu, 1), 'RLU')}`;
  const swabOk = atpRlu === null || atpRlu === undefined || atpRlu < P8.atpMaxRlu;
  return { text: `SIP ${sip.ok ? 'passed' : 'failed'}${when}${swab}`, status: sip.ok && swabOk ? 'ok' : 'bad' };
}

/** The next seal test and the tests so far: "In 1 h 20 min · 3 passed, 0 failed"; amber after a failure. */
export function p8SealTestText(p8: P8Snapshot | undefined, timeS: number): StateText {
  if (!p8 || p8.nextSealTestS === undefined) return NONE;
  const tests = p8.sealTests ? ` · ${formatNumber(p8.sealTests.passed)} passed, ${formatNumber(p8.sealTests.failed)} failed` : '';
  const when = p8.nextSealTestS === null ? 'When P8 runs' : `In ${formatDuration(Math.max(0, p8.nextSealTestS - timeS))}`;
  return { text: `${when}${tests}`, status: (p8.sealTests?.failed ?? 0) > 0 ? 'warn' : p8.nextSealTestS === null ? 'idle' : 'ok' };
}

/** The magazines: "Cups 96% · foils 35%"; amber once one is down to its refill call, red when one is empty. */
export function p8MagazinesText(p8: P8Snapshot | undefined): StateText {
  const magazines = p8?.magazines;
  if (!magazines) return NONE;
  const { cupsPct, foilsPct } = magazines;
  const callPct = 100 * P8.magazines.refillBelowFrac;
  const lowest = Math.min(cupsPct, foilsPct);
  const status = lowest < (100 * P8.lanes) / Math.min(P8.magazines.cups, P8.magazines.foils) ? 'bad' : lowest <= callPct ? 'warn' : 'ok';
  return { text: `Cups ${withUnit(formatNumber(cupsPct), '%')} · foils ${withUnit(formatNumber(foilsPct), '%')}`, status };
}

/** P8's part of a snapshot, or undefined for one without the yogurt line. */
export const p8Of = (snapshot: Snapshot): P8Snapshot | undefined => (snapshot as Partial<Snapshot>).yogurt?.p8;
