// What stages 11–16 show, read off one YogurtSnapshot (contracts v8): the per-stage values the info panel's rows
// name (src/data/stages.json), the lamps, and the yogurt line's measuring points. The idle line and the mock both
// build a YogurtSnapshot and pass it through here, so the panels, the lamps and the snapshot always agree.
import {
  fracToPct,
  type LinePoint,
  type PlantConfig,
  type Status,
  type TankLevel,
  type YogurtLinePointId,
  type YogurtSnapshot,
  type YogurtStageId,
} from '../../contracts';
import type { Setpoints } from '../core';
import { timeToPhS } from './formulas';

export type YogurtStageValues = Record<YogurtStageId, Record<string, number>>;

export interface YogurtView {
  yogurt: YogurtSnapshot;
  values: YogurtStageValues;
  statuses: Record<YogurtStageId, Status>;
  line: Record<YogurtLinePointId, LinePoint>;
}

const levelPct = ({ levelL, capacityL }: TankLevel): number => fracToPct(levelL / capacityL);

/** The values of stages 11–16, from the snapshot and the live set points. */
export function yogurtStageValues(config: PlantConfig, setpoints: Readonly<Setpoints>, yogurt: YogurtSnapshot): YogurtStageValues {
  const { mix, heat, ferment, buffer, p8, coldChain } = yogurt;
  const { yogurt: plant } = config;
  const tankPh = Object.fromEntries(ferment.tanks.map((tank, i) => [`tank${i + 1}Ph`, tank.ph]));
  return {
    11: {
      flowLph: mix.flowLph,
      fatPct: mix.fatPct,
      snfPct: mix.snfPct,
      powderKgPerT: mix.powderKgPerT,
      siloLevelPct: levelPct(mix.tanks.silo),
      mixTankLevelPct: levelPct(mix.tanks.mixTank),
    },
    12: {
      flowLph: heat.flowLph,
      tempC: heat.outletC,
      setpointC: setpoints.yogurtHeatC,
      holdS: heat.holdS,
      denatPct: heat.denatPct,
      divertLimitC: plant.heat.divertBelowC,
      minHoldS: plant.heat.minHoldS,
      homogenizerBar: heat.flowLph > 0 ? plant.homogenizer.bar : 0,
      reprocessLevelL: heat.reprocessTank.levelL,
    },
    13: {
      tempC: ferment.tempC,
      setpointC: setpoints.fermentTempC,
      endPh: plant.ferment.endPh,
      timeToEndS: timeToPhS(plant.ferment, plant.ferment.endPh, setpoints.fermentTempC),
      fermentingCount: ferment.tanks.filter((tank) => tank.state === 'fermenting').length,
      ...tankPh,
    },
    14: {
      inflowLph: buffer.inflowLph,
      outflowLph: buffer.outflowLph,
      tempC: buffer.tempC,
      levelPct: levelPct(buffer),
      fruitDosePct: buffer.fruitDosePct,
    },
    15: {
      cupsPerH: p8.cupsPerH,
      cupsMade: p8.cupsMade,
      cupsRejected: p8.cupsRejected,
      setRateCupsPerH: setpoints.p8RateCupsPerH,
      cupG: plant.p8.cupG,
      fillTargetG: plant.p8.fill.targetG,
      sealTempC: plant.p8.seal.tempC,
    },
    16: {
      warmRoomPallets: coldChain.warmRoom.pallets,
      chillerPallets: coldChain.chiller.pallets,
      coldRoomPallets: coldChain.coldRoom.positionsUsed,
      coldRoomTempC: coldChain.coldRoom.tempC,
      palletsShipped: coldChain.palletsShipped,
      reefersShipped: coldChain.reefersShipped,
      cupsPerPallet: plant.coldChain.cupsPerTray * plant.coldChain.traysPerPallet,
    },
  };
}

/**
 * The lamps of stages 11–16: grey while a stage stands, green while it runs, amber for a clean, a set mix near its
 * wait limit, a starved filler or a cold room outside its band, red for a divert or a stopped filler.
 */
export function yogurtStatuses(config: PlantConfig, yogurt: YogurtSnapshot): Record<YogurtStageId, Status> {
  const { mix, heat, ferment, buffer, p8, coldChain } = yogurt;
  const { coldChain: room, buffer: plantBuffer } = config.yogurt;
  const busyTank = ferment.tanks.some((tank) => tank.state !== 'empty');
  const palletsInChain = coldChain.warmRoom.pallets + coldChain.chiller.pallets + coldChain.coldRoom.positionsUsed;
  const roomOutside = coldChain.coldRoom.tempC < room.roomMinC || coldChain.coldRoom.tempC > room.roomMaxC;
  return {
    11: mix.flowLph > 0 ? 'ok' : 'idle',
    12: ({ production: 'ok', divert: 'bad', cleaning: 'warn', idle: 'idle' } as const)[heat.mode],
    13: busyTank ? 'ok' : 'idle',
    14:
      buffer.levelL <= 0 && buffer.inflowLph <= 0
        ? 'idle'
        : buffer.waitS !== null && buffer.waitS > 0.8 * plantBuffer.setMaxWaitS
          ? 'warn'
          : 'ok',
    15: ({ idle: 'idle', cleaning: 'warn', sterilizing: 'warn', running: 'ok', starved: 'warn', stopped: 'bad' } as const)[p8.state],
    16: palletsInChain <= 0 ? 'idle' : roomOutside ? 'warn' : 'ok',
  };
}

/** The yogurt line's measuring points (contracts v8), in flow order, read off the snapshot. */
export function yogurtLinePoints(config: PlantConfig, yogurt: YogurtSnapshot): Record<YogurtLinePointId, LinePoint> {
  const { mix, heat, ferment, buffer, p8 } = yogurt;
  const point = (tempC: number, flowLph: number): LinePoint => ({ tempC, flowLph });
  const siloC = config.yogurt.silo.tempC;
  const forwardLph = heat.mode === 'production' ? heat.flowLph : 0;
  const emptyingLph = ferment.tanks.some((tank) => tank.state === 'emptying') ? buffer.inflowLph : 0;
  // Set yogurt goes from the inoculation straight to the buffer; stirred into a tank, and later through the cooler.
  const set = yogurt.product.route === 'set';
  return {
    ySilo: point(siloC, mix.flowLph),
    yMixTank: point(siloC, heat.flowLph),
    yHeater: point(heat.flowLph > 0 ? heat.outletC : siloC, heat.flowLph),
    yHoldingCell: point(heat.flowLph > 0 ? heat.outletC : siloC, forwardLph),
    yInoculation: point(forwardLph > 0 ? ferment.tempC : siloC, forwardLph),
    yFermentTank: point(ferment.tanks.some((tank) => tank.state !== 'empty') ? ferment.tempC : siloC, set ? 0 : emptyingLph),
    yCooler: point(buffer.coolerOutletC ?? siloC, set ? 0 : emptyingLph),
    p8Buffer: point(buffer.levelL > 0 ? buffer.tempC : siloC, buffer.outflowLph),
    p8Filler: point(buffer.levelL > 0 ? buffer.tempC : siloC, p8.state === 'running' ? buffer.outflowLph : 0),
  };
}

/** Values, lamps and points together. */
export function yogurtView(config: PlantConfig, setpoints: Readonly<Setpoints>, yogurt: YogurtSnapshot): YogurtView {
  return {
    yogurt,
    values: yogurtStageValues(config, setpoints, yogurt),
    statuses: yogurtStatuses(config, yogurt),
    line: yogurtLinePoints(config, yogurt),
  };
}
