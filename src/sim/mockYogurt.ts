// A lively stand-in for the yogurt line (phase 15, agent plan "Contracts"), so the panels for stages 11–16 and,
// from phase 16, the wing's 3D view can be built before phases 17–19 make the line live. ?mock runs it beside
// the milk's mock. The three fermentation tanks take turns through fill, ferment, ready, empty and clean, a third
// of a cycle apart, so at opening one fills, one ferments half way and one feeds the P8 buffer; P8 runs; the cold
// room is part full. The pH, the hold and the denaturation follow the yogurt formulas (H122–H125) at the live set
// points, and a heat set point under the divert limit diverts; the rest drifts on seeded waves of sim time. The
// cycle's hold, clean and history numbers are mock numbers, not plant.json. Since contracts v9 it fills the live
// line's fields too: the steam, as the live line counts it, the buffer's product, and no changeover or clean; since
// v10 P8's: its cycles, the rejects by cause, a fill histogram, the seal, the hygiene readings, the magazines (a saw
// tooth) and the shift's batch; since v11 the cold chain's: a pallet for each the rooms hold, their trays and a reefer.
import {
  dayToS,
  hToS,
  sToH,
  type LogKind,
  type PlantConfig,
  type TankLevel,
  type FermentTank,
  type YogurtPallet,
  type YogurtProductId,
  type YogurtSnapshot,
} from '../contracts';
import type { Setpoints } from './core';
import { holdTimeS, tubeVolumeL } from './formulas';
import { boilerGasKw, boilerGasKwh, steamLph } from './liquid/stageModels';
import { createRng } from './rng';
import { batchCode, cyclePeriodS, FILL_HISTOGRAM } from './yogurt/p8';
import { betaLgDenaturedPct, fermentPh, p8DrawLph, powderKgPerT, timeToPhS, titratableAcidityPct } from './yogurt/formulas';
import { createProductPlan } from './yogurt/products';
import { yogurtView, type YogurtView } from './yogurt/view';

/** A tank holds at its end pH this long before it empties, and its clean takes this long (mock numbers). */
const READY_HOLD_S = hToS(0.5);
const TANK_CLEAN_S = hToS(0.75);
/** What P8 and the reefers had already done when the plant opens (mock numbers). */
const CUPS_BEFORE_OPENING = 1_200_000;
const REEFERS_BEFORE_OPENING = 12;
/** One reefer leaves this often in the mock, about six a day. */
const REEFER_EVERY_S = hToS(4);
/** Share of the cups the checks throw out in the mock. */
const REJECT_FRAC = 0.004;
/** How the mock splits its rejects among the checks (the live line rejects far fewer, H129). */
const REJECT_SHARES = { underFill: 0.2, overFill: 0.1, metal: 0.05, vision: 0.65 } as const;
/** The mock's magazines run down and refill on these cycles (mock numbers). */
const CUP_MAGAZINE_S = hToS(1 / 3);
const FOIL_MAGAZINE_S = hToS(5 / 9);

export interface MockYogurt {
  setNextProduct(product: string, timeS: number, log: (timeS: number, kind: LogKind, message: string) => void): void;
  /** Counts what the heat treatment diverts, step by step. */
  step(dtS: number, timeS: number, setpoints: Readonly<Setpoints>): void;
  view(setpoints: Readonly<Setpoints>, timeS: number): YogurtView;
}

export function createMockYogurt(config: PlantConfig): MockYogurt {
  const { yogurt: plant } = config;
  const openS = config.clock.startTimeS;
  const plan = createProductPlan(config);
  // Its own seeded stream, so the milk's mock draws exactly what it drew before the yogurt line came (D25).
  const rng = createRng((config.seed ^ 0x796f6775) >>> 0);
  const phases = Array.from({ length: 12 }, () => rng.next() * 2 * Math.PI);
  const wave = (timeS: number, periodS: number, index: number): number => Math.sin((2 * Math.PI * timeS) / periodS + phases[index]);
  const cellL = tubeVolumeL(plant.heat.holdS, plant.mix.capacityLph);
  let divertedL = 0;
  let reprocessL = 0;
  let divertCount = 0;
  let wasDiverting = false;
  let steamKg = 0;

  /**
   * The steam that heats the mix from the homogenizer's temperature to the outlet's, as the live line counts it; the
   * mock's heater runs at the mix line's capacity, forward or diverting.
   */
  const steamAt = (outletC: number): number => steamLph(config, plant.mix.capacityLph, plant.homogenizer.tempC, Math.max(outletC, plant.homogenizer.tempC));

  /** The holding-cell outlet, and whether the CCP diverts it, at a heat set point. */
  const heatAt = (timeS: number, setpoints: Readonly<Setpoints>): { outletC: number; holdS: number; diverting: boolean } => {
    const outletC = setpoints.yogurtHeatC + 0.3 * wave(timeS, 41, 0);
    const holdS = holdTimeS(cellL, plant.mix.capacityLph);
    return { outletC, holdS, diverting: outletC < plant.heat.divertBelowC || holdS < plant.heat.minHoldS };
  };

  function tanksAt(timeS: number, setpoints: Readonly<Setpoints>, product: YogurtProductId, fermentC: number): FermentTank[] {
    const { ferment } = plant;
    const fillS = hToS(ferment.tankL / plant.mix.capacityLph);
    const fermentS = timeToPhS(ferment, ferment.endPh, setpoints.fermentTempC);
    const emptyS = hToS(ferment.tankL / p8DrawLph(setpoints.p8RateCupsPerH, plant.p8.fill.targetG));
    const cycleS = fillS + fermentS + READY_HOLD_S + emptyS + TANK_CLEAN_S;
    // At opening the first tank is half way through its fermentation.
    const startS = fillS + fermentS / 2;
    return Array.from({ length: ferment.tanks }, (_, i) => {
      const intoS = (((timeS - openS + startS + (i * cycleS) / ferment.tanks) % cycleS) + cycleS) % cycleS;
      const tank = (state: FermentTank['state'], levelFrac: number, ph: number, startedS: number | null): FermentTank => ({
        levelL: ferment.tankL * levelFrac,
        capacityL: ferment.tankL,
        state,
        product: state === 'cleaning' || state === 'empty' ? null : product,
        ph,
        taPct: titratableAcidityPct(ferment, ph),
        startedS,
        readyAtS: startedS === null ? null : startedS + fermentS,
      });
      const fermentedS = intoS - fillS;
      if (intoS < fillS) return tank('filling', intoS / fillS, ferment.startPh, null);
      if (fermentedS < fermentS) return tank('fermenting', 1, fermentPh(ferment, fermentedS, fermentC), timeS - fermentedS);
      const startedS = timeS - fermentedS;
      if (fermentedS < fermentS + READY_HOLD_S) return tank('ready', 1, ferment.endPh, startedS);
      const emptiedS = fermentedS - fermentS - READY_HOLD_S;
      if (emptiedS < emptyS) return tank('emptying', 1 - emptiedS / emptyS, ferment.endPh, startedS);
      return tank('cleaning', 0, ferment.startPh, null);
    });
  }

  /**
   * The cold chain's pallets, one for each the rooms hold: the warm room's set yogurt on its way to pH 4.60, the
   * chiller's cores on their way to 4 °C, the cold room's on their hold clocks, the oldest released (mock numbers).
   */
  function palletsAt(timeS: number, warm: number, chilling: number, cold: number): YogurtPallet[] {
    const { coldChain: chain, ferment } = plant;
    const { batchS, firstShiftStartS } = config.quality;
    const cups = chain.cupsPerTray * chain.traysPerPallet;
    let id = 1;
    const pallet = (place: YogurtPallet['place'], closedS: number, route: 'set' | 'stirred', tempC: number, ph: number, coldS: number | null): YogurtPallet => {
      const shiftStartS = firstShiftStartS + Math.floor((closedS - firstShiftStartS) / batchS) * batchS;
      return {
        id: id++,
        batch: batchCode(shiftStartS, firstShiftStartS, batchS),
        product: route === 'set' ? 'plainSet' : 'plainStirred',
        route,
        cups,
        trays: chain.traysPerPallet,
        place,
        closedS,
        tempC,
        ph,
        holdUntilS: coldS === null ? null : coldS + chain.minHoldS,
        leaveByS: coldS === null ? null : coldS + chain.maxHoldS,
        released: coldS !== null && timeS >= coldS + chain.minHoldS,
      };
    };
    const list: YogurtPallet[] = [];
    // Oldest first: the cold room's spread over 30 h, then the chiller's, then the warm room's.
    for (let i = 0; i < cold; i++) {
      const coldS = timeS - hToS(30) * (1 - i / Math.max(1, cold));
      list.push(pallet('coldRoom', coldS - hToS(2), 'stirred', chain.roomC, ferment.endPh, coldS));
    }
    for (let i = 0; i < chilling; i++) {
      const frac = (i + 0.5) / Math.max(1, chilling);
      list.push(pallet('chiller', timeS - hToS(2) * (1 - frac), 'stirred', chain.chillToC + (plant.cooling.outletC - chain.chillToC) * frac, ferment.endPh, null));
    }
    for (let i = 0; i < warm; i++) {
      const sinceS = hToS(3.8) * (1 - (i + 0.5) / Math.max(1, warm));
      list.push(pallet('warmRoom', timeS - sinceS, 'set', chain.warmRoomC, fermentPh(ferment, sinceS, chain.warmRoomC), null));
    }
    return list;
  }

  function snapshotAt(setpoints: Readonly<Setpoints>, timeS: number): YogurtSnapshot {
    const t = timeS - openS;
    const product = plan.at(timeS);
    const set = product.route === 'set';
    const level = (capacityL: number, frac: number): TankLevel => ({ levelL: capacityL * Math.min(1, Math.max(0, frac)), capacityL });
    const heat = heatAt(timeS, setpoints);
    const flowLph = plant.mix.capacityLph;
    const forwardLph = heat.diverting ? 0 : flowLph;
    const fermentC = setpoints.fermentTempC + 0.15 * wave(timeS, 1_900, 1);
    const tanks = tanksAt(timeS, setpoints, product.id, fermentC);
    const cupsPerH = setpoints.p8RateCupsPerH * (0.99 + 0.01 * wave(timeS, 300, 2));
    const drawLph = p8DrawLph(cupsPerH, plant.p8.fill.targetG);
    const emptying = tanks.some((tank) => tank.state === 'emptying');
    const bufferC = set ? fermentC : plant.cooling.outletC + 0.3 * wave(timeS, 900, 3);
    const cupsMade = Math.floor(CUPS_BEFORE_OPENING + setpoints.p8RateCupsPerH * sToH(t) * (1 - REJECT_FRAC));
    const reefersShipped = REEFERS_BEFORE_OPENING + Math.floor(t / REEFER_EVERY_S);
    const coldRoomPallets = Math.round(170 + 60 * wave(timeS, hToS(24), 4));
    const warmPallets = Math.round(8 + 6 * wave(timeS, hToS(8), 11));
    const chillerPallets = Math.round(3 + wave(timeS, hToS(3), 1));
    const steamKgPerH = steamAt(heat.outletC);
    const cupsRejected = Math.floor((cupsMade * REJECT_FRAC) / (1 - REJECT_FRAC));
    const split = (share: number): number => Math.floor(cupsRejected * share);
    const rejects = { underFill: split(REJECT_SHARES.underFill), overFill: split(REJECT_SHARES.overFill), metal: split(REJECT_SHARES.metal), vision: 0, sealHold: 0 };
    rejects.vision = cupsRejected - rejects.underFill - rejects.overFill - rejects.metal;
    const { batchS, firstShiftStartS } = config.quality;
    const shiftStartS = firstShiftStartS + Math.floor((timeS - firstShiftStartS) / batchS) * batchS;
    const p8 = plant.p8;
    const sawtooth = (periodS: number, index: number): number => 100 * (1 - (((t + phases[index] * periodS) % periodS) + periodS) % periodS / periodS);
    // The shift's fills so far, a normal around the target, scaled to the shift's cups.
    const shiftCups = Math.max(0, Math.floor(setpoints.p8RateCupsPerH * sToH(timeS - Math.max(shiftStartS, openS))));
    const counts = Array.from({ length: FILL_HISTOGRAM.bins }, (_, i) => {
      const midG = FILL_HISTOGRAM.fromG + (i + 0.5) * FILL_HISTOGRAM.binG;
      const z = (midG - p8.fill.targetG) / p8.fill.sigmaG;
      return Math.round((shiftCups * FILL_HISTOGRAM.binG * Math.exp(-0.5 * z * z)) / (p8.fill.sigmaG * Math.sqrt(2 * Math.PI)));
    });
    const sealTestsDone = Math.floor((t + hToS(1)) / p8.sealTest.everyS);
    return {
      product,
      mix: {
        flowLph,
        fatPct: plant.mix.fatPct,
        snfPct: plant.mix.snfPct,
        powderKgPerT: powderKgPerT(plant.mix),
        tanks: {
          silo: level(plant.silo.capacityL, plant.silo.startFrac + 0.2 * wave(timeS, hToS(7), 5)),
          mixTank: level(plant.mix.tankL, 0.5 + 0.2 * wave(timeS, hToS(1.5), 6)),
        },
      },
      heat: {
        mode: heat.diverting ? 'divert' : 'production',
        flowLph,
        outletC: heat.outletC,
        holdS: heat.holdS,
        denatPct: betaLgDenaturedPct(heat.outletC, heat.holdS, plant.heat.betaLgGPerL),
        divertCount,
        reprocessTank: { levelL: reprocessL, capacityL: plant.heat.reprocessTankL },
        modeRemainingS: 0,
        cleaning: null,
      },
      ferment: { tempC: fermentC, tanks },
      buffer: {
        ...level(plant.buffer.capacityL, 0.55 + 0.3 * wave(timeS, hToS(2), 7)),
        inflowLph: set ? forwardLph : emptying ? drawLph * (1 + 0.1 * wave(timeS, 600, 8)) : 0,
        outflowLph: drawLph,
        tempC: bufferC,
        waitS: set ? 0.6 * plant.buffer.setMaxWaitS * (0.5 + 0.5 * wave(timeS, hToS(1), 9)) : null,
        coolerOutletC: set ? null : bufferC,
        fruitDosePct: product.fruit ? plant.fruit.dosePct : 0,
        product: product.id,
        changeover: null,
      },
      p8: {
        state: 'running',
        cupsPerH,
        cupsMade,
        cupsRejected,
        stopReason: null,
        cyclesPerMin: 60 / cyclePeriodS(p8.lanes, cupsPerH),
        rejects,
        lastFillG: p8.fill.targetG + p8.fill.sigmaG * wave(timeS, 7, 3),
        fillHistogram: { fromG: FILL_HISTOGRAM.fromG, binG: FILL_HISTOGRAM.binG, counts },
        seal: { tempC: p8.seal.tempC + 1.5 * wave(timeS, 120, 4), timeS: p8.seal.timeS, bar: p8.seal.bar + 0.1 * wave(timeS, 90, 5) },
        hepaPa: p8.hepa.normalPa + p8.hepa.swingPa * wave(timeS, p8.hepa.swingS, 6),
        sip: { lastS: openS - hToS(6 + 1 / 3), ok: true },
        atpRlu: p8.atpCleanRlu,
        nextSealTestS: openS - hToS(1) + (sealTestsDone + 1) * p8.sealTest.everyS,
        sealTests: { passed: sealTestsDone, failed: 0, cupsTaken: sealTestsDone * p8.sealTest.cups },
        magazines: { cupsPct: sawtooth(CUP_MAGAZINE_S, 7), foilsPct: sawtooth(FOIL_MAGAZINE_S, 8) },
        currentBatch: {
          code: batchCode(shiftStartS, firstShiftStartS, batchS),
          product: product.id,
          madeS: shiftStartS,
          expiresS: shiftStartS + dayToS(plant.coldChain.shelfLifeDays),
          cups: counts.reduce((sum, count) => sum + count, 0),
        },
      },
      coldChain: {
        warmRoom: { tempC: plant.coldChain.warmRoomC + 0.3 * wave(timeS, 1_300, 10), pallets: warmPallets, capacity: plant.coldChain.warmRoomPallets },
        chiller: { pallets: chillerPallets, capacity: plant.coldChain.chillerPallets, airC: plant.coldChain.chillerAirC },
        coldRoom: {
          tempC: plant.coldChain.roomC + 0.4 * wave(timeS, hToS(1.5), 2),
          positionsUsed: coldRoomPallets,
          capacity: plant.coldChain.coldRoomPallets,
          nextReleaseS: timeS + hToS(0.5 + 0.4 * wave(timeS, hToS(2), 3)),
        },
        palletsShipped: reefersShipped * plant.coldChain.palletsPerTruck,
        reefersShipped,
        trays: { made: Math.floor(t / 4), openBatch: null, openCups: 0, openTrays: 0 },
        pallets: palletsAt(timeS, warmPallets, chillerPallets, coldRoomPallets),
        reefers: [],
        cupsShipped: reefersShipped * plant.coldChain.palletsPerTruck * plant.coldChain.cupsPerTray * plant.coldChain.traysPerPallet,
        cupsHeld: 0,
      },
      kpis: { mixLph: forwardLph, divertedL, cupsPerH, cupsMade, coldRoomPallets, reefersShipped },
      energy: { steamKgPerH, gasKw: boilerGasKw(config, steamKgPerH), steamKg, gasKwh: boilerGasKwh(config, steamKg) },
    };
  }

  return {
    setNextProduct: (product, timeS, log) => plan.setNext(product, timeS, log),
    step(dtS, timeS, setpoints) {
      const { diverting, outletC } = heatAt(timeS, setpoints);
      steamKg += steamAt(outletC) * sToH(dtS);
      if (diverting) {
        const litres = sToH(dtS) * plant.mix.capacityLph;
        divertedL += litres;
        reprocessL = Math.min(plant.heat.reprocessTankL, reprocessL + litres);
        if (!wasDiverting) divertCount += 1;
      }
      wasDiverting = diverting;
    },
    view: (setpoints, timeS) => yogurtView(config, setpoints, snapshotAt(setpoints, timeS)),
  };
}
