import type { Snapshot, StockSnapshot, TruckSnapshot } from '../contracts';
import { createLamp, el, setLamp, setText } from './dom';
import { formatDay, formatDuration, formatNumber } from './format';
import type { PanelPart } from './stagePanel';

/** Stock lines shown at most; the rest are summed in one line. */
export const STOCK_SHOWN = 8;

/** A truck at the dock in words: "Truck 7 · door 1 · loading, 12 min left" or "… waiting for stock". */
export function truckText(truck: TruckSnapshot): string {
  const where = truck.door >= 0 ? `door ${truck.door + 1}` : 'yard';
  const what = truck.state === 'loading' ? `loading, ${formatDuration(truck.remainingS)} left` : 'waiting for stock';
  return `Truck ${truck.id} · ${where} · ${what}`;
}

/** A stock line: "Batch 3 · 41 pallets · best before day 182". */
export function stockText(entry: StockSnapshot): string {
  return `Batch ${entry.batchId} · ${formatNumber(entry.pallets)} pallets · best before ${formatDay(entry.bestBeforeS)}`;
}

/**
 * Stage 10's lists (plan 08: "stock, next pick and trucks"): the trucks at the dock with what each is
 * doing, and the released stock by batch in pick order, first-expired-first-out, the next pick first.
 * Redrawn only when a line's text changes, a few times a sim day.
 */
export function createStockList(host: HTMLElement): PanelPart {
  const box = el('section', 'stock');
  box.dataset.testid = 'stock-list';
  const trucksTitle = el('h3', 'eyebrow', 'At the dock');
  const trucks = el('ul', 'stock-rows');
  trucks.dataset.testid = 'dock-trucks';
  const stockTitle = el('h3', 'eyebrow', 'Stock, earliest best-before first');
  const stock = el('ol', 'stock-rows');
  stock.dataset.testid = 'stock-batches';
  box.append(trucksTitle, trucks, stockTitle, stock);
  host.append(box);
  // Null until the first update, so the empty lists draw their hint too.
  let shownTrucks: string | null = null;
  let shownStock: string | null = null;

  return {
    update(snapshot: Snapshot) {
      const warehouse = snapshot.packs?.warehouse;
      const truckLines = (warehouse?.trucks ?? []).map((truck) => ({ text: truckText(truck), status: truck.state === 'loading' ? ('ok' as const) : ('warn' as const) }));
      const truckKey = truckLines.map((line) => line.text).join('\n');
      if (truckKey !== shownTrucks) {
        shownTrucks = truckKey;
        if (truckLines.length === 0) trucks.replaceChildren(el('li', 'batch-hint', 'No truck at the dock'));
        else {
          trucks.replaceChildren(
            ...truckLines.map((line) => {
              const item = el('li');
              const lamp = createLamp(line.status);
              setLamp(lamp, line.status);
              item.append(lamp, ' ', el('span', '', line.text));
              return item;
            }),
          );
        }
      }
      const entries = warehouse?.stock ?? [];
      const lines = entries.slice(0, STOCK_SHOWN).map(stockText);
      const rest = entries.slice(STOCK_SHOWN).reduce((sum, entry) => sum + entry.pallets, 0);
      if (entries.length > STOCK_SHOWN) lines.push(`and ${formatNumber(rest)} pallets in ${formatNumber(entries.length - STOCK_SHOWN)} more batches`);
      const stockKey = lines.join('\n');
      if (stockKey !== shownStock) {
        shownStock = stockKey;
        if (lines.length === 0) stock.replaceChildren(el('li', 'batch-hint', 'No stock released'));
        else {
          stock.replaceChildren(
            ...lines.map((text, i) => {
              const item = el('li', i === 0 ? 'next-pick' : '');
              item.append(el('span', '', text));
              if (i === 0) item.append(' ', el('span', 'tag', 'next pick'));
              return item;
            }),
          );
        }
      }
      setText(trucksTitle, `At the dock · ${formatNumber(truckLines.length)}`);
    },
    dispose() {
      box.remove();
    },
  };
}
