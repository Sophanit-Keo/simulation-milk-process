// A machine explained in its stage's panel (phase 28): what it is, why the plant needs it and how it works, from
// src/data/machineNotes.json (process's text), with a few live readings on top. Stage 12 explains the holding cell,
// stage 15 Line P8. Each note is a <details>, open by default; whether a viewer closed it is kept for the session.
import type { PlantConfig, Snapshot, StageId, YogurtSnapshot } from '../contracts';
import plantJson from '../data/plant.json';
import notesJson from '../data/machineNotes.json';
import { el, setText } from './dom';
import { formatDuration, formatNumber, NO_VALUE, withUnit } from './format';
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
    return { id: note.id, stage: note.stage as StageId, title: note.title, summary: note.summary, sections };
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
    'Last cup': (y) =>
      y.p8.lastFillG === null || y.p8.lastFillG === undefined
        ? { text: NO_VALUE, state: 'idle' }
        : { text: `${withUnit(formatNumber(y.p8.lastFillG, 1), 'g')}, the target ${withUnit(formatNumber(Y.p8.fill.targetG), 'g')}`, state: y.p8.lastFillG < Y.p8.fill.underBelowG || y.p8.lastFillG > Y.p8.fill.overAboveG ? 'bad' : 'ok' },
    Sealing: (y) => {
      const seal = y.p8.seal;
      if (!seal) return { text: NO_VALUE, state: 'idle' };
      const s = Y.p8.seal;
      const outside = seal.tempC < s.minTempC || seal.tempC > s.maxTempC || seal.timeS < s.minTimeS || seal.timeS > s.maxTimeS || seal.bar < s.minBar || seal.bar > s.maxBar;
      return { text: `${degC(seal.tempC, 0)} · ${withUnit(formatNumber(seal.timeS, 1), 's')} · ${withUnit(formatNumber(seal.bar, 1), 'bar')}`, state: outside ? 'warn' : 'ok' };
    },
    'HEPA cabin': (y) => {
      const pa = y.p8.hepaPa;
      if (pa === undefined) return { text: NO_VALUE, state: 'idle' };
      return { text: `+${formatNumber(pa, 1)} Pa, the limit +${formatNumber(Y.p8.hepa.minPa)} Pa`, state: pa < Y.p8.hepa.minPa ? 'bad' : 'ok' };
    },
    Magazines: (y) => {
      const m = y.p8.magazines;
      if (!m) return { text: NO_VALUE, state: 'idle' };
      const low = Math.min(m.cupsPct, m.foilsPct) < Y.p8.magazines.refillBelowFrac * 100;
      return { text: `cups ${pct(m.cupsPct)} · foils ${pct(m.foilsPct)}`, state: low ? 'warn' : 'ok' };
    },
    'Next seal test': (y, s) => {
      const next = y.p8.nextSealTestS;
      return next === null || next === undefined ? { text: 'Only while it runs', state: 'idle' } : { text: `in ${formatDuration(Math.max(0, next - s.timeS))}`, state: 'ok' };
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

/** Whether a viewer closed a note, for the session, by its id; open by default. */
const closed = new Set<string>();

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
    details.open = !closed.has(note.id);
    details.addEventListener('toggle', () => {
      if (details.open) closed.delete(note.id);
      else closed.add(note.id);
    });
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
