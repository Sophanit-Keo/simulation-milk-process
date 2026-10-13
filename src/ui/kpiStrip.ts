import type { Snapshot } from '../contracts';
import { el, setAttr } from './dom';
import { formatKpi, KPI_IDS, NO_VALUE, type KpiId } from './format';

export interface KpiStrip {
  update(snapshot: Snapshot): void;
  dispose(): void;
}

interface Slot {
  card: HTMLElement;
  value: HTMLElement;
  /** The text last written, so an unchanged KPI leaves the DOM alone. */
  shown: string;
}

/**
 * The KPI strip: fills the [data-kpi-value] element of each [data-kpi] slot in index.html
 * from snapshot.kpis. A slot missing from the markup is skipped, not an error, so the
 * strip can lose or gain slots without code changes here.
 */
export function createKpiStrip(root: HTMLElement): KpiStrip {
  const slots = new Map<KpiId, Slot>();
  for (const id of KPI_IDS) {
    const card = root.querySelector<HTMLElement>(`[data-kpi="${id}"]`);
    const value = card?.querySelector<HTMLElement>('[data-kpi-value]');
    if (card && value) slots.set(id, { card, value, shown: '' });
  }

  return {
    update(snapshot) {
      for (const [id, slot] of slots) {
        const runs = formatKpi(id, snapshot.kpis);
        const text = runs.map((run) => run.text).join('');
        if (text === slot.shown) continue;
        slot.shown = text;
        // Units and names in <small>, as in the preview; the element still reads "16,000 L/h".
        slot.value.replaceChildren(...runs.map((run) => (run.small ? el('small', '', run.text) : run.text)));
      }
      // Sterility is the one KPI with a hard limit in phase 2: B* below 1 means under-processed milk.
      // 0 means the model gives no B* yet, which is not a fault.
      const sterility = slots.get('sterility');
      if (sterility) {
        const { bStar } = snapshot.kpis;
        setAttr(sterility.card, 'data-s', bStar > 0 && bStar < 1 ? 'bad' : null);
      }
    },
    dispose() {
      for (const slot of slots.values()) {
        slot.value.replaceChildren(NO_VALUE);
        slot.card.removeAttribute('data-s');
      }
    },
  };
}
