// Stage 16 (phase 19, D29): from P8's cups to the reefer trucks. The cups are packed 24 to a tray and 120 trays to a
// pallet, one batch to a pallet (D1). A set yogurt pallet waits in the warm room until its pH is at 4.60; every pallet
// is chilled to 4 °C in the blast tunnel, held 24 h in the cold room, released once its seal tests have passed, and
// shipped oldest first on a reefer of 26 pallets. A seal test that fails pulls its cups wherever they are.
//
// It runs in the yogurt line's step after P8, queues no events and draws nothing at random (D25). It opens as the last
// two days left it: the model runs the 48 h before the opening on the product day at P8's rate.
//
// Each room is a queue in the order its pallets came, and the times things fall due (a set pallet's pH, a core's
// chill) follow from the formulas, so a step does only what falls due in it; the temperatures and the pH a pallet shows
// are worked out when the snapshot asks.
import {
  hToS,
  sToH,
  yogurtProducts,
  yogurtShiftProducts,
  type ColdChainSnapshot,
  type PlantConfig,
  type YogurtPallet,
  type YogurtPalletPlace,
  type YogurtProductId,
  type YogurtReefer,
  type YogurtRoute,
} from '../../contracts';
import { formatDayTime, type LogTag, type LogWriter } from '../log';
import { fermentPh, timeToPhS } from './formulas';
import { createWingCip } from './heat';
import { batchCode, type P8Event } from './p8';

/** The seal-test window of the cups the opening's history made: their tests all passed. */
const HISTORY_WINDOW = -1;
/** How far back the opening's history starts, and its step. */
const HISTORY_S = hToS(48);
const HISTORY_STEP_S = 300;
/** The reefer dock looks for a load this often: calls come at most this late, against a 30 min drive in. */
const DOCK_CHECK_S = 60;

/** What the cold chain counted since the plant opened (the history before it not included). */
export interface ColdChainTotals {
  cupsIn: number;
  traysMade: number;
  palletsMade: number;
  cupsShipped: number;
  palletsShipped: number;
  reefersShipped: number;
  /** Pallets shipped by route: both reach the trucks. */
  shippedByRoute: Record<YogurtRoute, number>;
  /** Cups a failed seal test pulled, and the pallets it emptied. */
  cupsHeld: number;
  palletsHeld: number;
  /** Pallets that held past the 48 h maximum in the cold room, and the longest any shipped pallet held there. */
  overHold: number;
  longestHoldS: number;
  /** The most pallets each place held at once. */
  peak: { staging: number; warmRoom: number; chiller: number; coldRoom: number };
  /** Cups in the trays, the pallets and the reefers when the plant opened. */
  openingCups: number;
}

interface Pallet {
  id: number;
  batch: string;
  product: YogurtProductId;
  route: YogurtRoute;
  /** Cups by seal-test window. */
  windows: Map<number, number>;
  cups: number;
  trays: number;
  place: YogurtPalletPlace;
  closedS: number;
  /** Its turn for the chiller: at its pH (set yogurt) or as it closes (stirred). */
  readyS: number;
  chillFromS: number;
  chillFromC: number;
  /** When its core is at chillToC. */
  chilledS: number;
  /** Its pH once it leaves the warm room, where set yogurt stops setting. */
  heldPh: number;
  coldS: number;
  coldFromC: number;
  reefer: number | null;
  overLogged: boolean;
}

interface Reefer {
  id: number;
  door: number;
  state: 'arriving' | 'loading';
  untilS: number;
  loadFromS: number;
  pallets: Pallet[];
}

export interface ColdChain {
  /** One step ending at `timeS`: P8's cups and test results in the order they came, then the pallets and the reefers. */
  step(timeS: number, events: readonly P8Event[], log: LogWriter): void;
  /** The batch at the palletizer is over (a changeover starts): its last tray and pallet close part-full. */
  closeBatch(timeS: number): void;
  view(timeS: number): ColdChainSnapshot;
  totals(): Readonly<ColdChainTotals>;
  /** Cups now in the trays, the pallets and the reefers. */
  cupsInChain(): number;
}

export interface ColdChainOptions {
  /** Open as the last two days left it (the default), or empty. */
  history?: boolean;
}

const nothing: LogWriter = () => {};

export function createColdChain(config: PlantConfig, openS: number, options: ColdChainOptions = {}): ColdChain {
  const { yogurt } = config;
  const chain = yogurt.coldChain;
  const products = yogurtProducts(config);
  const tag: LogTag = { topic: 'yogurt', line: 'yogurt' };
  const tauS = chain.chillTauS;
  /** Set yogurt reaches its release pH this long after its pallet closes, in the warm room (H131). */
  const toReleasePhS = timeToPhS(yogurt.ferment, chain.releasePh, chain.warmRoomC);
  const fillC = (route: YogurtRoute): number => (route === 'set' ? yogurt.ferment.tempC : yogurt.cooling.outletC);
  /** How long a core takes from `fromC` down to chillToC in the chiller's air (H131). */
  const chillS = (fromC: number): number => (fromC <= chain.chillToC ? 0 : tauS * Math.log((fromC - chain.chillerAirC) / (chain.chillToC - chain.chillerAirC)));

  const totals: ColdChainTotals = {
    cupsIn: 0,
    traysMade: 0,
    palletsMade: 0,
    cupsShipped: 0,
    palletsShipped: 0,
    reefersShipped: 0,
    shippedByRoute: { set: 0, stirred: 0 },
    cupsHeld: 0,
    palletsHeld: 0,
    overHold: 0,
    longestHoldS: 0,
    peak: { staging: 0, warmRoom: 0, chiller: 0, coldRoom: 0 },
    openingCups: 0,
  };
  // Each place in the order its pallets came: set yogurt waiting for the warm room, stirred for the chiller.
  let stagingSet: Pallet[] = [];
  let stagingStirred: Pallet[] = [];
  let warm: Pallet[] = [];
  let chiller: Pallet[] = [];
  let cold: Pallet[] = [];
  const reefers: Reefer[] = [];
  const passed = new Set<number>([HISTORY_WINDOW]);
  // The pallet at the palletizer: its closed trays' cups and the open tray's, both by seal-test window.
  let open: { batch: string; product: YogurtProductId; trays: number; windows: Map<number, number>; tray: Map<number, number>; trayCups: number } | null = null;
  let nextPallet = 1;
  let nextReefer = 1;
  /** When the chiller's next core is chilled, and when the dock next looks for a load. */
  let nextChilledS = Infinity;
  let nextDockCheckS = -Infinity;
  /**
   * The view, built once for a sim time and a state: a frame's snapshots share it, since the sim may be asked for a
   * snapshot several times at one time, and some 200 pallets are a third of a snapshot's cost. Snapshots are read-only.
   */
  let changes = 0;
  let cached: { timeS: number; changes: number; view: ColdChainSnapshot } | null = null;

  const sum = (windows: Map<number, number>): number => [...windows.values()].reduce((a, b) => a + b, 0);
  const add = (windows: Map<number, number>, testWindow: number, cups: number): void => {
    windows.set(testWindow, (windows.get(testWindow) ?? 0) + cups);
  };

  function closePallet(atS: number): void {
    if (!open) return;
    const cups = sum(open.windows);
    if (cups > 0) {
      const route = products[open.product].route;
      const pallet: Pallet = {
        id: nextPallet++,
        batch: open.batch,
        product: open.product,
        route,
        windows: open.windows,
        cups,
        trays: open.trays,
        place: 'staging',
        closedS: atS,
        readyS: route === 'set' ? atS + toReleasePhS : atS,
        chillFromS: 0,
        chillFromC: fillC(route),
        chilledS: Infinity,
        heldPh: route === 'set' ? yogurt.ferment.startPh : yogurt.ferment.endPh,
        coldS: Infinity,
        coldFromC: chain.chillToC,
        reefer: null,
        overLogged: false,
      };
      (route === 'set' ? stagingSet : stagingStirred).push(pallet);
      totals.palletsMade += 1;
    }
    open = { ...open, trays: 0, windows: new Map() };
  }

  function closeTray(): void {
    if (!open || open.trayCups === 0) return;
    for (const [testWindow, cups] of open.tray) add(open.windows, testWindow, cups);
    open.tray = new Map();
    open.trayCups = 0;
    open.trays += 1;
    totals.traysMade += 1;
  }

  function closeBatch(atS: number): void {
    changes += 1;
    closeTray();
    closePallet(atS);
    open = null;
  }

  /** Packs `cups` of one batch and seal-test window: tray by tray, pallet by pallet. */
  function pack(batch: string, product: YogurtProductId, testWindow: number, cups: number, atS: number): void {
    if (open && open.batch !== batch) closeBatch(atS);
    if (!open) open = { batch, product, trays: 0, windows: new Map(), tray: new Map(), trayCups: 0 };
    let left = cups;
    while (left > 0) {
      // Whole trays at once while the open tray is empty, up to the pallet's last tray.
      const whole = open.trayCups === 0 ? Math.min(Math.floor(left / chain.cupsPerTray), chain.traysPerPallet - open.trays - 1) : 0;
      if (whole > 0) {
        add(open.windows, testWindow, whole * chain.cupsPerTray);
        open.trays += whole;
        totals.traysMade += whole;
        left -= whole * chain.cupsPerTray;
        continue;
      }
      const take = Math.min(left, chain.cupsPerTray - open.trayCups);
      add(open.tray, testWindow, take);
      open.trayCups += take;
      left -= take;
      if (open.trayCups === chain.cupsPerTray) {
        closeTray();
        if (open.trays === chain.traysPerPallet) closePallet(atS);
      }
    }
  }

  /** A failed seal test: its window's cups leave the trays and pallets, wherever they are. */
  function pull(testWindow: number, atS: number, log: LogWriter): void {
    let cups = 0;
    let emptied = 0;
    if (open) {
      for (const map of [open.tray, open.windows]) {
        cups += map.get(testWindow) ?? 0;
        map.delete(testWindow);
      }
      open.trayCups = sum(open.tray);
    }
    const strip = (list: Pallet[]): Pallet[] =>
      list.filter((pallet) => {
        const there = pallet.windows.get(testWindow) ?? 0;
        if (there === 0) return true;
        cups += there;
        pallet.windows.delete(testWindow);
        pallet.cups -= there;
        pallet.trays = Math.ceil(pallet.cups / chain.cupsPerTray);
        if (pallet.cups > 0) return true;
        emptied += 1;
        return false;
      });
    stagingSet = strip(stagingSet);
    stagingStirred = strip(stagingStirred);
    warm = strip(warm);
    chiller = strip(chiller);
    cold = strip(cold);
    totals.cupsHeld += cups;
    totals.palletsHeld += emptied;
    log(atS, 'warn', `Cold chain: ${cups.toLocaleString('en-US')} cups pulled for the failed seal test${emptied > 0 ? `, ${emptied} ${emptied === 1 ? 'pallet' : 'pallets'} emptied` : ''}`, tag);
  }

  function released(pallet: Pallet, timeS: number): boolean {
    if (pallet.place !== 'coldRoom' || timeS < pallet.coldS + chain.minHoldS) return false;
    for (const testWindow of pallet.windows.keys()) if (!passed.has(testWindow)) return false;
    return true;
  }

  /** A set pallet's pH at `timeS`: setting until it leaves the warm room, then held. */
  const phAt = (pallet: Pallet, timeS: number): number =>
    pallet.route === 'set' && (pallet.place === 'staging' || pallet.place === 'warmRoom') ? fermentPh(yogurt.ferment, timeS - pallet.closedS, chain.warmRoomC) : pallet.heldPh;

  /** A pallet's core at `timeS`. */
  function tempAt(pallet: Pallet, timeS: number): number {
    switch (pallet.place) {
      case 'warmRoom':
        return chain.warmRoomC;
      case 'chiller':
        return chain.chillerAirC + (pallet.chillFromC - chain.chillerAirC) * Math.exp(-(timeS - pallet.chillFromS) / tauS);
      case 'coldRoom':
        return chain.roomC + (pallet.coldFromC - chain.roomC) * Math.exp(-(timeS - pallet.coldS) / tauS);
      case 'reefer':
        return chain.roomC;
      default:
        return pallet.chillFromC;
    }
  }

  function peaks(): void {
    const { peak } = totals;
    peak.staging = Math.max(peak.staging, stagingSet.length + stagingStirred.length);
    peak.warmRoom = Math.max(peak.warmRoom, warm.length);
    peak.chiller = Math.max(peak.chiller, chiller.length);
    peak.coldRoom = Math.max(peak.coldRoom, cold.length);
  }

  /** The pallets, the rooms and the reefers at `timeS`: only what falls due. */
  function advance(timeS: number, log: LogWriter): void {
    // Into the warm room, oldest first, while it has positions.
    while (stagingSet.length > 0 && warm.length < chain.warmRoomPallets) {
      const pallet = stagingSet.shift() as Pallet;
      pallet.place = 'warmRoom';
      warm.push(pallet);
    }
    // Out of the chiller: a chilled core moves to the cold room while it has positions.
    if (timeS >= nextChilledS) {
      chiller = chiller.filter((pallet) => {
        if (timeS < pallet.chilledS || cold.length >= chain.coldRoomPallets) return true;
        pallet.coldFromC = tempAt(pallet, timeS);
        pallet.place = 'coldRoom';
        pallet.coldS = timeS;
        cold.push(pallet);
        return false;
      });
    }
    // Into the chiller, in the order the pallets were ready: stirred as they close, set at their pH.
    while (chiller.length < chain.chillerPallets) {
      const queues = [warm, stagingSet, stagingStirred].filter((queue) => queue.length > 0 && queue[0].readyS <= timeS);
      if (queues.length === 0) break;
      const queue = queues.reduce((best, next) => (next[0].readyS < best[0].readyS ? next : best));
      const pallet = queue.shift() as Pallet;
      pallet.heldPh = phAt(pallet, timeS);
      if (pallet.place === 'warmRoom') pallet.chillFromC = chain.warmRoomC;
      pallet.place = 'chiller';
      pallet.chillFromS = timeS;
      pallet.chilledS = timeS + chillS(pallet.chillFromC);
      chiller.push(pallet);
    }
    // A pallet chilled with the cold room full stays, and is looked at again next step.
    nextChilledS = chiller.reduce((soonest, pallet) => Math.min(soonest, pallet.chilledS), Infinity);
    if (chiller.length > 0 && cold.length >= chain.coldRoomPallets) nextChilledS = Math.min(nextChilledS, timeS);
    // The cold room's 48 h maximum, oldest first.
    for (const pallet of cold) {
      if (pallet.overLogged) continue;
      if (timeS <= pallet.coldS + chain.maxHoldS) break;
      pallet.overLogged = true;
      totals.overHold += 1;
      log(timeS, 'bad', `Cold room: pallet ${pallet.id} of batch ${pallet.batch} has held over ${Math.round(sToH(chain.maxHoldS))} h`, tag);
    }
    // The reefers: arriving ones dock and start loading; loading ones take their pallets one by one, then leave.
    for (const reefer of [...reefers]) {
      if (reefer.state === 'arriving' && timeS >= reefer.untilS) {
        reefer.state = 'loading';
        reefer.loadFromS = reefer.untilS;
        reefer.untilS = reefer.loadFromS + chain.reeferLoadS;
      }
      if (reefer.state !== 'loading') continue;
      const n = reefer.pallets.length;
      let moved = false;
      reefer.pallets.forEach((pallet, i) => {
        if (pallet.place === 'coldRoom' && timeS >= reefer.loadFromS + ((i + 1) * chain.reeferLoadS) / n) {
          pallet.place = 'reefer';
          moved = true;
        }
      });
      if (moved) cold = cold.filter((pallet) => pallet.place === 'coldRoom');
      if (timeS >= reefer.untilS && reefer.pallets.every((pallet) => pallet.place === 'reefer')) {
        const cups = reefer.pallets.reduce((total, pallet) => total + pallet.cups, 0);
        for (const pallet of reefer.pallets) {
          totals.longestHoldS = Math.max(totals.longestHoldS, reefer.untilS - pallet.coldS);
          totals.shippedByRoute[pallet.route] += 1;
        }
        totals.palletsShipped += n;
        totals.cupsShipped += cups;
        totals.reefersShipped += 1;
        reefers.splice(reefers.indexOf(reefer), 1);
        log(timeS, 'ok', `Reefer ${reefer.id} left door ${reefer.door + 1} with ${n} pallets, ${cups.toLocaleString('en-US')} cups`, tag);
      }
    }
    // A reefer is called to a free door for a load of released pallets, or for the oldest that has held reeferLatestS.
    if (timeS >= nextDockCheckS) nextDockCheckS = timeS + DOCK_CHECK_S;
    else return peaks();
    while (reefers.length < chain.dockDoors) {
      const load: Pallet[] = [];
      for (const pallet of cold) {
        if (pallet.reefer !== null) continue;
        if (!released(pallet, timeS)) break;
        load.push(pallet);
        if (load.length === chain.palletsPerTruck) break;
      }
      const due = load.length === chain.palletsPerTruck || (load.length > 0 && timeS - load[0].coldS >= chain.reeferLatestS);
      if (!due) break;
      const doors = new Set(reefers.map((reefer) => reefer.door));
      let door = 0;
      while (doors.has(door)) door += 1;
      const reefer: Reefer = { id: nextReefer++, door, state: 'arriving', untilS: timeS + chain.reeferArriveS, loadFromS: 0, pallets: load };
      for (const pallet of load) pallet.reefer = reefer.id;
      reefers.push(reefer);
      log(timeS, 'info', `Reefer ${reefer.id} called to door ${door + 1} for ${load.length} pallets, due at ${formatDayTime(reefer.untilS)}`, tag);
    }
    peaks();
  }

  function step(timeS: number, events: readonly P8Event[], log: LogWriter): void {
    changes += 1;
    for (const event of events) {
      if (event.kind === 'made') {
        pack(event.batch, event.product, event.sealWindow, event.cups, event.atS);
        totals.cupsIn += event.cups;
      } else if (event.passed) {
        passed.add(event.sealWindow);
      } else {
        pull(event.sealWindow, event.atS, log);
      }
    }
    advance(timeS, log);
  }

  /** Every pallet in the chain's order: on the reefers, in the cold room, the chiller, the warm room, staging. */
  const inPlaces = (): Pallet[] => [...reefers.flatMap((reefer) => reefer.pallets.filter((pallet) => pallet.place === 'reefer')), ...cold, ...chiller, ...warm, ...stagingSet, ...stagingStirred];
  const cupsInChain = (): number => inPlaces().reduce((total, pallet) => total + pallet.cups, 0) + (open ? sum(open.windows) + open.trayCups : 0);

  // The two days before the opening, on the product day at P8's rate, with H125e's changeovers; then the totals restart.
  if (options.history !== false) {
    const shifts = yogurtShiftProducts(config);
    const { batchS, firstShiftStartS } = config.quality;
    const cupsPerS = yogurt.p8.rateCupsPerH / hToS(1);
    const changeoverS = { set: createWingCip(config).totalS + yogurt.p8.sip.holdS, stirred: yogurt.changeover.rinseS };
    const productAt = (shiftStartS: number): YogurtProductId => {
      const index = Math.round((shiftStartS - firstShiftStartS) / batchS);
      return shifts[((index % shifts.length) + shifts.length) % shifts.length];
    };
    let owed = 0;
    let shiftStartS = NaN;
    for (let timeS = openS - HISTORY_S + HISTORY_STEP_S; timeS <= openS + 1e-6; timeS += HISTORY_STEP_S) {
      // The step from fromS to timeS, in the shift that holds fromS.
      const fromS = timeS - HISTORY_STEP_S;
      const startS = firstShiftStartS + Math.floor((fromS - firstShiftStartS + 1e-6) / batchS) * batchS;
      if (startS !== shiftStartS) {
        // A shift ends: its batch's last tray and pallet close, as at a changeover.
        if (!Number.isNaN(shiftStartS)) closeBatch(startS);
        shiftStartS = startS;
      }
      const product = productAt(shiftStartS);
      const gapS = productAt(shiftStartS - batchS) === product ? 0 : changeoverS[products[product].route];
      const events: P8Event[] = [];
      if (fromS >= shiftStartS + gapS - 1e-6) {
        owed += cupsPerS * HISTORY_STEP_S;
        const cups = Math.floor(owed + 1e-9);
        owed -= cups;
        if (cups > 0) events.push({ kind: 'made', batch: batchCode(shiftStartS, firstShiftStartS, batchS), product, sealWindow: HISTORY_WINDOW, cups, atS: timeS });
      }
      step(timeS, events, nothing);
    }
    // The night's set batch ends at the opening.
    closeBatch(openS);
    advance(openS, nothing);
    totals.openingCups = cupsInChain();
    Object.assign(totals, { cupsIn: 0, traysMade: 0, palletsMade: 0, cupsShipped: 0, palletsShipped: 0, reefersShipped: 0, cupsHeld: 0, palletsHeld: 0, overHold: 0, longestHoldS: 0 });
    totals.shippedByRoute = { set: 0, stirred: 0 };
    totals.peak = { staging: 0, warmRoom: 0, chiller: 0, coldRoom: 0 };
    peaks();
  }

  return {
    step,
    closeBatch,
    cupsInChain,
    totals: () => ({ ...totals, peak: { ...totals.peak }, shippedByRoute: { ...totals.shippedByRoute } }),
    view(timeS) {
      if (cached && cached.timeS === timeS && cached.changes === changes) return cached.view;
      // The cold room is first in first out: its next release is its oldest pallet still on hold.
      const holding = cold.find((pallet) => !released(pallet, timeS));
      const snapshotPallets: YogurtPallet[] = inPlaces().map((pallet) => {
        const inCold = Number.isFinite(pallet.coldS);
        return {
          id: pallet.id,
          batch: pallet.batch,
          product: pallet.product,
          route: pallet.route,
          cups: pallet.cups,
          trays: pallet.trays,
          place: pallet.place,
          closedS: pallet.closedS,
          tempC: tempAt(pallet, timeS),
          ph: phAt(pallet, timeS),
          holdUntilS: inCold ? pallet.coldS + chain.minHoldS : null,
          leaveByS: inCold ? pallet.coldS + chain.maxHoldS : null,
          released: released(pallet, timeS),
        };
      });
      const snapshotReefers: YogurtReefer[] = reefers.map((reefer) => ({
        id: reefer.id,
        door: reefer.door,
        state: reefer.state,
        pallets: reefer.pallets.filter((pallet) => pallet.place === 'reefer').length,
        load: reefer.pallets.length,
        untilS: reefer.untilS,
      }));
      const view: ColdChainSnapshot = {
        warmRoom: { tempC: chain.warmRoomC, pallets: warm.length, capacity: chain.warmRoomPallets },
        chiller: { pallets: chiller.length, capacity: chain.chillerPallets, airC: chain.chillerAirC },
        coldRoom: { tempC: chain.roomC, positionsUsed: cold.length, capacity: chain.coldRoomPallets, nextReleaseS: holding ? holding.coldS + chain.minHoldS : null },
        palletsShipped: totals.palletsShipped,
        reefersShipped: totals.reefersShipped,
        trays: { made: totals.traysMade, openBatch: open?.batch ?? null, openCups: open?.trayCups ?? 0, openTrays: open?.trays ?? 0 },
        pallets: snapshotPallets,
        reefers: snapshotReefers,
        cupsShipped: totals.cupsShipped,
        cupsHeld: totals.cupsHeld,
      };
      cached = { timeS, changes, view };
      return view;
    },
  };
}
