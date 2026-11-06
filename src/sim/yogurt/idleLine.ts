// The yogurt line as the live sim reports it until phase 17 makes stages 11–14 live (phase 15, D25): the wing
// stands. Its silo holds raw milk at its opening level and temperature, every other vessel is empty and clean,
// nothing flows, and stages 11–16 show grey lamps. The recipe values follow plant.json through the yogurt
// formulas, and the product plan already answers the setYogurtProduct command.
import { type LogKind, type PlantConfig, type TankLevel, type YogurtSnapshot } from '../../contracts';
import type { Setpoints } from '../core';
import { powderKgPerT, titratableAcidityPct } from './formulas';
import { createProductPlan } from './products';
import { yogurtView, type YogurtView } from './view';

export interface YogurtLine {
  /** The setYogurtProduct command. */
  setNextProduct(product: string, timeS: number, log: (timeS: number, kind: LogKind, message: string) => void): void;
  view(setpoints: Readonly<Setpoints>, timeS: number): YogurtView;
}

/** A standing yogurt line, fresh objects on every view. */
export function createIdleYogurtLine(config: PlantConfig): YogurtLine {
  const plan = createProductPlan(config);
  const { yogurt: plant } = config;
  const empty = (capacityL: number): TankLevel => ({ levelL: 0, capacityL });
  const idleSnapshot = (setpoints: Readonly<Setpoints>, timeS: number): YogurtSnapshot => ({
    product: plan.at(timeS),
    mix: {
      flowLph: 0,
      fatPct: plant.mix.fatPct,
      snfPct: plant.mix.snfPct,
      powderKgPerT: powderKgPerT(plant.mix),
      tanks: {
        silo: { levelL: plant.silo.capacityL * plant.silo.startFrac, capacityL: plant.silo.capacityL },
        mixTank: empty(plant.mix.tankL),
      },
    },
    heat: {
      mode: 'idle',
      flowLph: 0,
      outletC: plant.silo.tempC,
      holdS: 0,
      denatPct: 0,
      divertCount: 0,
      reprocessTank: empty(plant.heat.reprocessTankL),
    },
    ferment: {
      tempC: setpoints.fermentTempC,
      tanks: Array.from({ length: plant.ferment.tanks }, () => ({
        ...empty(plant.ferment.tankL),
        state: 'empty' as const,
        product: null,
        ph: plant.ferment.startPh,
        taPct: titratableAcidityPct(plant.ferment, plant.ferment.startPh),
        startedS: null,
        readyAtS: null,
      })),
    },
    buffer: { ...empty(plant.buffer.capacityL), inflowLph: 0, outflowLph: 0, tempC: plant.silo.tempC, waitS: null, coolerOutletC: null, fruitDosePct: 0 },
    p8: { state: 'idle', cupsPerH: 0, cupsMade: 0, cupsRejected: 0 },
    coldChain: {
      warmRoom: { tempC: plant.coldChain.warmRoomC, pallets: 0 },
      chiller: { pallets: 0 },
      coldRoom: { tempC: plant.coldChain.roomC, positionsUsed: 0 },
      palletsShipped: 0,
      reefersShipped: 0,
    },
    kpis: { mixLph: 0, divertedL: 0, cupsPerH: 0, cupsMade: 0, coldRoomPallets: 0, reefersShipped: 0 },
  });
  return {
    setNextProduct: (product, timeS, log) => plan.setNext(product, timeS, log),
    view: (setpoints, timeS) => yogurtView(config, setpoints, idleSnapshot(setpoints, timeS)),
  };
}
