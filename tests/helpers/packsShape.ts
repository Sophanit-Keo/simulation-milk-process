// The shape rules of contracts v3 (src/contracts/packs.ts) that the 3D view and the panels rely on, checked
// the same way for both sims and every recorded fixture.
import { expect } from 'vitest';
import { BATCH_STATUSES, FILLER_STATES, PACKER_STATES, TRUCK_STATES, type PlantConfig, type Snapshot } from '../../src/contracts';

const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;
const isNonNegative = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Fails on the first broken rule, naming where it broke. */
export function expectWellFormedPacks(snap: Snapshot, config: PlantConfig, where: string): void {
  const { packs } = snap;
  const packsPerPallet = config.packaging.packsPerTray * config.packaging.traysPerPallet;
  expect(packs.fillers.map((filler) => filler.name), `${where}: fillers`).toHaveLength(config.fillers.count);
  for (const filler of packs.fillers) {
    const at = `${where}: filler ${filler.name}`;
    expect(FILLER_STATES, `${at} state`).toContain(filler.state);
    for (const key of ['packsMade', 'packsRejected', 'breakdowns', 'batchId'] as const) {
      if (!isCount(filler[key])) expect.fail(`${at} ${key} is ${filler[key]}`);
    }
    for (const key of ['stateRemainingS', 'packsPerH', 'availabilityPct', 'performancePct', 'qualityPct', 'oeePct'] as const) {
      if (!isNonNegative(filler[key])) expect.fail(`${at} ${key} is ${filler[key]}`);
    }
    for (const key of ['availabilityPct', 'qualityPct', 'oeePct'] as const) if (filler[key] > 100 + 1e-9) expect.fail(`${at} ${key} is ${filler[key]}`);
    expect(filler.packsRejected, `${at} rejects`).toBeLessThanOrEqual(filler.packsMade);
    if (filler.state === 'running') expect(filler.packsPerH, `${at} packsPerH`).toBeGreaterThan(0);
    else expect(filler.packsPerH, `${at} packsPerH`).toBe(0);
    if (filler.state !== 'repair' && filler.state !== 'cleaning') expect(filler.stateRemainingS, `${at} stateRemainingS`).toBe(0);
  }

  const { packaging } = packs;
  expect(packaging.lanes.map((lane) => lane.name), `${where}: lanes`).toEqual(packs.fillers.map((filler) => filler.name));
  for (const lane of packaging.lanes) {
    const at = `${where}: lane ${lane.name}`;
    expect(PACKER_STATES, `${at} packerState`).toContain(lane.packerState);
    for (const key of ['queuePacks', 'trayPacks', 'palletTrays', 'batchId'] as const) if (!isCount(lane[key])) expect.fail(`${at} ${key} is ${lane[key]}`);
    expect(lane.trayPacks, `${at} trayPacks`).toBeLessThan(config.packaging.packsPerTray);
    expect(lane.palletTrays, `${at} palletTrays`).toBeLessThan(config.packaging.traysPerPallet);
    if (!isNonNegative(lane.changeoverRemainingS)) expect.fail(`${at} changeoverRemainingS is ${lane.changeoverRemainingS}`);
    expect(lane.packerState === 'changeover', `${at} changeover`).toBe(lane.changeoverRemainingS > 0);
  }
  for (const key of ['traysMade', 'palletsMade', 'packsSampled'] as const) if (!isCount(packaging[key])) expect.fail(`${where}: packaging.${key} is ${packaging[key]}`);

  const ids = packs.batches.map((batch) => batch.id);
  expect([...ids].sort((a, b) => a - b), `${where}: batches oldest first`).toEqual(ids);
  expect(new Set(ids).size, `${where}: batch ids`).toBe(ids.length);
  for (const batch of packs.batches) {
    const at = `${where}: batch ${batch.id}`;
    expect(BATCH_STATUSES, `${at} status`).toContain(batch.status);
    expect(batch.status, `${at} in quarantine`).not.toBe('released');
    for (const key of ['pallets', 'packs', 'lastPalletPacks', 'samples'] as const) if (!isCount(batch[key])) expect.fail(`${at} ${key} is ${batch[key]}`);
    for (const key of ['startS', 'endS', 'releaseAtS', 'bestBeforeS'] as const) if (!Number.isFinite(batch[key])) expect.fail(`${at} ${key} is ${batch[key]}`);
    expect(batch.endS, `${at} endS`).toBeGreaterThan(batch.startS);
    expect(batch.lastPalletPacks, `${at} lastPalletPacks`).toBeLessThanOrEqual(packsPerPallet);
    // Every pallet but the last holds a full 1,008 packs (D1).
    if (batch.pallets > 0) expect(batch.packs, `${at} packs`).toBe((batch.pallets - 1) * packsPerPallet + batch.lastPalletPacks);
    else expect(batch.packs, `${at} packs`).toBe(0);
    if (batch.status === 'filling') expect(batch.endS, `${at} still filling`).toBeGreaterThan(snap.timeS);
    if (batch.status === 'hold') expect(batch.releaseAtS, `${at} release`).toBeGreaterThan(snap.timeS);
  }

  const { warehouse } = packs;
  expect(warehouse.palletsInStock, `${where}: stock`).toBe(warehouse.stock.reduce((sum, entry) => sum + entry.pallets, 0));
  for (let i = 1; i < warehouse.stock.length; i++) {
    const [a, b] = [warehouse.stock[i - 1], warehouse.stock[i]];
    if (!a || !b || a.bestBeforeS > b.bestBeforeS) expect.fail(`${where}: stock not first-expired-first-out at ${i}`);
  }
  for (const entry of warehouse.stock) expect(entry.pallets, `${where}: stock of batch ${entry.batchId}`).toBeGreaterThan(0);
  for (const truck of warehouse.trucks) {
    const at = `${where}: truck ${truck.id}`;
    expect(TRUCK_STATES, `${at} state`).toContain(truck.state);
    expect(truck.door, `${at} door`).toBeGreaterThanOrEqual(-1);
    expect(truck.door, `${at} door`).toBeLessThan(config.warehouse.dockDoors);
    expect(truck.pallets, `${at} pallets`).toBe(truck.state === 'loading' ? config.warehouse.palletsPerTruck : 0);
  }
  const doors = warehouse.trucks.map((truck) => truck.door).filter((door) => door >= 0);
  expect(new Set(doors).size, `${where}: one truck a door`).toBe(doors.length);
  for (const key of ['trucksArrived', 'trucksFilledOnArrival', 'trucksShipped', 'palletsShipped', 'palletsDestroyed'] as const) {
    if (!isCount(warehouse[key])) expect.fail(`${where}: warehouse.${key} is ${warehouse[key]}`);
  }
  expect(warehouse.trucksFilledOnArrival, `${where}: filled trucks`).toBeLessThanOrEqual(warehouse.trucksArrived);
  expect(warehouse.trucksShipped, `${where}: shipped trucks`).toBeLessThanOrEqual(warehouse.trucksArrived);
  expect(warehouse.nextTruckS, `${where}: next truck`).toBeGreaterThan(snap.timeS - 1e-9);
}

/** The KPIs and stage values that repeat what Snapshot.packs holds agree with it. */
export function expectPacksMatchKpis(snap: Snapshot, where: string): void {
  const { packs, kpis, stages } = snap;
  expect(kpis.palletsInStock, `${where}: stock KPI`).toBe(packs.warehouse.palletsInStock);
  expect(kpis.trucksShipped, `${where}: trucks KPI`).toBe(packs.warehouse.trucksShipped);
  expect(kpis.traysMade, `${where}: trays KPI`).toBe(packs.packaging.traysMade);
  expect(kpis.palletsMade, `${where}: pallets KPI`).toBe(packs.packaging.palletsMade);
  expect(kpis.batchesOnHold, `${where}: on-hold KPI`).toBe(packs.batches.filter((batch) => batch.status === 'hold').length);
  expect(kpis.packsPerH, `${where}: packs/h KPI`).toBe(packs.fillers.reduce((sum, filler) => sum + filler.packsPerH, 0));
  expect(stages[7].values.runningCount, `${where}: running`).toBe(packs.fillers.filter((filler) => filler.state === 'running').length);
  expect(stages[10].values.palletsInStock, `${where}: stage 10 stock`).toBe(packs.warehouse.palletsInStock);
}
