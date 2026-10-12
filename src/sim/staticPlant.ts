// The plant at rest at its set points: every stage value follows from plant.json
// and the live set points through the plan 06 formulas. Phase 2 shows this; the
// stage models of phases 3 and 4 replace it stage by stage.
import { fracToPct, STAGE_IDS, type Kpis, type PlantConfig, type StageId, type StageSnapshot, type Status } from '../contracts';
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

export function toStages(values: StageValues, statusOf: (id: StageId) => Status = () => 'ok'): Record<StageId, StageSnapshot> {
  const stages = {} as Record<StageId, StageSnapshot>;
  for (const id of STAGE_IDS) stages[id] = { id, status: statusOf(id), values: values[id] };
  return stages;
}
