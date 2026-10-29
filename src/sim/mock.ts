// A lively stand-in for the model, so the 3D view and the UI can build every state
// before phases 3 and 4 produce it (agent plan, "Contracts"). Same clock, queue and
// commands as createSim and the same value keys, but the values drift with sim time
// and stages now and then turn amber or red. Now and then the UHT plant also runs a
// divert (divert, CIP, sterilize, back to production) or an intermediate clean, so
// every liquid-line mode shows. Everything is seeded and depends only on sim time and
// the commands, so two runs with the same input match.
import {
  dayToS,
  fracToPct,
  hToS,
  kjToKwh,
  kwSToKwh,
  lToT,
  minToS,
  pctToFrac,
  SCENARIO_IDS,
  sToH,
  STAGE_IDS,
  type EnergySnapshot,
  type Kpis,
  type LinePoint,
  type LinePointId,
  type LiquidSnapshot,
  type PacksSnapshot,
  type PlantConfig,
  type ScenariosSnapshot,
  type Sim,
  type StageId,
  type Status,
  type SteamUse,
  type UhtMode,
} from '../contracts';
import { createCore } from './core';
import { bStar, divertLimitC, f0Min, holdTimeS, homogenizerOutletC, tubeVolumeL } from './formulas';
import {
  boilerGasKw,
  condenserKw,
  creamingRiskPct,
  globuleUm,
  headspaceBar,
  heatRecoveredKw,
  homogenizerPowerKw,
  regenerationPct,
  separatorFlows,
  steamHeatKw,
  steamLph,
} from './liquid/stageModels';
import { mockPacks } from './mockPacks';
import { createRng, mulberry32 } from './rng';
import { fillerDrawLph, linePoints, staticLiquid, staticPlant, toStages, type StageValues } from './staticPlant';

/** A stage keeps its random status this long before it may change. */
const STATUS_WINDOW_S = minToS(15);
/** Share of status windows that turn amber or red. */
const WARN_FRAC = 0.08;
const BAD_FRAC = 0.03;
/** An amber UHT stage's lowest noisy reading stays at least this far above the divert limit. */
const WARN_ABOVE_LIMIT_C = 0.05;
/** Each window of this length may hold one episode: a divert with its cleaning, or an intermediate clean. */
const EPISODE_WINDOW_S = hToS(6);
/** Share of windows with a divert episode, and with an intermediate clean. */
const DIVERT_EPISODE_FRAC = 0.15;
const AIC_EPISODE_FRAC = 0.25;

const EPISODE_LOG: Record<UhtMode, [kind: 'ok' | 'info' | 'warn' | 'bad', message: string]> = {
  production: ['ok', 'Mock: UHT plant back in production'],
  divert: ['bad', 'Mock: UHT plant diverting to the reject tank'],
  cip: ['warn', 'Mock: UHT plant in full CIP'],
  sterilize: ['info', 'Mock: UHT plant sterilizing'],
  aic: ['info', 'Mock: UHT plant in an intermediate clean'],
};

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

/** What each step needs: the status windows, the episode and the flow. */
interface MockPulse {
  /** The random status windows, which the log follows. */
  statuses: Record<StageId, Status>;
  episode: UhtMode;
  episodeRemainingS: number;
  diverting: boolean;
  flowLph: number;
}

interface MockState extends MockPulse {
  values: StageValues;
  kpis: Kpis;
  packs: PacksSnapshot;
  /** What the lamps show: the statuses with the episode's mode laid over stages 2–5. */
  shown: Record<StageId, Status>;
  line: Record<LinePointId, LinePoint>;
  liquid: LiquidSnapshot;
}

/** The mock plays no fault scenarios: the menu shows each one, unavailable, and why. A fresh object each snapshot. */
const mockScenarios = (): ScenariosSnapshot => ({
  runs: [],
  unavailable: Object.fromEntries(SCENARIO_IDS.map((id) => [id, 'The mock snapshot plays no fault scenarios'])),
});

export function createMockSim(config: PlantConfig): Sim {
  const { asepticTank: tank, uht, fillers } = config;
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
  let rejectL = 0;
  let divertCount = 0;
  // The steam and energy since opening (phase 8), summed step by step.
  let steamKg = 0;
  let electricKwh = 0;
  let rawDrawnL = 0;

  /**
   * The steam, electricity and raw milk at an episode and a UHT flow (phase 8), from the live line's models at the
   * set temperatures: milk from the homogenizer outlet while it flows, the cleaning or re-sterilizing circulation
   * from the deaerator outlet while it does not.
   */
  function energyRates(episode: UhtMode, flowLph: number): { use: SteamUse | null; steamKgPerH: number; electricKw: number; rawLph: number } {
    const { preheating, homogenizer, cleaning } = config;
    const deaeratorC = preheating.preheatTempC - preheating.deaeratorDropC;
    const totalBar = core.setpoints.homogenizerStage1Bar + homogenizer.stage2Bar;
    const setpointC = core.setpoints.uhtSetpointC;
    let use: SteamUse | null = null;
    let steamKgPerH = 0;
    if (flowLph > 0) {
      use = 'milk';
      const toC = episode === 'divert' ? uht.faultTempC : setpointC;
      steamKgPerH = steamLph(config, flowLph, homogenizerOutletC(deaeratorC, totalBar, homogenizer.barPerDegreeC), toC);
    } else if (episode === 'cip' || episode === 'sterilize' || episode === 'aic') {
      use = episode === 'sterilize' ? 'sterilizing' : 'cleaning';
      const toC = { cip: cleaning.cipTempC, sterilize: uht.sterilizeTempC, aic: setpointC }[episode];
      steamKgPerH = steamLph(config, cleaning.circulateLph, deaeratorC, toC);
    }
    return {
      use: steamKgPerH > 0 ? use : null,
      steamKgPerH,
      electricKw: homogenizerPowerKw(config, flowLph, flowLph > 0 ? totalBar : 0),
      rawLph: separatorFlows(config, flowLph).rawMilkLph,
    };
  }

  /** The episode mode at timeS: a stateless hash of (seed, window), like the status windows. */
  function episodeAt(timeS: number): { mode: UhtMode; remainingS: number } {
    const windowIndex = Math.floor(timeS / EPISODE_WINDOW_S);
    const draw = mulberry32(config.seed ^ Math.imul(windowIndex + 1, 0x27d4eb2d) ^ 0x5bd1e995);
    const kind = draw();
    const steps: [UhtMode, number][] =
      kind < DIVERT_EPISODE_FRAC
        ? [
            ['divert', uht.divertBeforeCleaningS],
            ['cip', config.cleaning.cipS],
            ['sterilize', uht.sterilizeS],
          ]
        : kind < DIVERT_EPISODE_FRAC + AIC_EPISODE_FRAC
          ? [['aic', config.cleaning.aicS]]
          : [];
    const lengthS = steps.reduce((sum, [, durationS]) => sum + durationS, 0);
    let intoS = timeS - (windowIndex * EPISODE_WINDOW_S + draw() * Math.max(0, EPISODE_WINDOW_S - lengthS));
    for (const [mode, durationS] of steps) {
      if (intoS >= 0 && intoS < durationS) return { mode, remainingS: durationS - intoS };
      intoS -= durationS;
    }
    return { mode: 'production', remainingS: 0 };
  }

  function stateAt(timeS: number): MockState;
  function stateAt(timeS: number, full: false): MockPulse;
  function stateAt(timeS: number, full = true): MockState | MockPulse {
    const statuses = Object.fromEntries(STAGE_IDS.map((id) => [id, randomStatus(id, timeS)])) as Record<StageId, Status>;

    // 6: the tank level swings over six hours; above the throttle level the UHT plant runs at reduced flow.
    const levelFrac = 0.5 + 0.48 * wave(timeS, hToS(6), 6);
    const tankHigh = levelFrac > tank.throttleAboveFrac;
    if (tankHigh || levelFrac < 1 - tank.throttleAboveFrac) statuses[6] = worst(statuses[6], 'warn');

    // 4: hold, F0, B* and divert limit follow the live flow (R6). Noise stays inside displayNoiseC (R4).
    // An episode overrides the random status: a divert episode runs at the fault temperature, so B* falls
    // below 1, and a clean stops the UHT flow. A set point under the limit diverts too.
    const episode = episodeAt(timeS);
    // Only a divert episode diverts, and it always cleans afterwards as the live model does; a random red
    // stage 4 would divert and go straight back to production, so the random status stops at amber.
    if (statuses[4] === 'bad') statuses[4] = 'warn';
    const cleaningNow = episode.mode === 'cip' || episode.mode === 'sterilize' || episode.mode === 'aic';
    const nominalLph = uht.capacityLph * (tankHigh ? tank.throttledFlowFrac : 1);
    const flowLph = cleaningNow ? 0 : nominalLph;
    const limitC = divertLimitC(holdTimeS(tubeL, nominalLph));
    const holdS = flowLph > 0 ? holdTimeS(tubeL, flowLph) : 0;
    const setpointC = core.setpoints.uhtSetpointC;
    // Amber runs low but keeps its lowest noisy reading above the divert limit (139.5 ± 0.3 °C would dip
    // under 139.22 °C at full flow and flicker red), and never above the set point, so a set point under
    // the limit still diverts.
    const warnTempC = Math.min(setpointC, Math.max(setpointC - 0.5, limitC + uht.displayNoiseC + WARN_ABOVE_LIMIT_C));
    const randomTempC = { idle: setpointC, ok: setpointC, warn: warnTempC, bad: uht.faultTempC }[statuses[4]];
    const noiseC = uht.displayNoiseC * wave(timeS, 37, 7);
    const tempC = {
      production: randomTempC + noiseC,
      divert: uht.faultTempC + noiseC,
      cip: config.cleaning.cipTempC,
      sterilize: uht.sterilizeTempC,
      aic: setpointC + noiseC,
    }[episode.mode];
    const bStarNow = flowLph > 0 ? bStar(tempC, holdS) : 0;
    if (episode.mode === 'production' && bStarNow < 1) statuses[4] = 'bad';
    const diverting = episode.mode === 'divert' || (episode.mode === 'production' && statuses[4] === 'bad');
    const pulse: MockPulse = { statuses, episode: episode.mode, episodeRemainingS: episode.remainingS, diverting, flowLph };
    if (!full) return pulse;
    // Only the snapshot needs the stage values; a step needs no more than the pulse above.
    const { values } = staticPlant(config, core.setpoints);

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
    // A stopped homogenizer (in a clean) builds no pressure.
    if (flowLph <= 0) values[3].stage1Bar = values[3].stage2Bar = 0;
    values[3].inletTempC = values[2].deaeratorTempC;
    values[3].outletTempC = homogenizerOutletC(
      values[3].inletTempC,
      values[3].stage1Bar + values[3].stage2Bar,
      config.homogenizer.barPerDegreeC,
    );

    values[6].levelL = tank.capacityL * levelFrac;
    values[6].levelPct = fracToPct(levelFrac);
    const productLph = diverting ? 0 : flowLph;
    values[4] = {
      setpointC,
      tempC,
      flowLph,
      holdS,
      f0Min: flowLph > 0 ? f0Min(tempC, holdS) : 0,
      bStar: bStarNow,
      divertLimitC: limitC,
      rejectLevelL: rejectL,
    };

    // 1–3, 5 and 6: the phase 3 values, from the same stage models as the live line.
    const { rawMilkLph, surplusCreamLph } = separatorFlows(config, flowLph);
    Object.assign(values[1], {
      rawMilkLph,
      surplusCreamLph,
      siloLevelPct: fracToPct(0.55 + 0.3 * wave(timeS, hToS(9), 3)),
      mixTankLevelPct: fracToPct(config.standardization.mixTankStartFrac) + 4 * wave(timeS, minToS(41), 4),
    });
    const { deaeratedAirPct, rawAirPct } = config.preheating;
    values[2].airPct = flowLph > 0 ? deaeratedAirPct * (1 + 0.2 * wave(timeS, minToS(17), 5)) : rawAirPct;
    values[2].heatRecoveredKw = heatRecoveredKw(config, flowLph, values[2].preheatTempC);
    const totalBar = values[3].stage1Bar + values[3].stage2Bar;
    values[3].globuleUm = globuleUm(config, values[3].stage1Bar);
    values[3].creamingRiskPct = creamingRiskPct(config, values[3].globuleUm);
    values[3].powerKw = homogenizerPowerKw(config, flowLph, totalBar);
    const waterRemovedLph = steamLph(config, productLph, values[3].outletTempC, setpointC);
    values[5].waterRemovedLph = waterRemovedLph;
    values[5].condenserKw = condenserKw(config, waterRemovedLph);
    const productionSinceCleanS = (timeS - config.clock.startTimeS) % config.cleaning.aicEveryProductionS;

    // 2 and 4: the steam and energy (phase 8, contracts v6).
    const rates = energyRates(episode.mode, flowLph);
    const gasKwh = kjToKwh((steamKg * config.energy.boilerHeatKjPerKg) / config.energy.boilerEfficiencyFrac);
    const energy: EnergySnapshot = {
      steamKgPerH: rates.steamKgPerH,
      steamUse: rates.use,
      gasKw: boilerGasKw(config, rates.steamKgPerH),
      electricKw: rates.electricKw,
      regenerationPct: flowLph > 0 ? regenerationPct(values[2].heatRecoveredKw, steamHeatKw(config, rates.steamKgPerH)) : null,
      steamKg,
      gasKwh,
      electricKwh,
      kwhPerT: rawDrawnL > 0 ? (gasKwh + electricKwh) / lToT(rawDrawnL) : null,
    };
    values[2].regenerationPct = energy.regenerationPct ?? 0;
    values[4].steamKgPerH = energy.steamKgPerH;
    values[4].gasKw = energy.gasKw;

    // What the panels and lamps show: an episode's mode on stage 4, nothing flowing in a clean.
    const shown = { ...statuses };
    if (episode.mode === 'divert') shown[4] = 'bad';
    if (cleaningNow) shown[4] = 'warn';
    if (flowLph <= 0) shown[2] = shown[3] = 'idle';
    if (productLph <= 0) shown[5] = 'idle';

    values[5].flashTempC += 0.5 * wave(timeS, minToS(13), 8);
    values[5].coolerTempC += 0.4 * wave(timeS, minToS(31), 9);

    // 7: a red filler stage means one filler is down.
    values[7].ratePacksPerH *= 0.985 + 0.015 * wave(timeS, minToS(7), 10);
    const runningFillers = fillers.count - (statuses[7] === 'bad' ? 1 : 0);
    const fillerLph = fillerDrawLph(config, runningFillers, values[7].ratePacksPerH);
    Object.assign(values[6], {
      inflowLph: productLph,
      outflowLph: fillerLph,
      headspaceBar: headspaceBar(config, levelFrac),
      nextCleanS: config.cleaning.aicEveryProductionS - productionSinceCleanS,
    });

    // 10: the warehouse warms and cools with the day.
    values[10].tempC += 1.5 * wave(timeS, dayToS(1), 11);

    // 7–10: the packs model's picture (mockPacks.ts) from the stage 7 status window and a few slow waves.
    // The availability, stock swing and fill rate are mock numbers, not plant.json.
    const statusLeftS = STATUS_WINDOW_S - ((timeS + windowOffsetS[7]) % STATUS_WINDOW_S);
    const discrete = mockPacks(config, {
      timeS,
      openS: config.clock.startTimeS,
      fillerStatus: statuses[7],
      statusRemainingS: statusLeftS,
      ratePacksPerH: values[7].ratePacksPerH,
      availabilityFrac: 0.5,
      palletsInStock: Math.round(300 + 150 * wave(timeS, dayToS(2), 0)),
      orderFillPct: Math.min(100, 97 + 4 * wave(timeS, dayToS(3), 2)),
      dockWave: wave(timeS, dayToS(2), 0),
    });
    for (const id of [7, 8, 9, 10] as const) values[id] = { ...discrete.values[id], ...(id === 10 ? { tempC: values[10].tempC } : {}) };

    const kpis: Kpis = {
      uhtFlowLph: flowLph,
      f0Min: values[4].f0Min,
      bStar: values[4].bStar,
      divertedL,
      tankLevelPct: values[6].levelPct,
      packsPerH: runningFillers * values[7].ratePacksPerH,
      ...discrete.kpis,
    };
    // A red stage 4 is diverting: the whole UHT flow goes to the reject tank, none on to the flash vessel.
    const line = linePoints(values, {
      rawLph: rawMilkLph,
      standardizedLph: flowLph,
      uhtLph: flowLph,
      divertLph: diverting ? flowLph : 0,
      fillerLph,
    });
    // Contracts v2: a red stage 4 diverts, the high tank throttles, a red filler stage has one filler down,
    // and an episode sets the mode.
    const liquid = staticLiquid(config);
    liquid.uhtMode = diverting ? 'divert' : episode.mode;
    liquid.modeRemainingS = episode.remainingS;
    liquid.throttled = tankHigh;
    liquid.fillersRunning = runningFillers;
    liquid.headspaceBar = values[6].headspaceBar;
    liquid.divertCount = divertCount;
    liquid.tanks.asepticTank.levelL = values[6].levelL;
    liquid.tanks.rejectTank.levelL = rejectL;
    liquid.tanks.silo.levelL = config.standardization.siloCapacityL * pctToFrac(values[1].siloLevelPct);
    liquid.tanks.mixTank.levelL = config.standardization.mixTankCapacityL * pctToFrac(values[1].mixTankLevelPct);
    liquid.productionSinceCleanS = productionSinceCleanS;
    liquid.energy = energy;
    for (const id of [8, 9, 10] as const) shown[id] = worst(shown[id] === 'idle' ? 'ok' : shown[id], discrete.statuses[id]);
    return { ...pulse, values, kpis, shown, line, liquid, packs: discrete.packs };
  }

  let lastStatuses: Record<StageId, Status> | undefined;
  let lastEpisode: UhtMode = 'production';
  let lastDiverting = false;

  const core = createCore(config, {
    onStep(dtS, timeS) {
      const { statuses, episode, episodeRemainingS, diverting, flowLph } = stateAt(timeS, false);
      if (diverting) {
        divertedL += sToH(dtS) * flowLph;
        rejectL = Math.min(uht.rejectTankL, rejectL + sToH(dtS) * flowLph);
        if (!lastDiverting) divertCount += 1;
      }
      // A full CIP pumps the reject tank out by its end, as in the live line.
      if (episode === 'cip') rejectL -= (rejectL * dtS) / (episodeRemainingS + dtS);
      const rates = energyRates(episode, flowLph);
      steamKg += rates.steamKgPerH * sToH(dtS);
      electricKwh += kwSToKwh(rates.electricKw, dtS);
      rawDrawnL += rates.rawLph * sToH(dtS);
      lastDiverting = diverting;
      if (episode !== lastEpisode) core.log(timeS, ...EPISODE_LOG[episode]);
      lastEpisode = episode;
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
  const opening = stateAt(core.timeS, false);
  lastStatuses = opening.statuses;
  lastEpisode = opening.episode;

  return {
    step: (realDtS) => core.step(realDtS),
    dispatch: (command) => core.dispatch(command),
    snapshot() {
      const { values, kpis, shown, line, liquid, packs } = stateAt(core.timeS);
      return core.snapshot(toStages(values, (id) => shown[id]), kpis, line, liquid, packs, mockScenarios());
    },
  };
}
