// A lively stand-in for the model, so the 3D view and the UI can build every state
// before phases 3 and 4 produce it (agent plan, "Contracts"). Same clock, queue and
// commands as createSim and the same value keys, but the values drift with sim time
// and stages now and then turn amber or red. Everything is seeded and depends only
// on sim time and the commands, so two runs with the same input match.
import {
  dayToS,
  fracToPct,
  hToS,
  minToS,
  sToDay,
  sToH,
  STAGE_IDS,
  type Kpis,
  type PlantConfig,
  type Sim,
  type StageId,
  type Status,
} from '../contracts';
import { createCore } from './core';
import { bStar, divertLimitC, f0Min, holdTimeS, homogenizerOutletC, oeeFrac, tubeVolumeL } from './formulas';
import { createRng, mulberry32 } from './rng';
import { staticPlant, toStages, type StageValues } from './staticPlant';

/** A stage keeps its random status this long before it may change. */
const STATUS_WINDOW_S = minToS(15);
/** Share of status windows that turn amber or red. */
const WARN_FRAC = 0.08;
const BAD_FRAC = 0.03;
/** An amber UHT stage's lowest noisy reading stays at least this far above the divert limit. */
const WARN_ABOVE_LIMIT_C = 0.05;

const STAGE_NAMES: Record<StageId, string> = {
  1: 'Standardization',
  2: 'Preheater and deaerator',
  3: 'Homogenizer',
  4: 'UHT holding tube',
  5: 'Flash cooling',
  6: 'Aseptic tank',
  7: 'Fillers',
  8: 'Packaging',
  9: 'Quality control',
  10: 'Warehouse',
};

const STATUS_RANK: Record<Status, number> = { idle: 0, ok: 1, warn: 2, bad: 3 };
const worst = (a: Status, b: Status): Status => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

interface MockState {
  values: StageValues;
  kpis: Kpis;
  statuses: Record<StageId, Status>;
}

export function createMockSim(config: PlantConfig): Sim {
  const { asepticTank: tank, uht, fillers, packaging, quality, warehouse } = config;
  const rng = createRng(config.seed);
  // Seeded phases, so each wave starts somewhere different but repeatably.
  const phases = Array.from({ length: 12 }, () => rng.next() * 2 * Math.PI);
  const wave = (timeS: number, periodS: number, index: number): number => Math.sin((2 * Math.PI * timeS) / periodS + phases[index]);
  // Stagger the status windows so the stages don't all change at once.
  const windowOffsetS = Object.fromEntries(STAGE_IDS.map((id) => [id, rng.next() * STATUS_WINDOW_S])) as Record<StageId, number>;
  const tubeL = tubeVolumeL(uht.holdAtCapacityS, uht.capacityLph);

  // A stateless hash of (seed, stage, window): the first draw of a freshly seeded mulberry32.
  function randomStatus(id: StageId, timeS: number): Status {
    const windowIndex = Math.floor((timeS + windowOffsetS[id]) / STATUS_WINDOW_S);
    const draw = mulberry32(config.seed ^ Math.imul(id, 0x9e3779b1) ^ Math.imul(windowIndex, 0x85ebca6b))();
    if (draw < BAD_FRAC) return 'bad';
    if (draw < BAD_FRAC + WARN_FRAC) return 'warn';
    return 'ok';
  }

  let divertedL = 0;

  function stateAt(timeS: number): MockState {
    const { values } = staticPlant(config, core.setpoints);
    const statuses = Object.fromEntries(STAGE_IDS.map((id) => [id, randomStatus(id, timeS)])) as Record<StageId, Status>;

    // 1–2: small drifts around the set temperatures; raw-milk fat differs a little from silo to silo.
    values[1].siloTempC += 0.4 * wave(timeS, hToS(5), 0);
    values[1].separatorTempC += 0.6 * wave(timeS, minToS(47), 1);
    values[1].feedTankTempC += 0.3 * wave(timeS, hToS(3), 2);
    values[1].rawMilkFatPct += 0.15 * wave(timeS, hToS(8), 3);
    values[2].preheatTempC += 0.4 * wave(timeS, minToS(23), 4);
    values[2].deaeratorTempC = values[2].preheatTempC - config.preheating.deaeratorDropC;

    // 3: an amber or red homogenizer has lost pressure, and the outlet runs cooler with it.
    const pressureFrac = { idle: 1, ok: 1, warn: 0.85, bad: 0.5 }[statuses[3]];
    values[3].stage1Bar = (values[3].stage1Bar + 3 * wave(timeS, minToS(11), 5)) * pressureFrac;
    values[3].inletTempC = values[2].deaeratorTempC;
    values[3].outletTempC = homogenizerOutletC(
      values[3].inletTempC,
      values[3].stage1Bar + values[3].stage2Bar,
      config.homogenizer.barPerDegreeC,
    );

    // 6: the tank level swings over six hours; above the throttle level the UHT plant runs at reduced flow.
    const levelFrac = 0.5 + 0.48 * wave(timeS, hToS(6), 6);
    values[6].levelL = tank.capacityL * levelFrac;
    values[6].levelPct = fracToPct(levelFrac);
    const tankHigh = levelFrac > tank.throttleAboveFrac;
    if (tankHigh || levelFrac < 1 - tank.throttleAboveFrac) statuses[6] = worst(statuses[6], 'warn');

    // 4: hold, F0, B* and divert limit follow the live flow (R6). Noise stays inside displayNoiseC (R4);
    // a red stage 4 is the temperature-drop fault, so B* falls below 1.
    const flowLph = uht.capacityLph * (tankHigh ? tank.throttledFlowFrac : 1);
    const holdS = holdTimeS(tubeL, flowLph);
    const setpointC = core.setpoints.uhtSetpointC;
    // Amber runs low but keeps its lowest noisy reading above the divert limit (139.5 ± 0.3 °C would dip
    // under 139.22 °C at full flow and flicker red); red falls to the fault temperature.
    const warnTempC = Math.max(setpointC - 0.5, divertLimitC(holdS) + uht.displayNoiseC + WARN_ABOVE_LIMIT_C);
    const baseTempC = { idle: setpointC, ok: setpointC, warn: warnTempC, bad: uht.faultTempC }[statuses[4]];
    const tempC = baseTempC + uht.displayNoiseC * wave(timeS, 37, 7);
    const bStarNow = bStar(tempC, holdS);
    if (bStarNow < 1) statuses[4] = 'bad';
    values[4] = { setpointC, flowLph, holdS, f0Min: f0Min(tempC, holdS), bStar: bStarNow, divertLimitC: divertLimitC(holdS) };

    values[5].flashTempC += 0.5 * wave(timeS, minToS(13), 8);
    values[5].coolerTempC += 0.4 * wave(timeS, minToS(31), 9);

    // 7: a red filler stage means one filler is down.
    values[7].ratePacksPerH *= 0.985 + 0.015 * wave(timeS, minToS(7), 10);
    const runningFillers = fillers.count - (statuses[7] === 'bad' ? 1 : 0);

    // 10: the warehouse warms and cools with the day.
    values[10].tempC += 1.5 * wave(timeS, dayToS(1), 11);

    // Counters grow with time since the start; batch counts follow the 06:00 / 14:00 / 22:00 shift grid.
    // The 0.95 uptime, 60 batches per blocked one, stock swing and fill rate are mock numbers, not plant.json.
    const elapsedS = timeS - config.clock.startTimeS;
    const packsMade = Math.floor(sToH(elapsedS) * fillers.count * core.setpoints.fillerRatePacksPerH * 0.95);
    const traysMade = Math.floor(packsMade / packaging.packsPerTray);
    const shiftIndex = (t: number) => Math.floor((t - quality.firstShiftStartS) / quality.batchS);
    const closedBatches = fillers.count * (shiftIndex(timeS) - shiftIndex(config.clock.startTimeS));
    const batchesPerHold = fillers.count * Math.ceil(dayToS(quality.incubationDays) / quality.batchS);
    const pastHold = Math.max(0, closedBatches - batchesPerHold);
    const batchesBlocked = Math.floor(pastHold / 60);
    const palletsInStock = Math.round(300 + 150 * wave(timeS, dayToS(2), 0));
    const palletsPerDay = warehouse.palletsPerTruck / sToDay(warehouse.truckEveryS);
    const availabilityFrac = statuses[7] === 'bad' ? 0.5 : 0.93 + 0.03 * wave(timeS, hToS(4), 1);

    const kpis: Kpis = {
      uhtFlowLph: flowLph,
      f0Min: values[4].f0Min,
      bStar: values[4].bStar,
      divertedL,
      tankLevelPct: values[6].levelPct,
      packsPerH: runningFillers * values[7].ratePacksPerH,
      oeePct: fracToPct(oeeFrac(availabilityFrac, values[7].ratePacksPerH / fillers.maxRatePacksPerH, 0.998)),
      traysMade,
      palletsMade: Math.floor(traysMade / packaging.traysPerPallet),
      batchesOnHold: Math.min(closedBatches, batchesPerHold),
      batchesReleased: pastHold - batchesBlocked,
      batchesBlocked,
      palletsInStock,
      daysOfCover: palletsInStock / palletsPerDay,
      orderFillPct: Math.min(100, 97 + 4 * wave(timeS, dayToS(3), 2)),
      trucksShipped: Math.floor(elapsedS / warehouse.truckEveryS),
    };
    return { values, kpis, statuses };
  }

  let lastStatuses: Record<StageId, Status> | undefined;

  const core = createCore(config, {
    onStep(dtS, timeS) {
      const { statuses, values } = stateAt(timeS);
      if (statuses[4] === 'bad') divertedL += sToH(dtS) * values[4].flowLph;
      for (const id of STAGE_IDS) {
        const status = statuses[id];
        if (!lastStatuses || status === lastStatuses[id]) continue;
        const name = STAGE_NAMES[id];
        if (status === 'bad') core.log(timeS, 'bad', `Mock: ${name} stopped`);
        else if (status === 'warn') core.log(timeS, 'warn', `Mock: ${name} needs attention`);
        else core.log(timeS, 'ok', `Mock: ${name} back to normal`);
      }
      lastStatuses = statuses;
    },
  });
  lastStatuses = stateAt(core.timeS).statuses;

  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const { values, kpis, statuses } = stateAt(core.timeS);
      return core.snapshot(toStages(values, (id) => statuses[id]), kpis);
    },
  };
}
