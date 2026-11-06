// Stage 15 (phase 18, D28): Line P8, the cup filler. It fills a cycle of `p8.lanes` cups every 3,600 × lanes ÷ rate
// seconds of running time, taking each cup's fill weight from the buffer: the checkweigher, the metal detector and the
// vision check reject what they find, the coder prints the batch on every cup, and every 2 operating hours a seal test
// takes 5 cups. A test that fails holds every cup made since the last one that passed.
//
// The SOP's hygiene limits are interlocks: P8 starts only once a CIP is logged, an SIP has held its temperature and an
// ATP swab has passed; it stops while the HEPA cabin is under its limit, and when a magazine runs out. The cycles run
// inside the yogurt line's step, as many as fall in it, and queue no events. Every draw is from P8's own stream, so the
// UHT line's stay as they were (D25).
import { dayToS, gToKg, hToS, sToDay, type P8Batch, type P8Rejects, type P8StopReason, type PlantConfig, type YogurtProductId } from '../../contracts';
import { formatDayTime, type LogTag, type LogWriter } from '../log';
import type { Rng } from '../rng';
import type { Buffer } from './routing';

/** Times this close count as the same. */
const EPS = 1e-9;
/** A cycle starts only with yogurt in the buffer for every lane at 4 σ over the target: a cycle's fills always fit. */
const START_SIGMAS = 4;
/** The fill weights' histogram (contracts v10): 0.5 g bins from 120 g, the checkweigher's limits inside its ends. */
export const FILL_HISTOGRAM = { fromG: 120, binG: 0.5, bins: 32 } as const;
/** When the night's SIP before the opening ended: 23:40 the day before, after the set yogurt's CIP (H125e). */
const OPENING_SIP_BEFORE_S = hToS(6 + 20 / 60);

/** The readings P8 depends on but does not make; the defaults are plant.json's, tests and faults replace them. */
export interface P8Conditions {
  /** The HEPA cabin's overpressure, Pa. */
  hepaPa(timeS: number): number;
  /** The temperature the SIP that ended at `timeS` held, °C. */
  sipTempC(timeS: number): number;
  /** The ATP swab taken at `timeS`, RLU. */
  atpRlu(timeS: number): number;
  /** The sealing heads' temperature, time and pressure. */
  seal(timeS: number): { tempC: number; timeS: number; bar: number };
}

/** What P8 counted since the plant opened. Every cup filled is made, taken for a seal test or rejected. */
export interface P8Totals {
  cycles: number;
  cupsFilled: number;
  cupsMade: number;
  rejects: P8Rejects;
  sealTestCups: number;
  sealTestsPassed: number;
  sealTestsFailed: number;
  /** Every fill weight, summed: what P8 took from the buffer. */
  drawnKg: number;
  /** Running time, s. */
  runS: number;
  /** Time it waited for the buffer, s, while the buffer held the shift's product. */
  starvedS: number;
  /** Time it stood for an interlock, s, by cause. */
  stoppedS: Record<P8StopReason, number>;
  refills: { cups: number; foils: number };
  sips: number;
  swabs: number;
}

/** P8's own state, not counting a changeover (the yogurt line's): ready, running, waiting for yogurt or stopped. */
export type P8OwnState = 'idle' | 'running' | 'starved' | 'stopped';

export interface P8StepInput {
  dtS: number;
  timeS: number;
  rateCupsPerH: number;
  buffer: Buffer;
  /** The product in the buffer, and the one the shift makes. */
  product: YogurtProductId | null;
  shiftProduct: YogurtProductId;
  /** No changeover under way and a product in the buffer. */
  mayRun: boolean;
  log: LogWriter;
}

export interface P8View {
  state: P8OwnState;
  stopReason: P8StopReason | null;
  cyclesPerMin: number;
  lastFillG: number | null;
  fillHistogram: { fromG: number; binG: number; counts: number[] };
  seal: { tempC: number; timeS: number; bar: number };
  hepaPa: number;
  sip: { lastS: number | null; ok: boolean };
  atpRlu: number | null;
  nextSealTestS: number | null;
  magazines: { cupsPct: number; foilsPct: number };
  currentBatch: P8Batch | null;
}

export interface P8 {
  /** One step: refills, interlocks, then the cycles that fall in it. Returns the litres it took from the buffer. */
  step(input: P8StepInput): number;
  /** The wing's CIP before set yogurt has run and is logged: P8 may start only after it and an SIP and a swab that pass. */
  cipDone(timeS: number): void;
  /**
   * The SIP of a changeover ended at `timeS`. It held its temperature: the ATP swab is taken, and P8 is cleared ('ok'),
   * or sent back to the CIP ('cip'). It fell short: it runs again ('sip').
   */
  afterSip(timeS: number, log: LogWriter): 'ok' | 'sip' | 'cip';
  /** The yogurt a cycle needs in the buffer before it starts, litres. */
  readonly cycleNeedL: number;
  view(timeS: number, rateCupsPerH: number): P8View;
  totals(): Readonly<P8Totals>;
}

/** How far a reading lies outside [min, max], as a share of the window's width; 0 inside. */
export function outsideFrac(value: number, min: number, max: number): number {
  const widthM = max - min;
  if (!(widthM > 0)) return value === min ? 0 : Infinity;
  if (value < min) return (min - value) / widthM;
  if (value > max) return (value - max) / widthM;
  return 0;
}

/**
 * The chance that one cup's seal leaks (H128): leakInWindowFrac inside the window; outside it rises in step with the
 * farthest reading's distance out, as a share of its window's width, until every cup leaks leakAllBeyondFrac out.
 */
export function leakChance(sealConfig: PlantConfig['yogurt']['p8']['seal'], seal: { tempC: number; timeS: number; bar: number }): number {
  const outFrac = Math.max(
    outsideFrac(seal.tempC, sealConfig.minTempC, sealConfig.maxTempC),
    outsideFrac(seal.timeS, sealConfig.minTimeS, sealConfig.maxTimeS),
    outsideFrac(seal.bar, sealConfig.minBar, sealConfig.maxBar),
  );
  const p0 = sealConfig.leakInWindowFrac;
  return p0 + (1 - p0) * Math.min(1, outFrac / sealConfig.leakAllBeyondFrac);
}

/** The cycle's period at a rate: 3,600 × lanes ÷ cups an hour (H126). */
export const cyclePeriodS = (lanes: number, rateCupsPerH: number): number => hToS(lanes / rateCupsPerH);

/** The batch code of the shift starting at `shiftStartS`: "P8-008-1", Line P8, its day, its number from the first shift. */
export function batchCode(shiftStartS: number, firstShiftStartS: number, batchS: number): string {
  const day = Math.floor(sToDay(shiftStartS)) + 1;
  const perDay = Math.round(dayToS(1) / batchS);
  const index = Math.round((shiftStartS - firstShiftStartS) / batchS);
  const number = (((index % perDay) + perDay) % perDay) + 1;
  return `P8-${String(day).padStart(3, '0')}-${number}`;
}

export function createP8(config: PlantConfig, openS: number, rng: Rng, conditions: Partial<P8Conditions> = {}): P8 {
  const { yogurt } = config;
  const plant = yogurt.p8;
  const { batchS, firstShiftStartS } = config.quality;
  const lanes = plant.lanes;
  const tag: LogTag = { topic: 'yogurt', line: 'yogurt' };
  const reading: P8Conditions = {
    hepaPa: (timeS) => plant.hepa.normalPa + plant.hepa.swingPa * Math.sin((2 * Math.PI * (timeS - openS)) / plant.hepa.swingS),
    sipTempC: () => plant.sip.runC,
    // A clean surface reads its typical count, ± 50%.
    atpRlu: () => plant.atpCleanRlu * (0.5 + rng.next()),
    seal: () => ({ tempC: plant.seal.tempC, timeS: plant.seal.timeS, bar: plant.seal.bar }),
    ...conditions,
  };
  const cycleNeedL = lanes * gToKg(plant.fill.targetG + START_SIGMAS * plant.fill.sigmaG);

  const totals: P8Totals = {
    cycles: 0,
    cupsFilled: 0,
    cupsMade: 0,
    rejects: { underFill: 0, overFill: 0, metal: 0, vision: 0, sealHold: 0 },
    sealTestCups: 0,
    sealTestsPassed: 0,
    sealTestsFailed: 0,
    drawnKg: 0,
    runS: 0,
    starvedS: 0,
    stoppedS: { hepa: 0, cups: 0, foils: 0 },
    refills: { cups: 0, foils: 0 },
    sips: 0,
    swabs: 0,
  };
  // The night left P8 clean and sterile, with full magazines (D28).
  let cipLogged = true;
  let sip: { lastS: number | null; ok: boolean } = { lastS: openS - OPENING_SIP_BEFORE_S, ok: true };
  let atpRlu: number | null = plant.atpCleanRlu;
  let cleared = true;
  const magazines = {
    cups: { level: plant.magazines.cups, capacity: plant.magazines.cups, refillAtS: null as number | null, name: 'cup' },
    foils: { level: plant.magazines.foils, capacity: plant.magazines.foils, refillAtS: null as number | null, name: 'foil' },
  };
  let cycleClockS = 0;
  let sinceTestS = 0;
  let state: P8OwnState = 'idle';
  let stopReason: P8StopReason | null = null;
  let starvedLogged = false;
  let lastFillG: number | null = null;
  let counts: number[] = new Array<number>(FILL_HISTOGRAM.bins).fill(0);
  let batch: (P8Batch & { shiftStartS: number }) | null = null;
  // Cups made since the last seal test that passed, by batch code: what a failed test holds.
  let sincePass = new Map<string, number>();
  let spareNormal: number | null = null;

  const shiftStartOf = (timeS: number): number => firstShiftStartS + Math.floor((timeS - firstShiftStartS + EPS) / batchS) * batchS;

  /** A standard normal draw (Box–Muller, the pair's second kept for the next call). */
  function normal(): number {
    if (spareNormal !== null) {
      const z = spareNormal;
      spareNormal = null;
      return z;
    }
    const u = 1 - rng.next(); // in (0, 1], so the log never sees 0
    const v = rng.next();
    const r = Math.sqrt(-2 * Math.log(u));
    spareNormal = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  function stop(reason: P8StopReason, timeS: number, why: string, log: LogWriter): void {
    if (state !== 'stopped' || stopReason !== reason) log(timeS, 'bad', `Line P8 stopped: ${why}`, tag);
    state = 'stopped';
    stopReason = reason;
  }

  /** A new batch starts with a new product, or with a new shift that makes the same product. */
  function batchFor(product: YogurtProductId, shiftProduct: YogurtProductId, timeS: number, log: LogWriter): P8Batch & { shiftStartS: number } {
    const shiftStartS = shiftStartOf(timeS);
    if (batch && batch.product === product && (batch.shiftStartS === shiftStartS || shiftProduct !== product)) return batch;
    const code = batchCode(shiftStartS, firstShiftStartS, batchS);
    batch = { code, product, madeS: timeS, expiresS: timeS + dayToS(yogurt.coldChain.shelfLifeDays), cups: 0, shiftStartS };
    counts = new Array<number>(FILL_HISTOGRAM.bins).fill(0);
    log(timeS, 'info', `Line P8: batch ${code} started, best before ${formatDayTime(batch.expiresS)}`, tag);
    return batch;
  }

  function sealTest(timeS: number, cupsTaken: number, log: LogWriter): void {
    const p = leakChance(plant.seal, reading.seal(timeS));
    let leaked = 0;
    for (let i = 0; i < cupsTaken; i++) if (rng.next() < p) leaked += 1;
    totals.sealTestCups += cupsTaken;
    if (leaked === 0) {
      totals.sealTestsPassed += 1;
      sincePass = new Map();
      return;
    }
    totals.sealTestsFailed += 1;
    let held = 0;
    for (const [code, cups] of sincePass) {
      held += cups;
      if (batch && code === batch.code) batch.cups -= cups;
    }
    totals.cupsMade -= held;
    totals.rejects.sealHold += held;
    const codes = [...sincePass.keys()];
    sincePass = new Map();
    log(
      timeS,
      'bad',
      `Line P8 seal test failed: ${leaked} of ${cupsTaken} cups leaked; ${held.toLocaleString('en-US')} cups held since the last test that passed (${codes.length > 1 ? 'batches' : 'batch'} ${codes.join(', ') || 'none'})`,
      tag,
    );
  }

  /** One cycle of `lanes` cups at `timeS`; false if the buffer is short of a cycle's yogurt. */
  function cycle(input: P8StepInput, timeS: number, periodS: number): boolean {
    const { buffer, log } = input;
    if (buffer.levelL < cycleNeedL - EPS) return false;
    const product = input.product as YogurtProductId;
    const current = batchFor(product, input.shiftProduct, timeS, log);
    const { fill } = plant;
    let drawnKg = 0;
    let passed = 0;
    for (let lane = 0; lane < lanes; lane++) {
      const fillG = fill.targetG + fill.sigmaG * normal();
      drawnKg += gToKg(fillG);
      lastFillG = fillG;
      const bin = Math.min(FILL_HISTOGRAM.bins - 1, Math.max(0, Math.floor((fillG - FILL_HISTOGRAM.fromG) / FILL_HISTOGRAM.binG)));
      counts[bin] += 1;
      if (fillG < fill.underBelowG) totals.rejects.underFill += 1;
      else if (fillG > fill.overAboveG) totals.rejects.overFill += 1;
      else passed += 1;
    }
    buffer.draw(drawnKg);
    totals.drawnKg += drawnKg;
    totals.cycles += 1;
    totals.cupsFilled += lanes;
    totals.runS += periodS;
    // The metal detector and the vision check: a reject each when the draw falls under the cycle's chance.
    if (passed > 0 && rng.next() < passed * plant.metalRejectFrac) {
      totals.rejects.metal += 1;
      passed -= 1;
    }
    if (passed > 0 && rng.next() < passed * plant.visionRejectFrac) {
      totals.rejects.vision += 1;
      passed -= 1;
    }
    for (const magazine of [magazines.cups, magazines.foils]) {
      magazine.level -= lanes;
      if (magazine.refillAtS === null && magazine.level <= plant.magazines.refillBelowFrac * magazine.capacity) {
        magazine.refillAtS = timeS + plant.magazines.refillS;
      }
    }
    // Every `everyS` of running, the seal test takes its cups from this cycle.
    sinceTestS += periodS;
    const testing = sinceTestS >= plant.sealTest.everyS - EPS;
    const taken = testing ? Math.min(plant.sealTest.cups, passed) : 0;
    passed -= taken;
    totals.cupsMade += passed;
    current.cups += passed;
    sincePass.set(current.code, (sincePass.get(current.code) ?? 0) + passed);
    if (testing) {
      sinceTestS -= plant.sealTest.everyS;
      sealTest(timeS, taken, log);
    }
    return true;
  }

  return {
    cycleNeedL,
    step(input) {
      const { dtS, timeS, log } = input;
      // Refills arrive, the operator having been called at refillBelowFrac.
      for (const [key, magazine] of [['cups', magazines.cups], ['foils', magazines.foils]] as const) {
        if (magazine.refillAtS !== null && timeS >= magazine.refillAtS - EPS) {
          magazine.level = magazine.capacity;
          magazine.refillAtS = null;
          totals.refills[key] += 1;
        }
      }
      if (!input.mayRun || !cleared) {
        state = 'idle';
        stopReason = null;
        cycleClockS = 0;
        starvedLogged = false;
        return 0;
      }
      const hepaPa = reading.hepaPa(timeS);
      if (hepaPa < plant.hepa.minPa) {
        stop('hepa', timeS, `the HEPA cabin reads +${hepaPa.toFixed(1)} Pa, under +${plant.hepa.minPa} Pa`, log);
        totals.stoppedS.hepa += dtS;
        cycleClockS = 0;
        return 0;
      }
      if (state === 'stopped' && stopReason === 'hepa') {
        log(timeS, 'ok', `Line P8 runs again: the HEPA cabin is back at +${hepaPa.toFixed(1)} Pa`, tag);
        state = 'running';
        stopReason = null;
      }
      const levelBefore = input.buffer.levelL;
      const periodS = cyclePeriodS(lanes, input.rateCupsPerH);
      cycleClockS += dtS;
      let starved = false;
      let short: P8StopReason | null = null;
      // The cycles that fall in this step, each at the moment it ends.
      while (cycleClockS >= periodS - EPS) {
        if (magazines.cups.level < lanes) short = 'cups';
        else if (magazines.foils.level < lanes) short = 'foils';
        if (short) break;
        const atS = timeS - (cycleClockS - periodS);
        if (!cycle(input, atS, periodS)) {
          starved = true;
          break;
        }
        cycleClockS -= periodS;
      }
      // A cycle that cannot run waits at its start, owing nothing.
      if (cycleClockS > periodS) cycleClockS = periodS;
      if (short) {
        stop(short, timeS, `the ${magazines[short].name} magazine is empty, waiting for its refill`, log);
        totals.stoppedS[short] += dtS;
      } else if (starved) {
        // Waiting for the buffer: logged once, and only while it holds the shift's product (not at a run-down).
        const waiting = input.product === input.shiftProduct;
        if (waiting) {
          totals.starvedS += dtS;
          if (!starvedLogged) log(timeS, 'warn', 'Line P8 waiting: the buffer is empty', tag);
        }
        starvedLogged = waiting;
        state = 'starved';
        stopReason = null;
      } else {
        if (state === 'stopped' && (stopReason === 'cups' || stopReason === 'foils')) {
          log(timeS, 'ok', `Line P8 runs again: the ${magazines[stopReason].name} magazine is refilled`, tag);
        }
        state = 'running';
        stopReason = null;
        starvedLogged = false;
      }
      return levelBefore - input.buffer.levelL;
    },
    cipDone() {
      cipLogged = true;
      cleared = false;
    },
    afterSip(timeS, log) {
      totals.sips += 1;
      const heldC = reading.sipTempC(timeS);
      const ok = heldC >= plant.sip.tempC - EPS;
      sip = { lastS: timeS, ok };
      if (!ok) {
        cleared = false;
        log(timeS, 'bad', `Line P8's SIP held ${heldC.toFixed(1)} °C, under ${plant.sip.tempC} °C: sterilizing again`, tag);
        return 'sip';
      }
      totals.swabs += 1;
      atpRlu = reading.atpRlu(timeS);
      if (!(atpRlu < plant.atpMaxRlu) || !cipLogged) {
        cleared = false;
        cipLogged = false;
        log(timeS, 'bad', `Line P8's ATP swab read ${atpRlu.toFixed(1)} RLU, not under ${plant.atpMaxRlu}: the wing cleans P8 again`, tag);
        return 'cip';
      }
      cleared = true;
      log(timeS, 'ok', `Line P8 cleared to start: SIP ${heldC.toFixed(0)} °C for ${Math.round(plant.sip.holdS / 60)} min, ATP swab ${atpRlu.toFixed(1)} RLU`, tag);
      return 'ok';
    },
    view(timeS, rateCupsPerH) {
      const periodS = cyclePeriodS(lanes, rateCupsPerH);
      const running = state === 'running';
      const pct = (magazine: { level: number; capacity: number }): number => (100 * magazine.level) / magazine.capacity;
      return {
        state,
        stopReason: state === 'stopped' ? stopReason : null,
        cyclesPerMin: running ? 60 / periodS : 0,
        lastFillG,
        fillHistogram: { fromG: FILL_HISTOGRAM.fromG, binG: FILL_HISTOGRAM.binG, counts: [...counts] },
        seal: { ...reading.seal(timeS) },
        hepaPa: reading.hepaPa(timeS),
        sip: { ...sip },
        atpRlu,
        nextSealTestS: running ? timeS + Math.max(0, plant.sealTest.everyS - sinceTestS) : null,
        magazines: { cupsPct: pct(magazines.cups), foilsPct: pct(magazines.foils) },
        currentBatch: batch ? { code: batch.code, product: batch.product, madeS: batch.madeS, expiresS: batch.expiresS, cups: batch.cups } : null,
      };
    },
    totals: () => ({ ...totals, rejects: { ...totals.rejects }, stoppedS: { ...totals.stoppedS }, refills: { ...totals.refills } }),
  };
}
