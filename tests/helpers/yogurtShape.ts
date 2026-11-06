// Every shape rule of contracts v8's Snapshot.yogurt (src/contracts/yogurt.ts) that a consumer may rely on, with v9's
// and v10's fields where a snapshot has them, and the agreement between it, the stage 11–16 values and the yogurt line
// points (src/sim/yogurt/view.ts).
import { expect } from 'vitest';
import {
  FERMENT_TANK_STATES,
  P8_STATES,
  P8_STOP_REASONS,
  YOGURT_PALLET_PLACES,
  YOGURT_REEFER_STATES,
  YOGURT_HEAT_MODES,
  YOGURT_LINE_POINT_IDS,
  YOGURT_PRODUCT_IDS,
  YOGURT_ROUTES,
  YOGURT_STAGE_IDS,
  type PlantConfig,
  type Snapshot,
  type TankLevel,
} from '../../src/contracts';

const finiteAtLeast0 = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function expectTank(tank: TankLevel, where: string): void {
  if (!(tank.capacityL > 0 && tank.levelL >= 0 && tank.levelL <= tank.capacityL + 1e-9)) expect.fail(`${where} holds ${tank.levelL} of ${tank.capacityL} L`);
}

export function expectWellFormedYogurt(snap: Snapshot, config: PlantConfig, where: string): void {
  const { yogurt } = snap;
  expect(yogurt, `${where}: yogurt`).toBeDefined();
  const { product, mix, heat, ferment, buffer, p8, coldChain, kpis } = yogurt;
  expect(YOGURT_PRODUCT_IDS, `${where}: product`).toContain(product.id);
  expect(YOGURT_PRODUCT_IDS, `${where}: next product`).toContain(product.next);
  expect(YOGURT_ROUTES, `${where}: route`).toContain(product.route);
  const named = config.yogurt.products.find((entry) => entry.id === product.id);
  expect({ route: product.route, fruit: product.fruit }, `${where}: the product's route and fruit`).toEqual({ route: named?.route, fruit: named?.fruit });

  for (const [key, value] of Object.entries({ ...mix, tanks: undefined })) {
    if (key !== 'tanks' && !finiteAtLeast0(value)) expect.fail(`${where}: mix.${key} is ${String(value)}`);
  }
  expectTank(mix.tanks.silo, `${where}: the yogurt silo`);
  expectTank(mix.tanks.mixTank, `${where}: the mix tank`);
  expect(YOGURT_HEAT_MODES, `${where}: heat.mode`).toContain(heat.mode);
  for (const key of ['flowLph', 'outletC', 'holdS', 'denatPct', 'divertCount'] as const) {
    if (!finiteAtLeast0(heat[key])) expect.fail(`${where}: heat.${key} is ${heat[key]}`);
  }
  expect(heat.denatPct, `${where}: heat.denatPct`).toBeLessThanOrEqual(100);
  expect(Number.isInteger(heat.divertCount), `${where}: whole diverts`).toBe(true);
  expect(heat.mode === 'idle' ? heat.flowLph === 0 : true, `${where}: an idle heat treatment has no flow`).toBe(true);
  expectTank(heat.reprocessTank, `${where}: the reprocess tank`);

  expect(ferment.tanks, `${where}: one entry per fermentation tank`).toHaveLength(config.yogurt.ferment.tanks);
  ferment.tanks.forEach((tank, i) => {
    const at = `${where}: tank ${i + 1}`;
    expect(FERMENT_TANK_STATES, `${at} state`).toContain(tank.state);
    expectTank(tank, at);
    const { floorPh, startPh } = config.yogurt.ferment;
    if (!(tank.ph >= floorPh && tank.ph <= startPh)) expect.fail(`${at}: pH ${tank.ph} outside ${floorPh}–${startPh}`);
    if (!finiteAtLeast0(tank.taPct)) expect.fail(`${at}: TA ${tank.taPct}`);
    expect(tank.product === null, `${at}: no product while empty or cleaning`).toBe(tank.state === 'empty' || tank.state === 'cleaning');
    expect(tank.startedS === null, `${at}: a start once fermenting`).toBe(tank.state === 'empty' || tank.state === 'filling' || tank.state === 'cleaning');
    if (tank.startedS !== null && !(tank.readyAtS !== null && tank.readyAtS > tank.startedS && tank.startedS <= snap.timeS)) {
      expect.fail(`${at}: started ${tank.startedS}, ready ${String(tank.readyAtS)}, now ${snap.timeS}`);
    }
  });

  expectTank(buffer, `${where}: the P8 buffer`);
  for (const key of ['inflowLph', 'outflowLph', 'tempC', 'fruitDosePct'] as const) {
    if (!finiteAtLeast0(buffer[key])) expect.fail(`${where}: buffer.${key} is ${buffer[key]}`);
  }
  // While the buffer holds product: set mix waits and skips the cooler, stirred yogurt comes through it. Empty, nothing
  // waits. Its product (contracts v9) may still be the last shift's, which P8 finishes before the changeover.
  const bufferRoute = buffer.product ? config.yogurt.products.find((entry) => entry.id === buffer.product)?.route : product.route;
  if (buffer.levelL > 0) {
    expect(buffer.waitS === null, `${where}: a wait only for set yogurt`).toBe(bufferRoute === 'stirred');
    expect(buffer.coolerOutletC === null, `${where}: no cooler for set yogurt`).toBe(bufferRoute === 'set');
  } else {
    expect(buffer.waitS, `${where}: nothing waits in an empty buffer`).toBeNull();
  }
  if (buffer.waitS !== null && !finiteAtLeast0(buffer.waitS)) expect.fail(`${where}: buffer.waitS is ${buffer.waitS}`);

  expect(P8_STATES, `${where}: p8.state`).toContain(p8.state);
  for (const key of ['cupsPerH', 'cupsMade', 'cupsRejected'] as const) {
    if (!finiteAtLeast0(p8[key])) expect.fail(`${where}: p8.${key} is ${p8[key]}`);
  }
  expect(Number.isInteger(p8.cupsMade) && Number.isInteger(p8.cupsRejected), `${where}: whole cups`).toBe(true);
  expect(p8.state === 'running' ? true : p8.cupsPerH === 0, `${where}: cups only while P8 runs`).toBe(true);
  expectWellFormedP8(p8, where);
  expectWellFormedColdChain(coldChain, config, snap.timeS, where);

  const counts = [coldChain.warmRoom.pallets, coldChain.chiller.pallets, coldChain.coldRoom.positionsUsed, coldChain.palletsShipped, coldChain.reefersShipped];
  if (!counts.every((count) => Number.isInteger(count) && count >= 0)) expect.fail(`${where}: cold-chain counts ${counts.join(', ')}`);
  for (const [key, value] of Object.entries(kpis)) if (!finiteAtLeast0(value)) expect.fail(`${where}: yogurt KPI ${key} is ${String(value)}`);
  expect(kpis.cupsMade, where).toBe(p8.cupsMade);
  expect(kpis.cupsPerH, where).toBe(p8.cupsPerH);
  expect(kpis.coldRoomPallets, where).toBe(coldChain.coldRoom.positionsUsed);
  expect(kpis.reefersShipped, where).toBe(coldChain.reefersShipped);

  // The panels read the same numbers as the snapshot, and every yogurt point has a temperature and a flow.
  for (const id of YOGURT_STAGE_IDS) expect(snap.stages[id]?.id, `${where}: stage ${id}`).toBe(id);
  const values = (id: 11 | 12 | 13 | 14 | 15 | 16) => snap.stages[id].values;
  expect(values(11).powderKgPerT, where).toBe(mix.powderKgPerT);
  expect(values(11).flowLph, where).toBe(mix.flowLph);
  expect(values(12).tempC, where).toBe(heat.outletC);
  expect(values(12).denatPct, where).toBe(heat.denatPct);
  ferment.tanks.forEach((tank, i) => expect(values(13)[`tank${i + 1}Ph`], `${where}: tank ${i + 1} pH`).toBe(tank.ph));
  expect(values(14).outflowLph, where).toBe(buffer.outflowLph);
  expect(values(15).cupsMade, where).toBe(p8.cupsMade);
  expect(values(16).coldRoomPallets, where).toBe(coldChain.coldRoom.positionsUsed);
  for (const id of YOGURT_LINE_POINT_IDS) {
    const point = snap.line[id];
    if (!(point && Number.isFinite(point.tempC) && finiteAtLeast0(point.flowLph))) expect.fail(`${where}: line.${id} is ${JSON.stringify(point)}`);
  }
}

/** Contracts v10's P8 fields (phase 18, D28), each where the snapshot has it. */
function expectWellFormedP8(p8: Snapshot['yogurt']['p8'], where: string): void {
  if (p8.stopReason !== undefined) {
    expect(p8.stopReason === null || P8_STOP_REASONS.includes(p8.stopReason), `${where}: p8.stopReason ${p8.stopReason}`).toBe(true);
    expect(p8.stopReason !== null, `${where}: a stop reason only while stopped`).toBe(p8.state === 'stopped');
  }
  if (p8.cyclesPerMin !== undefined) expect(p8.state === 'running' || p8.cyclesPerMin === 0, `${where}: cycles only while P8 runs`).toBe(true);
  if (p8.rejects) {
    const { underFill, overFill, metal, vision, sealHold } = p8.rejects;
    for (const count of [underFill, overFill, metal, vision, sealHold]) expect(Number.isInteger(count) && count >= 0, `${where}: p8 reject counts`).toBe(true);
    expect(underFill + overFill + metal + vision + sealHold, `${where}: the rejects by cause sum to cupsRejected`).toBe(p8.cupsRejected);
  }
  if (p8.fillHistogram) {
    const { fromG, binG, counts } = p8.fillHistogram;
    expect(Number.isFinite(fromG) && binG > 0 && counts.length > 0, `${where}: p8.fillHistogram`).toBe(true);
    expect(counts.every((count) => Number.isInteger(count) && count >= 0), `${where}: whole histogram counts`).toBe(true);
    if (p8.currentBatch) expect(counts.reduce((sum, count) => sum + count, 0), `${where}: the histogram weighs every cup of the batch at least`).toBeGreaterThanOrEqual(p8.currentBatch.cups);
  }
  if (p8.lastFillG !== undefined && p8.lastFillG !== null) expect(p8.lastFillG > 0, `${where}: p8.lastFillG`).toBe(true);
  if (p8.magazines) {
    for (const pct of [p8.magazines.cupsPct, p8.magazines.foilsPct]) expect(pct >= 0 && pct <= 100, `${where}: magazine at ${pct}%`).toBe(true);
  }
  if (p8.hepaPa !== undefined) expect(Number.isFinite(p8.hepaPa), `${where}: p8.hepaPa`).toBe(true);
  if (p8.seal) for (const value of Object.values(p8.seal)) expect(value > 0, `${where}: p8.seal`).toBe(true);
  if (p8.nextSealTestS !== undefined && p8.nextSealTestS !== null) expect(Number.isFinite(p8.nextSealTestS), `${where}: p8.nextSealTestS`).toBe(true);
  if (p8.sealTests) {
    const { passed, failed, cupsTaken } = p8.sealTests;
    expect([passed, failed, cupsTaken].every((count) => Number.isInteger(count) && count >= 0), `${where}: p8.sealTests`).toBe(true);
  }
  if (p8.currentBatch) {
    const batch = p8.currentBatch;
    expect(batch.code, `${where}: batch code`).toMatch(/^P8-\d{3}-[1-3]$/);
    expect(YOGURT_PRODUCT_IDS, `${where}: batch product`).toContain(batch.product);
    expect(batch.expiresS > batch.madeS && Number.isInteger(batch.cups) && batch.cups >= 0, `${where}: batch dates and cups`).toBe(true);
  }
}

/** Contracts v11's cold chain fields (phase 19, D29), each where the snapshot has it. */
function expectWellFormedColdChain(coldChain: Snapshot['yogurt']['coldChain'], config: PlantConfig, timeS: number, where: string): void {
  const plant = config.yogurt.coldChain;
  const { warmRoom, chiller, coldRoom } = coldChain;
  for (const [room, held, capacity] of [
    ['warm room', warmRoom.pallets, warmRoom.capacity],
    ['chiller', chiller.pallets, chiller.capacity],
    ['cold room', coldRoom.positionsUsed, coldRoom.capacity],
  ] as const) {
    if (capacity !== undefined) expect(held <= capacity, `${where}: the ${room} holds ${held} of ${capacity}`).toBe(true);
  }
  if (coldChain.trays) {
    const { made, openCups, openTrays } = coldChain.trays;
    expect(Number.isInteger(made) && made >= 0, `${where}: trays made`).toBe(true);
    expect(openCups >= 0 && openCups < plant.cupsPerTray && openTrays >= 0 && openTrays < plant.traysPerPallet, `${where}: the open tray and pallet`).toBe(true);
  }
  if (coldChain.pallets) {
    const at = (place: string): number => coldChain.pallets?.filter((pallet) => pallet.place === place).length ?? 0;
    expect(at('warmRoom'), `${where}: warm-room pallets`).toBe(warmRoom.pallets);
    expect(at('chiller'), `${where}: chiller pallets`).toBe(chiller.pallets);
    expect(at('coldRoom'), `${where}: cold-room pallets`).toBe(coldRoom.positionsUsed);
    // Plain checks, failing only on a violation: a snapshot carries some 200 pallets, and the runs check every frame.
    const places = new Set<string>(YOGURT_PALLET_PLACES);
    const products = new Set<string>(YOGURT_PRODUCT_IDS);
    for (const pallet of coldChain.pallets) {
      const name = `${where}: pallet ${pallet.id}`;
      if (!places.has(pallet.place) || !products.has(pallet.product) || !/^P8-\d{3}-[1-3]$/.test(pallet.batch)) expect.fail(`${name}: ${pallet.place}, ${pallet.product}, ${pallet.batch}`);
      if (!(pallet.cups > 0 && pallet.cups <= pallet.trays * plant.cupsPerTray && pallet.trays <= plant.traysPerPallet)) expect.fail(`${name}: ${pallet.cups} cups on ${pallet.trays} trays`);
      if (!(Number.isFinite(pallet.tempC) && Number.isFinite(pallet.ph))) expect.fail(`${name}: ${pallet.tempC} °C, pH ${pallet.ph}`);
      // Stirred yogurt never sees the warm room; a pallet's hold clock starts in the cold room, and it is released once over.
      if (pallet.route === 'stirred' && pallet.place === 'warmRoom') expect.fail(`${name}: stirred in the warm room`);
      if ((pallet.place === 'coldRoom' || pallet.place === 'reefer') && (pallet.holdUntilS === null || pallet.leaveByS === null)) expect.fail(`${name}: no hold clock`);
      if (pallet.released && !(pallet.holdUntilS !== null && pallet.holdUntilS <= timeS)) expect.fail(`${name}: released before its hold is over`);
      // In the cold room it is at most chillToC; a set pallet leaves the warm room only at its pH.
      if (pallet.place === 'coldRoom' && pallet.tempC > plant.chillToC + 1e-9) expect.fail(`${name}: ${pallet.tempC} °C in the cold room`);
      if (pallet.route === 'set' && (pallet.place === 'chiller' || pallet.place === 'coldRoom') && pallet.ph > plant.releasePh + 1e-9) expect.fail(`${name}: pH ${pallet.ph} past the warm room`);
    }
  }
  if (coldChain.reefers) {
    for (const reefer of coldChain.reefers) {
      expect(YOGURT_REEFER_STATES, `${where}: reefer ${reefer.id}`).toContain(reefer.state);
      expect(reefer.pallets >= 0 && reefer.pallets <= reefer.load && reefer.load <= plant.palletsPerTruck, `${where}: reefer ${reefer.id} load`).toBe(true);
      expect(reefer.door >= 0 && reefer.door < plant.dockDoors, `${where}: reefer ${reefer.id} door`).toBe(true);
    }
  }
}
