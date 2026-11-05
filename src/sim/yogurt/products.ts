// The yogurt line's product day (D26, plan 12 "Product plan"): one product a shift, on the shift grid of D1 (06:00,
// 14:00, 22:00), from yogurt.shiftProducts. The setYogurtProduct command changes the next shift's product only;
// the shift after it goes back to the product day.
import { YOGURT_PRODUCT_IDS, yogurtProducts, yogurtShiftProducts, type LogKind, type PlantConfig, type YogurtProductId, type YogurtSnapshot } from '../../contracts';
import { formatDayTime } from '../log';

export interface ProductPlan {
  /** The setYogurtProduct command; an id the line does not make is logged and ignored. */
  setNext(product: string, timeS: number, log: (timeS: number, kind: LogKind, message: string) => void): void;
  /** The product of the shift running at timeS, and the next shift's. */
  at(timeS: number): YogurtSnapshot['product'];
}

export function createProductPlan(config: PlantConfig): ProductPlan {
  const products = yogurtProducts(config);
  const day = yogurtShiftProducts(config);
  const { batchS, firstShiftStartS } = config.quality;
  const shiftAt = (timeS: number): number => Math.floor((timeS - firstShiftStartS) / batchS);
  const planned = (shift: number): YogurtProductId => day[((shift % day.length) + day.length) % day.length];
  let chosen: { shift: number; product: YogurtProductId } | null = null;
  const productOf = (shift: number): YogurtProductId => (chosen?.shift === shift ? chosen.product : planned(shift));

  return {
    setNext(product, timeS, log) {
      if (!YOGURT_PRODUCT_IDS.includes(product as YogurtProductId)) {
        log(timeS, 'warn', `Yogurt product "${product}" not set: the line makes ${YOGURT_PRODUCT_IDS.join(', ')}`);
        return;
      }
      const shift = shiftAt(timeS) + 1;
      chosen = { shift, product: product as YogurtProductId };
      log(timeS, 'info', `Yogurt line: the next shift (${formatDayTime(firstShiftStartS + shift * batchS)}) makes ${products[chosen.product].name.toLowerCase()}`);
    },
    at(timeS) {
      const shift = shiftAt(timeS);
      const { id, route, fruit } = products[productOf(shift)];
      return { id, route, fruit, next: productOf(shift + 1) };
    },
  };
}
