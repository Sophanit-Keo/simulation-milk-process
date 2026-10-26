// Stages 7–10 for the ?mock sim (contracts v3): a lively, stateless picture of the packs model, so the 3D
// view and the panels can show every state without running the model to it. Everything follows from sim
// time, the mock's stage 7 status and a seeded hash, so two runs with the same input match. The numbers
// (95% uptime, one blocked batch in 40, the stock swing) are mock numbers, not plant.json's.
import {
  dayToS,
  fracToPct,
  minToS,
  sToH,
  type BatchSnapshot,
  type FillerSnapshot,
  type Kpis,
  type PacksSnapshot,
  type PlantConfig,
  type StockSnapshot,
  type Status,
  type TruckSnapshot,
} from '../contracts';
import { FILLER_NAMES } from './packs/filler';
import type { PacksStageId } from './packsLine';
import { mulberry32 } from './rng';

/** Mock uptime of a running filler. */
const UPTIME_FRAC = 0.95;
/** One batch in this many is blocked in the mock's quarantine. */
const BLOCKED_ONE_IN = 40;
const QUALITY_FRAC = 0.998;

export interface MockPacks {
  packs: PacksSnapshot;
  values: Record<PacksStageId, Record<string, number>>;
  statuses: Record<PacksStageId, Status>;
  kpis: Pick<
    Kpis,
    'oeePct' | 'traysMade' | 'palletsMade' | 'batchesOnHold' | 'batchesReleased' | 'batchesBlocked' | 'palletsInStock' | 'daysOfCover' | 'orderFillPct' | 'trucksShipped'
  >;
}

export interface MockPacksInput {
  timeS: number;
  openS: number;
  /** The mock's stage 7 status: red has the last filler in repair (one filler down, as the mock's liquid line has it). */
  fillerStatus: Status;
  /** Seconds left in the mock's stage 7 status window. */
  statusRemainingS: number;
  ratePacksPerH: number;
  availabilityFrac: number;
  palletsInStock: number;
  orderFillPct: number;
  /** A stage-10 wave: below 0 a truck waits for stock. */
  dockWave: number;
}

export function mockPacks(config: PlantConfig, input: MockPacksInput): MockPacks {
  const { fillers: spec, packaging, quality: q, warehouse, product } = config;
  const { timeS, openS, ratePacksPerH } = input;
  const hash = (...parts: number[]): number => mulberry32(parts.reduce((seed, part) => Math.imul(seed ^ part, 0x9e3779b1), config.seed))();
  const packsPerPallet = packaging.packsPerTray * packaging.traysPerPallet;
  const openForS = Math.max(0, timeS - openS);
  const shiftIndex = (t: number): number => Math.floor((t - q.firstShiftStartS) / q.batchS);
  const shiftStartS = (k: number): number => q.firstShiftStartS + k * q.batchS;
  const nowShift = shiftIndex(timeS);
  const batchId = (k: number, filler: number): number => 2 * k + filler + 1;
  const intoShiftS = timeS - shiftStartS(nowShift);

  // 7: filler A always runs; a red stage 7 has the last filler in repair.
  const fillers: FillerSnapshot[] = Array.from({ length: spec.count }, (_, index) => {
    const down = index === spec.count - 1 && input.fillerStatus === 'bad';
    const state = down ? 'repair' : ratePacksPerH > 0 ? 'running' : 'stopped';
    const packsMade = Math.floor(sToH(openForS) * ratePacksPerH * UPTIME_FRAC);
    const availabilityFrac = down ? input.availabilityFrac : UPTIME_FRAC;
    const performanceFrac = ratePacksPerH / spec.maxRatePacksPerH;
    return {
      name: FILLER_NAMES[index] ?? String(index + 1),
      state,
      stateRemainingS: down ? input.statusRemainingS : 0,
      packsPerH: state === 'running' ? ratePacksPerH : 0,
      batchId: batchId(nowShift, index),
      packsMade,
      packsRejected: Math.floor(packsMade * spec.rejectFrac),
      breakdowns: Math.floor(openForS / spec.mtbfMeanS),
      availabilityPct: fracToPct(availabilityFrac),
      performancePct: fracToPct(performanceFrac),
      qualityPct: fracToPct(QUALITY_FRAC),
      oeePct: fracToPct(availabilityFrac * performanceFrac * QUALITY_FRAC),
    };
  });
  const running = fillers.filter((filler) => filler.state === 'running').length;
  const packsMade = fillers.reduce((sum, filler) => sum + filler.packsMade, 0);

  // 8: after each shift change the packer stands for its batch change, then catches up.
  const changeoverLeftS = Math.max(0, packaging.batchChangeS - intoShiftS);
  const catchUpS = minToS(6);
  const lanes = fillers.map((filler, index) => {
    const lanePacks = Math.floor(sToH(intoShiftS) * filler.packsPerH);
    const queuePacks =
      changeoverLeftS > 0
        ? Math.floor(sToH(intoShiftS) * filler.packsPerH)
        : Math.max(0, Math.floor(sToH(packaging.batchChangeS) * filler.packsPerH * (1 - (intoShiftS - packaging.batchChangeS) / catchUpS)));
    const packed = Math.max(0, lanePacks - queuePacks);
    return {
      name: filler.name,
      packerState: changeoverLeftS > 0 ? ('changeover' as const) : queuePacks > packaging.packsPerTray ? ('catchUp' as const) : filler.packsPerH > 0 ? ('running' as const) : ('idle' as const),
      changeoverRemainingS: changeoverLeftS,
      queuePacks,
      trayPacks: packed % packaging.packsPerTray,
      palletTrays: Math.floor(packed / packaging.packsPerTray) % packaging.traysPerPallet,
      batchId: batchId(nowShift, index),
    };
  });
  const traysMade = Math.floor(packsMade / packaging.packsPerTray);
  /** Line A's newest pallet: in the batch it fills now, or the last of the one before. */
  const lastPallet = () => {
    const closed = Math.floor(sToH(intoShiftS) * (fillers[0]?.packsPerH ?? 0) / packsPerPallet);
    return closed > 0
      ? { batchId: batchId(nowShift, 0), palletNo: closed, atS: timeS - minToS(2) }
      : { batchId: batchId(nowShift - 1, 0), palletNo: 60, atS: shiftStartS(nowShift) };
  };
  const palletsMade = Math.floor(traysMade / packaging.traysPerPallet);

  // 9: a week of batches on the shift grid, the newest filling; one in BLOCKED_ONE_IN is blocked.
  const incubationS = dayToS(q.incubationDays);
  const holdShifts = Math.ceil(incubationS / q.batchS);
  const batches: BatchSnapshot[] = [];
  for (let k = nowShift - holdShifts; k <= nowShift; k++) {
    for (let filler = 0; filler < spec.count; filler++) {
      const id = batchId(k, filler);
      const startS = shiftStartS(k);
      const endS = startS + q.batchS;
      const filling = k === nowShift;
      const blocked = !filling && hash(id, 1) < 1 / BLOCKED_ONE_IN;
      const pallets = filling ? Math.floor(sToH(intoShiftS) * ratePacksPerH / packsPerPallet) : 57 + Math.floor(hash(id, 2) * 4);
      const lastPalletPacks = filling ? packsPerPallet : 300 + Math.floor(hash(id, 3) * 700);
      if (!filling && endS + incubationS <= timeS && !blocked) continue;
      batches.push({
        id,
        filler: FILLER_NAMES[filler] ?? String(filler + 1),
        status: filling ? 'filling' : blocked ? 'blocked' : 'hold',
        startS,
        endS,
        releaseAtS: endS + incubationS,
        bestBeforeS: startS + dayToS(product.shelfLifeDays),
        pallets,
        packs: pallets > 0 ? (pallets - 1) * packsPerPallet + lastPalletPacks : 0,
        lastPalletPacks: pallets > 0 ? lastPalletPacks : 0,
        samples: Math.round(q.batchS / q.sampleEveryS) + q.samplesAfterStop * Math.floor(hash(id, 4) * 3),
        qaResult: blocked ? 'fail' : 'pending',
      });
    }
  }
  const onHold = batches.filter((batch) => batch.status === 'hold');
  const releasedSinceOpen = Math.max(0, spec.count * (shiftIndex(timeS - incubationS) - shiftIndex(openS - incubationS)));
  const blockedNow = batches.filter((batch) => batch.status === 'blocked').length;

  // 10: the stock as whole batches older than the quarantine, first-expired-first-out.
  const stock: StockSnapshot[] = [];
  let palletsLeft = input.palletsInStock;
  for (let k = nowShift - holdShifts - 1; palletsLeft > 0; k--) {
    for (let filler = spec.count - 1; filler >= 0 && palletsLeft > 0; filler--) {
      const pallets = Math.min(palletsLeft, 58);
      stock.unshift({ batchId: batchId(k, filler), pallets, bestBeforeS: shiftStartS(k) + dayToS(product.shelfLifeDays) });
      palletsLeft -= pallets;
    }
  }
  // A truck docks every truckEveryS from the opening and loads for truckLoadS; a low stock wave keeps one waiting.
  const sinceTruckS = openForS % warehouse.truckEveryS;
  const truckNo = Math.floor(openForS / warehouse.truckEveryS);
  const trucks: TruckSnapshot[] = [];
  if (truckNo > 0 && input.dockWave < -0.6) {
    trucks.push({ id: truckNo, door: truckNo % warehouse.dockDoors, state: 'waiting', arrivedS: timeS - sinceTruckS, remainingS: 0, pallets: 0 });
  } else if (truckNo > 0 && sinceTruckS < warehouse.truckLoadS) {
    trucks.push({
      id: truckNo,
      door: truckNo % warehouse.dockDoors,
      state: 'loading',
      arrivedS: timeS - sinceTruckS,
      remainingS: warehouse.truckLoadS - sinceTruckS,
      pallets: warehouse.palletsPerTruck,
    });
  }
  const trucksShipped = Math.max(0, truckNo - (trucks.length > 0 ? 1 : 0));
  const palletsPerDay = warehouse.palletsPerTruck * (dayToS(1) / warehouse.truckEveryS);
  const daysOfCover = input.palletsInStock / palletsPerDay;

  const packs: PacksSnapshot = {
    fillers,
    packaging: {
      lanes,
      traysMade,
      palletsMade,
      packsSampled: spec.count * Math.floor(openForS / q.sampleEveryS),
      lastPallet: palletsMade > 0 ? lastPallet() : null,
    },
    batches,
    warehouse: {
      stock,
      palletsInStock: input.palletsInStock,
      trucks,
      nextTruckS: timeS - sinceTruckS + warehouse.truckEveryS,
      trucksArrived: truckNo,
      trucksFilledOnArrival: Math.round((truckNo * input.orderFillPct) / 100),
      trucksShipped,
      palletsShipped: trucksShipped * warehouse.palletsPerTruck,
      palletsDestroyed: 0,
    },
  };
  const oeePct = fillers.reduce((sum, filler) => sum + filler.oeePct, 0) / Math.max(1, fillers.length);
  const values: MockPacks['values'] = {
    7: {
      fillerCount: spec.count,
      ratePacksPerH,
      runningCount: running,
      packsPerH: running * ratePacksPerH,
      oeePct,
      packsMade,
      packsRejected: fillers.reduce((sum, filler) => sum + filler.packsRejected, 0),
      tempC: spec.tempC,
    },
    8: {
      packsPerTray: packaging.packsPerTray,
      traysPerPallet: packaging.traysPerPallet,
      packsPerPallet,
      queuePacks: lanes.reduce((sum, lane) => sum + lane.queuePacks, 0),
      traysMade,
      palletsMade,
    },
    9: {
      incubationTempC: q.incubationTempC,
      incubationDays: q.incubationDays,
      samplesPerBatch: q.batchS / q.sampleEveryS,
      batchesOnHold: onHold.length,
      palletsInQuarantine: batches.reduce((sum, batch) => sum + batch.pallets, 0),
      nextReleaseS: onHold.length > 0 ? Math.max(0, Math.min(...onHold.map((batch) => batch.releaseAtS)) - timeS) : 0,
      batchesReleased: releasedSinceOpen,
      batchesBlocked: blockedNow,
      samplesTaken: packs.packaging.packsSampled,
    },
    10: {
      tempC: warehouse.tempC + 1.5 * Math.sin((2 * Math.PI * timeS) / dayToS(1)),
      palletsPerTruck: warehouse.palletsPerTruck,
      palletsInStock: input.palletsInStock,
      daysOfCover,
      trucksAtDock: trucks.filter((truck) => truck.door >= 0).length,
      nextTruckS: warehouse.truckEveryS - sinceTruckS,
      trucksShipped,
      orderFillPct: input.orderFillPct,
    },
  };
  return {
    packs,
    values,
    statuses: {
      7: input.fillerStatus === 'idle' ? 'ok' : input.fillerStatus,
      8: lanes.some((lane) => lane.packerState === 'changeover') ? 'warn' : 'ok',
      9: blockedNow > 0 ? 'bad' : 'warn',
      10: trucks.some((truck) => truck.state === 'waiting') ? 'warn' : 'ok',
    },
    kpis: {
      oeePct,
      traysMade,
      palletsMade,
      batchesOnHold: onHold.length,
      batchesReleased: releasedSinceOpen,
      batchesBlocked: blockedNow,
      palletsInStock: input.palletsInStock,
      daysOfCover,
      orderFillPct: input.orderFillPct,
      trucksShipped,
    },
  };
}
