import type { Snapshot } from '../contracts';
import { el, setAttr, setText } from './dom';
import { fillerOeeText, formatKpi, KPI_IDS, KPI_SUB_IDS, kpiSubText, NO_VALUE, sterilityStatus, type KpiId, type KpiSubId } from './format';

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
 * from snapshot.kpis, and each [data-kpi-sub] secondary value under it; the OEE card's
 * [data-kpi-fillers] line reads each filler's OEE from snapshot.packs (contracts v3). A slot or
 * value missing from the markup is skipped, not an error, so the strip can lose or gain them
 * without code changes here.
 */
export function createKpiStrip(root: HTMLElement): KpiStrip {
  const slots = new Map<KpiId, Slot>();
  for (const id of KPI_IDS) {
    const card = root.querySelector<HTMLElement>(`[data-kpi="${id}"]`);
    const value = card?.querySelector<HTMLElement>('[data-kpi-value]');
    if (card && value) slots.set(id, { card, value, shown: '' });
  }
  const subs = new Map<KpiSubId, HTMLElement>();
  for (const id of KPI_SUB_IDS) {
    const node = root.querySelector<HTMLElement>(`[data-kpi-sub="${id}"]`);
    if (node) subs.set(id, node);
  }
  const fillers = root.querySelector<HTMLElement>('[data-kpi-fillers]');

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
      for (const [id, node] of subs) setText(node, kpiSubText(id, snapshot.kpis));
      if (fillers) setText(fillers, fillerOeeText(snapshot.packs?.fillers));
      // Sterility is the one KPI with a hard limit: it turns red on B* or a divert, never on F0 (D4).
      const sterility = slots.get('sterility');
      if (sterility) setAttr(sterility.card, 'data-s', sterilityStatus(snapshot.kpis.bStar, snapshot.stages[4].status));
    },
    dispose() {
      for (const slot of slots.values()) {
        slot.value.replaceChildren(NO_VALUE);
        slot.card.removeAttribute('data-s');
      }
      for (const node of subs.values()) node.textContent = NO_VALUE;
      if (fillers) fillers.textContent = NO_VALUE;
    },
  };
}
