// Reads the snapshot for the packs line's labels and motion. A value the sim doesn't send (an older or
// partial snapshot) reads as undefined, and its label shows nothing rather than "NaN".
import type { Kpis, Snapshot, StageId, Status } from '../../../contracts';

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export function stageValue(snapshot: Snapshot, stage: StageId, key: string): number | undefined {
  return finite(snapshot.stages[stage]?.values[key]);
}

export function kpiValue(snapshot: Snapshot, key: keyof Kpis): number | undefined {
  return finite(snapshot.kpis?.[key]);
}

export function stageStatus(snapshot: Snapshot, stage: StageId): Status | undefined {
  return snapshot.stages[stage]?.status;
}

export function fillerFlowLph(snapshot: Snapshot): number | undefined {
  return finite(snapshot.line?.filler?.flowLph);
}

const formats = new Map<number, Intl.NumberFormat>();

/**
 * A label value such as "7,500", "55 °C" or "84 trays/pallet", in a fixed locale like the top bar, so
 * the labels read the same on every machine. '' when the value is missing.
 */
export function labelValue(value: number | undefined, decimals: number, unit: string): string {
  if (value === undefined) return '';
  let format = formats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formats.set(decimals, format);
  }
  // A small negative value rounds to "-0" (or "-0.0"); show it unsigned.
  const text = format.format(value).replace(/^-(?=0(\.0+)?$)/, '');
  return unit ? `${text} ${unit}` : text;
}
