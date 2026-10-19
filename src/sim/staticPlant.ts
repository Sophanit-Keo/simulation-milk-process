// The plant at rest at its set points: every stage value follows from plant.json
// and the live set points through the plan 06 formulas. Phase 2 showed this; since
// phase 3 the live model (liquidLine.ts) replaces stages 1–6, and phase 4 replaces 7–10.
import {
  fracToPct,
  STAGE_IDS,
  type Kpis,
  type LinePoint,
  type LinePointId,
  type LiquidSnapshot,
  type PlantConfig,
  type StageId,
  type StageSnapshot,
  type Status,
} from '../contracts';
import type { Setpoints } from './core';
import { bStar, creamShareFrac, divertLimitC, f0Min, holdTimeS, homogenizerOutletC, tubeVolumeL } from './formulas';

export type StageValues = Record<StageId, Record<string, number>>;

export function emptyKpis(): Kpis {
  return {
    uhtFlowLph: 0,
    f0Min: 0,
    bStar: 0,
    divertedL: 0,
    tankLevelPct: 0,
    packsPerH: 0,
    oeePct: 0,
    traysMade: 0,
    palletsMade: 0,
    batchesOnHold: 0,
    batchesReleased: 0,
    batchesBlocked: 0,
    palletsInStock: 0,
    daysOfCover: 0,
    orderFillPct: 0,
    trucksShipped: 0,
  };
}

/** Fresh values and KPIs on every call. */
export function staticPlant(config: PlantConfig, setpoints: Readonly<Setpoints>): { values: StageValues; kpis: Kpis } {
  const { standardization: std, product, preheating, homogenizer, uht, flashCooling, asepticTank: tank } = config;
  const { fillers, packaging, quality, warehouse } = config;

  const deaeratorTempC = preheating.preheatTempC - preheating.deaeratorDropC;
  const stage1Bar = setpoints.homogenizerStage1Bar;
  // The tube is sized for the hold at full capacity; the hold then follows the live flow (R6).
  const flowLph = uht.capacityLph;
  const holdS = holdTimeS(tubeVolumeL(uht.holdAtCapacityS, uht.capacityLph), flowLph);
  const setpointC = setpoints.uhtSetpointC;
  const levelL = tank.capacityL * tank.startFrac;
  const ratePacksPerH = setpoints.fillerRatePacksPerH;

  const values: StageValues = {
    1: {
      siloTempC: std.siloTempC,
      separatorTempC: std.separatorTempC,
      feedTankTempC: std.feedTankTempC,
      rawMilkFatPct: std.rawMilkFatPct,
      productFatPct: product.fatPct,
      creamShareFrac: creamShareFrac(product.fatPct, std.skimFatPct, std.creamFatPct),
    },
    2: { preheatTempC: preheating.preheatTempC, deaeratorTempC },
    3: {
      stage1Bar,
      stage2Bar: homogenizer.stage2Bar,
      inletTempC: deaeratorTempC,
      outletTempC: homogenizerOutletC(deaeratorTempC, stage1Bar + homogenizer.stage2Bar, homogenizer.barPerDegreeC),
    },
    4: {
      setpointC,
      // Measured at the holding-tube outlet; the static plant sits exactly on its set point.
      tempC: setpointC,
      flowLph,
      holdS,
      f0Min: f0Min(setpointC, holdS),
      bStar: bStar(setpointC, holdS),
      divertLimitC: divertLimitC(holdS),
    },
    5: { flashTempC: flashCooling.flashTempC, coolerTempC: flashCooling.coolerTempC },
    6: { levelL, levelPct: fracToPct(tank.startFrac), capacityL: tank.capacityL, tempC: tank.tempC },
    7: { fillerCount: fillers.count, ratePacksPerH, tempC: fillers.tempC },
    8: {
      packsPerTray: packaging.packsPerTray,
      traysPerPallet: packaging.traysPerPallet,
      packsPerPallet: packaging.packsPerTray * packaging.traysPerPallet,
    },
    9: {
      incubationTempC: quality.incubationTempC,
      incubationDays: quality.incubationDays,
      samplesPerBatch: quality.batchS / quality.sampleEveryS,
    },
    10: { tempC: warehouse.tempC, palletsPerTruck: warehouse.palletsPerTruck },
  };

  const kpis: Kpis = {
    ...emptyKpis(),
    uhtFlowLph: flowLph,
    f0Min: values[4].f0Min,
    bStar: values[4].bStar,
    tankLevelPct: values[6].levelPct,
    packsPerH: fillers.count * ratePacksPerH,
  };
  return { values, kpis };
}

/**
 * Flows that set the line points: raw milk from the silo, standardized milk into the mixing tank, through
 * the UHT plant, to the reject tank, and drawn by the fillers. The surplus cream leaves at the separator.
 */
export interface LineFlows {
  rawLph: number;
  standardizedLph: number;
  uhtLph: number;
  divertLph: number;
  fillerLph: number;
}

/** The liquid line's measuring points (contracts v1), read off the stage values in flow order. */
export function linePoints(values: StageValues, flows: LineFlows): Record<LinePointId, LinePoint> {
  const point = (tempC: number, flowLph: number): LinePoint => ({ tempC, flowLph });
  const { rawLph, standardizedLph, uhtLph, divertLph, fillerLph } = flows;
  // What the divert valve doesn't send to the reject tank goes on to the flash vessel.
  const productLph = Math.max(0, uhtLph - divertLph);
  return {
    silo: point(values[1].siloTempC, rawLph),
    separator: point(values[1].separatorTempC, standardizedLph),
    feedTank: point(values[1].feedTankTempC, uhtLph),
    preheater: point(values[2].preheatTempC, uhtLph),
    deaerator: point(values[2].deaeratorTempC, uhtLph),
    homogenizer: point(values[3].outletTempC, uhtLph),
    holdingTube: point(values[4].tempC, uhtLph),
    divert: point(values[4].tempC, divertLph),
    flashVessel: point(values[5].flashTempC, productLph),
    cooler: point(values[5].coolerTempC, productLph),
    asepticTank: point(values[6].tempC, fillerLph),
    filler: point(values[7].tempC, fillerLph),
  };
}

/** The liquid line at rest (contracts v2): producing at full flow, tanks at their opening levels, both fillers drawing. */
export function staticLiquid(config: PlantConfig): LiquidSnapshot {
  const { standardization: std, uht, asepticTank: tank, fillers } = config;
  const tankLevel = (capacityL: number, frac: number) => ({ levelL: capacityL * frac, capacityL });
  return {
    uhtMode: 'production',
    modeRemainingS: 0,
    throttled: false,
    fillersRunning: fillers.count,
    fillersStarved: false,
    headspaceBar: tank.maxHeadspaceBar,
    productionSinceCleanS: 0,
    divertCount: 0,
    tanks: {
      silo: tankLevel(std.siloCapacityL, std.siloStartFrac),
      mixTank: tankLevel(std.mixTankCapacityL, std.mixTankStartFrac),
      asepticTank: tankLevel(tank.capacityL, tank.startFrac),
      rejectTank: tankLevel(uht.rejectTankL, 0),
    },
  };
}

/** Litres per hour the running fillers draw from the aseptic tank. */
export const fillerDrawLph = (config: PlantConfig, runningFillers: number, ratePacksPerH: number): number =>
  runningFillers * ratePacksPerH * config.product.packVolumeL;

export function toStages(values: StageValues, statusOf: (id: StageId) => Status = () => 'ok'): Record<StageId, StageSnapshot> {
  const stages = {} as Record<StageId, StageSnapshot>;
  for (const id of STAGE_IDS) stages[id] = { id, status: statusOf(id), values: values[id] };
  return stages;
}
