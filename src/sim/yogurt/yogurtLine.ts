// The yogurt line live: its liquid side, stages 11–14 (phase 17, D27), and Line P8, stage 15 (phase 18, D28, p8.ts),
// with the cold chain still standing (phase 19). It runs inside the core's step after the UHT line's and queues no
// events; P8's draws come from a stream of its own, so the UHT line's steps, draws and numbers stay as they were (D25).
//
// Each step:
//   1. P8's shift product (the product day) and the buffer's changeover: P8 finishes what the buffer holds, then a
//      rinse (before a stirred product) or the wing's CIP and P8's SIP (before set yogurt) runs, and the buffer takes
//      the new product. Near a shift's end before another product the buffer is filled only for the time left. The
//      SIP that falls short runs again, and an ATP swab that fails sends P8 back to the CIP (D28).
//   2. The yogurt silo's tanker, which starts only while the tanker bay's UHT lane is free.
//   3. The mix line fills the mix tank at its capacity, by H122's recipe.
//   4. The heat treatment: set mix for the buffer first (a level control), the rest into the tank that is filling;
//      the outlet lags its set point; the holding cell passes the litres in plug flow, and the parcel at its outlet
//      is the CCP's: below the divert limit, or held too short, the line diverts to the reprocess tank, then cleans.
//   5. The tanks ferment on H125's curve; the oldest ready tank empties through the smoothing valve and the cooler
//      into the buffer, with fruit dosed in when P8's product has it.
//   6. P8 fills its cycles from the buffer (p8.ts); set mix that waits past its limit goes to rework, and what a
//      product leaves in the buffer, less than a cycle, is flushed out to rework by the changeover.
import {
  hToS,
  lpsToLph,
  pctToFrac,
  sToH,
  yogurtProducts,
  type CleaningSnapshot,
  type LogKind,
  type PlantConfig,
  type YogurtChangeoverKind,
  type YogurtHeatMode,
  type YogurtProductId,
  type YogurtSnapshot,
} from '../../contracts';
import type { Setpoints } from '../core';
import { lagToward, tubeVolumeL } from '../formulas';
import { boilerGasKw, boilerGasKwh, steamLph } from '../liquid/stageModels';
import type { LogWriter } from '../log';
import { createRng, type Rng } from '../rng';
import { ferment, tankView, type TankState } from './ferment';
import { betaLgDenaturedPct, p8DrawLph } from './formulas';
import { createHoldingCell, createWingCip } from './heat';
import { mixRecipe } from './mix';
import { createP8, type P8, type P8Conditions } from './p8';
import { createProductPlan } from './products';
import { createBuffer } from './routing';
import { yogurtView, type YogurtView } from './view';

/** Litres and times this close count as nothing. */
const EPS = 1e-9;

/** Everything summed since the plant opened, for the mass balance and the acceptance run. */
export interface YogurtTotals {
  tankerInL: number;
  rawDrawnL: number;
  creamL: number;
  powderKg: number;
  stabilizerKg: number;
  mixL: number;
  heatedL: number;
  divertedL: number;
  /** Diverted mix pumped out of the reprocess tank to rework during the clean after a divert. */
  reprocessedL: number;
  toTanksL: number;
  fromTanksL: number;
  fruitL: number;
  setToBufferL: number;
  toP8L: number;
  /** Set mix that waited in the buffer past its limit. */
  reworkL: number;
  /** What a product left in the buffer, less than a cycle, flushed out to rework by the changeover (D28). */
  flushedL: number;
  /** Cleans run again after an ATP swab failed (D28). */
  recleans: number;
  steamKg: number;
  /** Tanks that reached their end pH. */
  tanksFermented: number;
  /** Changeovers between two products on P8, by kind (a CIP before set yogurt counts once, its SIP with it). */
  rinses: number;
  cips: number;
}

export interface YogurtLine {
  /** One fixed step of `dtS` ending at `timeS`; `bayBusy` while the UHT line's tanker unloads at the shared bay. */
  step(dtS: number, timeS: number, setpoints: Readonly<Setpoints>, bayBusy: boolean, log: LogWriter): void;
  /** The setYogurtProduct command: P8's next shift makes this product. */
  setNextProduct(product: string, timeS: number, log: (timeS: number, kind: LogKind, message: string) => void): void;
  view(setpoints: Readonly<Setpoints>, timeS: number): YogurtView;
  totals(): Readonly<YogurtTotals>;
  /** Levels the mass balance needs: the silo and the tanker, the mix tank, the tanks, the buffer, the reprocess tank. */
  inventory(): { siloL: number; tankerLeftL: number; mixTankL: number; tanksL: number; bufferL: number; reprocessL: number };
  /** Line P8 (phase 18), for its totals. */
  readonly p8: P8;
}

/** P8's seed: plant.json's seed, mixed so its stream never runs in step with the UHT line's or the packs model's. */
export const yogurtSeed = (seed: number): number => Math.imul(seed ^ 0x50380001, 0x85ebca6b) >>> 0;

export interface YogurtLineOptions {
  /** P8's random draws; defaults to its own stream from plant.json's seed. */
  rng?: Rng;
  /** P8's readings in place of plant.json's (the HEPA cabin, the SIP, the swab, the seal), for tests and faults. */
  p8Conditions?: Partial<P8Conditions>;
}

/** The yogurt line live, opening at `openS` as the night left it: two tanks ready, the third half way. */
export function createYogurtLine(config: PlantConfig, openS: number, options: YogurtLineOptions = {}): YogurtLine {
  const { yogurt: plant } = config;
  const products = yogurtProducts(config);
  const plan = createProductPlan(config);
  const recipe = mixRecipe(config);
  const wingCip = createWingCip(config);
  const cellL = tubeVolumeL(plant.heat.holdS, plant.mix.capacityLph);
  const { batchS, firstShiftStartS } = config.quality;
  const shiftEndS = (timeS: number): number => firstShiftStartS + (Math.floor((timeS - firstShiftStartS) / batchS) + 1) * batchS;

  const totals: YogurtTotals = {
    tankerInL: 0,
    rawDrawnL: 0,
    creamL: 0,
    powderKg: 0,
    stabilizerKg: 0,
    mixL: 0,
    heatedL: 0,
    divertedL: 0,
    reprocessedL: 0,
    toTanksL: 0,
    fromTanksL: 0,
    fruitL: 0,
    setToBufferL: 0,
    toP8L: 0,
    reworkL: 0,
    flushedL: 0,
    recleans: 0,
    steamKg: 0,
    tanksFermented: 0,
    rinses: 0,
    cips: 0,
  };
  let siloL = plant.silo.capacityL * plant.silo.startFrac;
  let tankerLeftL = 0;
  let mixTankL = plant.mix.tankL * plant.mix.tankStartFrac;
  let mixLph = 0;
  // The heat treatment.
  let mode: YogurtHeatMode = 'idle';
  let modeLeftS = 0;
  let cleaningIntoS = 0;
  let outletC = plant.heat.setpointC;
  let heatLph = 0;
  let steamKgPerH = 0;
  let divertCount = 0;
  let reprocessL = 0;
  const cell = createHoldingCell(cellL, plant.heat.setpointC, openS, plant.heat.holdS);
  // The tanks, as the night left them.
  const tanks: TankState[] = Array.from({ length: plant.ferment.tanks }, (_, i): TankState => {
    const last = i === plant.ferment.tanks - 1;
    const curveS = last ? plant.ferment.endAtOptS / 2 : plant.ferment.endAtOptS;
    return {
      state: last ? 'fermenting' : 'ready',
      levelL: plant.ferment.tankL,
      product: 'plainStirred',
      curveS,
      startedS: openS - curveS - (last ? 0 : hToS(1) * (plant.ferment.tanks - 1 - i)),
      readyS: last ? null : openS - hToS(1) * (plant.ferment.tanks - 1 - i),
      cleanLeftS: 0,
    };
  });
  let emptying: number | null = null;
  let filling: number | null = null;
  let fromTankLph = 0;
  // The buffer and the changeover between products.
  const buffer = createBuffer();
  let bufferProduct: YogurtProductId | null = plan.at(openS).id;
  let changeover: { kind: YogurtChangeoverKind; leftS: number; to: YogurtProductId } | null = null;
  let bufferInLph = 0;
  let fruitDosePct = 0;
  // Line P8 (phase 18).
  const p8 = createP8(config, openS, options.rng ?? createRng(yogurtSeed(config.seed)), options.p8Conditions);
  let p8Lph = 0;
  /**
   * The step just ended a changeover: P8 is ready and starts from the next one. The plant opens so too, P8 ready for
   * the first tank's yogurt, so the opening view shows it standing ready, not starved.
   */
  let readyToRun = true;

  const routeOf = (id: YogurtProductId) => products[id].route;
  const tag = { topic: 'yogurt' as const, line: 'yogurt' as const };

  /** The product in the buffer is done: what is left, less than a cycle, is flushed to rework, and the changeover starts. */
  function startChangeover(to: YogurtProductId, timeS: number, log: LogWriter): void {
    totals.flushedL += buffer.draw(buffer.levelL);
    const kind: YogurtChangeoverKind = routeOf(to) === 'set' ? 'cip' : 'rinse';
    changeover = { kind, leftS: kind === 'cip' ? wingCip.totalS : config.yogurt.changeover.rinseS, to };
    bufferProduct = null;
    if (kind === 'cip') totals.cips += 1;
    else totals.rinses += 1;
    const what = kind === 'cip' ? 'the wing\'s CIP and P8\'s SIP' : 'a rinse of the buffer and the fruit line';
    log(timeS, 'info', `Line P8: ${what} before ${products[to].name.toLowerCase()}`, tag);
  }

  return {
    step(dtS, timeS, setpoints, bayBusy, log) {
      const shift = plan.at(timeS);

      // 1. The changeover between two products on P8. P8 and the buffer's feed start again from the step after it ends.
      let changedOver = false;
      if (changeover) {
        changeover.leftS -= dtS;
        if (changeover.leftS <= EPS) {
          // After the CIP, P8's SIP; after the SIP, its check and the ATP swab, which may send it back (D28).
          const after = changeover.kind === 'cip' ? 'sip' : changeover.kind === 'sip' ? p8.afterSip(timeS, log) : 'ok';
          if (changeover.kind === 'cip') p8.cipDone(timeS);
          if (after === 'sip') {
            changeover = { kind: 'sip', leftS: plant.p8.sip.holdS + changeover.leftS, to: changeover.to };
          } else if (after === 'cip') {
            changeover = { kind: 'cip', leftS: wingCip.totalS + changeover.leftS, to: changeover.to };
            totals.recleans += 1;
          } else {
            bufferProduct = changeover.to;
            log(timeS, 'ok', `Line P8: ready for ${products[bufferProduct].name.toLowerCase()}`, tag);
            changeover = null;
            changedOver = true;
          }
        }
      }
      if (!changeover && !changedOver && bufferProduct !== shift.id && buffer.levelL < p8.cycleNeedL) startChangeover(shift.id, timeS, log);
      const feeding = !changeover && !changedOver && bufferProduct === shift.id;
      const drawLph = p8DrawLph(setpoints.p8RateCupsPerH, plant.p8.fill.targetG);
      // Near the end of a shift before another product, the buffer holds only what P8 draws until then.
      const runDownL = shift.next !== shift.id ? (drawLph * sToH(Math.max(0, shiftEndS(timeS) - timeS))) : Infinity;

      // 2. The yogurt silo's tanker: while the bay's UHT lane is free, when the silo runs low.
      if (tankerLeftL <= EPS && siloL < plant.silo.tankerBelowFrac * plant.silo.capacityL && !bayBusy) {
        tankerLeftL = plant.silo.tankerL;
        log(timeS, 'info', `Tanker unloading into the yogurt silo: ${Math.round(plant.silo.tankerL).toLocaleString('en-US')} L`, tag);
      }
      if (tankerLeftL > EPS) {
        const inL = Math.min(config.standardization.tankerUnloadLph * sToH(dtS), tankerLeftL, plant.silo.capacityL - siloL);
        siloL += inL;
        tankerLeftL -= inL;
        totals.tankerInL += inL;
      }

      // 3. The mix line: at its capacity while the mix tank has room, by the recipe of H122.
      const mixL = Math.max(0, Math.min(plant.mix.capacityLph * sToH(dtS), plant.mix.tankL - mixTankL, siloL / recipe.rawPerMix));
      siloL -= mixL * recipe.rawPerMix;
      mixTankL += mixL;
      mixLph = mixL / sToH(dtS);
      totals.rawDrawnL += mixL * recipe.rawPerMix;
      totals.creamL += mixL * recipe.creamPerMix;
      totals.powderKg += mixL * recipe.powderPerMix;
      totals.stabilizerKg += mixL * recipe.stabilizerPerMix;
      totals.mixL += mixL;

      // 4. The heat treatment.
      if (mode === 'cleaning') {
        cleaningIntoS += dtS;
        modeLeftS -= dtS;
        // The reprocess tank is pumped out to rework by the clean's end.
        const outL = modeLeftS > EPS ? (reprocessL * dtS) / (modeLeftS + dtS) : reprocessL;
        reprocessL -= outL;
        totals.reprocessedL += outL;
        outletC = lagToward(outletC, wingCip.tempAt(cleaningIntoS), dtS, plant.heat.lagS);
        if (modeLeftS <= EPS) {
          mode = 'idle';
          modeLeftS = 0;
          // The clean ends with the line full of water brought up to the set point: the mix starts again behind it,
          // so the cold mix of before the divert is gone from the holding cell, and the CCP judges the new mix as
          // it reaches the outlet. A set point still under the limit diverts again at once.
          outletC = setpoints.yogurtHeatC;
          cell.refill(outletC, timeS, plant.heat.holdS);
          log(timeS, 'ok', 'Yogurt heat treatment clean, ready to run again', tag);
        }
      } else {
        outletC = lagToward(outletC, setpoints.yogurtHeatC, dtS, plant.heat.lagS);
      }
      let heatL = 0;
      let setL = 0;
      let tankL = 0;
      if (mode === 'divert') {
        heatL = Math.max(0, Math.min(plant.mix.capacityLph * sToH(dtS), mixTankL, plant.heat.reprocessTankL - reprocessL));
      } else if (mode !== 'cleaning') {
        const set = feeding && routeOf(shift.id) === 'set';
        if (set) {
          const targetL = Math.min(plant.buffer.setHighFrac * plant.buffer.capacityL, runDownL);
          const wantLph = drawLph + lpsToLph((targetL - buffer.levelL) / plant.buffer.levelLagS);
          setL = Math.max(0, Math.min(wantLph, plant.mix.capacityLph) * sToH(dtS));
          setL = Math.min(setL, plant.buffer.capacityL - buffer.levelL);
        }
        if (filling === null) {
          const next = tanks.findIndex((tank) => tank.state === 'empty');
          if (next >= 0) {
            filling = next;
            tanks[next].state = 'filling';
            tanks[next].product = 'plainStirred';
          }
        }
        if (filling !== null) tankL = Math.max(0, Math.min(plant.mix.capacityLph * sToH(dtS) - setL, plant.ferment.tankL - tanks[filling].levelL));
        heatL = setL + tankL;
        if (heatL > mixTankL) {
          // Short of mix: the buffer first.
          setL = Math.min(setL, mixTankL);
          tankL = Math.max(0, mixTankL - setL);
          heatL = setL + tankL;
        }
      }
      mixTankL -= heatL;
      totals.heatedL += heatL;
      heatLph = heatL / sToH(dtS);
      cell.push(heatL, outletC, timeS);
      const out = cell.outlet();
      const heldS = timeS - out.enteredS;
      if (mode !== 'divert' && mode !== 'cleaning') {
        mode = heatL > EPS ? 'production' : 'idle';
        // The CCP: the parcel at the holding cell's outlet, too cool or held too short.
        if (heatL > EPS && (out.tempC < plant.heat.divertBelowC || heldS < plant.heat.minHoldS)) {
          mode = 'divert';
          modeLeftS = plant.heat.divertS;
          divertCount += 1;
          const why = out.tempC < plant.heat.divertBelowC ? `${out.tempC.toFixed(1)} °C at the holding cell's outlet, below ${plant.heat.divertBelowC} °C` : `held ${heldS.toFixed(0)} s, under ${plant.heat.minHoldS} s`;
          log(timeS, 'bad', `Yogurt mix diverted to the reprocess tank: ${why}`, tag);
          // This step's litres go to the reprocess tank too.
          setL = 0;
          tankL = 0;
        }
      }
      if (mode === 'divert') {
        const intoL = Math.min(heatL, plant.heat.reprocessTankL - reprocessL);
        reprocessL += intoL;
        totals.divertedL += intoL;
        // What the reprocess tank has no room for stays in the mix tank.
        mixTankL += heatL - intoL;
        totals.heatedL -= heatL - intoL;
        modeLeftS -= dtS;
        if (modeLeftS <= EPS) {
          mode = 'cleaning';
          modeLeftS = wingCip.totalS;
          cleaningIntoS = 0;
          log(timeS, 'warn', 'Yogurt heat treatment cleaning after the divert (the wing\'s CIP)', tag);
        }
      }
      // The steam heats the mix from the homogenizer's temperature to the outlet's (the regeneration does the rest).
      steamKgPerH = heatL > EPS ? steamLph(config, heatLph, plant.homogenizer.tempC, Math.max(outletC, plant.homogenizer.tempC)) : 0;
      totals.steamKg += steamKgPerH * sToH(dtS);

      // Forward: set mix to the buffer, the rest into the filling tank.
      if (setL > EPS) {
        buffer.add(setL, timeS);
        totals.setToBufferL += setL;
      }
      if (filling !== null && tankL > EPS) {
        const tank = tanks[filling];
        tank.levelL += tankL;
        totals.toTanksL += tankL;
        if (tank.levelL >= plant.ferment.tankL - EPS) {
          tank.levelL = plant.ferment.tankL;
          tank.state = 'fermenting';
          tank.curveS = 0;
          tank.startedS = timeS;
          log(timeS, 'info', `Fermentation tank ${filling + 1} full: fermenting at ${setpoints.fermentTempC} °C`, tag);
          filling = null;
        }
      }

      // 5. The tanks ferment; a ready one empties through the cooler into the buffer.
      for (const [i, tank] of tanks.entries()) {
        if (ferment(plant.ferment, tank, dtS, setpoints.fermentTempC, timeS)) {
          totals.tanksFermented += 1;
          log(timeS, 'ok', `Fermentation tank ${i + 1} at pH ${plant.ferment.endPh}: cooled, ready for P8`, tag);
        }
        if (tank.state === 'cleaning') {
          tank.cleanLeftS -= dtS;
          if (tank.cleanLeftS <= EPS) {
            tank.state = 'empty';
            tank.cleanLeftS = 0;
          }
        }
      }
      let baseL = 0;
      let fruitL = 0;
      const stirred = feeding && routeOf(shift.id) === 'stirred';
      fruitDosePct = stirred && products[shift.id].fruit ? plant.fruit.dosePct : 0;
      if (stirred) {
        if (emptying === null) {
          let oldest = -1;
          for (const [i, tank] of tanks.entries()) {
            if (tank.state === 'ready' && (oldest < 0 || (tank.readyS ?? 0) < (tanks[oldest].readyS ?? 0))) oldest = i;
          }
          if (oldest >= 0) {
            emptying = oldest;
            tanks[oldest].state = 'emptying';
          }
        }
        if (emptying !== null) {
          const tank = tanks[emptying];
          const dose = pctToFrac(fruitDosePct);
          const targetL = Math.min(plant.buffer.highFrac * plant.buffer.capacityL, runDownL);
          const needL = Math.max(0, targetL - buffer.levelL + drawLph * sToH(dtS));
          baseL = Math.max(0, Math.min(plant.cooling.flowLph * sToH(dtS), tank.levelL, needL * (1 - dose)));
          fruitL = (baseL * dose) / (1 - dose);
          tank.levelL -= baseL;
          totals.fromTanksL += baseL;
          totals.fruitL += fruitL;
          buffer.add(baseL + fruitL, timeS);
          if (tank.levelL <= EPS) {
            tank.levelL = 0;
            tank.state = 'cleaning';
            tank.cleanLeftS = plant.ferment.tankCleanS;
            tank.product = null;
            tank.startedS = null;
            tank.readyS = null;
            tank.curveS = 0;
            log(timeS, 'info', `Fermentation tank ${emptying + 1} empty: cleaning`, tag);
            emptying = null;
          }
        }
      }
      fromTankLph = baseL / sToH(dtS);
      bufferInLph = (baseL + fruitL + setL) / sToH(dtS);

      // 6. P8 fills its cycles from the buffer; set mix that has waited too long goes to rework.
      const drawnL = p8.step({
        dtS,
        timeS,
        rateCupsPerH: setpoints.p8RateCupsPerH,
        buffer,
        product: bufferProduct,
        shiftProduct: shift.id,
        mayRun: !changeover && !changedOver && bufferProduct !== null,
        log,
      });
      totals.toP8L += drawnL;
      p8Lph = drawnL / sToH(dtS);
      if (bufferProduct && routeOf(bufferProduct) === 'set') {
        const lateL = buffer.discardOlderThan(plant.buffer.setMaxWaitS, timeS);
        if (lateL > EPS) {
          totals.reworkL += lateL;
          log(timeS, 'warn', `Set mix waited past ${Math.round(plant.buffer.setMaxWaitS / 60)} min in the P8 buffer: ${Math.round(lateL)} L to rework`, tag);
        }
      }
      // The buffer ran out of the last shift's product in this step, short of a cycle: the changeover starts at once.
      if (!changeover && bufferProduct !== shift.id && buffer.levelL < p8.cycleNeedL) startChangeover(shift.id, timeS, log);
      readyToRun = changedOver;
    },
    setNextProduct: (product, timeS, log) => plan.setNext(product, timeS, log),
    view(setpoints, timeS) {
      const shift = plan.at(timeS);
      const out = cell.outlet();
      const heldS = timeS - out.enteredS;
      const flowing = heatLph > EPS;
      const cleaning: CleaningSnapshot | null = mode === 'cleaning' ? wingCip.snapshotAt(cleaningIntoS) : null;
      const bufferTempC = bufferProduct && routeOf(bufferProduct) === 'set' ? setpoints.fermentTempC : plant.cooling.outletC;
      const waitS = bufferProduct && routeOf(bufferProduct) === 'set' ? (buffer.oldestWaitS(timeS) ?? null) : null;
      const own = p8.view(timeS, setpoints.p8RateCupsPerH);
      const p8State = changeover ? (changeover.kind === 'sip' ? 'sterilizing' : 'cleaning') : readyToRun ? 'idle' : own.state;
      const running = p8State === 'running';
      const p8Totals = p8.totals();
      const { rejects } = p8Totals;
      const cups = p8Totals.cupsMade;
      const yogurt: YogurtSnapshot = {
        product: { ...shift },
        mix: {
          flowLph: mixLph,
          fatPct: plant.mix.fatPct,
          snfPct: plant.mix.snfPct,
          powderKgPerT: recipe.powderPerMix * 1_000,
          tanks: { silo: { levelL: siloL, capacityL: plant.silo.capacityL }, mixTank: { levelL: mixTankL, capacityL: plant.mix.tankL } },
        },
        heat: {
          mode,
          flowLph: heatLph,
          outletC: mode === 'cleaning' ? outletC : flowing ? out.tempC : outletC,
          holdS: flowing ? heldS : 0,
          denatPct: flowing ? betaLgDenaturedPct(out.tempC, heldS, plant.heat.betaLgGPerL) : 0,
          divertCount,
          reprocessTank: { levelL: reprocessL, capacityL: plant.heat.reprocessTankL },
          modeRemainingS: mode === 'divert' || mode === 'cleaning' ? Math.max(0, modeLeftS) : 0,
          cleaning,
        },
        ferment: { tempC: setpoints.fermentTempC, tanks: tanks.map((tank) => tankView(plant.ferment, tank, setpoints.fermentTempC, timeS)) },
        buffer: {
          levelL: buffer.levelL,
          capacityL: plant.buffer.capacityL,
          inflowLph: bufferInLph,
          outflowLph: p8Lph,
          tempC: bufferTempC,
          waitS: buffer.levelL > EPS ? waitS : null,
          coolerOutletC: buffer.levelL > EPS && bufferProduct && routeOf(bufferProduct) === 'stirred' ? plant.cooling.outletC : null,
          fruitDosePct: fromTankLph > EPS ? fruitDosePct : 0,
          product: bufferProduct,
          changeover: changeover ? { kind: changeover.kind, remainingS: Math.max(0, changeover.leftS) } : null,
        },
        p8: {
          ...own,
          state: p8State,
          cupsPerH: running ? setpoints.p8RateCupsPerH : 0,
          cupsMade: cups,
          cupsRejected: rejects.underFill + rejects.overFill + rejects.metal + rejects.vision + rejects.sealHold,
          stopReason: p8State === 'stopped' ? own.stopReason : null,
          cyclesPerMin: running ? own.cyclesPerMin : 0,
          nextSealTestS: running ? own.nextSealTestS : null,
          rejects: { ...rejects },
          sealTests: { passed: p8Totals.sealTestsPassed, failed: p8Totals.sealTestsFailed, cupsTaken: p8Totals.sealTestCups },
        },
        coldChain: {
          warmRoom: { tempC: plant.coldChain.warmRoomC, pallets: 0 },
          chiller: { pallets: 0 },
          coldRoom: { tempC: plant.coldChain.roomC, positionsUsed: 0 },
          palletsShipped: 0,
          reefersShipped: 0,
        },
        kpis: {
          mixLph: heatLph,
          divertedL: totals.divertedL,
          cupsPerH: running ? setpoints.p8RateCupsPerH : 0,
          cupsMade: cups,
          coldRoomPallets: 0,
          reefersShipped: 0,
        },
        energy: {
          steamKgPerH,
          gasKw: boilerGasKw(config, steamKgPerH),
          steamKg: totals.steamKg,
          gasKwh: boilerGasKwh(config, totals.steamKg),
        },
      };
      return yogurtView(config, setpoints, yogurt);
    },
    totals: () => ({ ...totals }),
    p8,
    inventory: () => ({
      siloL,
      tankerLeftL,
      mixTankL,
      tanksL: tanks.reduce((sum, tank) => sum + tank.levelL, 0),
      bufferL: buffer.levelL,
      reprocessL,
    }),
  };
}
