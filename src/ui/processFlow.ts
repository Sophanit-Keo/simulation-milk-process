// The yogurt line's process flow, step by step (phase 22): each stage 11–16's equipment in flow order
// (src/data/yogurtFlow.json, process's text), with the live reading at each step and the step's state, drawn in the
// stage's panel as a track whose dots run at the live flow.
//
// A step's state says what the product does there now:
// - 'flow': the product moves through it (the track's dots run);
// - 'hold': the product is in it but stands (a tank fermenting, pallets in a room);
// - 'warn' / 'bad': it cleans, waits or warns / it diverts, stops or holds product back;
// - 'idle': nothing is in it now;
// - 'skip': the product of this shift does not pass it (set yogurt skips the tanks and the cooler, stirred the warm
//   room; the divert's reprocess tank while nothing diverts).
import { fracToPct, YOGURT_STAGE_IDS, type FermentTank, type PlantConfig, type Snapshot, type StageId, type YogurtSnapshot, type YogurtStageId } from '../contracts';
import plantJson from '../data/plant.json';
import flowJson from '../data/yogurtFlow.json';
import { coldChainOf, coldRoomText, reefersText } from './coldChainRows';
import { el, setText } from './dom';
import { formatDuration, formatNumber, NO_VALUE, withUnit } from './format';
import type { StateText } from './liquidRows';
import type { PanelPart } from './stagePanel';
import { tankText } from './yogurtRows';

const PLANT: PlantConfig = plantJson;
const Y = PLANT.yogurt;

export type FlowState = 'flow' | 'hold' | 'warn' | 'bad' | 'idle' | 'skip';

export const FLOW_STATES: readonly FlowState[] = ['flow', 'hold', 'warn', 'bad', 'idle', 'skip'];

/** One step as yogurtFlow.json gives it. */
export interface FlowStepInfo {
  id: string;
  name: string;
  does: string;
  /** A side branch off the main flow (the reprocess tank, set yogurt's route past the tanks). */
  branch?: boolean;
}

/** One step as the panel shows it now. */
export interface FlowStepView extends FlowStepInfo {
  text: string;
  state: FlowState;
}

/** A stage's flow now: its steps, and how fast the product moves, as a share of the stage's full rate (0 when it stands). */
export interface FlowView {
  stage: YogurtStageId;
  steps: FlowStepView[];
  rateFrac: number;
}

/** Checks src/data/yogurtFlow.json: each yogurt stage once, its steps with ids unique in it, a name and a sentence. */
export function parseYogurtFlow(json: unknown): ReadonlyMap<YogurtStageId, readonly FlowStepInfo[]> {
  const list = (json as { stages?: unknown })?.stages;
  if (!Array.isArray(list)) throw new Error('yogurtFlow.json needs a "stages" list');
  const out = new Map<YogurtStageId, FlowStepInfo[]>();
  for (const [index, raw] of list.entries()) {
    const entry = raw as { stage?: unknown; steps?: unknown };
    const where = `yogurtFlow.json entry ${index + 1}`;
    if (!YOGURT_STAGE_IDS.includes(entry.stage as YogurtStageId)) throw new Error(`${where}: ${String(entry.stage)} is not a yogurt stage`);
    const stage = entry.stage as YogurtStageId;
    if (out.has(stage)) throw new Error(`${where}: stage ${stage} appears twice`);
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) throw new Error(`${where}: needs steps`);
    const ids = new Set<string>();
    const steps = (entry.steps as Partial<FlowStepInfo>[]).map((step, i): FlowStepInfo => {
      if (!step.id?.trim() || !step.name?.trim() || !step.does?.trim()) throw new Error(`${where}, step ${i + 1}: needs an id, a name and what it does`);
      if (ids.has(step.id)) throw new Error(`${where}: step "${step.id}" appears twice`);
      ids.add(step.id);
      return { id: step.id, name: step.name, does: step.does, ...(step.branch ? { branch: true } : {}) };
    });
    out.set(stage, steps);
  }
  for (const stage of YOGURT_STAGE_IDS) if (!out.has(stage)) throw new Error(`yogurtFlow.json has no stage ${stage}`);
  return out;
}

export const YOGURT_FLOW: ReadonlyMap<YogurtStageId, readonly FlowStepInfo[]> = parseYogurtFlow(flowJson);

export const isYogurtStage = (stage: StageId): stage is YogurtStageId => (YOGURT_STAGE_IDS as readonly StageId[]).includes(stage);

const yogurtOf = (snapshot: Snapshot): YogurtSnapshot | undefined => (snapshot as Partial<Snapshot>).yogurt;
const pct = (value: number, decimals = 0): string => withUnit(formatNumber(value, decimals), '%');
const lph = (value: number): string => withUnit(formatNumber(value), 'L/h');
const degC = (value: number, decimals = 1): string => withUnit(formatNumber(value, decimals), '°C');
const levelPct = (tank: { levelL: number; capacityL: number }): number => fracToPct(tank.capacityL > 0 ? tank.levelL / tank.capacityL : 0);
/** A StateText's status as a step's state: 'ok' moves the product, unless the step only holds it. */
const fromStatus = (status: StateText['status'], moving: FlowState = 'flow'): FlowState => (status === 'ok' ? moving : status);

type Reading = { text: string; state: FlowState };
type Readers = Readonly<Record<string, (yogurt: YogurtSnapshot, snapshot: Snapshot) => Reading>>;

/** A tank's step: moving while it fills or empties, holding while it ferments or waits, red while held (D30). */
function tankReading(tank: FermentTank | undefined, timeS: number): Reading {
  if (!tank) return { text: NO_VALUE, state: 'idle' };
  const { text, status } = tankText(tank, timeS);
  if (tank.held) return { text: `Held: its pH stalled at ${formatNumber(tank.ph, 2)}`, state: 'bad' };
  if (tank.state === 'filling' || tank.state === 'emptying') return { text, state: 'flow' };
  if (tank.state === 'fermenting' || tank.state === 'ready') return { text, state: 'hold' };
  return { text, state: fromStatus(status) };
}

/** Line P8's stations share one state: moving while it runs, red while it stands for an interlock. */
function p8State(yogurt: YogurtSnapshot): FlowState {
  switch (yogurt.p8.state) {
    case 'running':
      return 'flow';
    case 'stopped':
      return 'bad';
    case 'starved':
    case 'cleaning':
    case 'sterilizing':
      return 'warn';
    default:
      return 'idle';
  }
}

const STOP_TEXT = { running: 'Running', idle: 'Standing ready', cleaning: 'Cleaning in place', sterilizing: 'Sterilizing (SIP)', starved: 'Waiting for the buffer', stopped: 'Stopped' } as const;
/** A station's reading while P8 runs, or what P8 does instead. */
function station(yogurt: YogurtSnapshot, running: string): Reading {
  const state = p8State(yogurt);
  const { p8 } = yogurt;
  if (state === 'flow') return { text: running, state };
  const why = p8.state === 'stopped' && p8.stopReason ? `${STOP_TEXT.stopped}: ${p8.stopReason === 'hepa' ? 'the HEPA cabin' : `the ${p8.stopReason === 'cups' ? 'cup' : 'foil'} magazine`}` : STOP_TEXT[p8.state];
  return { text: why, state };
}

const READERS: Readonly<Record<YogurtStageId, Readers>> = {
  11: {
    silo: (y) => ({ text: `${pct(levelPct(y.mix.tanks.silo))} full · ${degC(Y.silo.tempC, 0)}`, state: y.mix.flowLph > 0 ? 'flow' : y.mix.tanks.silo.levelL > 0 ? 'hold' : 'idle' }),
    standardize: (y) => ({ text: `${pct(y.mix.fatPct, 1)} fat in the mix`, state: y.mix.flowLph > 0 ? 'flow' : 'idle' }),
    powder: (y) => ({ text: `${withUnit(formatNumber(y.mix.powderKgPerT, 1), 'kg')} a tonne · SNF ${pct(y.mix.snfPct, 1)}`, state: y.mix.flowLph > 0 ? 'flow' : 'idle' }),
    stabilizer: (y) => ({ text: `${pct(Y.mix.stabilizerPct, 1)} · dry matter ${pct(y.mix.fatPct + y.mix.snfPct + Y.mix.stabilizerPct, 1)}`, state: y.mix.flowLph > 0 ? 'flow' : 'idle' }),
    mixTank: (y) => {
      const level = levelPct(y.mix.tanks.mixTank);
      const moving = y.mix.flowLph > 0 || y.heat.flowLph > 0;
      return { text: `${pct(level)} full · ${lph(y.mix.flowLph)} in`, state: moving ? 'flow' : level > 0 ? 'hold' : 'idle' };
    },
  },
  12: {
    deaerator: (y) => heatStep(y, lph(y.heat.flowLph)),
    homogenizer: (y, s) => heatStep(y, withUnit(formatNumber(s.stages[12].values.homogenizerBar ?? Y.homogenizer.bar), 'bar')),
    heating: (y) => heatStep(y, `out at ${degC(y.heat.outletC)}`),
    holdingCell: (y) => heatStep(y, `${formatDuration(y.heat.holdS)} · ${pct(y.heat.denatPct)} of the whey protein denatured`),
    divertValve: (y) => {
      switch (y.heat.mode) {
        case 'production':
          return { text: `Forward: ${degC(y.heat.outletC)}, over ${degC(Y.heat.divertBelowC, 0)}`, state: 'flow' };
        case 'divert':
          return { text: `Diverting: the mix under ${degC(Y.heat.divertBelowC, 0)} or held too short`, state: 'bad' };
        case 'cleaning':
          return { text: `Cleaning after a divert · ${formatDuration(y.heat.modeRemainingS ?? 0)} left`, state: 'warn' };
        default:
          return { text: 'Closed: no mix flows', state: 'idle' };
      }
    },
    reprocess: (y) => {
      const text = `${withUnit(formatNumber(y.heat.reprocessTank.levelL), 'L')} of ${withUnit(formatNumber(y.heat.reprocessTank.capacityL), 'L')}`;
      if (y.heat.mode === 'divert') return { text: `${text} · filling`, state: 'bad' };
      if (y.heat.reprocessTank.levelL > 0) return { text: `${text} · to rework`, state: 'warn' };
      return { text: 'Empty: nothing diverts', state: 'skip' };
    },
    cooling: (y) =>
      y.heat.mode === 'production'
        ? { text: `out at ${degC(y.ferment.tempC, 0)} to the culture`, state: 'flow' }
        : { text: y.heat.mode === 'divert' ? 'Nothing goes forward' : 'No mix flows', state: 'idle' },
  },
  13: {
    inoculation: (y) =>
      y.heat.mode === 'production' && y.heat.flowLph > 0
        ? { text: `${lph(y.heat.flowLph)} at ${degC(y.ferment.tempC, 0)}`, state: 'flow' }
        : { text: 'No mix to inoculate', state: 'idle' },
    setRoute: (y) => {
      if (y.product.route !== 'set') return { text: 'Not this shift: its yogurt is stirred', state: 'skip' };
      return y.heat.mode === 'production' ? { text: 'Set mix to the buffer, warm', state: 'flow' } : { text: 'Set yogurt this shift; no mix flows', state: 'idle' };
    },
    tank1: (y, s) => tankReading(y.ferment.tanks[0], s.timeS),
    tank2: (y, s) => tankReading(y.ferment.tanks[1], s.timeS),
    tank3: (y, s) => tankReading(y.ferment.tanks[2], s.timeS),
  },
  14: {
    smoothing: (y) => stirredStep(y, () => `${lph(Math.max(0, y.buffer.inflowLph * (1 - y.buffer.fruitDosePct / 100)))} from the ready tank`),
    cooler: (y) => stirredStep(y, () => `out at ${degC(y.buffer.coolerOutletC ?? Y.cooling.outletC, 0)}`),
    fruit: (y) => {
      if (!y.product.fruit) return { text: 'No fruit in this shift\'s product', state: 'skip' };
      return y.buffer.fruitDosePct > 0 ? { text: `${pct(y.buffer.fruitDosePct)} of the flow`, state: 'flow' } : { text: 'Fruit recipe; nothing flows now', state: 'idle' };
    },
    buffer: (y) => {
      const { buffer } = y;
      const level = levelPct(buffer);
      const text = `${pct(level)} full · ${lph(buffer.inflowLph)} in, ${lph(buffer.outflowLph)} to P8`;
      if (buffer.changeover) return { text: `${text} · changeover`, state: 'warn' };
      if (buffer.waitS !== null && buffer.waitS !== undefined && buffer.waitS > 0.8 * Y.buffer.setMaxWaitS) return { text: `${text} · set mix waited ${formatDuration(buffer.waitS)}`, state: 'warn' };
      if (buffer.outflowLph > 0 || buffer.inflowLph > 0) return { text, state: 'flow' };
      return { text, state: level > 0 ? 'hold' : 'idle' };
    },
  },
  15: {
    denester: (y) => (y.p8.stopReason === 'cups' && y.p8.state === 'stopped' ? { text: 'Stopped: the cup magazine is empty', state: 'bad' } : station(y, `cup magazine ${pct(y.p8.magazines?.cupsPct ?? 100)}`)),
    decontamination: (y) => {
      const pa = y.p8.hepaPa;
      if (pa !== undefined && pa < Y.p8.hepa.minPa) return { text: `HEPA cabin +${formatNumber(pa, 1)} Pa, under +${Y.p8.hepa.minPa} Pa`, state: 'bad' };
      return station(y, `UV-C on · HEPA cabin +${formatNumber(pa ?? Y.p8.hepa.normalPa, 1)} Pa`);
    },
    filler: (y) => station(y, `last cup ${withUnit(formatNumber(y.p8.lastFillG ?? Y.p8.fill.targetG, 1), 'g')} · ${formatNumber(y.p8.cyclesPerMin ?? 0)} cycles a min`),
    lidder: (y) => {
      const seal = y.p8.seal;
      const outside = seal !== undefined && (seal.tempC < Y.p8.seal.minTempC || seal.tempC > Y.p8.seal.maxTempC);
      const reading = station(y, `seal ${degC(seal?.tempC ?? Y.p8.seal.tempC, 0)} · foils ${pct(y.p8.magazines?.foilsPct ?? 100)}`);
      return outside && reading.state === 'flow' ? { text: `${reading.text}, outside ${Y.p8.seal.minTempC}–${Y.p8.seal.maxTempC} °C`, state: 'warn' } : reading;
    },
    coder: (y) => station(y, y.p8.currentBatch ? `batch ${y.p8.currentBatch.code}` : 'no batch yet'),
    checkweigher: (y) => station(y, `${formatNumber((y.p8.rejects?.underFill ?? 0) + (y.p8.rejects?.overFill ?? 0))} cups rejected`),
    metal: (y) => station(y, `${formatNumber(y.p8.rejects?.metal ?? 0)} cups rejected`),
    vision: (y) => station(y, `${formatNumber(y.p8.rejects?.vision ?? 0)} cups rejected`),
    sealTest: (y, s) => {
      const tests = y.p8.sealTests;
      const tally = tests ? `${formatNumber(tests.passed)} passed, ${formatNumber(tests.failed)} failed` : NO_VALUE;
      const held = y.p8.rejects?.sealHold ?? 0;
      if (held > 0 && tests && tests.failed > 0) return { text: `${tally} · ${formatNumber(held)} cups held`, state: 'warn' };
      const next = y.p8.nextSealTestS;
      return y.p8.state === 'running' && next !== null && next !== undefined ? { text: `${tally} · next in ${formatDuration(Math.max(0, next - s.timeS))}`, state: 'flow' } : { text: tally, state: 'idle' };
    },
  },
  16: {
    trayPacker: (y) => station(y, `${formatNumber(y.coldChain.trays?.openCups ?? 0)} of ${Y.coldChain.cupsPerTray} cups in the open tray`),
    palletizer: (y) => station(y, `${formatNumber(y.coldChain.trays?.openTrays ?? 0)} of ${Y.coldChain.traysPerPallet} trays on the pallet`),
    warmRoom: (y) => {
      const { pallets, capacity } = y.coldChain.warmRoom;
      if (pallets === 0) return { text: y.product.route === 'set' ? 'Empty' : 'Empty: stirred yogurt skips it', state: y.product.route === 'set' ? 'idle' : 'skip' };
      return { text: `${formatNumber(pallets)} of ${formatNumber(capacity ?? Y.coldChain.warmRoomPallets)} pallets at ${degC(Y.coldChain.warmRoomC, 0)}`, state: 'hold' };
    },
    chiller: (y) => {
      const { pallets, capacity, airC } = y.coldChain.chiller;
      return { text: `${formatNumber(pallets)} of ${formatNumber(capacity ?? Y.coldChain.chillerPallets)} pallets · air ${degC(airC ?? Y.coldChain.chillerAirC, 0)}`, state: pallets > 0 ? 'hold' : 'idle' };
    },
    coldRoom: (_y, s) => {
      const { text, status } = coldRoomText(coldChainOf(s));
      return { text, state: fromStatus(status, 'hold') };
    },
    reefers: (y, s) => {
      const { text } = reefersText(coldChainOf(s), s.timeS);
      const reefers = y.coldChain.reefers ?? [];
      return { text, state: reefers.some((reefer) => reefer.state === 'loading') ? 'flow' : reefers.length > 0 ? 'hold' : 'idle' };
    },
  },
};

/** A step of the heat treatment: moving in production, red in a divert, amber while the line cleans. */
function heatStep(yogurt: YogurtSnapshot, running: string): Reading {
  switch (yogurt.heat.mode) {
    case 'production':
      return { text: running, state: 'flow' };
    case 'divert':
      return { text: `${running} · to the reprocess tank`, state: 'bad' };
    case 'cleaning':
      return { text: 'Cleaning in place (the wing\'s CIP)', state: 'warn' };
    default:
      return { text: 'No mix flows', state: 'idle' };
  }
}

/** A step stirred yogurt takes from the ready tank to the buffer; set yogurt skips it. */
function stirredStep(yogurt: YogurtSnapshot, running: () => string): Reading {
  if (yogurt.product.route === 'set') return { text: 'Set yogurt skips it', state: 'skip' };
  const flowing = yogurt.buffer.inflowLph > 0 && yogurt.ferment.tanks.some((tank) => tank.state === 'emptying');
  return flowing ? { text: running(), state: 'flow' } : { text: 'Waiting for a ready tank', state: 'idle' };
}

/** How fast the product moves through each stage now, as a share of its full rate. */
function rateFrac(stage: YogurtStageId, yogurt: YogurtSnapshot): number {
  switch (stage) {
    case 11:
      return yogurt.mix.flowLph / Y.mix.capacityLph;
    case 12:
    case 13:
      return yogurt.heat.flowLph / Y.mix.capacityLph;
    case 14:
      return yogurt.buffer.inflowLph / Y.cooling.flowLph;
    case 15:
    case 16:
      return yogurt.p8.state === 'running' ? (yogurt.p8.cupsPerH ?? 0) / Y.p8.rateCupsPerH : 0;
  }
}

/** Every step's reading key, by stage: what the tests hold yogurtFlow.json to. */
export const FLOW_READERS: Readonly<Record<YogurtStageId, readonly string[]>> = Object.fromEntries(
  YOGURT_STAGE_IDS.map((stage) => [stage, Object.keys(READERS[stage])]),
) as unknown as Record<YogurtStageId, readonly string[]>;

/** A yogurt stage's process flow now, or null for a snapshot without the yogurt line. */
export function processFlow(stage: YogurtStageId, snapshot: Snapshot): FlowView | null {
  const yogurt = yogurtOf(snapshot);
  if (!yogurt) return null;
  const readers = READERS[stage];
  const steps = (YOGURT_FLOW.get(stage) ?? []).map((info): FlowStepView => {
    const read = readers[info.id];
    const reading = read ? read(yogurt, snapshot) : { text: NO_VALUE, state: 'idle' as const };
    return { ...info, ...reading };
  });
  return { stage, steps, rateFrac: Math.max(0, Math.min(1.5, rateFrac(stage, yogurt))) };
}

/**
 * Seconds a dot takes to move one dash (10 px) along the track: 1.6 s at the stage's full rate, slower as the flow
 * falls, at most 6 s; 0 where nothing moves.
 */
export function dotPeriodS(rateFrac: number): number {
  return rateFrac > 0 ? Math.min(6, 1.6 / Math.max(rateFrac, 1.6 / 6)) : 0;
}

/**
 * The panel part (stagePanel.ts parts): "Process flow", each step a node on the track with its name, its reading and
 * what happens there. The track's dots run where the product moves, at dotPeriodS, and stop while the sim is paused.
 */
export function createProcessFlow(host: HTMLElement, stage: YogurtStageId): PanelPart {
  const section = el('section', 'p-flow');
  section.dataset.testid = 'process-flow';
  section.dataset.stage = String(stage);
  const titleId = `process-flow-title-${stage}`;
  const title = el('h3', 'eyebrow', 'Process flow');
  title.id = titleId;
  section.setAttribute('aria-labelledby', titleId);
  const list = el('ol', 'flow-steps');
  section.append(title, list);
  const rows = (YOGURT_FLOW.get(stage) ?? []).map((info) => {
    const item = el('li', info.branch ? 'flow-step flow-branch' : 'flow-step');
    item.dataset.step = info.id;
    item.dataset.state = 'idle';
    const node = el('span', 'flow-node');
    node.setAttribute('aria-hidden', 'true');
    const body = el('div', 'flow-body');
    const reading = el('span', 'flow-reading', NO_VALUE);
    body.append(el('strong', 'flow-name', info.name), ' ', reading, el('p', 'flow-does', info.does));
    item.append(node, body);
    list.append(item);
    return { info, item, reading };
  });
  host.append(section);
  let shownPeriod = '';
  return {
    update(snapshot) {
      const view = processFlow(stage, snapshot);
      if (!view) return;
      const paused = snapshot.paused ? 'true' : 'false';
      if (section.dataset.paused !== paused) section.dataset.paused = paused;
      const period = `${dotPeriodS(view.rateFrac).toFixed(2)}s`;
      if (period !== shownPeriod) {
        shownPeriod = period;
        section.style.setProperty('--flow-s', period);
      }
      view.steps.forEach((step, i) => {
        const row = rows[i];
        if (!row) return;
        if (row.item.dataset.state !== step.state) row.item.dataset.state = step.state;
        setText(row.reading, step.text);
      });
    },
    dispose() {
      section.remove();
    },
  };
}
