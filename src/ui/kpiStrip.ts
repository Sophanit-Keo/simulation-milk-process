import type { LineId, Snapshot } from '../contracts';
import { el, setAttr, setText } from './dom';
import {
  fillerOeeText,
  formatKpi,
  formatYogurtKpi,
  KPI_IDS,
  KPI_SUB_IDS,
  kpiSubText,
  NO_VALUE,
  sterilityStatus,
  YOGURT_KPI_IDS,
  YOGURT_KPI_SUB_IDS,
  yogurtKpiSubText,
  type KpiId,
  type KpiSubId,
  type KpiText,
  type YogurtKpiId,
  type YogurtKpiSubId,
} from './format';

export interface KpiStrip {
  update(snapshot: Snapshot): void;
  /**
   * Shows the KPI group of a line (phase 16): the milk's eight cards, or the yogurt line's four in their place,
   * in the same one row, so the strip and the 3D view keep their heights.
   */
  showLine(line: LineId): void;
  /** The line whose group is shown. */
  readonly line: LineId;
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
  const findSlots = <Id extends string>(ids: readonly Id[]): Map<Id, Slot> => {
    const found = new Map<Id, Slot>();
    for (const id of ids) {
      const card = root.querySelector<HTMLElement>(`[data-kpi="${id}"]`);
      const value = card?.querySelector<HTMLElement>('[data-kpi-value]');
      if (card && value) found.set(id, { card, value, shown: '' });
    }
    return found;
  };
  const findSubs = <Id extends string>(ids: readonly Id[]): Map<Id, HTMLElement> => {
    const found = new Map<Id, HTMLElement>();
    for (const id of ids) {
      const node = root.querySelector<HTMLElement>(`[data-kpi-sub="${id}"]`);
      if (node) found.set(id, node);
    }
    return found;
  };
  const slots = findSlots<KpiId>(KPI_IDS);
  const subs = findSubs<KpiSubId>(KPI_SUB_IDS);
  const yogurtSlots = findSlots<YogurtKpiId>(YOGURT_KPI_IDS);
  const yogurtSubs = findSubs<YogurtKpiSubId>(YOGURT_KPI_SUB_IDS);
  const fillers = root.querySelector<HTMLElement>('[data-kpi-fillers]');
  // The two groups (index.html): the milk's shown, the yogurt line's not, until a yogurt stage is selected. Both
  // stand in one grid cell (app.css) and the other is only made invisible, so the strip keeps the taller one's height.
  const groups = { uht: root.querySelector<HTMLElement>('[data-line="uht"]'), yogurt: root.querySelector<HTMLElement>('[data-line="yogurt"]') };
  let line: LineId = 'uht';
  const show = (next: LineId): void => {
    line = next;
    // A group missing from the markup leaves the other as it is.
    if (!groups.uht || !groups.yogurt) return;
    for (const id of ['uht', 'yogurt'] as const) {
      const group = groups[id];
      if (!group) continue;
      group.dataset.shown = String(id === next);
      group.inert = id !== next;
    }
  };
  show('uht');

  /** Writes a slot's runs, units and names in <small> as in the preview; the element still reads "16,000 L/h". */
  const write = (slot: Slot, runs: KpiText): void => {
    const text = runs.map((run) => run.text).join('');
    if (text === slot.shown) return;
    slot.shown = text;
    slot.value.replaceChildren(...runs.map((run) => (run.small ? el('small', '', run.text) : run.text)));
  };

  return {
    get line() {
      return line;
    },
    showLine: show,
    update(snapshot) {
      for (const [id, slot] of slots) write(slot, formatKpi(id, snapshot.kpis));
      for (const [id, node] of subs) setText(node, kpiSubText(id, snapshot.kpis));
      // An older snapshot has no yogurt line: its cards keep "—".
      const yogurt = (snapshot as Partial<Snapshot>).yogurt?.kpis;
      if (yogurt) {
        for (const [id, slot] of yogurtSlots) write(slot, formatYogurtKpi(id, yogurt));
        for (const [id, node] of yogurtSubs) setText(node, yogurtKpiSubText(id, yogurt));
      }
      if (fillers) setText(fillers, fillerOeeText(snapshot.packs?.fillers));
      // Sterility is the one KPI with a hard limit: it turns red on B* or a divert, never on F0 (D4).
      const sterility = slots.get('sterility');
      if (sterility) setAttr(sterility.card, 'data-s', sterilityStatus(snapshot.kpis.bStar, snapshot.stages[4].status));
    },
    dispose() {
      for (const slot of [...slots.values(), ...yogurtSlots.values()]) {
        slot.value.replaceChildren(NO_VALUE);
        slot.card.removeAttribute('data-s');
      }
      for (const node of [...subs.values(), ...yogurtSubs.values()]) node.textContent = NO_VALUE;
      if (fillers) fillers.textContent = NO_VALUE;
      show('uht');
    },
  };
}
