// The yogurt line's states in words (phase 17, D27), for the info panel of stages 11–14: the product and the next
// shift's, the heat treatment's mode and its clean, each fermentation tank, and the P8 buffer's product, changeover
// and set-mix wait. Every function takes the snapshot's yogurt part, or undefined for an older snapshot ("—").
import {
  fracToPct,
  yogurtProducts,
  type FermentTank,
  type PlantConfig,
  type YogurtChangeoverKind,
  type YogurtHeatMode,
  type YogurtProductId,
  type YogurtSnapshot,
} from '../contracts';
import plantJson from '../data/plant.json';
import { formatDuration, formatNumber, NO_VALUE, withUnit } from './format';
import { cleaningText, type StateText } from './liquidRows';

const PLANT: PlantConfig = plantJson;
const PRODUCTS = yogurtProducts(PLANT);
const NONE: StateText = { text: NO_VALUE, status: 'idle' };

/** A product's name as plant.json gives it, "Plain stirred yogurt"; an unknown id as it is. */
export const productName = (id: YogurtProductId | null | undefined): string => (id ? (PRODUCTS[id]?.name ?? id) : NO_VALUE);

/** The yogurt line's products in plant.json's order, for the next-product picker. */
export const PRODUCT_CHOICES: readonly { id: YogurtProductId; name: string }[] = Object.values(PRODUCTS).map(({ id, name }) => ({ id, name }));

/** The product this shift makes: "Strawberry stirred yogurt · stirred, 15% fruit". */
export function productText(yogurt: YogurtSnapshot | undefined): StateText {
  if (!yogurt) return NONE;
  const { id, route, fruit } = yogurt.product;
  const how = route === 'set' ? 'sets in the cup' : fruit ? `stirred, ${formatNumber(PLANT.yogurt.fruit.dosePct)}% fruit` : 'stirred';
  return { text: `${productName(id)} · ${how}`, status: 'ok' };
}

/** The product the next shift makes; the picker below the values changes it. */
export function nextProductText(yogurt: YogurtSnapshot | undefined): StateText {
  return yogurt ? { text: productName(yogurt.product.next), status: 'idle' } : NONE;
}

const HEAT_MODES: Readonly<Record<YogurtHeatMode, StateText>> = {
  production: { text: 'Forward to the tanks and the buffer', status: 'ok' },
  divert: { text: 'Diverting to the reprocess tank', status: 'bad' },
  cleaning: { text: 'Cleaning (the wing\'s CIP)', status: 'warn' },
  idle: { text: 'Standing · no tank or buffer room to fill', status: 'idle' },
};

/** The heat treatment's mode, with the time left in a divert or a clean: "Diverting to the reprocess tank · 2 min 10 s left". */
export function heatModeText(yogurt: YogurtSnapshot | undefined): StateText {
  if (!yogurt) return NONE;
  const mode = HEAT_MODES[yogurt.heat.mode] as StateText | undefined;
  if (!mode) return NONE;
  const leftS = yogurt.heat.modeRemainingS ?? 0;
  if ((yogurt.heat.mode !== 'divert' && yogurt.heat.mode !== 'cleaning') || !(leftS > 0)) return mode;
  return { text: `${mode.text} · ${formatDuration(leftS)} left`, status: mode.status };
}

/** The wing's CIP step while it cleans after a divert, as the UHT panel words its own: "Lye (NaOH), 80 °C · 2 of 5 · 20 min left". */
export function heatCleaningText(yogurt: YogurtSnapshot | undefined): StateText {
  return yogurt ? cleaningText({ cleaning: yogurt.heat.cleaning ?? null }) : NONE;
}

/** The heat treatment's steam and the boiler's gas for it (contracts v9): "255 kg/h · gas 198 kW". */
export function steamText(yogurt: YogurtSnapshot | undefined): StateText {
  const energy = yogurt?.energy;
  if (!energy) return NONE;
  if (!(energy.steamKgPerH > 0)) return { text: 'None now', status: 'idle' };
  return { text: `${withUnit(formatNumber(energy.steamKgPerH), 'kg/h')} · gas ${withUnit(formatNumber(energy.gasKw), 'kW')}`, status: 'ok' };
}

const tankPct = (tank: FermentTank): string => withUnit(formatNumber(fracToPct(tank.capacityL > 0 ? tank.levelL / tank.capacityL : 0)), '%');

/**
 * A fermentation tank in words: "Fermenting · pH 5.21 · ready in 1 h 20 min", "Ready at pH 4.55 · cooled, waiting",
 * "Emptying to the buffer · 60 %". `timeS` is the snapshot's clock, for the time to ready.
 */
export function tankText(tank: FermentTank | undefined, timeS: number): StateText {
  if (!tank) return NONE;
  const ph = `pH ${formatNumber(tank.ph, 2)}`;
  switch (tank.state) {
    case 'empty':
      return { text: 'Empty · clean, waiting to fill', status: 'idle' };
    case 'filling':
      return { text: `Filling · ${tankPct(tank)} · ${ph}`, status: 'ok' };
    case 'fermenting': {
      const leftS = tank.readyAtS === null ? null : tank.readyAtS - timeS;
      const ready = leftS === null || !Number.isFinite(leftS) ? '' : leftS > 0 ? ` · ready in ${formatDuration(leftS)}` : ' · at the end pH';
      return { text: `Fermenting · ${ph}${ready}`, status: 'ok' };
    }
    case 'ready':
      return { text: `Ready at ${ph} · cooled, waiting to empty`, status: 'ok' };
    case 'emptying':
      return { text: `Emptying to the buffer · ${tankPct(tank)} · ${ph}`, status: 'ok' };
    case 'cleaning':
      return { text: 'Cleaning in place', status: 'warn' };
    default:
      return NONE;
  }
}

const CHANGEOVERS: Readonly<Record<YogurtChangeoverKind, string>> = {
  rinse: 'Rinse of the buffer and the fruit line',
  cip: 'CIP of the buffer and P8',
  sip: 'P8 sterilizing (SIP)',
};

/** The product in the buffer, or "Changing over" while it is empty between two products. */
export function bufferProductText(yogurt: YogurtSnapshot | undefined): StateText {
  if (!yogurt) return NONE;
  const product = yogurt.buffer.product;
  if (product === undefined) return NONE;
  if (product === null) return { text: 'Changing over', status: 'warn' };
  return { text: productName(product), status: yogurt.buffer.levelL > 0 ? 'ok' : 'idle' };
}

/** The changeover under way between two runs on P8: "Rinse of the buffer and the fruit line · 10 min left", or "None". */
export function changeoverText(yogurt: YogurtSnapshot | undefined): StateText {
  if (!yogurt || yogurt.buffer.changeover === undefined) return NONE;
  const changeover = yogurt.buffer.changeover;
  if (!changeover) return { text: 'None', status: 'idle' };
  const what = CHANGEOVERS[changeover.kind] ?? changeover.kind;
  return { text: `${what} · ${formatDuration(changeover.remainingS)} left`, status: 'warn' };
}

/**
 * How long the oldest set mix in the buffer has waited, of the 45 min it may before it starts to set and goes back to
 * rework: amber past 80% of it, as the stage's lamp. Stirred yogurt keeps, and reads "—".
 */
export function setWaitText(yogurt: YogurtSnapshot | undefined): StateText {
  if (!yogurt) return NONE;
  const { waitS } = yogurt.buffer;
  const maxS = PLANT.yogurt.buffer.setMaxWaitS;
  if (waitS === null) return { text: `${NO_VALUE} · stirred yogurt keeps`, status: 'idle' };
  return { text: `${formatDuration(waitS)} of ${formatDuration(maxS)}`, status: waitS > 0.8 * maxS ? 'warn' : 'ok' };
}
