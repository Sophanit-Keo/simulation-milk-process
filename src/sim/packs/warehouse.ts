// Stage 10: released stock and the trucks (plan 04). Stock is kept by batch and best-before date, and every
// pick is first-expired-first-out. Demand is a truck of 22 pallets every 100 min (D2, D3): it docks at a free
// door and loads if released stock holds a full load; otherwise it waits at the door until a release brings
// enough, and with every door taken it waits in the yard. The order fill rate is the share of trucks that
// found a full load when they arrived (D2); days of cover is stock ÷ the pallets the trucks take in a day.
import { dayToS, sToMin, type PlantConfig, type StockSnapshot, type TruckSnapshot, type WarehouseSnapshot } from '../../contracts';
import type { QueuedEvent } from '../eventQueue';
import type { ReleasedBatch } from './quality';
import type { Scheduler } from './types';

export const WAREHOUSE_EVENTS = { truckArrives: 'truckArrives', truckLoaded: 'truckLoaded' } as const;

interface TruckPayload {
  truckId: number;
}

interface Truck {
  id: number;
  door: number;
  state: 'waiting' | 'loading';
  arrivedS: number;
  loadedAtS: number;
  pallets: number;
}

export interface Warehouse {
  /** Released stock, first-expired-first-out. */
  readonly stock: readonly StockSnapshot[];
  readonly palletsInStock: number;
  /** Pallets on trucks still loading at the dock. */
  readonly palletsLoading: number;
  readonly palletsShipped: number;
  readonly palletsDestroyed: number;
  readonly trucksArrived: number;
  readonly trucksShipped: number;
  /** Pallets the trucks take in a day (D3: 316.8). */
  readonly palletsPerDay: number;
  receive(batch: ReleasedBatch, atS: number): void;
  destroyed(pallets: number): void;
  onEvent(event: QueuedEvent): boolean;
  daysOfCover(): number;
  orderFillPct(): number;
  snapshot(nowS: number): WarehouseSnapshot;
}

export function createWarehouse(config: PlantConfig, scheduler: Scheduler, openS: number, openingStock: readonly ReleasedBatch[]): Warehouse {
  const { palletsPerTruck, truckEveryS, truckLoadS, dockDoors } = config.warehouse;
  const palletsPerDay = palletsPerTruck * (dayToS(1) / truckEveryS);
  const stock: StockSnapshot[] = [];
  const trucks: Truck[] = [];
  let palletsInStock = 0;
  let palletsShipped = 0;
  let palletsDestroyed = 0;
  let trucksArrived = 0;
  let trucksFilled = 0;
  let trucksShipped = 0;
  let nextTruckId = 1;
  let nextTruck = scheduler.schedule<null>(openS + truckEveryS, WAREHOUSE_EVENTS.truckArrives, null);

  /** Keeps the stock in pick order: earliest best-before first, then the older batch. */
  function receive(batch: ReleasedBatch): void {
    if (batch.pallets <= 0) return;
    const entry: StockSnapshot = { batchId: batch.batchId, pallets: batch.pallets, bestBeforeS: batch.bestBeforeS };
    const at = stock.findIndex((other) => other.bestBeforeS > entry.bestBeforeS || (other.bestBeforeS === entry.bestBeforeS && other.batchId > entry.batchId));
    stock.splice(at < 0 ? stock.length : at, 0, entry);
    palletsInStock += entry.pallets;
  }
  for (const batch of openingStock) receive(batch);

  /** First-expired-first-out: takes `count` pallets from the front of the stock. */
  function pick(count: number): void {
    let left = count;
    while (left > 0 && stock.length > 0) {
      const first = stock[0] as StockSnapshot;
      const taken = Math.min(left, first.pallets);
      first.pallets -= taken;
      left -= taken;
      if (first.pallets === 0) stock.shift();
    }
    palletsInStock -= count - left;
  }

  const freeDoor = (): number => {
    for (let door = 0; door < dockDoors; door++) if (!trucks.some((truck) => truck.door === door)) return door;
    return -1;
  };

  function startLoading(truck: Truck, atS: number, why: string): void {
    pick(palletsPerTruck);
    truck.state = 'loading';
    truck.pallets = palletsPerTruck;
    truck.loadedAtS = atS + truckLoadS;
    scheduler.schedule<TruckPayload>(truck.loadedAtS, WAREHOUSE_EVENTS.truckLoaded, { truckId: truck.id });
    scheduler.log(atS, 'info', `Truck ${truck.id} ${why} at door ${truck.door + 1}: loading ${palletsPerTruck} pallets, earliest best-before first`);
  }

  /** Trucks waiting at a door load, in arrival order, while the stock holds a full load. */
  function serveWaiting(atS: number): void {
    for (const truck of trucks) {
      if (truck.state !== 'waiting' || truck.door < 0) continue;
      if (palletsInStock < palletsPerTruck) return;
      startLoading(truck, atS, 'got its load');
    }
  }

  function arrive(atS: number): void {
    const truck: Truck = { id: nextTruckId++, door: freeDoor(), state: 'waiting', arrivedS: atS, loadedAtS: 0, pallets: 0 };
    trucks.push(truck);
    trucksArrived += 1;
    // A truck that finds the trucks before it still waiting gets in line behind them.
    const queued = trucks.some((other) => other !== truck && other.state === 'waiting');
    if (truck.door >= 0 && !queued && palletsInStock >= palletsPerTruck) {
      trucksFilled += 1;
      startLoading(truck, atS, 'docked');
    } else if (truck.door < 0) {
      scheduler.log(atS, 'warn', `Truck ${truck.id} waiting in the yard: all ${dockDoors} doors taken`);
    } else {
      scheduler.log(atS, 'warn', `Truck ${truck.id} waiting at door ${truck.door + 1}: ${palletsInStock} pallets released, ${palletsPerTruck} needed`);
    }
    nextTruck = scheduler.schedule<null>(atS + truckEveryS, WAREHOUSE_EVENTS.truckArrives, null);
  }

  function depart(truck: Truck, atS: number): void {
    trucks.splice(trucks.indexOf(truck), 1);
    trucksShipped += 1;
    palletsShipped += truck.pallets;
    const waitedMin = Math.round(sToMin(atS - truck.arrivedS - truckLoadS));
    scheduler.log(atS, 'ok', `Truck ${truck.id} left with ${truck.pallets} pallets${waitedMin > 0 ? ` after waiting ${waitedMin} min` : ''}`);
    // The door it leaves goes to the first truck in the yard.
    const next = trucks.find((other) => other.door < 0);
    if (next) next.door = truck.door;
    serveWaiting(atS);
  }

  return {
    stock,
    get palletsInStock() {
      return palletsInStock;
    },
    get palletsLoading() {
      return trucks.reduce((sum, truck) => sum + truck.pallets, 0);
    },
    get palletsShipped() {
      return palletsShipped;
    },
    get palletsDestroyed() {
      return palletsDestroyed;
    },
    get trucksArrived() {
      return trucksArrived;
    },
    get trucksShipped() {
      return trucksShipped;
    },
    palletsPerDay,
    receive(batch, atS) {
      receive(batch);
      serveWaiting(atS);
    },
    destroyed(pallets) {
      palletsDestroyed += pallets;
    },
    onEvent(event) {
      if (event.type === WAREHOUSE_EVENTS.truckArrives) {
        if (event.seq === nextTruck.seq) arrive(event.timeS);
        return true;
      }
      if (event.type !== WAREHOUSE_EVENTS.truckLoaded) return false;
      const truck = trucks.find((candidate) => candidate.id === (event.payload as TruckPayload).truckId);
      if (truck?.state === 'loading') depart(truck, event.timeS);
      return true;
    },
    daysOfCover: () => palletsInStock / palletsPerDay,
    // No truck yet means no order missed.
    orderFillPct: () => (trucksArrived > 0 ? (100 * trucksFilled) / trucksArrived : 100),
    snapshot(nowS) {
      const truckSnapshots: TruckSnapshot[] = trucks.map((truck) => ({
        id: truck.id,
        door: truck.door,
        state: truck.state,
        arrivedS: truck.arrivedS,
        remainingS: truck.state === 'loading' ? Math.max(0, truck.loadedAtS - nowS) : 0,
        pallets: truck.pallets,
      }));
      return {
        stock: stock.map((entry) => ({ ...entry })),
        palletsInStock,
        trucks: truckSnapshots,
        nextTruckS: nextTruck.timeS,
        trucksArrived,
        trucksFilledOnArrival: trucksFilled,
        trucksShipped,
        palletsShipped,
        palletsDestroyed,
      };
    },
  };
}
