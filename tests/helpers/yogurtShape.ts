// Every shape rule of contracts v8's Snapshot.yogurt (src/contracts/yogurt.ts) that a consumer may rely on, and the
// agreement between it, the stage 11–16 values and the yogurt line points (src/sim/yogurt/view.ts).
import { expect } from 'vitest';
import {
  FERMENT_TANK_STATES,
  P8_STATES,
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
  // While the buffer holds product: set mix waits and skips the cooler, stirred yogurt comes through it. Empty, nothing waits.
  if (buffer.levelL > 0) {
    expect(buffer.waitS === null, `${where}: a wait only for set yogurt`).toBe(product.route === 'stirred');
    expect(buffer.coolerOutletC === null, `${where}: no cooler for set yogurt`).toBe(product.route === 'set');
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
