// A machine explained in its stage's panel (phase 28): what it is, why the plant needs it and how it works, from
// src/data/machineNotes.json (process's text), with a few live readings on top. Stage 12 explains the holding cell and,
// since phase 32, the wing's CIP station; stage 15 Line P8 and, since phase 31, each machine of the cup filling room. Each note is a <details>, open by default
// unless the file says "open": false (the room's machines); whether a viewer opened or closed it is kept for the session.
import type { CleaningSnapshot, PlantConfig, Snapshot, StageId, YogurtSnapshot } from '../contracts';
import plantJson from '../data/plant.json';
import notesJson from '../data/machineNotes.json';
import { el, setText } from './dom';
import { formatDay, formatDuration, formatNumber, NO_VALUE, withUnit } from './format';
import { CLEANING_RETURN_TEXT, cleaningText } from './liquidRows';
import type { PanelPart } from './stagePanel';

const PLANT: PlantConfig = plantJson;
const Y = PLANT.yogurt;

export interface NoteSection {
  heading: string;
  text: string;
}

export interface MachineNote {
  id: string;
  stage: StageId;
  title: string;
  /** One line under the title, shown while the note is closed too. */
  summary: string;
  sections: NoteSection[];
  /** Whether the note starts open; true if left out. */
  open: boolean;
}

/** A live reading at the top of a note: its text, and whether it is fine ('ok'), a warning or a fault. */
export interface NoteFact {
  text: string;
  state: 'ok' | 'warn' | 'bad' | 'idle';
}

type FactReader = (yogurt: YogurtSnapshot, snapshot: Snapshot) => NoteFact;

/** Checks src/data/machineNotes.json: each note once, on a stage, with a title, a summary and sections of text. */
export function parseMachineNotes(json: unknown): readonly MachineNote[] {
  const list = (json as { notes?: unknown })?.notes;
  if (!Array.isArray(list) || list.length === 0) throw new Error('machineNotes.json needs a "notes" list');
  const ids = new Set<string>();
  return list.map((raw, i): MachineNote => {
    const note = raw as Partial<MachineNote>;
    const where = `machineNotes.json note ${i + 1}`;
    if (!note.id?.trim() || !note.title?.trim() || !note.summary?.trim()) throw new Error(`${where}: needs an id, a title and a summary`);
    if (ids.has(note.id)) throw new Error(`${where}: "${note.id}" appears twice`);
    ids.add(note.id);
    if (typeof note.stage !== 'number' || note.stage < 1 || note.stage > 16) throw new Error(`${where}: ${String(note.stage)} is not a stage`);
    if (!Array.isArray(note.sections) || note.sections.length === 0) throw new Error(`${where}: needs sections`);
    const sections = note.sections.map((section, j) => {
      if (!section?.heading?.trim() || !section.text?.trim()) throw new Error(`${where}, section ${j + 1}: needs a heading and its text`);
      return { heading: section.heading, text: section.text };
    });
    const open = (raw as { open?: unknown }).open;
    if (open !== undefined && typeof open !== 'boolean') throw new Error(`${where}: "open" must be true or false`);
    return { id: note.id, stage: note.stage as StageId, title: note.title, summary: note.summary, sections, open: open ?? true };
  });
}

export const MACHINE_NOTES: readonly MachineNote[] = parseMachineNotes(notesJson);

const yogurtOf = (snapshot: Snapshot): YogurtSnapshot | undefined => (snapshot as Partial<Snapshot>).yogurt;
const degC = (value: number, decimals = 1): string => withUnit(formatNumber(value, decimals), '°C');
const pct = (value: number, decimals = 0): string => withUnit(formatNumber(value, decimals), '%');

/** What the CCP does with the mix at the holding cell's outlet now. */
function ccpFact(yogurt: YogurtSnapshot): NoteFact {
  switch (yogurt.heat.mode) {
    case 'production':
      return { text: 'Forward to the culture: hot enough, held long enough', state: 'ok' };
    case 'divert':
      return { text: 'Diverting to the reprocess tank', state: 'bad' };
    case 'cleaning':
      return { text: `Cleaning after a divert · ${formatDuration(yogurt.heat.modeRemainingS ?? 0)} left`, state: 'warn' };
    default:
      return { text: 'No mix flows', state: 'idle' };
  }
}

const P8_STATE_TEXT = { running: 'Running', idle: 'Standing ready', cleaning: 'Cleaning in place', sterilizing: 'Sterilizing with steam (SIP)', starved: 'Waiting for the buffer', stopped: 'Stopped' } as const;
const STOP_WHY = { hepa: 'the HEPA cabin under its limit', cups: 'the cup magazine is empty', foils: 'the foil magazine is empty' } as const;

const grams = (value: number, decimals = 0): string => withUnit(formatNumber(value, decimals), 'g');
const refillMarkPct = Y.p8.magazines.refillBelowFrac * 100;

/** The last cup's weight against the checkweigher's limits. */
const lastCup: FactReader = (y) =>
  y.p8.lastFillG === null || y.p8.lastFillG === undefined
    ? { text: NO_VALUE, state: 'idle' }
    : { text: `${grams(y.p8.lastFillG, 1)}, the target ${grams(Y.p8.fill.targetG)}`, state: y.p8.lastFillG < Y.p8.fill.underBelowG || y.p8.lastFillG > Y.p8.fill.overAboveG ? 'bad' : 'ok' };
const sealing: FactReader = (y) => {
  const seal = y.p8.seal;
  if (!seal) return { text: NO_VALUE, state: 'idle' };
  const s = Y.p8.seal;
  const outside = seal.tempC < s.minTempC || seal.tempC > s.maxTempC || seal.timeS < s.minTimeS || seal.timeS > s.maxTimeS || seal.bar < s.minBar || seal.bar > s.maxBar;
  return { text: `${degC(seal.tempC, 0)} · ${withUnit(formatNumber(seal.timeS, 1), 's')} · ${withUnit(formatNumber(seal.bar, 1), 'bar')}`, state: outside ? 'warn' : 'ok' };
};
const hepaCabin: FactReader = (y) => {
  const pa = y.p8.hepaPa;
  if (pa === undefined) return { text: NO_VALUE, state: 'idle' };
  return { text: `+${formatNumber(pa, 1)} Pa, the limit +${formatNumber(Y.p8.hepa.minPa)} Pa`, state: pa < Y.p8.hepa.minPa ? 'bad' : 'ok' };
};
const nextSealTest: FactReader = (y, s) => {
  const next = y.p8.nextSealTestS;
  return next === null || next === undefined ? { text: 'Only while it runs', state: 'idle' } : { text: `in ${formatDuration(Math.max(0, next - s.timeS))}`, state: 'ok' };
};
/** One magazine's level: amber while it is under its refill mark, red once it has run out and stopped the line. */
const magazine = (which: 'cups' | 'foils'): FactReader => (y) => {
  const m = y.p8.magazines;
  if (!m) return { text: NO_VALUE, state: 'idle' };
  const level = which === 'cups' ? m.cupsPct : m.foilsPct;
  if (y.p8.stopReason === which) return { text: `${pct(level)} · empty, P8 waits for its refill`, state: 'bad' };
  return level <= refillMarkPct ? { text: `${pct(level)} · being refilled`, state: 'warn' } : { text: pct(level), state: 'ok' };
};
/** Cups a check has thrown out so far: fine at none, a warning once there are some. */
const thrownOut = (count: (y: YogurtSnapshot) => number | undefined): FactReader => (y) => {
  const n = count(y);
  return n === undefined ? { text: NO_VALUE, state: 'idle' } : { text: `${formatNumber(n)} cups`, state: n > 0 ? 'warn' : 'ok' };
};
const whileRunning = (running: string): FactReader => (y) => (y.p8.state === 'running' ? { text: running, state: 'ok' } : { text: 'Standing', state: 'idle' });

/** A wing clean's step, as the UHT panel words its own: "Lye (NaOH), 78 °C · 2 of 5 · 12 min left". */
const stepFact = (step: CleaningSnapshot | null | undefined): NoteFact => {
  const text = cleaningText({ cleaning: step ?? null });
  return step ? { text: text.text, state: 'warn' } : { text: 'Cleaning in place', state: 'warn' };
};
const STANDING_BY: NoteFact = { text: 'Standing by', state: 'idle' };
/** The tanks that clean now, the one furthest into its clean first (as the 3D view's circuit shows it). */
const cleaningTanks = (y: YogurtSnapshot): number[] =>
  y.ferment.tanks
    .map((tank, i) => (tank.state === 'cleaning' ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => {
      const far = (i: number): number => (y.ferment.tanks[i]?.cleaning ? (y.ferment.tanks[i]?.cleaning?.stepIndex ?? 0) * 1e6 - (y.ferment.tanks[i]?.cleaning?.stepRemainingS ?? 0) : 0);
      return far(b) - far(a);
    });
/** What each of the station's circuits runs now: its step, a rinse, or nothing. */
const circuitSteps = (y: YogurtSnapshot): { what: string; step: CleaningSnapshot | null }[] => {
  const out: { what: string; step: CleaningSnapshot | null }[] = [];
  if (y.heat.mode === 'cleaning') out.push({ what: 'heat treatment', step: y.heat.cleaning ?? null });
  for (const i of cleaningTanks(y)) out.push({ what: `tank ${i + 1}`, step: y.ferment.tanks[i]?.cleaning ?? null });
  if (y.buffer.changeover?.kind === 'cip') out.push({ what: 'buffer and P8', step: y.buffer.changeover.cleaning ?? null });
  return out;
};
const RINSE_TEXT = 'Rinse of the buffer and the fruit line';

/** Each note's live readings, by label, in the order shown. */
export const NOTE_FACTS: Readonly<Record<string, Readonly<Record<string, FactReader>>>> = {
  holdingCell: {
    'At the outlet': (y) => {
      const flowing = y.heat.flowLph > 0;
      const under = y.heat.outletC < Y.heat.divertBelowC;
      return { text: `${degC(y.heat.outletC)}, the limit ${degC(Y.heat.divertBelowC, 0)}`, state: !flowing ? 'idle' : under ? 'bad' : 'ok' };
    },
    Held: (y) =>
      y.heat.flowLph > 0
        ? { text: `${formatDuration(y.heat.holdS)} at ${withUnit(formatNumber(y.heat.flowLph), 'L/h')}, the limit ${withUnit(formatNumber(Y.heat.minHoldS / 60), 'min')}`, state: y.heat.holdS < Y.heat.minHoldS ? 'bad' : 'ok' }
        : { text: 'No mix flows', state: 'idle' },
    'Whey protein denatured': (y) => ({
      text: `${pct(y.heat.denatPct, 1)}, the target ${pct(Y.heat.denatTargetPct)}`,
      state: y.heat.flowLph <= 0 ? 'idle' : y.heat.denatPct < Y.heat.denatTargetPct ? 'warn' : 'ok',
    }),
    'The CCP': (y) => ccpFact(y),
    'Diverts so far': (y) => ({ text: formatNumber(y.heat.divertCount), state: y.heat.divertCount > 0 ? 'warn' : 'ok' }),
  },
  // Phase 32: the wing's CIP station, a circuit a row, then where the returns go and what the cleans have used.
  wingCip: {
    'Heat treatment': (y) => (y.heat.mode === 'cleaning' ? stepFact(y.heat.cleaning) : STANDING_BY),
    'Fermentation tanks': (y) => {
      const tanks = cleaningTanks(y);
      if (tanks.length === 0) return STANDING_BY;
      return { text: tanks.map((i) => `Tank ${i + 1}: ${stepFact(y.ferment.tanks[i]?.cleaning).text}`).join('; '), state: 'warn' };
    },
    'Buffer and P8': (y) => {
      const changeover = y.buffer.changeover;
      if (changeover?.kind === 'cip') return stepFact(changeover.cleaning);
      if (changeover?.kind === 'rinse') return { text: `${RINSE_TEXT} · ${formatDuration(changeover.remainingS)} left`, state: 'warn' };
      return STANDING_BY;
    },
    Returns: (y) => {
      const returns = circuitSteps(y).flatMap(({ what, step }) => (step?.returnTo ? [`${what} ${CLEANING_RETURN_TEXT[step.returnTo] ?? step.returnTo}`] : []));
      if (y.buffer.changeover?.kind === 'rinse') returns.push(`buffer and P8 ${CLEANING_RETURN_TEXT.drain}`);
      return returns.length === 0 ? { text: 'None', state: 'idle' } : { text: returns.join('; '), state: 'ok' };
    },
    'Used since opening': (y) => {
      const use = y.cleaningUse;
      if (!use) return { text: NO_VALUE, state: 'idle' };
      return {
        text: `${withUnit(formatNumber(use.lyeKg, 1), 'kg')} NaOH · ${withUnit(formatNumber(use.acidKg, 1), 'kg')} HNO₃ · ${withUnit(formatNumber(use.drainWaterL), 'L')} water`,
        state: use.lyeKg + use.acidKg + use.drainWaterL > 0 ? 'ok' : 'idle',
      };
    },
  },
  p8: {
    Now: (y) => {
      const { p8 } = y;
      if (p8.state === 'stopped') return { text: `Stopped: ${p8.stopReason ? STOP_WHY[p8.stopReason] : 'an interlock'}`, state: 'bad' };
      const state = p8.state === 'running' ? 'ok' : p8.state === 'idle' ? 'idle' : 'warn';
      return { text: P8_STATE_TEXT[p8.state], state };
    },
    Speed: (y) => ({
      text: `${formatNumber(y.p8.cyclesPerMin ?? 0)} cycles a min · ${withUnit(formatNumber(y.p8.cupsPerH), 'cups/h')}`,
      state: y.p8.state === 'running' ? 'ok' : 'idle',
    }),
    'Last cup': lastCup,
    Sealing: sealing,
    'HEPA cabin': hepaCabin,
    Magazines: (y) => {
      const m = y.p8.magazines;
      if (!m) return { text: NO_VALUE, state: 'idle' };
      const low = Math.min(m.cupsPct, m.foilsPct) < refillMarkPct;
      return { text: `cups ${pct(m.cupsPct)} · foils ${pct(m.foilsPct)}`, state: low ? 'warn' : 'ok' };
    },
    'Next seal test': nextSealTest,
  },
  // Phase 31: the cup filling room's machines, one note each.
  p8Denester: {
    'Cups set down': (y) => (y.p8.state === 'running' ? { text: `${formatNumber((y.p8.cyclesPerMin ?? 0) * Y.p8.lanes)} a minute`, state: 'ok' } : { text: 'Standing', state: 'idle' }),
    'Cup magazine': magazine('cups'),
    'UV-C tunnel': whileRunning('Lit'),
  },
  p8Dosing: {
    'Last cup': lastCup,
    'Feed from the buffer': (y) =>
      y.p8.state === 'running' && y.buffer.levelL > 0
        ? { text: `Open · ${withUnit(formatNumber(y.buffer.levelL), 'L')} in the buffer`, state: 'ok' }
        : { text: y.p8.state === 'starved' ? 'The buffer is empty' : 'Shut', state: y.p8.state === 'starved' ? 'warn' : 'idle' },
    Doses: (y) => (y.p8.state === 'running' ? { text: `${formatNumber(y.p8.cupsPerH)} an hour`, state: 'ok' } : { text: 'Standing', state: 'idle' }),
  },
  p8Sealing: {
    Sealing: sealing,
    'Foil magazine': magazine('foils'),
    'Printed on the lid': (y) => {
      const batch = y.p8.currentBatch;
      return batch ? { text: `${batch.code} · best before ${formatDay(batch.expiresS)}`, state: 'ok' } : { text: NO_VALUE, state: 'idle' };
    },
  },
  checkweigher: {
    'Last cup': lastCup,
    Passes: () => ({ text: `${formatNumber(Y.p8.fill.underBelowG, 1)}–${grams(Y.p8.fill.overAboveG)}`, state: 'ok' }),
    'Under-filled': thrownOut((y) => y.p8.rejects?.underFill),
    'Over-filled': thrownOut((y) => y.p8.rejects?.overFill),
  },
  metalDetector: {
    Now: whileRunning('Searching every cup'),
    'Thrown out': thrownOut((y) => y.p8.rejects?.metal),
  },
  visionCheck: {
    Now: whileRunning('Looking at every lid'),
    'Thrown out': thrownOut((y) => y.p8.rejects?.vision),
    'In the reject bin': thrownOut((y) => y.p8.cupsRejected),
  },
  airUnit: {
    'HEPA cabin': hepaCabin,
    Fans: (y) => {
      const pa = y.p8.hepaPa;
      if (pa === undefined) return { text: NO_VALUE, state: 'idle' };
      return pa < Y.p8.hepa.minPa ? { text: 'Stopped', state: 'bad' } : { text: 'Running', state: 'ok' };
    },
  },
  cipSip: {
    Now: (y) =>
      y.p8.state === 'cleaning'
        ? { text: 'Cleaning in place', state: 'warn' }
        : y.p8.state === 'sterilizing'
          ? { text: `Sterilizing with steam at ${degC(Y.p8.sip.runC, 0)}`, state: 'warn' }
          : { text: 'Standing by', state: 'idle' },
    'Last SIP': (y) => {
      const sip = y.p8.sip;
      if (!sip || sip.lastS === null) return { text: NO_VALUE, state: 'idle' };
      return sip.ok ? { text: `Passed, ${formatDay(sip.lastS)}`, state: 'ok' } : { text: `Fell short, ${formatDay(sip.lastS)}`, state: 'bad' };
    },
    'ATP swab': (y) => {
      const rlu = y.p8.atpRlu;
      if (rlu === null || rlu === undefined) return { text: NO_VALUE, state: 'idle' };
      return { text: `${formatNumber(rlu, 1)} RLU, must be under ${formatNumber(Y.p8.atpMaxRlu)} RLU`, state: rlu < Y.p8.atpMaxRlu ? 'ok' : 'bad' };
    },
  },
  qaBench: {
    'Next seal test': nextSealTest,
    'Tests so far': (y) => {
      const t = y.p8.sealTests;
      if (!t) return { text: NO_VALUE, state: 'idle' };
      return { text: `${formatNumber(t.passed)} passed · ${formatNumber(t.failed)} failed`, state: t.failed > 0 ? 'bad' : 'ok' };
    },
    'Cups held back': thrownOut((y) => y.p8.rejects?.sealHold),
  },
  supplies: {
    'Cup magazine': magazine('cups'),
    'Foil magazine': magazine('foils'),
    Operator: (y) => {
      const m = y.p8.magazines;
      if (y.p8.stopReason === 'cups' || (m && m.cupsPct <= refillMarkPct)) return { text: 'At the de-nester, loading cups', state: 'warn' };
      if (y.p8.stopReason === 'foils' || (m && m.foilsPct <= refillMarkPct)) return { text: 'At the lidder, loading foils', state: 'warn' };
      return { text: 'At the screen', state: 'ok' };
    },
  },
};

/** A note's live readings now, by label, or null for a snapshot without the yogurt line. */
export function noteFacts(id: string, snapshot: Snapshot): Record<string, NoteFact> | null {
  const yogurt = yogurtOf(snapshot);
  const readers = NOTE_FACTS[id];
  if (!yogurt || !readers) return null;
  return Object.fromEntries(Object.entries(readers).map(([label, read]) => [label, read(yogurt, snapshot)]));
}

/** The notes a stage's panel shows. */
export const notesFor = (stage: StageId): readonly MachineNote[] => MACHINE_NOTES.filter((note) => note.stage === stage);

/** Whether a viewer opened or closed a note, for the session, by its id; until then it is as its file says. */
const toggled = new Map<string, boolean>();

/**
 * The panel part (stagePanel.ts parts): one <details> a note, its title and summary as the summary line, then its live
 * readings and its sections of text.
 */
export function createMachineNotes(host: HTMLElement, stage: StageId): PanelPart {
  const built = notesFor(stage).map((note) => {
    const section = el('section', 'p-notes');
    section.dataset.testid = 'machine-notes';
    section.dataset.note = note.id;
    const details = el('details', 'notes');
    details.open = toggled.get(note.id) ?? note.open;
    details.addEventListener('toggle', () => toggled.set(note.id, details.open));
    const summary = el('summary', 'notes-head');
    summary.append(el('span', 'notes-title', note.title), el('span', 'notes-summary', note.summary));
    const facts = el('dl', 'notes-facts');
    const cells = Object.keys(NOTE_FACTS[note.id] ?? {}).map((label) => {
      const row = el('div', 'notes-fact');
      row.dataset.fact = label;
      row.dataset.state = 'idle';
      const value = el('dd', '', NO_VALUE);
      row.append(el('dt', '', label), value);
      facts.append(row);
      return { label, row, value };
    });
    details.append(summary, facts);
    for (const part of note.sections) details.append(el('h4', 'notes-heading', part.heading), el('p', 'notes-text', part.text));
    section.append(details);
    host.append(section);
    return { note, section, cells };
  });
  return {
    update(snapshot) {
      for (const { note, cells } of built) {
        const facts = noteFacts(note.id, snapshot);
        if (!facts) continue;
        for (const cell of cells) {
          const fact = facts[cell.label];
          if (!fact) continue;
          if (cell.row.dataset.state !== fact.state) cell.row.dataset.state = fact.state;
          setText(cell.value, fact.text);
        }
      }
    },
    dispose() {
      for (const { section } of built) section.remove();
    },
  };
}
